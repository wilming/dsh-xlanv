import { randomUUID } from 'node:crypto'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 解析 browser_snapshot 返回的文本，提取所有带编号的交互元素
 * 格式示例：  [12] button "Follow" → /user/status/123
 */
export function parseSnapshotItems(snapshotText = '') {
  const items = []
  const lineRe = /^\s*\[(\d+)\]\s+(\S+)\s+"([^"]*)"(.*)$/gm
  let m
  while ((m = lineRe.exec(snapshotText)) !== null) {
    const rest = m[4] || ''
    const hrefMatch = rest.match(/→\s+(\S+)/)
    items.push({
      index: Number(m[1]),
      role: m[2].toLowerCase(),
      name: m[3],
      href: hrefMatch ? hrefMatch[1] : '',
      disabled: /\[[^\]]*disabled[^\]]*\]/i.test(rest),
      raw: m[0]
    })
  }
  return items
}

/**
 * 解析 browser_list_tabs 返回的 JSON（可能包裹在 <UNTRUSTED_PAGE_CONTENT> 中）
 */
export function parseTabsList(tabsText = '') {
  const raw = String(tabsText || '')
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
      if (Array.isArray(parsed?.tabs)) {
        return parsed.tabs
      }
    } catch {
      // 回退到按行解析
    }
  }
  return []
}

/**
 * 解析 browser_list_tabs 返回的标签页列表，查找 x.com / twitter.com 的 tabId
 * 优先复用已在受控中或当前激活的 X 标签页，确保全部操作在同一个页面完成
 */
