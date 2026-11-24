const AI_CLICHES = [
  /首先[，,]?/g,
  /其次[，,]?/g,
  /最后[，,]?/g,
  /总而言之[，,]?/g,
  /综上所述[，,]?/g,
  /值得注意的是[，,]?/g,
  /不仅如此[，,]?/g,
  /换句话说[，,]?/g,
  /毫无疑问[，,]?/g,
  /显而易见[，,]?/g,
  /非常感谢分享[！!。.]?/g,
  /写得真好[！!。.]?/g
]

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * 借鉴 lieflat-less-ai-tone 语料规则：
 * 1. 严禁破折号 (—— / — / --)
 * 2. 清理 AI 连接词与模板套话
 * 3. 去掉末尾标点符号
 * 4. 随机增加 1~3 个自然空格，保留人工打字感
 */
export function deAiTone(rawText, options = {}) {
  const {
    stripTrailingPunctuation = true,
    forbidEmDash = true,
    extraSpacesMin = 1,
    extraSpacesMax = 3
  } = options

  let text = String(rawText || '').trim()

  if (forbidEmDash) {
    text = text.replace(/——+|—+|--+/g, ' ')
  }

  for (const pattern of AI_CLICHES) {
    text = text.replace(pattern, '')
  }

  // 合并多余连续空白并修剪
  text = text.replace(/\s+/g, ' ').trim()

  if (stripTrailingPunctuation) {
    text = text.replace(/[。！!.,，、；;：:]+$/g, '').trim()
  }

  // 随机在句子停顿处或字符间加入 1~3 个额外空格
  const spaceCount = randomInt(extraSpacesMin, extraSpacesMax)
  for (let i = 0; i < spaceCount; i++) {
    if (text.length < 6) break
    const commaMatch = text.match(/[，,、]/)
    if (commaMatch && commaMatch.index !== undefined && Math.random() < 0.65) {
      const idx = commaMatch.index
      text = text.slice(0, idx) + ' ' + text.slice(idx + 1)
    } else {
      const pos = randomInt(2, text.length - 2)
      text = text.slice(0, pos) + ' ' + text.slice(pos)
    }
  }

  return text.trim()
}

function isTimestampLike(str) {
  const s = String(str || '').trim()
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

function extractKeyword(postContent) {
  const cleaned = String(postContent || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[@#]\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || isTimestampLike(cleaned)) return ''
  // 截取一段核心短语用于结合原帖内容
  const slice = cleaned.slice(0, 14)
  return slice.length >= 4 && !isTimestampLike(slice) ? slice : ''
}

let lastFallbackIndex = -1

function buildFallbackHumanReply(postContent) {
  const kw = extractKeyword(postContent)
  const subjectiveOpeners = [
    '讲真',
    '说实话',
    '我感觉',
    '老实说',
    '有一说一',
    '其实我倒觉得',
    '哈哈太真实了'
  ]
  const opener = subjectiveOpeners[randomInt(0, subjectiveOpeners.length - 1)]

  const templates = kw
    ? [
        `${opener} 看到你说的「${kw}」我也有同感 之前踩过类似的坑`,
        `${opener} 「${kw}」这点确实挺关键的 不过实际落地还得看节奏`,
        `${opener} 关于「${kw}」我之前也纠结过 后来发现还是得自己试一遍才行`,
        `${opener} 你聊到「${kw}」算是说到点子上了 很多人根本没注意到这层`,
        `${opener} 「${kw}」这个切入点很实在 我最近也在关注这块`
      ]
    : [
        `${opener} 这事儿确实不能只看表面 自己跑一遍才有体感`,
        `${opener} 挺认同这个判断的 不过每个人节奏不太一样`,
        `${opener} 刷到你这条刚好想到我前两天也遇到差不多的情况`,
        `${opener} 确实是这样 很多细节只有真上手了才体会得到`
      ]

  let idx = randomInt(0, templates.length - 1)
  if (templates.length > 1 && idx === lastFallbackIndex) {
    idx = (idx + 1) % templates.length
  }
  lastFallbackIndex = idx
  return templates[idx]
}

/**
 * 仅提取帖子纯文字核心内容：过滤图片、视频标记、链接、引用块与长文截断，最大程度节省 Token
 */
export function extractPurePostText(rawContent, maxLen = 180) {
  let text = String(rawContent || '')
  // 1. 移除 dsh-browser-x 图片标记、常见媒体占位符与媒体短链
  text = text
    .replace(/⟦i\d+[^⟧]*⟧/g, ' ')
    .replace(/\[(?:img|image|video|media|gif|card|poll|图片|视频|动图|投票)[^\]]*\]/gi, ' ')
    .replace(/(?:https?:\/\/)?(?:pic\.(?:x|twitter)\.com|t\.co)\/\S+/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
  // 2. 截断引用推文与长文展开提示
  text = text
    .replace(/(?:\n|\s)(?:Quote|Quoted|引用推文|引用|查看引用)[\s\S]*$/i, '')
    .replace(/(?:Show more|显示更多|Translate post|翻译帖子)/gi, ' ')
  // 3. 合并空白并严格截断长度（不提交长文），若是纯时间戳则置空
  text = text.replace(/\s+/g, ' ').trim()
  if (isTimestampLike(text)) return ''
  if (text.length > maxLen) {
    text = text.slice(0, maxLen)
  }
  return text
}

/**
 * 调用 DSH llm 服务生成文本（兼容 @deepseek-ai/dsh-llm 的 stream() 与旧式 chat()）
 */
async function callDshLlm(llm, systemPrompt, userPrompt) {
  if (!llm) return ''

  if (typeof llm.stream === 'function') {
    const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    const provider = providers?.[0]?.id || 'deepseek'
    const model = 'deepseek-chat'
    let out = ''
    for await (const chunk of llm.stream({
      provider,
      model,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: userPrompt }]
        }
      ]
    })) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        out += chunk.text
      }
    }
    return out.trim()
  }

  if (typeof llm.chat === 'function') {
    return String(await llm.chat(`${systemPrompt}\n${userPrompt}`)).trim()
  }

  return ''
}

/**
 * 结合原帖内容生成去 AI 味的拟人化评论
 * 若传入 DSH 的 llm 服务则优先调用大模型 + 规则二次清洗
 */
export async function generateHumanReply(postContent, llm = null, options = {}) {
  let raw = ''
  const compactContent = extractPurePostText(postContent, 180)

  if (llm && (typeof llm.stream === 'function' || typeof llm.chat === 'function')) {
    const customPrompt = String(options.customPrompt || '').trim().slice(0, 1000)
    const systemLines = [
      '你是真实X蓝V用户，根据原帖写12~35字口语短评。必须紧扣原帖具体内容表达主观感受，严禁套话、严禁破折号、严禁重复模板，末尾不加标点。'
    ]
    if (customPrompt) {
      systemLines.push(`人设与额外要求：${customPrompt}`)
    }
    const systemPrompt = systemLines.join('\n')
    const userPrompt = compactContent
      ? `原帖内容：${compactContent}\n请直接输出一条简短自然的评论：`
      : '请输出一条简短自然、不带标点的日常互动短评：'

    try {
      raw = await callDshLlm(llm, systemPrompt, userPrompt)
    } catch (err) {
      console.warn('[dsh-xlanv] LLM 生成失败，切换本地拟人模板:', err.message)
    }
  }

  if (!raw || !raw.trim()) {
    raw = buildFallbackHumanReply(compactContent)
  }

  return deAiTone(raw, options)
}
