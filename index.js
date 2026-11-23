import { fileURLToPath } from 'node:url'
import { loadConfig } from './src/config.js'
import { XlanvClient } from './src/api/xlanvClient.js'
import { XAutomationRunner } from './src/browser/xAutomation.js'

export { deAiTone, generateHumanReply } from './src/humanizer/replyGenerator.js'
export { XlanvClient } from './src/api/xlanvClient.js'
export { XAutomationRunner } from './src/browser/xAutomation.js'

/**
 * DeepSeek Harness (Cordis) 插件标准入口
 * 不强制阻塞等待 browser 服务，避免因服务名差异导致插件一直处于 pending 状态
 */
export const name = 'dsh-xlanv'

export function apply(ctx, pluginConfig = {}) {
  const config = loadConfig(pluginConfig)
  const client = new XlanvClient(config.baseUrl, config.apiSecret)
  const runner = new XAutomationRunner({
    client,
    browser: ctx.browser || null,
    llm: ctx.llm || null,
    config
  })

  ctx.on('ready', () => {
    if (!runner.browser && ctx.browser) {
      runner.browser = ctx.browser
    }
    if (!runner.llm && ctx.llm) {
      runner.llm = ctx.llm
    }

    if (!runner.browser) {
      console.warn('====================================================================')
      console.warn('⚠️ [dsh-xlanv] 提示：未检测到 ctx.browser 服务。')
      console.warn('👉 如需浏览器自动化支持，请确认已安装并启用 dsh-browser-x：')
      console.warn('     dsh plugin --profile web add https://github.com/wilming/dsh-browser-x')
      console.warn('👉 详细图文指引请参考本插件说明书: README.md')
      console.warn('====================================================================')
    }

    runner.start().catch((err) => {
      console.error('[dsh-xlanv] 启动失败:', err.message)
    })
  })

  ctx.on('dispose', () => {
    runner.stop()
  })
}

// 支持独立命令行运行测试（npm start）
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirectRun) {
  const config = loadConfig()
  const client = new XlanvClient(config.baseUrl, config.apiSecret)
  const runner = new XAutomationRunner({
    client,
    browser: null,
    llm: null,
    config
  })

  process.on('SIGINT', () => runner.stop())
  process.on('SIGTERM', () => runner.stop())

  runner.start().catch((err) => {
    console.error('[dsh-xlanv] 启动失败:', err.message)
    process.exit(1)
  })
}