export function findXTabId(tabsText = '') {
  const tabs = parseTabsList(tabsText)
  if (tabs.length > 0) {
    const xTabs = tabs.filter((t) =>
      /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\b/i.test(String(t?.url || ''))
    )
    if (xTabs.length > 0) {
      const preferred = xTabs.find((t) => t.controlled) || xTabs.find((t) => t.active) || xTabs[0]
      if (typeof preferred?.tabId === 'number') {
        return preferred.tabId
      }
    }
  }

  // 兜底按行匹配
  const lines = String(tabsText).split('\n')
  for (const line of lines) {
    if (!/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\b/i.test(line)) continue
    const idMatch = line.match(/(?:tabId[:=\s"]+|^\[?)(\d+)\b/i)
    if (idMatch) return Number(idMatch[1])
  }
  return null
}

/**
 * 将 dsh-browser-x 注册在 ctx.tools 上的 browser_* 工具
 * 适配为 XAutomationRunner 所需的浏览器操作接口
 */
export class DshBrowserToolAdapter {
  constructor(toolsRuntime) {
    this.tools = toolsRuntime
    this.attachedTabId = null
  }

  async callTool(name, args = {}) {
    if (!this.tools || typeof this.tools.execute !== 'function') {
      throw new Error('dsh-tools 服务未就绪')
    }
    const res = await this.tools.execute({
      callId: randomUUID(),
      name,
      arguments: args,
      signal: new AbortController().signal
    })
    if (res.isError) {
      const errMsg =
        res.content?.map((c) => c?.text).filter(Boolean).join('\n') ||
        res.error?.message ||
        '工具调用失败'
      throw new Error(`[${name}] ${errMsg}`)
    }
    if (res.value && typeof res.value === 'object' && typeof res.value.text === 'string') {
      return res.value.text
    }
    return res.content?.map((c) => c?.text).filter(Boolean).join('\n') || ''
  }

  async ensureXTab(defaultUrl = 'https://x.com/home') {
    const tabsText = await this.callTool('browser_list_tabs', {})
    const tabs = parseTabsList(tabsText)

    // 1. 如果此前锁定的标签页依然存在，直接复用它（绝不新开标签页）
    if (this.attachedTabId !== null) {
      const stillOpen = tabs.find((t) => t.tabId === this.attachedTabId)
      if (stillOpen) {
        if (!stillOpen.controlled) {
          await this.callTool('browser_follow_tab', { tabId: this.attachedTabId })
        }
        return this.attachedTabId
      }
      this.attachedTabId = null
    }

    // 2. 查找浏览器里已有的任意 X / Twitter 标签页并锁定它
    const existingTabId = findXTabId(tabsText)
    if (existingTabId !== null) {
      const targetTab = tabs.find((t) => t.tabId === existingTabId)
      if (!targetTab?.controlled) {
        await this.callTool('browser_follow_tab', { tabId: existingTabId })
      }
      this.attachedTabId = existingTabId
      return existingTabId
    }

    // 3. 只有当浏览器里完全没有 X 标签页时，才打开唯一一个新标签页；
    // 若已打开过且列表仍为空，直接复用当前受控页或导航过去，绝不重复开新标签页
    await this.callTool('browser_open_tab', { url: defaultUrl, active: true })
    await this.callTool('browser_wait', { ms: 3000 })

    const updatedTabs = await this.callTool('browser_list_tabs', {})
    const newTabId = findXTabId(updatedTabs)
    if (newTabId !== null) {
      this.attachedTabId = newTabId
    }
    return this.attachedTabId
  }

  async followUser(xUsername) {
    if (!xUsername) return false
    await this.ensureXTab()
    await this.callTool('browser_navigate', { url: `https://x.com/${xUsername}` })
    await this.callTool('browser_wait', { ms: 2500 })

    const snapshot = await this.callTool('browser_snapshot', {})
    const items = parseSnapshotItems(snapshot)
    const followBtn = items.find(
      (item) =>
        !item.disabled &&
        (item.role === 'button' || item.role === 'link') &&
        /^(Follow|关注)\b/i.test(item.name) &&
        !/^(Following|正在关注)/i.test(item.name)
    )
    if (!followBtn) {
      return false
    }

    await this.callTool('browser_click', { index: followBtn.index })
    await this.callTool('browser_wait', { ms: 1200 })
    return true
  }

  async openPostFromFollowing(authorUsername, tweetId) {
    await this.ensureXTab()
    // 优先通过关注信息流定位作者链接进入主页，避免生硬 URL 直跳
    await this.callTool('browser_navigate', { url: 'https://x.com/following' })
    await this.callTool('browser_wait', { ms: 2000 })

    let snapshot = await this.callTool('browser_snapshot', {})
    let items = parseSnapshotItems(snapshot)
    const authorLink = items.find(
      (item) =>
        item.role === 'link' &&
        item.href &&
        new RegExp(`/${authorUsername}(?:[/?#]|$)`, 'i').test(item.href)
    )
    if (authorLink) {
      await this.callTool('browser_click', { index: authorLink.index })
    } else {
      await this.callTool('browser_navigate', { url: `https://x.com/${authorUsername}` })
    }
    await this.callTool('browser_wait', { ms: 2500 })

    snapshot = await this.callTool('browser_snapshot', {})
    items = parseSnapshotItems(snapshot)
    const postLink = items.find(
      (item) => item.href && item.href.includes(`/status/${tweetId}`)
    )
    if (postLink) {
      await this.callTool('browser_click', { index: postLink.index })
    } else {
      await this.callTool('browser_navigate', { url: `https://x.com/${authorUsername}/status/${tweetId}` })
    }
    await this.callTool('browser_wait', { ms: 2500 })
  }

  async scanTimelineTweets() {
    await this.ensureXTab('https://x.com/home')
    const snapshot = await this.callTool('browser_snapshot', {})
    const items = parseSnapshotItems(snapshot)

    const tweetMap = new Map()
    const statusRe = /(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com)?\/([A-Za-z0-9_]{1,30})\/status\/(\d+)/i
    for (const item of items) {
      if (!item.href) continue
      const m = item.href.match(statusRe)
      if (!m) continue
      const authorUsername = m[1]
      const tweetId = m[2]
      if (!tweetMap.has(tweetId)) {
        tweetMap.set(tweetId, {
          tweetId,
          authorXId: authorUsername,
          authorUsername,
          content: item.name || ''
        })
      }
    }

    // 轻量下滑滚动刷新更多信息流条目
    try {
      await this.callTool('browser_scroll', { direction: 'down', amount: 450 })
    } catch {
      // 忽略滚动异常
    }

    return Array.from(tweetMap.values()).slice(0, 50)
  }

  /**
   * 抓取本人 X 主页的前 10 条原创帖子，用于帖子推广管理页与本地配置合并
   */
  async scanProfileTweets(xUsername, limit = 10) {
    const cleanUser = String(xUsername || '').replace(/^@/, '').trim()
    if (!cleanUser) {
      throw new Error('未提供 X 用户名，无法抓取个人主页帖子')
    }

    await this.ensureXTab(`https://x.com/${cleanUser}`)
    await this.callTool('browser_navigate', { url: `https://x.com/${cleanUser}` })
    await this.callTool('browser_wait', { ms: 3000 })

    const tweetMap = new Map()
    const statusRe = new RegExp(
      `(?:https?:\\/\\/(?:www\\.)?(?:x|twitter)\\.com)?\\/${cleanUser}\\/status\\/(\\d+)`,
      'i'
    )

    for (let round = 0; round < 3 && tweetMap.size < limit; round++) {
      const snapshot = await this.callTool('browser_snapshot', {})
      const items = parseSnapshotItems(snapshot)
      for (const item of items) {
        if (!item.href) continue
        const m = item.href.match(statusRe)
        if (!m) continue
        const tweetId = m[1]
        if (!tweetMap.has(tweetId)) {
          tweetMap.set(tweetId, {
            tweetId,
            authorUsername: cleanUser,
            content: item.name || '',
            url: `https://x.com/${cleanUser}/status/${tweetId}`
          })
          if (tweetMap.size >= limit) break
        }
      }
      if (tweetMap.size < limit && round < 2) {
        await this.callTool('browser_scroll', { direction: 'down', amount: 650 })
        await sleep(1000)
      }
    }

    return Array.from(tweetMap.values()).slice(0, limit)
  }

  async interactTweet({ tweetId, actions = [], replyText = '' }) {
    await this.ensureXTab()
    let snapshot = await this.callTool('browser_snapshot', {})
    if (!snapshot.includes(`/status/${tweetId}`)) {
      await this.callTool('browser_navigate', { url: `https://x.com/i/web/status/${tweetId}` })
      await this.callTool('browser_wait', { ms: 2500 })
      snapshot = await this.callTool('browser_snapshot', {})
    }

    let replyTweetId = ''
    const executedActions = []

    if (actions.includes('RETWEET')) {
      const items = parseSnapshotItems(snapshot)
      const repostBtn = items.find(
        (item) =>
          !item.disabled &&
          item.role === 'button' &&
          /\b(Repost|Retweet|转推|转发)\b/i.test(item.name) &&
          !/Undo|取消/i.test(item.name)
      )
      if (repostBtn) {
        await this.callTool('browser_click', { index: repostBtn.index })
        await sleep(700)
        const menuSnap = await this.callTool('browser_snapshot', {})
        const menuItems = parseSnapshotItems(menuSnap)
        const confirmRepost = menuItems.find(
          (item) =>
            (item.role === 'menuitem' || item.role === 'button') &&
            /^(Repost|Retweet|转发|转推)$/i.test(item.name.trim())
        )
        if (confirmRepost) {
          await this.callTool('browser_click', { index: confirmRepost.index })
          await sleep(1000)
          executedActions.push('RETWEET')
          snapshot = await this.callTool('browser_snapshot', {})
        }
      }
    }

    if (actions.includes('LIKE')) {
      const items = parseSnapshotItems(snapshot)
      const likeBtn = items.find(
        (item) =>
          !item.disabled &&
          item.role === 'button' &&
          /\b(Like|喜欢|点赞)\b/i.test(item.name) &&
          !/Unlike|Liked|取消|已喜欢/i.test(item.name)
      )
      if (likeBtn) {
        await this.callTool('browser_click', { index: likeBtn.index })
        await sleep(800)
        executedActions.push('LIKE')
        snapshot = await this.callTool('browser_snapshot', {})
      }
    }

    if (actions.includes('REPLY') && replyText) {
      let items = parseSnapshotItems(snapshot)
      let inputBox = items.find(
        (item) =>
          item.role === 'contenteditable' ||
          item.role === 'textarea' ||
          item.role === 'textbox'
      )

      if (!inputBox) {
        const replyTrigger = items.find(
          (item) =>
            !item.disabled &&
            item.role === 'button' &&
            /\b(Reply|回复)\b/i.test(item.name)
        )
        if (replyTrigger) {
          await this.callTool('browser_click', { index: replyTrigger.index })
          await this.callTool('browser_wait', { ms: 1000 })
          snapshot = await this.callTool('browser_snapshot', {})
          items = parseSnapshotItems(snapshot)
          inputBox = items.find(
            (item) =>
              item.role === 'contenteditable' ||
              item.role === 'textarea' ||
              item.role === 'textbox'
          )
        }
      }

      if (inputBox) {
        await this.callTool('browser_type', {
          index: inputBox.index,
          text: replyText,
          replace: false
        })
        await sleep(700)
        const afterTypeSnap = await this.callTool('browser_snapshot', {})
        const afterItems = parseSnapshotItems(afterTypeSnap)
        const submitBtn = afterItems.find(
          (item) =>
            !item.disabled &&
            item.role === 'button' &&
            /^(Reply|Post|回复|发帖)$/i.test(item.name.trim())
        )
        if (submitBtn) {
          await this.callTool('browser_click', { index: submitBtn.index })
          await this.callTool('browser_wait', { ms: 2500 })
          const afterPostSnap = await this.callTool('browser_snapshot', {})
          const postItems = parseSnapshotItems(afterPostSnap)
          const statusMatches = postItems
            .map((i) => i.href?.match(/\/status\/(\d+)/)?.[1])
            .filter((id) => id && id !== String(tweetId))
          if (statusMatches.length > 0) {
            replyTweetId = statusMatches[statusMatches.length - 1]
            executedActions.push('REPLY')
          }
        }
      }
    }

    return { executedActions, replyTweetId }
  }
}
