import { randomUUID } from 'node:crypto'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { isValidApiSecret } from '../config.js'

let activePendingConfirm = null

export function getPendingConfirm() {
  if (!activePendingConfirm) return null
  const remainSeconds = Math.max(0, Math.ceil((activePendingConfirm.expiresAt - Date.now()) / 1000))
  return {
    id: activePendingConfirm.id,
    tweetId: activePendingConfirm.tweetId,
    authorUsername: activePendingConfirm.authorUsername,
    postContent: activePendingConfirm.postContent,
    plannedActions: activePendingConfirm.plannedActions,
    replyText: activePendingConfirm.replyText,
    timeoutSeconds: activePendingConfirm.timeoutSeconds,
    remainSeconds
  }
}

export function resolvePendingConfirm({ id, confirmed, replyText }) {
  if (!activePendingConfirm || activePendingConfirm.id !== id) {
    return false
  }
  const resolver = activePendingConfirm.resolve
  const fallbackReply = activePendingConfirm.replyText
  activePendingConfirm = null
  resolver({
    confirmed: Boolean(confirmed),
    replyText: typeof replyText === 'string' && replyText.trim() ? replyText.trim() : fallbackReply
  })
  return true
}

/**
 * 首次启动或未配置有效 api_secret 时弹框提示用户填写并保存
 */
export async function promptForApiSecret(browser, siteUrl = 'https://xlanv.net') {
  if (browser && typeof browser.evaluate === 'function') {
    try {
      const secret = await browser.evaluate(({ siteUrl }) => {
        return new Promise((resolve) => {
          const existing = document.getElementById('dsh-xlanv-secret-modal')
          if (existing) existing.remove()

          const overlay = document.createElement('div')
          overlay.id = 'dsh-xlanv-secret-modal'
          overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:9999999',
            'background:rgba(0,0,0,0.45)',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
          ].join(';')

          const box = document.createElement('div')
          box.style.cssText =
            'width:400px;background:#fff;border-radius:12px;padding:20px;box-shadow:0 12px 32px rgba(0,0,0,0.22);color:#1f2937;font-size:13px;'

          const title = document.createElement('div')
          title.style.cssText = 'font-size:16px;font-weight:700;color:#1d9bf0;margin-bottom:10px;'
          title.textContent = '配置 XLANV 插件密钥 (api_secret)'

          const desc = document.createElement('div')
          desc.style.cssText = 'color:#4b5563;line-height:1.6;margin-bottom:12px;'
          desc.textContent = `请先前往 ${siteUrl} 注册并绑定您的 X 用户名，然后将生成的 api_secret 粘贴到下方：`

          const errTip = document.createElement('div')
          errTip.style.cssText = 'color:#ef4444;font-size:12px;margin-bottom:8px;display:none;'
          errTip.textContent = '请输入有效的 api_secret'

          const inp = document.createElement('input')
          inp.type = 'text'
          inp.placeholder = '粘贴 32 位 api_secret'
          inp.style.cssText =
            'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-bottom:12px;'

          const btn = document.createElement('button')
          btn.textContent = '保存并启动'
          btn.style.cssText =
            'width:100%;padding:9px 14px;border:none;border-radius:6px;background:#1d9bf0;color:#fff;font-weight:600;cursor:pointer;'

          btn.onclick = () => {
            const val = inp.value.trim()
            if (!val) {
              errTip.style.display = 'block'
              return
            }
            overlay.remove()
            resolve(val)
          }

          box.appendChild(title)
          box.appendChild(desc)
          box.appendChild(errTip)
          box.appendChild(inp)
          box.appendChild(btn)
          overlay.appendChild(box)
          document.body.appendChild(overlay)
        })
      }, { siteUrl })

      if (isValidApiSecret(secret)) {
        return secret.trim()
      }
    } catch (err) {
      console.warn('[dsh-xlanv] 浏览器弹窗输入密钥失败，切换终端输入:', err.message)
    }
  }

  if (!process.stdin.isTTY) {
    throw new Error(`尚未配置有效的 api_secret，请前往 ${siteUrl} 获取后填入 config.json 或插件配置`)
  }

  const rl = readline.createInterface({ input, output })
  try {
    console.log(`\n[dsh-xlanv] 检测到尚未配置有效的 api_secret。`)
    console.log(`[dsh-xlanv] 请先前往 ${siteUrl} 注册并绑定 X 账号，然后复制您的 api_secret。`)
    while (true) {
      const answer = await rl.question('请输入您的 api_secret 并回车保存: ')
      if (isValidApiSecret(answer)) {
        return answer.trim()
      }
      console.log('输入的 api_secret 无效，请重新输入。')
    }
  } finally {
    rl.close()
  }
}

/**
 * 互动前确认弹窗（支持浏览器页面内悬浮倒计时弹窗 + 终端兜底）
 * 默认倒计时 20 秒：用户可修改内容、立即发送或取消跳过；若 20 秒内无人工干预则自动执行。
 */
