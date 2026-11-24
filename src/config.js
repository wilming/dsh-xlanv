import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PLACEHOLDER_SECRET = '在此填入你在 xlanv.net 绑定的 api_secret'

export function isValidApiSecret(secret) {
  const s = String(secret || '').trim()
  return s.length > 0 && s !== PLACEHOLDER_SECRET
}

/**
 * 统一使用 ~/.dsh/xlanv 作为持久化配置与缓存目录，避免依赖不可预测的 process.cwd()
 */
export function getDataDir() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'xlanv')
}

export function getConfigPath() {
  return path.join(getDataDir(), 'config.json')
}

export function getPromotedPostsPath() {
  return path.join(getDataDir(), 'promoted_posts.json')
}

export function getLogsPath() {
  return path.join(getDataDir(), 'logs.json')
}

const DEFAULT_CONFIG = {
  enabled: true,
  baseUrl: 'https://xlanv.net/api/v1',
  apiSecret: '',
  customPrompt: '',
  mode: 'semi-auto', // 'semi-auto' (20s弹窗确认) | 'auto'
  confirmTimeoutSeconds: 20,
  activeStartHour: 0,
  activeEndHour: 24,
  loopPollIntervalSeconds: 15,
  actions: {
    retweet: true,
    reply: true,
    like: true
  },
  timing: {
    dwellMinMs: 5000,
    dwellMaxMs: 12000,
    intervalMinMs: 60000,
    intervalMaxMs: 180000,
    recommendFollowIntervalMs: 3600000,
    highPriorityProbability: 0.1
  },
  humanReply: {
    stripTrailingPunctuation: true,
    forbidEmDash: true,
    extraSpacesMin: 1,
    extraSpacesMax: 3
  }
}

export function loadConfig(overrides = {}) {
  let fileCfg = {}
  const primaryPath = getConfigPath()
  const fallbackCwdPath = path.resolve(process.cwd(), 'config.json')
  const cfgPath = fs.existsSync(primaryPath) ? primaryPath : fallbackCwdPath

  if (fs.existsSync(cfgPath)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    } catch (err) {
      console.warn('[dsh-xlanv] 读取 config.json 失败，使用默认配置:', err.message)
    }
  }

  const cleanOverrides = { ...overrides }
  if (!isValidApiSecret(cleanOverrides.apiSecret)) {
    delete cleanOverrides.apiSecret
  }

  const merged = {
    ...DEFAULT_CONFIG,
    ...fileCfg,
    ...cleanOverrides,
    actions: {
      ...DEFAULT_CONFIG.actions,
      ...(fileCfg.actions || {}),
      ...(cleanOverrides.actions || {})
    },
    timing: {
      ...DEFAULT_CONFIG.timing,
      ...(fileCfg.timing || {}),
      ...(cleanOverrides.timing || {})
    },
    humanReply: {
      ...DEFAULT_CONFIG.humanReply,
      ...(fileCfg.humanReply || {}),
      ...(cleanOverrides.humanReply || {})
    }
  }

  // 兼容 DSH 界面扁平化参数映射
  if (typeof cleanOverrides.enableRetweet === 'boolean') merged.actions.retweet = cleanOverrides.enableRetweet
  if (typeof cleanOverrides.enableReply === 'boolean') merged.actions.reply = cleanOverrides.enableReply
  if (typeof cleanOverrides.enableLike === 'boolean') merged.actions.like = cleanOverrides.enableLike

  if (typeof cleanOverrides.dwellMinSeconds === 'number') {
    merged.timing.dwellMinMs = Math.max(1, cleanOverrides.dwellMinSeconds) * 1000
  }
  if (typeof cleanOverrides.dwellMaxSeconds === 'number') {
    merged.timing.dwellMaxMs = Math.max(merged.timing.dwellMinMs, cleanOverrides.dwellMaxSeconds * 1000)
  }
  if (typeof cleanOverrides.intervalMinSeconds === 'number') {
    merged.timing.intervalMinMs = Math.max(5, cleanOverrides.intervalMinSeconds) * 1000
  }
  if (typeof cleanOverrides.intervalMaxSeconds === 'number') {
    merged.timing.intervalMaxMs = Math.max(merged.timing.intervalMinMs, cleanOverrides.intervalMaxSeconds * 1000)
  }
  if (typeof cleanOverrides.recommendFollowIntervalMinutes === 'number') {
    merged.timing.recommendFollowIntervalMs = Math.max(5, cleanOverrides.recommendFollowIntervalMinutes) * 60 * 1000
  }

  if (process.env.XLANV_BASE_URL) merged.baseUrl = process.env.XLANV_BASE_URL
  if (process.env.XLANV_API_SECRET) merged.apiSecret = process.env.XLANV_API_SECRET
  if (process.env.XLANV_MODE) merged.mode = process.env.XLANV_MODE

  if (typeof merged.customPrompt === 'string') {
    merged.customPrompt = merged.customPrompt.trim().slice(0, 1000)
  } else {
    merged.customPrompt = ''
  }

  return merged
}

export function saveConfig(config) {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const cfgPath = getConfigPath()
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8')
  return cfgPath
}
