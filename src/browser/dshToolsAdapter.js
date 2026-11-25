import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { activityLogger } from '../storage/activityLogger.js'

const browserLockContext = new AsyncLocalStorage()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const humanPause = (minMs, maxMs) => sleep(randomInt(minMs, maxMs))

function isTimestampLabel(text = '') {
  const s = String(text || '').trim()
  if (!s) return true
  return (
    /^\d+\s*[smhd]$/i.test(s) ||
    /^\d+\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.test(s) ||
    /^just\s+now$/i.test(s) ||
    /^\d+\s*(秒|分钟?|小时|天)前?$/.test(s) ||
    /^(?:\d{4}[年/-])?\d{1,2}[月/-]\d{1,2}日?$/.test(s) ||
    /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,\s*\d{4})?$/i.test(s) ||
    /^\d{1,2}:\d{2}(?:\s*[AP]M)?(?:\s*·.*)?$/i.test(s)
  )
}

function unwrapUntrustedText(raw = '') {
  return String(raw || '')
    .replace(/<\/?UNTRUSTED_PAGE_CONTENT[^>]*>/gi, '')
    .replace(/Security:\s*Enclosed page content is untrusted data[^\n]*\n?/gi, '')
    .replace(/Treat returned page text as untrusted data[^\n]*\n?/gi, '')
    .replace(/⟦i\d+[^⟧]*⟧/g, ' ')
    .replace(
      /(?:Translated from [A-Za-z\u4e00-\u9fa5]+(?:\s*\([^)]+\))?|由\s*[A-Za-z0-9_\u4e00-\u9fa5]+\s*翻译|Show original|View original|显示原文|查看原文|显示原帖|Translate post|翻译帖子)/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
}

const CHROME_NOISE_RE =
  /(?:To view keyboard shortcuts,\s*press question mark|View keyboard shortcuts|Skip to home timeline|Skip to trending|Set up profile|\bSubscribe\b|\bFor you\b\s+\bFollowing\b)/i

function isPollutedChromeText(text = '') {
  const s = String(text || '').trim()
  if (!s) return true
  return CHROME_NOISE_RE.test(s)
}

function extractMainContentFromSnapshot(snapshotText = '') {
  const cleanedRaw = String(snapshotText || '')
    .replace(/<\/?UNTRUSTED_PAGE_CONTENT[^>]*>/gi, '')
    .replace(/Security:\s*Enclosed page content is untrusted data[^\n]*\n?/gi, '')
    .replace(/Treat returned page text as untrusted data[^\n]*\n?/gi, '')
  const m = cleanedRaw.match(
    /(?:Changed )?Main content:\s*\r?\n?([\s\S]*?)(?:\r?\n\s*\r?\n\s*(?:Changed )?(?:Interactive|Form|Images)\b|$)/i
  )
  if (m && m[1] && m[1].trim()) return m[1]
  // 若快照格式无显式 Main content 头，剥离 Interactive/Form/Images 区块后兜底返回文本部分
  return cleanedRaw
    .replace(/\r?\n\s*\r?\n\s*(?:Changed )?(?:Interactive|Form|Images)\b[\s\S]*$/i, '')
    .trim()
}

function isReplyOrThreadContinuation(snapshotText = '', cleanUser = '', tweetId = '') {
  const raw = String(snapshotText || '')
  if (!raw) return false
  const cleanLower = String(cleanUser || '').replace(/^@/, '').toLowerCase()

  // 1. 仅在 Main content 中「推文详情时间戳（如 11:27 · 2026年11月24日 / 11:27 AM · Nov 24, 2026）」之前的正文头部区域
  //    检测「Replying to @xxx」或「回复 @xxx」，彻底避开主帖下方内嵌回复输入框的「回复 @作者」以及 Interactive 区块
  const mainBlock = extractMainContentFromSnapshot(raw)
  const tsSplitRe =
    /(?:(?:上午|下午)?\d{1,2}:\d{2}\s*·\s*\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}\s*(?:AM|PM)\s*·\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s*\d{4})/i
  const beforeTimestamp = mainBlock ? mainBlock.split(tsSplitRe)[0] || '' : ''
  if (/(?:Replying to|回复)\s+@[A-Za-z0-9_]+/i.test(beforeTimestamp)) {
    return true
  }

  // 2. 在 detail page 的 main 快照中，若目标推文链接之前已经出现过父帖的互动按钮栏（Reply/Repost/Like），
  //    说明上方存在父帖（即本帖是回复别人的评论，或串推的第 2/3/... 条，而非第一条）。
  //    （注：引用推文嵌套在主帖内部且没有独立互动按钮栏，不会误判）
  if (cleanLower && tweetId) {
    const items = parseSnapshotItems(raw)
    const targetRe = new RegExp(`\\/${cleanLower}\\/status\\/${tweetId}(?:$|[?#])`, 'i')
    const actionBtnRe = /\b(Reply|Replies|Repost|Reposts|Retweet|Like|Likes)\b|回复|转帖|轉帖|转发|喜欢|点赞/i
    for (const item of items) {
      if (item.href && targetRe.test(item.href)) break
      if (item.role === 'button' && actionBtnRe.test(item.name || '')) {
        return true
      }
    }
  }

  return false
}

