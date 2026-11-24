export class XlanvClient {
  constructor(baseUrl, apiSecret, { onApiLog = null } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiSecret = apiSecret
    this.onApiLog = onApiLog
  }

  async request(method, path, body = null) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Api-Secret': this.apiSecret
    }

    const startAt = Date.now()
    let status = 0
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      })
      status = res.status

      const data = await res.json().catch(() => ({}))
      const durationMs = Date.now() - startAt
      if (!res.ok) {
        if (typeof this.onApiLog === 'function') {
          this.onApiLog({
            ok: false,
            method,
            path,
            status,
            durationMs,
            error: data.error || `HTTP ${res.status}`
          })
        }
        throw new Error(data.error || `HTTP ${res.status} ${path}`)
      }

      if (typeof this.onApiLog === 'function') {
        this.onApiLog({
          ok: true,
          method,
          path,
          status,
          durationMs,
          data
        })
      }
      return data
    } catch (err) {
      if (status === 0 && typeof this.onApiLog === 'function') {
        this.onApiLog({
          ok: false,
          method,
          path,
          status: 0,
          durationMs: Date.now() - startAt,
          error: err.message
        })
      }
      throw err
    }
  }

  // 获取当前插件绑定会员信息与实时积分
  getProfile() {
    return this.request('GET', '/plugin/profile')
  }

  // 每 60 分钟获取 10 名推荐关注会员
  getRecommendedFollows() {
    return this.request('GET', '/plugin/follows/recommend')
  }

  // 关注成功回传 (+1 / -1)
  reportFollow(targetXUserId, targetXUsername) {
    return this.request('POST', '/plugin/follows/report', {
      target_x_user_id: targetXUserId,
      target_x_username: targetXUsername
    })
  }

  // 全量下载已关注会员列表
  getFollowedList() {
    return this.request('GET', '/plugin/follows/list')
  }

  // 查询本人已上传的推广帖子列表
  getMyPosts() {
    return this.request('GET', '/plugin/posts')
  }

  // 会员发帖上传推广 (0 积分消耗，支持指定允许推广的项目)
  promotePost(tweetIdOrOpts, content, targetReplies = 20, allowedActions = ['RETWEET', 'REPLY', 'LIKE']) {
    const opts =
      typeof tweetIdOrOpts === 'object' && tweetIdOrOpts !== null
        ? tweetIdOrOpts
        : { tweetId: tweetIdOrOpts, content, targetReplies, allowedActions }
    return this.request('POST', '/plugin/posts/promote', {
      tweet_id: opts.tweetId,
      content: opts.content || '',
      target_replies: opts.targetReplies || 20,
      allowed_actions: opts.allowedActions || ['RETWEET', 'REPLY', 'LIKE']
    })
  }

  // 切换本人某条帖子的推广开关
  togglePostPromote(tweetId, isPromoted = null) {
    return this.request('PATCH', `/plugin/posts/${encodeURIComponent(tweetId)}/toggle`, {
      is_promoted: isPromoted
    })
  }

  // 批量轻量级校验 (最多 50 条)
  batchCheckPosts(items) {
    return this.request('POST', '/plugin/posts/batch-check', { items })
  }

  // 单条轻量级校验
  checkSinglePost(tweetId, authorXId) {
    const q = new URLSearchParams({ tweet_id: tweetId, author_x_id: authorXId || '' })
    return this.request('GET', `/plugin/posts/check?${q.toString()}`)
  }

  // 10% 概率高积分未达标强推查询
  getHighPriorityUnmet() {
    return this.request('GET', '/plugin/posts/high-priority-unmet')
  }

  // 互动上报与零和结算 (转发3 / 评论2 / 点赞1)
  reportInteraction({ targetXUserId, targetTweetId, actions, replyTweetId, replyText }) {
    return this.request('POST', '/plugin/interactions/report', {
      target_x_user_id: targetXUserId,
      target_tweet_id: targetTweetId,
      actions,
      reply_tweet_id: replyTweetId || '',
      reply_text: replyText || ''
    })
  }

  // 原帖作者交叉抽检核验
  auditVerify(tweetId, realReplyTweetIds) {
    return this.request('POST', '/plugin/interactions/audit-verify', {
      tweet_id: tweetId,
      real_reply_tweet_ids: realReplyTweetIds
    })
  }
}
