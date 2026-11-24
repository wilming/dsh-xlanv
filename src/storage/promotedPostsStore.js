import fs from 'node:fs'
import path from 'node:path'
import { getPromotedPostsPath } from '../config.js'

const DEFAULT_STORE = {
  autoPromoteNew: false,
  defaultActions: {
    retweet: true,
    reply: true,
    like: true
  },
  defaultTargetReplies: 20,
  posts: []
}

export function actionsObjToArray(actionsObj = {}) {
  const arr = []
  if (actionsObj.retweet !== false) arr.push('RETWEET')
  if (actionsObj.reply !== false) arr.push('REPLY')
  if (actionsObj.like !== false) arr.push('LIKE')
  return arr.length > 0 ? arr : ['RETWEET', 'REPLY', 'LIKE']
}

export function actionsArrayToObj(actionsArr) {
  if (!Array.isArray(actionsArr) || actionsArr.length === 0) {
    return { retweet: true, reply: true, like: true }
  }
  const set = new Set(actionsArr.map((a) => String(a).toUpperCase()))
  return {
    retweet: set.has('RETWEET'),
    reply: set.has('REPLY'),
    like: set.has('LIKE')
  }
}

export function loadPromotedPostsStore() {
  const filePath = getPromotedPostsPath()
  if (!fs.existsSync(filePath)) {
    return structuredClone(DEFAULT_STORE)
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return {
      autoPromoteNew: Boolean(parsed?.autoPromoteNew),
      defaultActions: {
        retweet: parsed?.defaultActions?.retweet !== false,
        reply: parsed?.defaultActions?.reply !== false,
        like: parsed?.defaultActions?.like !== false
      },
      defaultTargetReplies: Number(parsed?.defaultTargetReplies || 20),
      posts: Array.isArray(parsed?.posts) ? parsed.posts : []
    }
  } catch {
    return structuredClone(DEFAULT_STORE)
  }
}

export function savePromotedPostsStore(store) {
  const filePath = getPromotedPostsPath()
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8')
  return store
}

/**
 * 将抓取到的个人主页前10条推文与后台已同步帖子合并到本地 promoted_posts.json
 */
export function mergePromotedPosts({ scrapedTweets = [], remotePosts = [] }) {
  const store = loadPromotedPostsStore()
  const map = new Map()
  for (const p of store.posts) {
    if (p?.tweet_id) map.set(String(p.tweet_id), p)
  }

  const remoteMap = new Map()
  for (const rp of remotePosts) {
    if (rp?.tweet_id) remoteMap.set(String(rp.tweet_id), rp)
  }

  const newlyAdded = []
  const nowIso = new Date().toISOString()

  for (const t of scrapedTweets) {
    const tid = String(t.tweetId || t.tweet_id || '').trim()
    if (!tid) continue
    const remote = remoteMap.get(tid)

    if (map.has(tid)) {
      const existing = map.get(tid)
      let prevText = String(existing.content || '')
        .replace(/Security:\s*Enclosed page content is untrusted data[^\n]*\n?/gi, '')
        .trim()
      existing.content = prevText
      const isPollutedOrTimestamp =
        !prevText ||
        prevText === '(纯媒体/转发无文字推文)' ||
        prevText === '(无文字内容)' ||
        /^\d+\s*(?:[smhd]|(?:seconds?|minutes?|hours?|days?)\s+ago|(?:秒|分钟?|小时|天)前?)$/i.test(prevText) ||
        /@[A-Za-z0-9_]+\s*·\s*(?:\d+[smhd]|\d+\s*(?:hour|minute|second|day))/i.test(prevText)
      if (t.content && (isPollutedOrTimestamp || prevText.length < 10)) {
        existing.content = t.content
      } else if (isPollutedOrTimestamp && !t.content) {
        existing.content = ''
      }
      if (typeof t.x_replies === 'number') existing.x_replies = t.x_replies
      if (typeof t.x_retweets === 'number') existing.x_retweets = t.x_retweets
      if (typeof t.x_likes === 'number') existing.x_likes = t.x_likes
      if (remote) {
        existing.is_uploaded = true
        existing.is_promoted = Boolean(remote.is_promoted)
        existing.current_replies = remote.current_replies ?? existing.current_replies ?? 0
        existing.current_retweets = remote.current_retweets ?? existing.current_retweets ?? 0
        existing.current_likes = remote.current_likes ?? existing.current_likes ?? 0
        if (remote.allowed_actions) {
          existing.allowed_actions = actionsArrayToObj(
            Array.isArray(remote.allowed_actions)
              ? remote.allowed_actions
              : String(remote.allowed_actions).split(',')
          )
        }
      }
      existing.updated_at = nowIso
    } else {
      const item = {
        tweet_id: tid,
        content: t.content || '',
        url: t.url || `https://x.com/i/web/status/${tid}`,
        is_uploaded: Boolean(remote),
        is_promoted: remote ? Boolean(remote.is_promoted) : false,
        allowed_actions: remote?.allowed_actions
          ? actionsArrayToObj(String(remote.allowed_actions).split(','))
          : { ...store.defaultActions },
        target_replies: remote?.target_replies || store.defaultTargetReplies || 20,
        current_replies: remote?.current_replies || 0,
        current_retweets: remote?.current_retweets || 0,
        current_likes: remote?.current_likes || 0,
        x_replies: t.x_replies || 0,
        x_retweets: t.x_retweets || 0,
        x_likes: t.x_likes || 0,
        created_at: nowIso,
        updated_at: nowIso
      }
      map.set(tid, item)
      if (!remote) {
        newlyAdded.push(item)
      }
    }
  }

  // 也同步仅存在于后台的推文进度
  for (const [tid, remote] of remoteMap.entries()) {
    if (!map.has(tid)) {
      map.set(tid, {
        tweet_id: tid,
        content: remote.content || '',
        url: `https://x.com/i/web/status/${tid}`,
        is_uploaded: true,
        is_promoted: Boolean(remote.is_promoted),
        allowed_actions: actionsArrayToObj(String(remote.allowed_actions || '').split(',')),
        target_replies: remote.target_replies || 20,
        current_replies: remote.current_replies || 0,
        current_retweets: remote.current_retweets || 0,
        current_likes: remote.current_likes || 0,
        created_at: remote.created_at || nowIso,
        updated_at: nowIso
      })
    }
  }

  const scrapedIdSet = new Set(
    scrapedTweets.map((t) => String(t.tweetId || t.tweet_id || '').trim()).filter(Boolean)
  )

  // 若本次刷新抓取到了主页最新推文，清理不在最新抓取范围内且未上传的空文本/占位符旧行，避免列表越刷越多
  const cleanedPosts = Array.from(map.values()).filter((p) => {
    if (scrapedIdSet.size === 0) return true
    if (p.is_uploaded || p.is_promoted) return true
    if (scrapedIdSet.has(String(p.tweet_id))) return true
    const txt = String(p.content || '').trim()
    const isEmptyPlaceholder = !txt || txt === '(无文字内容)' || txt === '(纯媒体/转发无文字推文)'
    return !isEmptyPlaceholder
  })

  store.posts = cleanedPosts.sort((a, b) =>
    String(b.tweet_id).localeCompare(String(a.tweet_id))
  )
  savePromotedPostsStore(store)
  return { store, newlyAdded }
}
