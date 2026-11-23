import { fileURLToPath } from 'node:url'
import { loadConfig } from './src/config.js'
import { XlanvClient } from './src/api/xlanvClient.js'
import { XAutomationRunner } from './src/browser/xAutomation.js'

export { deAiTone, generateHumanReply } from './src/humanizer/replyGenerator.js'
export { XlanvClient } from './src/api/xlanvClient.js'
export { XAutomationRunner } from './src/browser/xAutomation.js'

/**
 * DeepSeek Harness (Cordis) 插件标准入口
 * 使用 ctx.inject 动态注入可选服务，既不触发 Cordis 未注入访问报错，也不阻塞插件激活
 */
export const name = 'dsh-xlanv'

export function apply(ctx, pluginConfig = {}) {
  const config = loadConfig(pluginConfig)
  const client = new XlanvClient(config.baseUrl, config.apiSecret)
  const runner = new XAutomationRunner({
    client,
    browser: null,
    llm: null,
    config
  })

  // 动态注入可选服务：当服务就绪时自动挂载到 runner，不阻塞主插件启动
  ctx.inject(['browser'], (browserCtx) => {
    runner.browser = browserCtx.browser
    console.log('[dsh-xlanv] 已成功挂载 browser 浏览器服务')
  })

  ctx.inject(['llm'], (llmCtx) => {
    runner.llm = llmCtx.llm
    console.log('[dsh-xlanv] 已成功挂载 llm 服务')
  })

  ctx.on('ready', () => {
    if (!runner.browser) {
      console.warn('====================================================================')
      console.warn('⚠️ [dsh-xlanv] 提示：当前尚未挂载 ctx.browser 服务。')
      console.warn('👉 如需浏览器自动化支持，请确认已安装并启用 dsh-browser-x：')
      console.warn('     dsh plugin --profile web add https://github.com/wilming/dsh-browser-x')
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