export async function confirmBeforeInteract({
  browser,
  tweetId,
  authorUsername,
  postContent,
  plannedActions,
  replyText,
  timeoutSeconds = 20
}) {
  if (browser && typeof browser.evaluate === 'function') {
    try {
      const result = await browser.evaluate(
        ({ tweetId, authorUsername, postContent, plannedActions, replyText, timeoutSeconds }) => {
          return new Promise((resolve) => {
            const existing = document.getElementById('dsh-xlanv-confirm-modal')
            if (existing) existing.remove()

            const wrap = document.createElement('div')
            wrap.id = 'dsh-xlanv-confirm-modal'
            wrap.style.cssText = [
              'position:fixed',
              'right:20px',
              'bottom:20px',
              'width:360px',
              'z-index:999999',
              'background:#ffffff',
              'border:1px solid #dcdfe6',
              'border-radius:12px',
              'box-shadow:0 8px 28px rgba(0,0,0,0.18)',
              'padding:16px',
              'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
              'color:#1f2937',
              'font-size:13px'
            ].join(';')

            const title = document.createElement('div')
            title.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:8px;color:#1d9bf0;'
            title.textContent = `XLANV 互动确认 (@${authorUsername})`

            const info = document.createElement('div')
            info.style.cssText = 'color:#4b5563;margin-bottom:8px;line-height:1.4;'
            info.textContent = `推文 ${tweetId} | 计划动作: ${plannedActions.join(', ')}`

            const postPreview = document.createElement('div')
            postPreview.style.cssText =
              'background:#f3f4f6;padding:8px;border-radius:6px;margin-bottom:8px;max-height:60px;overflow:auto;font-size:12px;'
            postPreview.textContent = postContent.slice(0, 120)

            const textarea = document.createElement('textarea')
            textarea.value = replyText || ''
            textarea.rows = 3
            textarea.style.cssText =
              'width:100%;box-sizing:border-box;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-bottom:10px;'
            if (!plannedActions.includes('REPLY')) {
              textarea.style.display = 'none'
            }

            const countdownEl = document.createElement('div')
            countdownEl.style.cssText = 'font-size:12px;color:#d97706;margin-bottom:10px;'

            const btnRow = document.createElement('div')
            btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;'

            const cancelBtn = document.createElement('button')
            cancelBtn.textContent = '跳过本条'
            cancelBtn.style.cssText =
              'padding:6px 12px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;'

            const okBtn = document.createElement('button')
            okBtn.textContent = '立即执行'
            okBtn.style.cssText =
              'padding:6px 12px;border:none;background:#1d9bf0;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;'

            btnRow.appendChild(cancelBtn)
            btnRow.appendChild(okBtn)
            wrap.appendChild(title)
            wrap.appendChild(info)
            wrap.appendChild(postPreview)
            wrap.appendChild(textarea)
            wrap.appendChild(countdownEl)
            wrap.appendChild(btnRow)
            document.body.appendChild(wrap)

            let remain = timeoutSeconds
            countdownEl.textContent = `若无人工干预，${remain} 秒后自动执行...`

            const timer = setInterval(() => {
              remain -= 1
              if (remain <= 0) {
                cleanup({ confirmed: true, replyText: textarea.value })
              } else {
                countdownEl.textContent = `若无人工干预，${remain} 秒后自动执行...`
              }
            }, 1000)

            function cleanup(res) {
              clearInterval(timer)
              wrap.remove()
              resolve(res)
            }

            cancelBtn.onclick = () => cleanup({ confirmed: false, replyText: textarea.value })
            okBtn.onclick = () => cleanup({ confirmed: true, replyText: textarea.value })
          })
        },
        { tweetId, authorUsername, postContent, plannedActions, replyText, timeoutSeconds }
      )
      return result
    } catch (err) {
      console.warn('[dsh-xlanv] 浏览器内弹窗失败，降级为倒计时自动确认:', err.message)
    }
  }

  // 通过 DSH Web UI 悬浮倒计时弹窗队列等待人工确认（超时自动执行）
  const id = randomUUID()
  const waitSec = Math.max(3, Number(timeoutSeconds || 20))
  console.log(
    `[dsh-xlanv] 待确认互动 @${authorUsername} (${tweetId}) | 动作: ${plannedActions.join(', ')} | 回复: "${replyText}"`
  )
  console.log(`[dsh-xlanv] 已推送到 DSH 界面弹窗，${waitSec} 秒后若无干预将自动执行...`)

  return await new Promise((resolve) => {
    let settled = false
    const finish = (res) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (activePendingConfirm?.id === id) {
        activePendingConfirm = null
      }
      resolve(res)
    }

    const timer = setTimeout(() => {
      finish({ confirmed: true, replyText })
    }, waitSec * 1000)

    activePendingConfirm = {
      id,
      tweetId,
      authorUsername,
      postContent: String(postContent || '').slice(0, 180),
      plannedActions,
      replyText,
      timeoutSeconds: waitSec,
      expiresAt: Date.now() + waitSec * 1000,
      resolve: finish
    }
  })
}
