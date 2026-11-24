import fs from 'node:fs'
import path from 'node:path'
import { getDataDir, isValidApiSecret, saveConfig } from '../config.js'
import { generateHumanReply } from '../humanizer/replyGenerator.js'
import { activityLogger } from '../storage/activityLogger.js'
import { confirmBeforeInteract, promptForApiSecret } from '../ui/confirmModal.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

export class XAutomationRunner {
  constructor({ client, browser, llm = null, config }) {
    this.client = client
    this.browser = browser
    this.llm = llm
    this.config = config
    this.running = false
    this.lastFollowSyncAt = 0
    this.dataDir = getDataDir()
    this.followedCachePath = path.join(this.dataDir, 'followed_cache.json')
    this.followedMap = new Map()
    this.interactedCachePath = path.join(this.dataDir, 'interacted_cache.json')
    this.interactedMap = new Map()
    this.myProfile = null
    this.lastProfileSyncAt = 0
  }

  loadLocalInteracted() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
    if (this.interactedMap.size === 0 && fs.existsSync(this.interactedCachePath)) {
      try {
        const obj = JSON.parse(fs.readFileSync(this.interactedCachePath, 'utf-8'))
        for (const [tid, acts] of Object.entries(obj || {})) {
          if (Array.isArray(acts)) {
            this.interactedMap.set(tid, new Set(acts))
          }
        }
      } catch {
        // 忽略损坏缓存
      }
    }
  }

  recordInteracted(tweetId, actions = []) {
    if (!tweetId || !actions.length) return
    this.loadLocalInteracted()
    const key = String(tweetId)
    const set = this.interactedMap.get(key) || new Set()
    for (const a of actions) set.add(a)
    this.interactedMap.set(key, set)

    const out = {}
    // 最多保留最近 3000 条本地去重记录
    const entries = Array.from(this.interactedMap.entries()).slice(-3000)
    for (const [k, s] of entries) {
      out[k] = Array.from(s)
    }
    fs.writeFileSync(this.interactedCachePath, JSON.stringify(out), 'utf-8')
  }

  async ensureMyProfile() {
    const now = Date.now()
    if (this.myProfile && now - this.lastProfileSyncAt < 1800000) {
      return this.myProfile
    }
    try {
      const prof = await this.client.getProfile()
      if (prof) {
        this.myProfile = {
          xUserId: String(prof.x_user_id || '').trim(),
          xUsername: String(prof.x_username || '').replace(/^@/, '').trim().toLowerCase()
        }
        this.lastProfileSyncAt = now
      }
    } catch {
      // 忽略临时拉取失败
    }
    return this.myProfile
  }

  isOwnPost(post) {
    if (!this.myProfile) return false
    const axId = String(post?.author_x_id || post?.authorXId || '').trim()
    const axName = String(post?.author_username || post?.authorUsername || axId).replace(/^@/, '').trim().toLowerCase()
    if (this.myProfile.xUserId && axId && axId === this.myProfile.xUserId) return true
    if (this.myProfile.xUsername && axName && axName === this.myProfile.xUsername) return true
    return false
  }

  loadLocalFollowed() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
    if (fs.existsSync(this.followedCachePath)) {
      try {
        const arr = JSON.parse(fs.readFileSync(this.followedCachePath, 'utf-8'))
        for (const item of arr) {
          this.followedMap.set(item.x_user_id, item)
        }
      } catch {
        // 忽略损坏缓存，后续从服务端恢复
      }
    }
  }

  saveLocalFollowed() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true })
    }
    fs.writeFileSync(
      this.followedCachePath,
      JSON.stringify(Array.from(this.followedMap.values()), null, 2),
      'utf-8'
    )
  }

  async ensureFollowedSynced() {
    this.loadLocalFollowed()
    if (this.followedMap.size === 0) {
      console.log('[dsh-xlanv] 本地关注列表为空，正在从服务端全量下载...')
      const res = await this.client.getFollowedList()
      for (const item of res.items || []) {
        this.followedMap.set(item.x_user_id, item)
      }
      this.saveLocalFollowed()
      console.log(`[dsh-xlanv] 已同步 ${this.followedMap.size} 名已关注会员`)
    }
  }

  async runRecommendFollowCycle() {
    const now = Date.now()
    if (now - this.lastFollowSyncAt < this.config.timing.recommendFollowIntervalMs) {
      return
    }
    this.lastFollowSyncAt = now

    console.log('[dsh-xlanv] 拉取本小时 10 名推荐关注会员...')
    const res = await this.client.getRecommendedFollows()
    const targets = res.items || []

    for (const member of targets) {
      if (!this.running) break
      if (this.followedMap.has(member.x_user_id)) continue

      if (!this.browser || typeof this.browser.followUser !== 'function') {
        console.warn('[dsh-xlanv] 浏览器适配器未就绪，跳过关注上报（绝不虚报）')
        break
      }

      const followed = await this.browser.followUser(member.x_username)
      if (!followed) {
        activityLogger.append({
          type: 'FOLLOW',
          action: `跳过关注 @${member.x_username}`,
          pointsDelta: 0,
          detail: '未确认页面按钮变为「正在关注」，已拦截积分上报'
        })
        console.log(`[dsh-xlanv] 未能在页面完成关注 @${member.x_username}，跳过积分上报`)
        continue
      }

      const followRes = await this.client.reportFollow(member.x_user_id, member.x_username)
      this.followedMap.set(member.x_user_id, member)
      this.saveLocalFollowed()
      const earned = typeof followRes?.earned_points === 'number' ? followRes.earned_points : (followRes?.already_followed ? 0 : 1)
      activityLogger.append({
        type: 'FOLLOW',
        action: `关注会员 @${member.x_username}`,
        api: 'POST /plugin/follows/report',
        status: 200,
        pointsDelta: earned,
        currentPoints: followRes?.current_points ?? null,
        detail: followRes?.already_followed ? '重复关注不重复计分' : '新关注 +1 分'
      })
      console.log(`[dsh-xlanv] 已关注 @${member.x_username} 并完成 +1/-1 积分回传`)
      await sleep(randomInt(4000, 9000))
    }
  }

  buildPlannedActions(tweetId, completedActions = [], allowedActions = null) {
    this.loadLocalInteracted()
    const done = new Set(completedActions)
    const localDone = this.interactedMap.get(String(tweetId))
    if (localDone) {
      for (const a of localDone) done.add(a)
    }
    const allowed = Array.isArray(allowedActions) && allowedActions.length > 0
      ? new Set(allowedActions.map((a) => String(a).toUpperCase()))
      : null
    const planned = []
    if (this.config.actions.retweet && !done.has('RETWEET') && (!allowed || allowed.has('RETWEET'))) planned.push('RETWEET')
    if (this.config.actions.reply && !done.has('REPLY') && (!allowed || allowed.has('REPLY'))) planned.push('REPLY')
    if (this.config.actions.like && !done.has('LIKE') && (!allowed || allowed.has('LIKE'))) planned.push('LIKE')
    return planned
  }

  async handleCandidatePost(post) {
    // 铁律：绝不对自己的主帖执行任何转推、评论或点赞
    if (this.isOwnPost(post)) {
      return
    }

    const plannedActions = this.buildPlannedActions(post.tweet_id, post.completed_actions, post.allowed_actions)
    if (plannedActions.length === 0) return

    // 1. 拟人化视口停留 5~12 秒
    const dwellMs = randomInt(this.config.timing.dwellMinMs, this.config.timing.dwellMaxMs)
    await sleep(dwellMs)

    let replyText = ''
    if (plannedActions.includes('REPLY')) {
      let postText = post.content || ''
      if (!postText && this.browser && typeof this.browser.getTweetText === 'function') {
        postText = await this.browser.getTweetText(post.tweet_id)
      }
      replyText = await generateHumanReply(postText, this.llm, {
        ...(this.config.humanReply || {}),
        customPrompt: this.config.customPrompt || ''
      })
    }

    // 2. 弹窗倒计时 20 秒确认（半自动模式下人工可干预，超时自动执行）
    if (this.config.mode === 'semi-auto') {
      const confirmRes = await confirmBeforeInteract({
        browser: this.browser,
        tweetId: post.tweet_id,
        authorUsername: post.author_username || post.author_x_id,
        postContent: post.content || '',
        plannedActions,
        replyText,
        timeoutSeconds: this.config.confirmTimeoutSeconds
      })
      if (!confirmRes.confirmed) {
        console.log(`[dsh-xlanv] 用户跳过推文 ${post.tweet_id}`)
        return
      }
      replyText = confirmRes.replyText || replyText
    }

    // 3. 必须通过真实浏览器执行点赞 / 转发 / 逐字输入回复，严禁未执行就上报
    if (!this.browser || typeof this.browser.interactTweet !== 'function') {
      console.warn('[dsh-xlanv] 浏览器适配器未就绪，跳过推文互动与积分上报（绝不虚报）')
      return
    }

    const execRes = await this.browser.interactTweet({
      tweetId: post.tweet_id,
      actions: plannedActions,
      replyText
    })
    const replyTweetId = execRes?.replyTweetId || ''
    const executedSet = new Set(Array.isArray(execRes?.executedActions) ? execRes.executedActions : [])

    const finalActions = plannedActions.filter(
      (a) => executedSet.has(a) && (a !== 'REPLY' || Boolean(replyTweetId))
    )
    if (finalActions.length === 0) {
      console.log(`[dsh-xlanv] 推文 ${post.tweet_id} 未完成有效页面互动，跳过上报`)
      return
    }

    // 立即记录到本地去重缓存，确保每条推文转发/评论/点赞各最多执行一次
    this.recordInteracted(post.tweet_id, finalActions)

    // 4. 上报互动结果并完成零和积分结算
    const reportRes = await this.client.reportInteraction({
      targetXUserId: post.author_x_id,
      targetTweetId: post.tweet_id,
      actions: finalActions,
      replyTweetId,
      replyText
    })
    activityLogger.append({
      type: 'INTERACT',
      action: `互动 @${post.author_username || post.author_x_id} (${reportRes.settled_actions?.join('+') || finalActions.join('+')})`,
      api: 'POST /plugin/interactions/report',
      status: 200,
      pointsDelta: reportRes.earned_points || 0,
      currentPoints: reportRes.current_points ?? null,
      detail: replyText ? `推文 ${post.tweet_id} | 评论: ${replyText}` : `推文 ${post.tweet_id}`
    })
    console.log(
      `[dsh-xlanv] 推文 ${post.tweet_id} 互动完成: ${reportRes.settled_actions?.join(', ')} (+${reportRes.earned_points} 分)`
    )

    // 5. 随机间隔 60~180 秒处理下一条
    const waitMs = randomInt(this.config.timing.intervalMinMs, this.config.timing.intervalMaxMs)
    await sleep(waitMs)
  }

  isWithinActiveHours() {
    const start = Number(this.config.activeStartHour ?? 0)
    const end = Number(this.config.activeEndHour ?? 24)
    if (start === 0 && end === 24) return true
    if (start === end) return true

    const hour = new Date().getHours()
    if (start < end) {
      return hour >= start && hour < end
    }
    // 支持跨午夜时段（如 22 点到次日 6 点）
    return hour >= start || hour < end
  }

  async runOnce() {
    if (this.config.enabled === false) {
      return
    }
    if (!this.isWithinActiveHours()) {
      return
    }
    await this.ensureMyProfile()
    await this.ensureFollowedSynced()
    await this.runRecommendFollowCycle()

    // 仅在 Home 页面的 For You 和 Following 两个信息流巡检，每次最多下滑采集 20 条
    if (this.browser && typeof this.browser.scanTimelineTweets === 'function') {
      const timelineTweets = await this.browser.scanTimelineTweets(20)
      const candidates = timelineTweets.filter((t) => !this.isOwnPost(t)).slice(0, 20)
      if (candidates.length > 0) {
        const checkItems = candidates.map((t) => ({
          author_x_id: t.authorXId,
          tweet_id: t.tweetId
        }))
        const checkRes = await this.client.batchCheckPosts(checkItems)
        const tweetMap = new Map(candidates.map((t) => [t.tweetId, t]))

        for (const item of checkRes.items || []) {
          if (!this.running) break
          // 铁律：未上传或关闭推广或作者积分 <= 0 绝不执行任何互动
          if (!item.is_promoted || item.author_points <= 0) continue

          const rawTweet = tweetMap.get(item.tweet_id) || {}
          await this.handleCandidatePost({
            ...item,
            author_username: rawTweet.authorUsername || item.author_x_id,
            content: rawTweet.content || ''
          })
        }
      }
    }
  }

  async start() {
    if (this.config.enabled === false) {
      console.log('[dsh-xlanv] 插件自动托管开关已关闭（enabled=false），待命不执行任务')
      return
    }
    if (!isValidApiSecret(this.config.apiSecret)) {
      const secret = await promptForApiSecret(this.browser, 'https://xlanv.net')
      this.config.apiSecret = secret
      this.client.apiSecret = secret
      saveConfig(this.config)
      console.log('[dsh-xlanv] api_secret 已保存到 config.json，后续启动将不再重复弹窗')
    }
    this.running = true
    console.log('[dsh-xlanv] 24小时拟人化互助引擎已启动')

    while (this.running) {
      try {
        await this.runOnce()
      } catch (err) {
        console.error('[dsh-xlanv] 本轮巡检异常:', err.message)
      }
      const pollMs = Math.max(5, Number(this.config.loopPollIntervalSeconds || 15)) * 1000
      await sleep(pollMs)
    }
  }

  stop() {
    this.running = false
    console.log('[dsh-xlanv] 正在停止运行...')
  }
}
