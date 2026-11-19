import fs from 'node:fs'
import path from 'node:path'

export const PLACEHOLDER_SECRET = '在此填入你在 xlanv.net 绑定的 api_secret'

export function isValidApiSecret(secret) {
  const s = String(secret || '').trim()
  return s.length > 0 && s !== PLACEHOLDER_SECRET
}

const DEFAULT_CONFIG = {
  baseUrl: 'https://xlanv.net/api/v1',
  apiSecret: '',
  mode: 'semi-auto', // 'semi-auto' (20s弹窗确认) | 'auto'
  confirmTimeoutSeconds: 20,
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
  const cfgPath = path.resolve(process.cwd(), 'config.json')
  if (fs.existsSync(cfgPath)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    } catch (err) {
      console.warn('[dsh-xlanv] 读取 config.json 失败，使用默认配置:', err.message)
    }
  }

  const merged = {
    ...DEFAULT_CONFIG,
    ...fileCfg,
    ...overrides,
    actions: {
      ...DEFAULT_CONFIG.actions,
      ...(fileCfg.actions || {}),
      ...(overrides.actions || {})
    },
    timing: {
      ...DEFAULT_CONFIG.timing,
      ...(fileCfg.timing || {}),
      ...(overrides.timing || {})
    },
    humanReply: {
      ...DEFAULT_CONFIG.humanReply,
      ...(fileCfg.humanReply || {}),
      ...(overrides.humanReply || {})
    }
  }

  if (process.env.XLANV_BASE_URL) merged.baseUrl = process.env.XLANV_BASE_URL
  if (process.env.XLANV_API_SECRET) merged.apiSecret = process.env.XLANV_API_SECRET
  if (process.env.XLANV_MODE) merged.mode = process.env.XLANV_MODE

  return merged
}

export function saveConfig(config) {
  const cfgPath = path.resolve(process.cwd(), 'config.json')
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8')
}