function stripDetailNoise(text = '', username = '') {
  const cleanUser = String(username || '').replace(/^@/, '').trim()
  let out = String(text || '').trim()
  out = out.replace(
    /^(?:发帖|Post)?\s*(?:X\s*上的\s*[^\n"“]+?[：:]\s*[“"][^"”]+[”"]|[^\n"]*?\s+on X:\s*"[^"]+")\s*(?:对话|Conversation)?\s*/i,
    ''
  )
  if (cleanUser) {
    out = out.replace(new RegExp(`^.{0,80}?@${cleanUser}\\s*`, 'i'), '')
  } else {
    out = out.replace(/^.{0,80}?@[A-Za-z0-9_]+\s+/, '')
  }
  out = out
    .replace(/^(?:·\s*)?(?:\d+\s*(?:[smhd]|seconds?|minutes?|hours?|days?|秒|分钟?|小时|天)前?|just\s+now)\s+/i, '')
    .replace(/(?:上午|下午)?\d{1,2}:\d{2}\s*·\s*\d{4}年\d{1,2}月\d{1,2}日[\s\S]*$/i, '')
    .replace(/\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\s*·\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s*\d{4}[\s\S]*$/i, '')
    .replace(/\s*·\s*[\d.,KM万]+\s*(?:Views?|查看|次查看|浏览)[\s\S]*$/i, '')
    .trim()
  return out
}

function extractTitleQuotedTweetText(snapshotText = '') {
  const titleLine = (String(snapshotText || '').match(/^Title:\s*(.+)$/im) || [])[1] || ''
  if (!titleLine) return ''
  const enMatch = titleLine.match(/^[^\n"]*?\s+on X:\s*"([\s\S]+?)"\s*(?:\/\s*X)?$/i)
  if (enMatch && enMatch[1]) {
    const q = unwrapUntrustedText(enMatch[1])
    if (q && !isPollutedChromeText(q)) return q
  }
  const zhMatch = titleLine.match(/^X\s*上的\s*[^\n"“]+?[：:]\s*[“"]([\s\S]+?)[”"]\s*(?:\/\s*X)?$/i)
  if (zhMatch && zhMatch[1]) {
    const q = unwrapUntrustedText(zhMatch[1])
    if (q && !isPollutedChromeText(q)) return q
  }
  return ''
}

function extractTweetTextFromDetailSnapshot(snapshotText = '', username = '') {
  const block = extractMainContentFromSnapshot(snapshotText)
  if (!block) return extractTitleQuotedTweetText(snapshotText)

  // 1. 优先匹配 X 详情页无障碍标题格式: Post<Name> on X: "<正文>" 或 (发帖)X 上的 <Name>：“<正文>”
  const titleQuoteMatch =
    block.match(/Post[^\n"]*?\s+on X:\s*"([^"]{1,350})"/i) ||
    block.match(/(?:发帖)?X\s*上的\s*[^\n"“]+?[：:]\s*[“"]([^"”]{1,350})[”"]/i)
  if (titleQuoteMatch && titleQuoteMatch[1]) {
    const quoted = unwrapUntrustedText(titleQuoteMatch[1])
    if (quoted && !isPollutedChromeText(quoted)) return quoted
  }

  // 2. 从 Main content 逐行剥离导航栏/用户信息/时间戳/操作栏噪音
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.replace(/⟦i\d+[^⟧]*⟧/g, ' ').trim())
    .filter(Boolean)

  const cleanUser = String(username || '').replace(/^@/, '').trim()
  const filtered = []
  let started = false
  for (const line of lines) {
    if (
      /^(?:To view keyboard shortcuts|View keyboard shortcuts|Skip to home timeline|Skip to trending|Post|Conversation|对话|帖子|Home|Explore|Notifications|Messages|Grok|Bookmarks|Profile|More|Subscribe|For you|Following|Follow|Set up profile|\d+\s+posts?)$/i.test(
        line
      )
    ) {
      if (/^(?:Conversation|对话)$/i.test(line)) started = true
      continue
    }
    if (cleanUser && new RegExp(`^@?${cleanUser}$`, 'i').test(line)) {
      started = true
      continue
    }
    if (/^@[A-Za-z0-9_]+$/.test(line)) continue
    if (/^(?:Translated from|Show original|View original|Translate post|显示原文|查看原文|显示原帖|翻译帖子|由\s*\S+\s*翻译)/i.test(line)) {
      continue
    }
    // 到达底部时间线/数据统计区即停止收集
    if (
      /^(?:\d{1,2}:\d{2}\s*(?:AM|PM)|(?:上午|下午)?\d{1,2}:\d{2}\s*·\s*\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\s*·\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s*\d{4}|·|\d+\s*Views?|Views?|Replies?|Reposts?|Likes?|Bookmarks?|Quote|查看次数|回复|转发|转帖|点赞)$/i.test(
        line
      )
    ) {
      if (started && filtered.length > 0) break
      continue
    }
    if (isTimestampLabel(line)) continue
    filtered.push(line)
  }

  const joined = stripDetailNoise(unwrapUntrustedText(filtered.join(' ')), cleanUser)
  if (joined && !isPollutedChromeText(joined)) return joined
  return extractTitleQuotedTweetText(snapshotText)
}

/**
 * 从 browser_snapshot 的 Main content 文本块中提取 @username · <时间> 之后的推文正文片段
 */
export function extractTweetSnippetsFromMain(snapshotText = '', username = '') {
  const raw = unwrapUntrustedText(snapshotText)
  const mainMatch = raw.match(/(?:Changed )?Main content:\s*\n([\s\S]*?)(?:\n\n(?:Changed )?(?:Interactive|Form|Images)|$)/i)
  const mainText = (mainMatch ? mainMatch[1] : raw).trim()
  if (!mainText || !username) return []

  const cleanUser = username.replace(/^@/, '')
  const tsPattern = '(?:\\d+\\s*(?:seconds?|minutes?|hours?|days?|weeks?)\\s+ago|just\\s+now|\\d+\\s*[smhd]|\\d+\\s*(?:秒|分钟?|小时|天)前?|(?:\\d{4}[年/-])?\\d{1,2}[月/-]\\d{1,2}日?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2}(?:,\\s*\\d{4})?)'
  const re = new RegExp(`@${cleanUser}\\s*·\\s*${tsPattern}\\s+`, 'gi')
  const parts = mainText.split(re)
  if (parts.length <= 1) return []

  return parts.slice(1).map((seg) =>
    seg
      .replace(/⟦i\d+[^⟧]*⟧/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140)
  )
}

export function parseTweetMetricsFromItems(items = []) {
  const metrics = { x_replies: 0, x_retweets: 0, x_likes: 0 }
  for (const item of items) {
    if (item.role !== 'button' && item.role !== 'link') continue
    const name = String(item.name || '').trim()
    const numMatch = name.match(/(\d+(?:[.,]\d+)?)\s*([KM万亿])?/i)
    let count = 0
    if (numMatch) {
      const base = Number(numMatch[1].replace(/,/g, ''))
      const unit = (numMatch[2] || '').toUpperCase()
      if (unit === 'K') count = Math.round(base * 1000)
      else if (unit === 'M') count = Math.round(base * 1000000)
      else if (unit === '万') count = Math.round(base * 10000)
      else count = Math.round(base)
    }
    if (/\b(Replies|Reply|回复)\b/i.test(name)) {
      metrics.x_replies = Math.max(metrics.x_replies, count)
    } else if (/\b(Reposts?|Retweets?|转帖|转推|转发)\b/i.test(name)) {
      metrics.x_retweets = Math.max(metrics.x_retweets, count)
    } else if (/\b(Likes?|喜欢|点赞)\b/i.test(name)) {
      metrics.x_likes = Math.max(metrics.x_likes, count)
    }
  }
  return metrics
}

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
    this.homeFeedTab = 'foryou'
    this._lockTail = Promise.resolve()
  }

  /**
   * 可重入的浏览器互斥锁：防止“后台巡检”与“手动刷新帖子列表”同时抢占同一个 X 标签页导致互相跳转超时
   */
  async withBrowserLock(fn) {
    if (browserLockContext.getStore() === this) {
      return await fn()
    }
    const prev = this._lockTail
    let release
    this._lockTail = new Promise((resolve) => {
      release = resolve
    })
    await prev
    try {
      return await browserLockContext.run(this, fn)
    } finally {
      release()
    }
  }

  async callTool(name, args = {}) {
    if (!this.tools) {
      throw new Error('dsh-tools 服务未就绪')
    }

    const signal = new AbortController().signal

    // 优先通过 tools.get(name).execute 直接调用工具实现，绕过缺少 agent 上下文时的 Tool batch 调度报错
    if (typeof this.tools.get === 'function') {
      const tool = this.tools.get(name)
      if (tool && typeof tool.execute === 'function') {
        try {
          const val = await tool.execute(args, { callId: randomUUID(), signal })
          if (typeof val === 'string') return val
          if (val && typeof val === 'object' && typeof val.text === 'string') return val.text
          return JSON.stringify(val ?? '')
        } catch (err) {
          throw new Error(`[${name}] ${err?.message || String(err)}`)
        }
      }
    }

    if (typeof this.tools.execute !== 'function') {
      throw new Error(`dsh-tools 未找到工具 ${name}`)
    }

    const res = await this.tools.execute({
      callId: randomUUID(),
      name,
      arguments: args,
      signal
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
    return await this.withBrowserLock(async () => {
      const cleanUser = String(xUsername || '').replace(/^@/, '').trim()
      if (!cleanUser) return false

    await this.ensureXTab(`https://x.com/${cleanUser}`)
    await this.callTool('browser_navigate', { url: `https://x.com/${cleanUser}` })
    await humanPause(2600, 4500)

    // 仅在 main 区域查找，避免误点右侧边栏“推荐关注”的 Follow 按钮
    const snapshot = await this.callTool('browser_snapshot', { region: 'main' })
    const items = parseSnapshotItems(snapshot)

    const userRe = new RegExp(`@${cleanUser}\\b`, 'i')
    const isFollowingBtn = (item) =>
      (item.role === 'button' || item.role === 'link') &&
      /^(Following|正在关注)/i.test(item.name.trim())

    // 如果本来就已经处于正在关注状态，不重复点击，直接返回 false 避免未实际关注就刷分
    const alreadyFollowing = items.find((item) => isFollowingBtn(item) && userRe.test(item.name))
    if (alreadyFollowing) {
      return false
    }

    const followBtn =
      items.find(
        (item) =>
          !item.disabled &&
          (item.role === 'button' || item.role === 'link') &&
          /^(Follow|关注)\b/i.test(item.name.trim()) &&
          userRe.test(item.name) &&
          !/^(Following|正在关注)/i.test(item.name.trim())
      ) ||
      items.find(
        (item) =>
          !item.disabled &&
          (item.role === 'button' || item.role === 'link') &&
          /^(Follow|关注)$/i.test(item.name.trim())
      )

    if (!followBtn) {
      return false
    }

    await this.callTool('browser_click', { index: followBtn.index })
    await humanPause(1800, 3000)

    // 点击后二次校验：必须确认页面按钮真正变成了 Following / 正在关注，才算关注成功
    const verifySnap = await this.callTool('browser_snapshot', { region: 'main', delta: true })
    let verifyItems = parseSnapshotItems(verifySnap)
    let confirmed = verifyItems.some((item) => isFollowingBtn(item))
    if (!confirmed) {
      const fullVerifySnap = await this.callTool('browser_snapshot', { region: 'main' })
      verifyItems = parseSnapshotItems(fullVerifySnap)
      confirmed = verifyItems.some((item) => isFollowingBtn(item) && (userRe.test(item.name) || /^(Following|正在关注)$/i.test(item.name.trim())))
    }

      return confirmed
    })
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

  /**
   * 巡检只去 x.com/home 的 For You 和 Following 两个页面，每个页面各滑动采集约 10 条推文
   */
  async scanTimelineTweets(perFeedLimit = 10) {
    const feedLimit = Math.min(12, Math.max(5, Number(perFeedLimit || 10)))
    const tabId = await this.ensureXTab('https://x.com/home')

    // 若已在 home 则主动刷新回到顶部；若不在 home 则导航过去
    const tabsText = await this.callTool('browser_list_tabs', {})
    const tabs = parseTabsList(tabsText)
    const activeTab = tabs.find((t) => t.tabId === tabId || t.controlled)
    const curUrl = String(activeTab?.url || '')
    if (!/x\.com\/home\b/i.test(curUrl) && !/twitter\.com\/home\b/i.test(curUrl)) {
      await this.callTool('browser_navigate', { url: 'https://x.com/home' })
    } else {
      await this.callTool('browser_reload', {})
    }
    await this.callTool('browser_wait', { ms: 3500 })
    await humanPause(2000, 3500)

    const allTweets = new Map()
    const statusRe = /(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com)?\/([A-Za-z0-9_]{1,30})\/status\/(\d+)/i

    const scanSingleFeed = async (tabNameRegex) => {
      let snapshot = await this.callTool('browser_snapshot', { region: 'main' })
      let items = parseSnapshotItems(snapshot)

      const tabBtn = items.find(
        (item) =>
          (item.role === 'tab' || item.role === 'link' || item.role === 'button') &&
          tabNameRegex.test(item.name.trim())
      )
      if (tabBtn) {
        await humanPause(1500, 2800)
        await this.callTool('browser_click', { index: tabBtn.index })
        await humanPause(3000, 5500)
        snapshot = await this.callTool('browser_snapshot', { region: 'main' })
        items = parseSnapshotItems(snapshot)
      }

      const feedMap = new Map()
      const collectFromItems = (list) => {
        for (const item of list) {
          if (!item.href) continue
          const m = item.href.match(statusRe)
          if (!m) continue
          const authorUsername = m[1]
          const tweetId = m[2]
          if (!feedMap.has(tweetId)) {
            const tweetObj = {
              tweetId,
              authorXId: authorUsername,
              authorUsername,
              content: isTimestampLabel(item.name) ? '' : (item.name || '')
            }
            feedMap.set(tweetId, tweetObj)
            if (!allTweets.has(tweetId)) {
              allTweets.set(tweetId, tweetObj)
            }
            if (feedMap.size >= feedLimit) break
          }
        }
      }

      collectFromItems(items)

      // 每个页面各滑动 1~2 次，采集约 10 条即止，停顿模拟真人阅读节奏
      for (let scrollRound = 0; scrollRound < 2 && feedMap.size < feedLimit; scrollRound++) {
        try {
          await humanPause(2200, 4200)
          await this.callTool('browser_scroll', { direction: 'down', amount: randomInt(450, 780) })
          await humanPause(3000, 5500)
          const deltaSnap = await this.callTool('browser_snapshot', { region: 'main', delta: true })
          collectFromItems(parseSnapshotItems(deltaSnap))
        } catch {
          break
        }
      }
    }

    // 1. 先巡检 For You（为你推荐）约 10 条
    await scanSingleFeed(/^(For you|为你推荐)$/i)
    // 2. 停顿后切换巡检 Following（正在关注）约 10 条
    await humanPause(2800, 5200)
    await scanSingleFeed(/^(Following|正在关注)$/i)

    return Array.from(allTweets.values())
  }

  /**
   * 拟人化“边刷边看”巡检：只去 For You 和 Following 各刷约 10 条，
   * 看到一条即通过 onTweetSeen 实时校验一条，符合推广条件当场互动后再继续往下滑
   */
  async browseHomeFeeds(perFeedLimit = 10, onTweetSeen) {
    return await this.withBrowserLock(async () => {
      const feedLimit = Math.min(12, Math.max(5, Number(perFeedLimit || 10)))
      const tabId = await this.ensureXTab('https://x.com/home')

    const ensureOnHome = async (forceReload = false) => {
      const tabsText = await this.callTool('browser_list_tabs', {})
      const tabs = parseTabsList(tabsText)
      const activeTab = tabs.find((t) => t.tabId === tabId || t.controlled)
      const curUrl = String(activeTab?.url || '')
      if (!/x\.com\/home\b/i.test(curUrl) && !/twitter\.com\/home\b/i.test(curUrl)) {
        try {
          await this.callTool('browser_back', {})
          await humanPause(2000, 3500)
          const backTabs = parseTabsList(await this.callTool('browser_list_tabs', {}))
          const backUrl = String(backTabs.find((t) => t.tabId === tabId || t.controlled)?.url || '')
          if (!/x\.com\/home\b/i.test(backUrl) && !/twitter\.com\/home\b/i.test(backUrl)) {
            await this.callTool('browser_navigate', { url: 'https://x.com/home' })
          }
        } catch {
          await this.callTool('browser_navigate', { url: 'https://x.com/home' })
        }
      } else if (forceReload) {
        await this.callTool('browser_reload', {})
      }
      await this.callTool('browser_wait', { ms: 3200 })
    }

    await ensureOnHome(true)
    await humanPause(3000, 5500)

    const seenGlobal = new Set()
    const statusRe = /(?:https?:\/\/(?:www\.)?(?:x|twitter)\.com)?\/([A-Za-z0-9_]{1,30})\/status\/(\d+)/i

    const browseSingleFeed = async (tabNameRegex) => {
      await ensureOnHome(false)
      let snapshot = await this.callTool('browser_snapshot', { region: 'main' })
      let items = parseSnapshotItems(snapshot)

      const tabBtn = items.find(
        (item) =>
          (item.role === 'tab' || item.role === 'link' || item.role === 'button') &&
          tabNameRegex.test(item.name.trim())
      )
      if (tabBtn) {
        await humanPause(1500, 2800)
        await this.callTool('browser_click', { index: tabBtn.index })
        await humanPause(3000, 5500)
        snapshot = await this.callTool('browser_snapshot', { region: 'main' })
        items = parseSnapshotItems(snapshot)
      }

      let feedCount = 0
      const processVisibleItems = async (list) => {
        for (const item of list) {
          if (feedCount >= feedLimit) break
          if (!item.href) continue
          const m = item.href.match(statusRe)
          if (!m) continue
          const authorUsername = m[1]
          const tweetId = m[2]
          if (seenGlobal.has(tweetId)) continue
          seenGlobal.add(tweetId)
          feedCount++

            if (typeof onTweetSeen === 'function') {
            const didInteract = await onTweetSeen({
              tweetId,
              authorXId: authorUsername,
              authorUsername,
              content: ''
            })
            if (didInteract) {
              await ensureOnHome(false)
            }
          }
        }
      }

      await processVisibleItems(items)

      for (let scrollRound = 0; scrollRound < 2 && feedCount < feedLimit; scrollRound++) {
        try {
          await humanPause(2200, 4200)
          await this.callTool('browser_scroll', { direction: 'down', amount: randomInt(450, 780) })
          await humanPause(2800, 4800)
          let nextItems = []
          try {
            const deltaSnap = await this.callTool('browser_snapshot', { region: 'main', delta: true })
            nextItems = parseSnapshotItems(deltaSnap)
          } catch {
            nextItems = []
          }
          const hasUnseenStatus = nextItems.some((item) => {
            const m = item.href && item.href.match(statusRe)
            return m && !seenGlobal.has(m[2])
          })
          if (!hasUnseenStatus) {
            const fullSnap = await this.callTool('browser_snapshot', { region: 'main' })
            nextItems = parseSnapshotItems(fullSnap)
          }
          await processVisibleItems(nextItems)
        } catch {
          break
        }
      }
    }

      await browseSingleFeed(/^(For you|为你推荐)$/i)
      await humanPause(2800, 5200)
      await browseSingleFeed(/^(Following|正在关注)$/i)
    })
  }

  /**
   * 抓取本人 X 主页的前 10 条原创帖子：
   * 1. 先翻页收集最多 10 个去重 tweetId（最多下滑 6 次，确保抓够 10 条）
   * 2. 对本地尚无干净正文的新帖，逐条进入推文页用 [data-testid="tweetText"] 精准提取正文，彻底杜绝串行错位与重复
   */
  async scanProfileTweets(xUsername, limit = 10, existingContentMap = new Map()) {
    return await this.withBrowserLock(async () => {
      const cleanUser = String(xUsername || '').replace(/^@/, '').trim()
      if (!cleanUser) {
        throw new Error('未提供 X 用户名，无法抓取个人主页帖子')
      }

      await this.ensureXTab(`https://x.com/${cleanUser}`)
      await this.callTool('browser_navigate', { url: `https://x.com/${cleanUser}` })
      await this.callTool('browser_wait', { ms: 3200 })

    const tweetIds = []
    const seen = new Set()
    const statusRe = new RegExp(
      `(?:https?:\\/\\/(?:www\\.)?(?:x|twitter)\\.com)?\\/${cleanUser}\\/status\\/(\\d+)(?:$|[?#])`,
      'i'
    )

    let emptyRounds = 0
    for (let round = 0; round < 6 && tweetIds.length < limit; round++) {
      const snapshot = await this.callTool('browser_snapshot', { region: 'main' })
      if (round === 0) {
        const snapUrl = (snapshot.match(/^URL:\s*(\S+)/im) || [])[1] || ''
        if (/\/i\/flow\/login|\/login\b/i.test(snapUrl)) {
          throw new Error('X 账号未登录，请先在浏览器中登录 x.com 后再刷新')
        }
      }
      const items = parseSnapshotItems(snapshot)
      let addedThisRound = 0

      for (const item of items) {
        if (!item.href) continue
        const m = item.href.match(statusRe)
        if (!m) continue
        const tweetId = m[1]
        if (!seen.has(tweetId)) {
          seen.add(tweetId)
          tweetIds.push(tweetId)
          addedThisRound++
          if (tweetIds.length >= limit) break
        }
      }

      if (tweetIds.length >= limit) break
      if (addedThisRound === 0) {
        emptyRounds++
        if (emptyRounds >= 2) break
      } else {
        emptyRounds = 0
      }

      await humanPause(1000, 2000)
      await this.callTool('browser_scroll', { direction: 'down', amount: randomInt(650, 950) })
      await humanPause(1800, 3200)
    }

    const results = []
    for (const tweetId of tweetIds.slice(0, limit)) {
      let content = existingContentMap.get(tweetId) || ''
      let metrics = {}
      if (!content) {
        metrics = { x_replies: 0, x_retweets: 0, x_likes: 0 }
        try {
          await humanPause(1200, 2200)
          await this.callTool('browser_navigate', { url: `https://x.com/${cleanUser}/status/${tweetId}` })
          await this.callTool('browser_wait', { ms: 2800 })

          const { text, focusedSnap } = await this.extractCurrentTweetText(cleanUser)
          // 优先从快照头部 URL: 校验当前页确实停留在目标推文详情页，避免跳转到 /home 或登录页
          const snapUrl = (String(focusedSnap || '').match(/^URL:\s*(\S+)/im) || [])[1] || ''
          if (snapUrl && !snapUrl.includes(`/status/${tweetId}`)) {
            continue
          }
          if (!snapUrl) {
            const navTabs = parseTabsList(await this.callTool('browser_list_tabs', {}))
            const activeNavTab = navTabs.find((t) => t.controlled) || navTabs[0]
            if (activeNavTab?.url && !String(activeNavTab.url).includes(`/status/${tweetId}`)) {
              continue
            }
          }
          if (isReplyOrThreadContinuation(focusedSnap, cleanUser, tweetId)) {
            continue
          }
          if (focusedSnap) {
            metrics = parseTweetMetricsFromItems(parseSnapshotItems(focusedSnap))
          }

          content = text.slice(0, 180)
          if (!content && focusedSnap) {
            const mainText = extractMainContentFromSnapshot(focusedSnap)
            if (CHROME_NOISE_RE.test(mainText) && !/Conversation|对话|帖子/i.test(focusedSnap)) {
              // 页面非推文详情页（如主页时间线）时跳过，不生成假行
              continue
            }
            content = '(无文字内容)'
          }
        } catch (err) {
          console.warn(`[dsh-xlanv] scanProfileTweets 抓取推文 ${tweetId} 异常:`, err?.message || err)
          content = ''
        }
      }
      results.push({
        tweetId,
        authorUsername: cleanUser,
        content,
        ...metrics,
        url: `https://x.com/${cleanUser}/status/${tweetId}`
      })
    }

      return results
    })
  }

  /**
   * 在当前已打开的推文详情页提取主帖正文：
   * 1. 若 X 自动翻译遮挡/替换了 tweetText，先尝试点击「显示原文 / Show original」还原原帖节点
   * 2. 依次尝试 tweetText、div[lang]、长文节点与聚焦 article 全文，最后用 Main content 快照兜底
   */
  async extractCurrentTweetText(username = '') {
    let mainSnap = ''
    try {
      mainSnap = await this.callTool('browser_snapshot', { region: 'main' })
    } catch {
      mainSnap = ''
    }

    // 若页面尚未渲染出正文或按钮，纯延时再拍一次快照（不使用会报超时的 selector 等待）
    if (mainSnap && !extractTweetTextFromDetailSnapshot(mainSnap, username)) {
      await this.callTool('browser_wait', { ms: 2000 })
      try {
        mainSnap = await this.callTool('browser_snapshot', { region: 'main' })
      } catch {
        // 保留旧快照
      }
    }

    if (mainSnap) {
      const items = parseSnapshotItems(mainSnap)
      const firstAnalyticsIdx = items.findIndex((i) => i.href && /\/status\/\d+\/analytics/i.test(i.href))
      const mainTweetItems = firstAnalyticsIdx > 0 ? items.slice(0, firstAnalyticsIdx) : items
      const showOriginalBtn = mainTweetItems.find(
        (item) =>
          !item.disabled &&
          (item.role === 'button' || item.role === 'link') &&
          /^(Show original|View original|显示原文|查看原文|显示原帖)$/i.test(item.name.trim())
      )
      if (showOriginalBtn) {
        try {
          await this.callTool('browser_click', { index: showOriginalBtn.index })
          await this.callTool('browser_wait', { ms: 2200 })
          mainSnap = await this.callTool('browser_snapshot', { region: 'main' })
        } catch {
          // 忽略还原点击失败
        }
      }
    }

    // 1. 优先用精准 DOM 选择器只读取主帖正文节点（天然隔离作者名、时间戳、查看数、引用帖与评论区）
    let bestText = ''
    for (const sel of [
      'article[data-testid="tweet"] [data-testid="tweetText"]',
      'article[data-testid="tweet"] div[lang]'
    ]) {
      try {
        const raw = await this.callTool('browser_get_text', { selector: sel })
        const cleaned = unwrapUntrustedText(raw)
        if (cleaned && !isPollutedChromeText(cleaned)) {
          bestText = cleaned
          break
        }
      } catch {
        // 忽略未命中
      }
    }

    // 2. 若精准 DOM 节点未取到，再退回从 mainSnap 结构化提取兜底
    if (!bestText && mainSnap) {
      bestText = extractTweetTextFromDetailSnapshot(mainSnap, username)
    }

    return { text: bestText.slice(0, 350), focusedSnap: mainSnap }
  }

  /**
   * 精确提取推文正文纯文本
   */
  async getTweetText(tweetId) {
    return await this.withBrowserLock(async () => {
      const tabId = await this.ensureXTab('https://x.com/home')
      const tabsText = await this.callTool('browser_list_tabs', {})
      const tabs = parseTabsList(tabsText)
      const activeTab = tabs.find((t) => t.tabId === tabId || t.controlled)
      if (!String(activeTab?.url || '').includes(`/status/${tweetId}`)) {
        await this.callTool('browser_navigate', { url: `https://x.com/i/web/status/${tweetId}` })
        await this.callTool('browser_wait', { ms: 2800 })
      }

      const { text } = await this.extractCurrentTweetText()
      return text
    })
  }

  async interactTweet({ tweetId, actions = [], replyText = '' }) {
    return await this.withBrowserLock(async () => {
      const tabId = await this.ensureXTab('https://x.com/home')
      const tabsText = await this.callTool('browser_list_tabs', {})
      const tabs = parseTabsList(tabsText)
      const activeTab = tabs.find((t) => t.tabId === tabId || t.controlled)
      if (!String(activeTab?.url || '').includes(`/status/${tweetId}`)) {
        await this.callTool('browser_navigate', { url: `https://x.com/i/web/status/${tweetId}` })
        await this.callTool('browser_wait', { ms: 3000 })
        await humanPause(1000, 1800)
      }

      const getFocusedItems = async () => {
        for (const region of ['article[data-testid="tweet"][tabindex="-1"]', 'article[data-testid="tweet"]', 'main']) {
          try {
            const s = await this.callTool('browser_snapshot', { region })
            const items = parseSnapshotItems(s)
            if (items.length > 0) return items
          } catch {
            // 尝试下一个 region
          }
        }
        return []
      }

      let baseItems = await getFocusedItems()
      if (baseItems.length === 0) {
        await this.callTool('browser_wait', { ms: 2200 })
        baseItems = await getFocusedItems()
      }

      let replyTweetId = ''
      const executedActions = []
      const alreadyDoneOnPage = []

    if (actions.includes('RETWEET')) {
      const alreadyReposted = baseItems.some(
        (item) =>
          item.role === 'button' &&
          /\b(Reposted|Retweeted)\b|Undo\s*repost|Undo\s*retweet|取消转帖|已转帖|已转发|取消转发/i.test(item.name)
      )
      if (alreadyReposted) {
        alreadyDoneOnPage.push('RETWEET')
      } else {
        const repostBtn = baseItems.find(
          (item) =>
            !item.disabled &&
            item.role === 'button' &&
            /\b(Repost|Retweet)\b|转帖|轉帖|转推|转发/i.test(item.name) &&
            !/\b(Reposted|Retweeted)\b|Undo|取消|已转/i.test(item.name)
        )
        if (repostBtn) {
          await humanPause(1200, 2500)
          await this.callTool('browser_click', { index: repostBtn.index })
          await humanPause(1200, 2200)

          let menuSnap = ''
          try {
            menuSnap = await this.callTool('browser_snapshot', { region: '[role="menu"]' })
          } catch {
            menuSnap = await this.callTool('browser_snapshot', { delta: true })
          }
          let menuItems = parseSnapshotItems(menuSnap)
          const findConfirmRepost = (items) =>
            items.find(
              (item) =>
                (item.role === 'menuitem' || item.role === 'button' || item.role === 'link') &&
                (/^(Repost|Retweet)\b|转帖|轉帖|转发|转推/i.test(item.name.trim())) &&
                !/Quote|引用|Undo|取消/i.test(item.name)
            )
          let confirmRepost = findConfirmRepost(menuItems)
          if (!confirmRepost) {
            const deltaSnap = await this.callTool('browser_snapshot', { delta: true })
            const deltaItems = parseSnapshotItems(deltaSnap)
            if (deltaItems.length > 0) menuItems = menuItems.concat(deltaItems)
            confirmRepost = findConfirmRepost(deltaItems)
          }
          if (confirmRepost) {
            await humanPause(900, 1800)
            await this.callTool('browser_click', { index: confirmRepost.index })
            await humanPause(1800, 3200)
            executedActions.push('RETWEET')
            activityLogger.append({
              type: 'INTERACT',
              action: `执行转发推文 ${tweetId} 成功`
            })
          } else {
            const menuShowsAlreadyReposted = menuItems.some((item) =>
              /Undo\s*repost|Undo\s*retweet|取消转帖|取消转发/i.test(item.name)
            )
            if (menuShowsAlreadyReposted) {
              alreadyDoneOnPage.push('RETWEET')
            } else {
              console.warn(
                '[dsh-xlanv] 未匹配到转发确认菜单项，候选菜单元素:',
                menuItems.map((i) => `${i.role}:"${i.name}"`).join(' | ')
              )
              activityLogger.append({
                type: 'SYSTEM',
                action: `推文 ${tweetId} 未匹配到转发确认菜单，跳过转发`
              })
            }
            // 关闭弹出菜单遮罩，防止阻塞后续点赞与评论
            try {
              await this.callTool('browser_press', { key: 'Escape' })
              await humanPause(600, 1200)
            } catch {
              // 忽略
            }
          }
        } else {
          activityLogger.append({
            type: 'SYSTEM',
            action: `推文 ${tweetId} 未找到转发按钮，跳过转发`
          })
        }
      }
    }

    // 若前面执行过 RETWEET，刷新一次聚焦卡片索引，防止 DOM 重绘导致索引偏移
    const itemsBeforeLike = executedActions.includes('RETWEET') ? await getFocusedItems() : baseItems

    if (actions.includes('LIKE')) {
      const alreadyLiked = itemsBeforeLike.some(
        (item) => item.role === 'button' && /\b(Unlike|Liked)\b|取消喜欢|已喜欢|取消赞/i.test(item.name)
      )
      if (alreadyLiked) {
        alreadyDoneOnPage.push('LIKE')
      } else {
        const likeBtn = itemsBeforeLike.find(
          (item) =>
            !item.disabled &&
            item.role === 'button' &&
            /\b(Like)\b|喜欢|点赞/i.test(item.name) &&
            !/Unlike|Liked|取消|已喜欢/i.test(item.name)
        )
        if (likeBtn) {
          await humanPause(1500, 2800)
          await this.callTool('browser_click', { index: likeBtn.index })
          await humanPause(1500, 2800)
          executedActions.push('LIKE')
          activityLogger.append({
            type: 'INTERACT',
            action: `执行点赞推文 ${tweetId} 成功`
          })
        } else {
          activityLogger.append({
            type: 'SYSTEM',
            action: `推文 ${tweetId} 未找到点赞按钮，跳过点赞`
          })
        }
      }
    }

    const itemsBeforeReply = executedActions.includes('LIKE') ? await getFocusedItems() : itemsBeforeLike

    if (actions.includes('REPLY') && replyText) {
      // 点击目标主帖内部的 Reply 按钮打开专属回复弹窗，确保 100% 回复给主帖而非其他评论
      const replyTrigger = itemsBeforeReply.find(
        (item) =>
          !item.disabled &&
          item.role === 'button' &&
          (/\bReply\b|回复/i.test(item.name))
      )

      let inputBox = null
      let currentItems = []
      let replyOpenedAt = 0

      if (replyTrigger) {
        await humanPause(1200, 2200)
        await this.callTool('browser_click', { index: replyTrigger.index })
        replyOpenedAt = Date.now()
        await humanPause(1500, 2600)
        try {
          const dialogSnap = await this.callTool('browser_snapshot', { region: '[role="dialog"]' })
          currentItems = parseSnapshotItems(dialogSnap)
        } catch {
          const modalSnap = await this.callTool('browser_snapshot', { delta: true })
          currentItems = parseSnapshotItems(modalSnap)
        }
        inputBox = currentItems.find(
          (item) =>
            item.role === 'contenteditable' ||
            item.role === 'textarea' ||
            item.role === 'textbox'
        )
      }

      // 若弹窗方式未找到输入框，兜底查找 main 区域内联回复框
      if (!inputBox) {
        const mainSnap = await this.callTool('browser_snapshot', { region: 'main' })
        if (!replyOpenedAt) replyOpenedAt = Date.now()
        currentItems = parseSnapshotItems(mainSnap)
        inputBox = currentItems.find(
          (item) =>
            item.role === 'contenteditable' ||
            item.role === 'textarea' ||
            item.role === 'textbox'
        )
      }

      if (inputBox) {
        activityLogger.append({
          type: 'SYSTEM',
          action: `已打开推文 ${tweetId} 评论框（防风控等待 ≥30 秒）`,
          detail: `拟评论: ${replyText}`
        })
        // 用 main 区域采集提交前所有已有的 status ID，避免把下方旧评论误当成新回复
        let preStatusIds = new Set([String(tweetId)])
        try {
          const preMainSnap = await this.callTool('browser_snapshot', { region: 'main' })
          for (const i of parseSnapshotItems(preMainSnap)) {
            const sid = i.href?.match(/\/status\/(\d+)/)?.[1]
            if (sid) preStatusIds.add(sid)
          }
        } catch {
          for (const i of baseItems) {
            const sid = i.href?.match(/\/status\/(\d+)/)?.[1]
            if (sid) preStatusIds.add(sid)
          }
        }

        await humanPause(2500, 4500)
        await this.callTool('browser_type', {
          index: inputBox.index,
          text: replyText,
          replace: false
        })

        // 防止触发 X 的 fast reply spam 风控：从打开评论框到点击发送总用时不少于 30 秒（随机 32~42 秒）
        const minReplyDurationMs = randomInt(32000, 42000)
        const elapsedMs = Date.now() - replyOpenedAt
        if (elapsedMs < minReplyDurationMs) {
          await sleep(minReplyDurationMs - elapsedMs)
        }

        const findSubmit = (list) =>
          list.find(
            (item) =>
              !item.disabled &&
              item.role === 'button' &&
              /^(Reply|Post|回复|发帖)$/i.test(item.name.trim())
          )

        let submitBtn = null
        try {
          const dialogSnap = await this.callTool('browser_snapshot', { region: '[role="dialog"]' })
          submitBtn = findSubmit(parseSnapshotItems(dialogSnap))
        } catch {
          // 忽略
        }
        if (!submitBtn) {
          const afterTypeSnap = await this.callTool('browser_snapshot', { delta: true })
          submitBtn = findSubmit(parseSnapshotItems(afterTypeSnap))
        }
        if (!submitBtn) {
          submitBtn = findSubmit(currentItems)
        }

        if (submitBtn) {
          await this.callTool('browser_click', { index: submitBtn.index })
          await humanPause(2600, 4200)

          // 1. 不限制 region 抓取增量快照，捕获底部 "Your post was sent -> View" 弹窗中的新 replyTweetId
          const toastDeltaSnap = await this.callTool('browser_snapshot', { delta: true })
          const toastIds = parseSnapshotItems(toastDeltaSnap)
            .map((i) => i.href?.match(/\/status\/(\d+)/)?.[1])
            .filter((id) => id && !preStatusIds.has(id))

          if (toastIds.length > 0) {
            replyTweetId = toastIds[toastIds.length - 1]
          } else {
            await humanPause(1500, 2500)
            const mainSnap = await this.callTool('browser_snapshot', { region: 'main' })
            const mainIds = parseSnapshotItems(mainSnap)
              .map((i) => i.href?.match(/\/status\/(\d+)/)?.[1])
              .filter((id) => id && !preStatusIds.has(id))
            if (mainIds.length > 0) {
              replyTweetId = mainIds[0]
            }
          }

          if (replyTweetId) {
            executedActions.push('REPLY')
            activityLogger.append({
              type: 'INTERACT',
              action: `发送评论推文 ${tweetId} 成功（耗时 ${Math.round((Date.now() - replyOpenedAt) / 1000)} 秒）`,
              detail: `新评论 ID: ${replyTweetId} | 内容: ${replyText}`
            })
          } else {
            activityLogger.append({
              type: 'SYSTEM',
              action: `推文 ${tweetId} 已点击发送评论，但未捕获新评论 ID`
            })
          }
        } else {
          activityLogger.append({
            type: 'SYSTEM',
            action: `推文 ${tweetId} 未找到评论发送按钮，跳过评论`
          })
        }
      } else {
        activityLogger.append({
          type: 'SYSTEM',
          action: `推文 ${tweetId} 未找到评论输入框，跳过评论`
        })
      }
    }

      return { executedActions, alreadyDoneOnPage, replyTweetId }
    })
  }
}
