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

function extractKeyword(postContent) {
  const cleaned = String(postContent || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[@#]\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  // 截取一段核心短语用于结合原帖内容
  const slice = cleaned.slice(0, 14)
  return slice.length >= 4 ? slice : ''
}

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
        `${opener} 你聊到「${kw}」算是说到点子上了 很多人根本没注意到这层`
      ]
    : [
        `${opener} 这事儿确实不能只看表面 自己跑一遍才有体感`,
        `${opener} 挺认同这个判断的 不过每个人节奏不太一样`,
        `${opener} 刷到你这条刚好想到我前两天也遇到差不多的情况`
      ]

  return templates[randomInt(0, templates.length - 1)]
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
  // 3. 合并空白并严格截断长度（不提交长文）
  text = text.replace(/\s+/g, ' ').trim()
  if (text.length > maxLen) {
    text = text.slice(0, maxLen)
  }
  return text
}

/**
 * 结合原帖内容生成去 AI 味的拟人化评论
 * 若传入 DSH 的 llm.chat 接口则优先调用大模型 + 规则二次清洗
 */
export async function generateHumanReply(postContent, llm = null, options = {}) {
  let raw = ''
  const compactContent = extractPurePostText(postContent, 180)

  if (llm && typeof llm.chat === 'function') {
    const customPrompt = String(options.customPrompt || '').trim().slice(0, 1000)
    const promptLines = [
      '你是真实X蓝V用户，结合原帖写12~35字口语短评（表达主观感受，禁破折号与AI套话，末尾无标点）：'
    ]
    if (customPrompt) {
      promptLines.push(`人设要求：${customPrompt}`)
    }
    promptLines.push(`原帖：${compactContent}`)
    const prompt = promptLines.join('\n')

    try {
      raw = await llm.chat(prompt)
    } catch (err) {
      console.warn('[dsh-xlanv] LLM 生成失败，切换本地拟人模板:', err.message)
    }
  }

  if (!raw || !raw.trim()) {
    raw = buildFallbackHumanReply(compactContent)
  }

  return deAiTone(raw, options)
}
