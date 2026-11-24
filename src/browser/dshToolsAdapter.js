import { randomUUID } from 'node:crypto'

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
    .replace(/\s+/g, ' ')
    .trim()
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
    try {
      await this.callTool('browser_wait', { selector: 'article[data-testid="tweet"]', ms: 9000 })
    } catch {
      await humanPause(3000, 5000)
    }
    await humanPause(3200, 5800)

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
      try {
        await this.callTool('browser_wait', { selector: 'article[data-testid="tweet"]', ms: 9000 })
      } catch {
        await humanPause(2800, 4500)
      }
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
          await humanPause(3000, 5500)
          const deltaSnap = await this.callTool('browser_snapshot', { region: 'main', delta: true })
          await processVisibleItems(parseSnapshotItems(deltaSnap))
        } catch {
          break
        }
      }
    }

    await browseSingleFeed(/^(For you|为你推荐)$/i)
    await humanPause(2800, 5200)
    await browseSingleFeed(/^(Following|正在关注)$/i)
  }

  /**
   * 抓取本人 X 主页的前 10 条原创帖子：
   * 1. 先翻页收集最多 10 个去重 tweetId（最多下滑 6 次，确保抓够 10 条）
   * 2. 对本地尚无干净正文的新帖，逐条进入推文页用 [data-testid="tweetText"] 精准提取正文，彻底杜绝串行错位与重复
   */
  async scanProfileTweets(xUsername, limit = 10, existingContentMap = new Map()) {
    const cleanUser = String(xUsername || '').replace(/^@/, '').trim()
    if (!cleanUser) {
      throw new Error('未提供 X 用户名，无法抓取个人主页帖子')
    }

    await this.ensureXTab(`https://x.com/${cleanUser}`)
    await this.callTool('browser_navigate', { url: `https://x.com/${cleanUser}` })
    try {
      await this.callTool('browser_wait', { selector: 'article[data-testid="tweet"]', ms: 8000 })
    } catch {
      await this.callTool('browser_wait', { ms: 2500 })
    }

    const tweetIds = []
    const seen = new Set()
    const statusRe = new RegExp(
      `(?:https?:\\/\\/(?:www\\.)?(?:x|twitter)\\.com)?\\/${cleanUser}\\/status\\/(\\d+)(?:$|[?#])`,
      'i'
    )

    let emptyRounds = 0
    for (let round = 0; round < 6 && tweetIds.length < limit; round++) {
      const snapshot = await this.callTool('browser_snapshot', { region: 'main' })
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
      let metrics = { x_replies: 0, x_retweets: 0, x_likes: 0 }
      if (!content) {
        try {
          await humanPause(1500, 2800)
          await this.callTool('browser_navigate', { url: `https://x.com/${cleanUser}/status/${tweetId}` })
          try {
            await this.callTool('browser_wait', { selector: '[data-testid="tweetText"]', ms: 7000 })
          } catch {
            await humanPause(1800, 3000)
          }
          await humanPause(700, 1400)

          let raw = ''
          const selectors = [
            'article[data-testid="tweet"][tabindex="-1"] [data-testid="tweetText"]',
            'article[data-testid="tweet"] [data-testid="tweetText"]',
            '[data-testid="twitterArticleRichTextView"]',
            '[data-testid="tweetText"]'
          ]
          for (const sel of selectors) {
            try {
              const txt = await this.callTool('browser_get_text', { selector: sel })
              const cleaned = unwrapUntrustedText(txt)
              if (cleaned) {
                raw = cleaned
                break
              }
            } catch {
              // 尝试下一个选择器
            }
          }

          let snap = ''
          try {
            snap = await this.callTool('browser_snapshot', { region: 'main' })
            metrics = parseTweetMetricsFromItems(parseSnapshotItems(snap))
          } catch {
            // 忽略快照异常
          }

          // 若 CSS 选择器均未命中，从 main 快照正文兜底提取
          if (!raw && snap) {
            const snippets = extractTweetSnippetsFromMain(snap, cleanUser)
            if (snippets.length > 0 && snippets[0]) {
              raw = snippets[0]
            }
          }

          content = raw.slice(0, 180)
          if (!content) {
            content = '(无文字内容)'
          }
        } catch {
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
  }

  /**
   * 通过 CSS 选择器精确提取推文正文纯文本，彻底避开时间戳、图片、视频与引用块，
   * 若正文字数过少则补充抓取聚焦推文卡片内的文字上下文，确保大模型拿到足够信息
   */
  async getTweetText(tweetId) {
    const tabId = await this.ensureXTab('https://x.com/home')
    const tabsText = await this.callTool('browser_list_tabs', {})
    const tabs = parseTabsList(tabsText)
    const activeTab = tabs.find((t) => t.tabId === tabId || t.controlled)
    if (!String(activeTab?.url || '').includes(`/status/${tweetId}`)) {
      await this.callTool('browser_navigate', { url: `https://x.com/i/web/status/${tweetId}` })
      try {
        await this.callTool('browser_wait', { selector: '[data-testid="tweetText"]', ms: 7000 })
      } catch {
        await humanPause(1800, 3000)
      }
      await humanPause(700, 1400)
    }

    const selectors = [
      'article[data-testid="tweet"][tabindex="-1"] [data-testid="tweetText"]',
      'article[data-testid="tweet"] [data-testid="tweetText"]',
      '[data-testid="twitterArticleRichTextView"]',
      '[data-testid="tweetText"]',
      'article[data-testid="tweet"][tabindex="-1"]'
    ]

    let bestText = ''
    for (const sel of selectors) {
      try {
        const raw = await this.callTool('browser_get_text', { selector: sel })
        const cleaned = unwrapUntrustedText(raw)
        if (cleaned && cleaned.length > bestText.length) {
          bestText = cleaned
          if (bestText.length >= 15) break
        }
      } catch {
        // 尝试下一个选择器
      }
    }

    return bestText.slice(0, 350)
  }

  async interactTweet({ tweetId, actions = [], replyText = '' }) {
    const tabId = await this.ensureXTab('https://x.com/home')
    const tabsText = await this.callTool('browser_list_tabs', {})
    const tabs = parseTabsList(tabsText)
    const activeTab = tabs.find((t) => t.tabId === tabId || t.controlled)
    if (!String(activeTab?.url || '').includes(`/status/${tweetId}`)) {
      await this.callTool('browser_navigate', { url: `https://x.com/i/web/status/${tweetId}` })
      await humanPause(2200, 3800)
    }

    // 仅抓取 main 区域一次快照，减少 50%~70% 的快照 Token 消耗
    const snapshot = await this.callTool('browser_snapshot', { region: 'main' })
    const baseItems = parseSnapshotItems(snapshot)

    let replyTweetId = ''
    const executedActions = []

    if (actions.includes('RETWEET')) {
      const repostBtn = baseItems.find(
        (item) =>
          !item.disabled &&
          item.role === 'button' &&
          /\b(Repost|Retweet|转帖|转推|转发)\b/i.test(item.name) &&
          !/Undo|取消|已转/i.test(item.name)
      )
      if (repostBtn) {
        await humanPause(1200, 2500)
        await this.callTool('browser_click', { index: repostBtn.index })
        await humanPause(1200, 2200)

        // 直接只快照弹出的 [role="menu"] 区域，避免全页 60 元素上限把菜单项裁掉
        let menuSnap = ''
        try {
          menuSnap = await this.callTool('browser_snapshot', { region: '[role="menu"]' })
        } catch {
          menuSnap = await this.callTool('browser_snapshot', { delta: true })
        }
        let menuItems = parseSnapshotItems(menuSnap)
        let confirmRepost = menuItems.find(
          (item) =>
            (item.role === 'menuitem' || item.role === 'button' || item.role === 'link') &&
            /^(Repost|Retweet|转帖|转发|转推)\b/i.test(item.name.trim()) &&
            !/Quote|引用|Undo|取消/i.test(item.name)
        )
        if (!confirmRepost) {
          const deltaSnap = await this.callTool('browser_snapshot', { delta: true })
          confirmRepost = parseSnapshotItems(deltaSnap).find(
            (item) =>
              (item.role === 'menuitem' || item.role === 'button' || item.role === 'link') &&
              /^(Repost|Retweet|转帖|转发|转推)\b/i.test(item.name.trim()) &&
              !/Quote|引用|Undo|取消/i.test(item.name)
          )
        }
        if (confirmRepost) {
          await humanPause(900, 1800)
          await this.callTool('browser_click', { index: confirmRepost.index })
          await humanPause(1800, 3200)
          executedActions.push('RETWEET')
        }
      }
    }

    if (actions.includes('LIKE')) {
      // 直接复用初始快照的稳定元素索引，无需重复快照
      const likeBtn = baseItems.find(
        (item) =>
          !item.disabled &&
          item.role === 'button' &&
          /\b(Like|喜欢|点赞)\b/i.test(item.name) &&
          !/Unlike|Liked|取消|已喜欢/i.test(item.name)
      )
      if (likeBtn) {
        await humanPause(1500, 2800)
        await this.callTool('browser_click', { index: likeBtn.index })
        await humanPause(1500, 2800)
        executedActions.push('LIKE')
      }
    }

    if (actions.includes('REPLY') && replyText) {
      let inputBox = baseItems.find(
        (item) =>
          item.role === 'contenteditable' ||
          item.role === 'textarea' ||
          item.role === 'textbox'
      )
      let currentItems = baseItems

      if (!inputBox) {
        const replyTrigger = baseItems.find(
          (item) =>
            !item.disabled &&
            item.role === 'button' &&
            /\b(Reply|回复)\b/i.test(item.name)
        )
        if (replyTrigger) {
          await this.callTool('browser_click', { index: replyTrigger.index })
          await this.callTool('browser_wait', { ms: 900 })
          const modalSnap = await this.callTool('browser_snapshot', { delta: true })
          currentItems = parseSnapshotItems(modalSnap)
          inputBox = currentItems.find(
            (item) =>
              item.role === 'contenteditable' ||
              item.role === 'textarea' ||
              item.role === 'textbox'
          )
        }
      }

      if (inputBox) {
        // 记录提交前页面已有的 status IDs，用于提交后精准 diff 出新评论的 replyTweetId
        const preStatusIds = new Set(
          baseItems
            .map((i) => i.href?.match(/\/status\/(\d+)/)?.[1])
            .filter(Boolean)
        )
        preStatusIds.add(String(tweetId))

        await this.callTool('browser_type', {
          index: inputBox.index,
          text: replyText,
          replace: false
        })
        await sleep(700)

        let submitBtn = currentItems.find(
          (item) =>
            !item.disabled &&
            item.role === 'button' &&
            /^(Reply|Post|回复|发帖)$/i.test(item.name.trim())
        )
        if (!submitBtn) {
          const afterTypeSnap = await this.callTool('browser_snapshot', { delta: true })
          submitBtn = parseSnapshotItems(afterTypeSnap).find(
            (item) =>
              !item.disabled &&
              item.role === 'button' &&
              /^(Reply|Post|回复|发帖)$/i.test(item.name.trim())
          )
        }
        if (!submitBtn) {
          const fullMainSnap = await this.callTool('browser_snapshot', { region: 'main' })
          submitBtn = parseSnapshotItems(fullMainSnap).find(
            (item) =>
              !item.disabled &&
              item.role === 'button' &&
              /^(Reply|Post|回复|发帖)$/i.test(item.name.trim())
          )
        }

        if (submitBtn) {
          await this.callTool('browser_click', { index: submitBtn.index })
          await this.callTool('browser_wait', { ms: 2500 })

          // 1. 不限制 region='main' 抓取增量快照，以捕获 X 底部 "Your post was sent -> View" 弹窗链接中的新 replyTweetId
          const toastDeltaSnap = await this.callTool('browser_snapshot', { delta: true })
          const toastIds = parseSnapshotItems(toastDeltaSnap)
            .map((i) => i.href?.match(/\/status\/(\d+)/)?.[1])
            .filter((id) => id && !preStatusIds.has(id))

          if (toastIds.length > 0) {
            replyTweetId = toastIds[toastIds.length - 1]
          } else {
            // 2. 兜底再等 1.5s，拉取 main 区域对比 preStatusIds 找到新出现的评论推文 ID
            await sleep(1500)
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
          }
        }
      }
    }

    return { executedActions, replyTweetId }
  }
}
