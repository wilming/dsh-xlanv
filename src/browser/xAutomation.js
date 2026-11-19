import fs from 'node:fs'
import path from 'node:path'
import { isValidApiSecret, saveConfig } from '../config.js'
import { generateHumanReply } from '../humanizer/replyGenerator.js'
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
    this.dataDir = path.resolve(process.cwd(), 'data')
    this.followedCachePath = path.join(this.dataDir, 'followed_cache.json')
    this.followedMap = new Map()
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

      if (this.browser && typeof this.browser.followUser === 'function') {
        await this.browser.followUser(member.x_username)
      }
      await this.client.reportFollow(member.x_user_id, member.x_username)
      this.followedMap.set(member.x_user_id, member)
      this.saveLocalFollowed()
      console.log(`[dsh-xlanv] 已关注 @${member.x_username} 并完成 +1/-1 积分回传`)
      await sleep(randomInt(4000, 9000))
    }
  }

  buildPlannedActions(completedActions = []) {
    const done = new Set(completedActions)
    const planned = []
    if (this.config.actions.retweet && !done.has('RETWEET')) planned.push('RETWEET')
    if (this.config.actions.reply && !done.has('REPLY')) planned.push('REPLY')
    if (this.config.actions.like && !done.has('LIKE')) planned.push('LIKE')
    return planned
  }

  async handleCandidatePost(post) {
    // 1. 拟人化视口停留 5~12 秒
    const dwellMs = randomInt(this.config.timing.dwellMinMs, this.config.timing.dwellMaxMs)
    await sleep(dwellMs)

    const plannedActions = this.buildPlannedActions(post.completed_actions)
    if (plannedActions.length === 0) return

    let replyText = ''
    if (plannedActions.includes('REPLY')) {
      replyText = await generateHumanReply(post.content || '', this.llm, this.config.humanReply)
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

    // 3. 通过 dsh-browser 在页面执行真实点赞 / 转发 / 逐字输入回复
    let replyTweetId = ''
    if (this.browser && typeof this.browser.interactTweet === 'function') {
      const execRes = await this.browser.interactTweet({
        tweetId: post.tweet_id,
        actions: plannedActions,
        replyText
      })
      replyTweetId = execRes?.replyTweetId || ''
    } else if (plannedActions.includes('REPLY')) {
      // 仅当浏览器适配器未返回真实 replyTweetId 时提示警告
      console.warn('[dsh-xlanv] 警告：未检测到 dsh-browser 返回 replyTweetId，跳过 REPLY 上报')
    }

    const finalActions = plannedActions.filter((a) => a !== 'REPLY' || Boolean(replyTweetId))
    if (finalActions.length === 0) return

    // 4. 上报互动结果并完成零和积分结算
    const reportRes = await this.client.reportInteraction({
      targetXUserId: post.author_x_id,
      targetTweetId: post.tweet_id,
      actions: finalActions,
      replyTweetId,
      replyText
    })
    console.log(
      `[dsh-xlanv] 推文 ${post.tweet_id} 互动完成: ${reportRes.settled_actions?.join(', ')} (+${reportRes.earned_points} 分)`
    )

    // 5. 随机间隔 60~180 秒处理下一条
    const waitMs = randomInt(this.config.timing.intervalMinMs, this.config.timing.intervalMaxMs)
    await sleep(waitMs)
  }

  async runOnce() {
    await this.ensureFollowedSynced()
    await this.runRecommendFollowCycle()

    // 10% 概率高积分未达标强推（通过关注列表定位作者头像进入主页，杜绝 URL 直跳）
    if (Math.random() < this.config.timing.highPriorityProbability) {
      const hp = await this.client.getHighPriorityUnmet()
      if (hp?.post) {
        console.log(`[dsh-xlanv] 触发 10% 高积分强推: @${hp.post.author_x_username} (${hp.post.tweet_id})`)
        if (this.browser && typeof this.browser.openPostFromFollowing === 'function') {
          await this.browser.openPostFromFollowing(hp.post.author_x_username, hp.post.tweet_id)
        }
        await this.handleCandidatePost({
          tweet_id: hp.post.tweet_id,
          author_x_id: hp.post.author_x_user_id,
          author_username: hp.post.author_x_username,
          content: hp.post.content,
          completed_actions: []
        })
        return
      }
    }

    // 信息流巡检 + 批量轻量级校验
    if (this.browser && typeof this.browser.scanTimelineTweets === 'function') {
      const timelineTweets = await this.browser.scanTimelineTweets()
      if (timelineTweets.length > 0) {
        const checkItems = timelineTweets.slice(0, 50).map((t) => ({
          author_x_id: t.authorXId,
          tweet_id: t.tweetId
        }))
        const checkRes = await this.client.batchCheckPosts(checkItems)
        const tweetMap = new Map(timelineTweets.map((t) => [t.tweetId, t]))

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
      await sleep(15000)
    }
  }

  stop() {
    this.running = false
    console.log('[dsh-xlanv] 正在停止运行...')
  }
}
