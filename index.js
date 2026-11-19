import { fileURLToPath } from 'node:url'
import { loadConfig } from './src/config.js'
import { XlanvClient } from './src/api/xlanvClient.js'
import { XAutomationRunner } from './src/browser/xAutomation.js'

export { deAiTone, generateHumanReply } from './src/humanizer/replyGenerator.js'
export { XlanvClient } from './src/api/xlanvClient.js'
export { XAutomationRunner } from './src/browser/xAutomation.js'

/**
 * DeepSeek Harness (Cordis) 插件标准入口
 * 在 DSH 中安装后会自动注入 browser (dsh-browser) 与 llm 服务
 */
export const name = 'dsh-xlanv'
export const inject = {
  required: ['browser'],
  optional: ['llm']
}

export function apply(ctx, pluginConfig = {}) {
  const config = loadConfig(pluginConfig)
  const client = new XlanvClient(config.baseUrl, config.apiSecret)
  const runner = new XAutomationRunner({
    client,
    browser: ctx.browser,
    llm: ctx.llm || null,
    config
  })

  ctx.on('ready', () => {
    if (!ctx.browser) {
      console.error('====================================================================')
      console.error('❌ [dsh-xlanv] 错误：未检测到可用的 dsh-browser 浏览器服务！')
      console.error('👉 本插件依赖 dsh-browser 提供指纹浏览器及推特登录态维持。')
      console.error('👉 解决方法：请在终端中执行以下命令安装并启用浏览器助手：')
      console.error('     dsh plugin --profile web add dsh-browser')
      console.error('👉 详细图文指引请参考本插件说明书: README.md')
      console.error('====================================================================')
      return
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
