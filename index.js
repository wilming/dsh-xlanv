import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { isValidApiSecret, loadConfig } from './src/config.js'
import { XlanvClient } from './src/api/xlanvClient.js'
import { DshBrowserToolAdapter } from './src/browser/dshToolsAdapter.js'
import { XAutomationRunner } from './src/browser/xAutomation.js'
import { activityLogger } from './src/storage/activityLogger.js'
import { buildDshUiInjectScript, registerSettingsRoutes } from './src/ui/settingsPage.js'

export { deAiTone, generateHumanReply } from './src/humanizer/replyGenerator.js'
export { XlanvClient } from './src/api/xlanvClient.js'
export { XAutomationRunner } from './src/browser/xAutomation.js'

/**
 * DeepSeek Harness (Cordis) 插件标准入口
 * 使用 ctx.inject 动态注入可选服务，既不触发 Cordis 未注入访问报错，也不阻塞插件激活
 */
export const name = 'XLANV 蓝V互助设置'

export const Config = z.object({
      apiSecret: z
        .string()
        .default('')
        .description('xlanv.net 平台密钥（api_secret）。请在官网绑定 X 用户名后复制填入此处。'),
      customPrompt: z
        .string()
        .max(1000)
        .default('')
        .description('自定义互动 Prompt 提示语（1000字以内），运行时将作为提示词加入上下文窗口。'),
      baseUrl: z
        .string()
        .default('https://xlanv.net/api/v1')
        .description('xlanv.net 后端接口地址，一般保持默认即可。'),
      enabled: z
        .boolean()
        .default(true)
        .description('是否开启自动互助任务总开关。关闭后插件保持待命，不执行任何互动。'),
      mode: z
        .union([
          z.const('semi-auto').description('半自动（互动前弹窗倒计时人工确认，超时自动执行）'),
          z.const('auto').description('全自动托管（无确认弹窗，按拟人节奏自动执行）')
        ])
        .default('semi-auto')
        .description('托管模式：半自动确认 或 全自动托管。'),
      confirmTimeoutSeconds: z
        .number()
        .step(1)
        .min(5)
        .max(120)
        .default(20)
        .description('半自动模式下的人工确认倒计时时间（秒），超时未操作将自动发送。'),
      activeStartHour: z
        .number()
        .step(1)
        .min(0)
        .max(23)
        .default(0)
        .description('每日自动运行开始时间（0~23点）。设为 0~24 表示全天 24 小时运行。'),
      activeEndHour: z
        .number()
        .step(1)
        .min(1)
        .max(24)
        .default(24)
        .description('每日自动运行结束时间（1~24点）。支持跨午夜，例如 22 到 6。'),
      intervalMinSeconds: z
        .number()
        .step(1)
        .min(10)
        .max(3600)
        .default(60)
        .description('每条推文互动后的最小随机休息间隔（秒）。'),
      intervalMaxSeconds: z
        .number()
        .step(1)
        .min(10)
        .max(3600)
        .default(180)
        .description('每条推文互动后的最大随机休息间隔（秒）。'),
      dwellMinSeconds: z
        .number()
        .step(1)
        .min(1)
        .max(60)
        .default(5)
        .description('浏览单条推文时的最小拟人停留时长（秒）。'),
      dwellMaxSeconds: z
        .number()
        .step(1)
        .min(1)
        .max(60)
        .default(12)
        .description('浏览单条推文时的最大拟人停留时长（秒）。'),
      recommendFollowIntervalMinutes: z
        .number()
        .step(1)
        .min(10)
        .max(1440)
        .default(60)
        .description('自动拉取推荐关注列表的周期（分钟），默认 60 分钟。'),
      loopPollIntervalSeconds: z
        .number()
        .step(1)
        .min(60)
        .max(3600)
        .default(60)
        .description('主巡检循环的轮询检查间隔（秒），最低 60 秒。'),
      enableRetweet: z
        .boolean()
        .default(true)
        .description('允许自动转发已推广推文（+3 积分）。'),
      enableReply: z
        .boolean()
        .default(true)
        .description('允许自动发送去 AI 味拟人评论（+2 积分）。'),
      enableLike: z
        .boolean()
        .default(true)
        .description('允许自动点赞已推广推文（+1 积分）。')
    })

export function apply(ctx, pluginConfig = {}) {
  const config = loadConfig(pluginConfig)
  const client = new XlanvClient(config.baseUrl, config.apiSecret, {
    onApiLog: ({ ok, method, path, status, durationMs, data, error }) => {
      if (typeof data?.current_points === 'number') {
        activityLogger.setCurrentPoints(data.current_points)
      } else if (typeof data?.points === 'number') {
        activityLogger.setCurrentPoints(data.points)
      }
      if (!ok) {
        activityLogger.append({
          type: 'API_ERROR',
          action: `接口调用失败: ${method} ${path}`,
          api: `${method} ${path}`,
          status,
          durationMs,
          detail: error || ''
        })
      }
    }
  })
  const runner = new XAutomationRunner({
    client,
    browser: null,
    llm: null,
    config
  })

  // 动态注入 dsh-browser-x 注册在 ctx.tools 上的 browser_* 工具适配器
  ctx.inject(['tools'], (toolsCtx) => {
    if (!runner.browser) {
      runner.browser = new DshBrowserToolAdapter(toolsCtx.tools)
      console.log('[dsh-xlanv] 已成功挂载 dsh-browser-x (browser_*) 工具适配器')
    }
  })

  // 兼容传统 ctx.browser 服务
  ctx.inject(['browser'], (browserCtx) => {
    runner.browser = browserCtx.browser
    console.log('[dsh-xlanv] 已成功挂载 browser 浏览器服务')
  })

  ctx.inject(['llm'], (llmCtx) => {
    runner.llm = llmCtx.llm
    console.log('[dsh-xlanv] 已成功挂载 llm 服务')
  })

  // 注入到 DSH Web 界面侧边/左下角，点击即可在 DSH 界面内直接打开设置抽屉
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'script',
      placement: 'body',
      text: buildDshUiInjectScript()
    })
  })

  // 在 DSH 内置 webServer 上注册专属设置页面 /xlanv
  let disposeSettingsRoute = null
  ctx.inject(['webServer'], (wsCtx) => {
    disposeSettingsRoute = registerSettingsRoutes(wsCtx.webServer, {
      runner,
      client,
      onConfigUpdated: (nextCfg) => {
        if (nextCfg.enabled === false) {
          if (runner.running) runner.stop()
          return
        }
        if (isValidApiSecret(nextCfg.apiSecret) && !runner.running) {
          runner.start().catch((err) => {
            console.error('[dsh-xlanv] 热更新启动失败:', err.message)
          })
        }
      }
    })
    const host = wsCtx.webServer.host || '127.0.0.1'
    const port = wsCtx.webServer.port
    if (port) {
      console.log(`[dsh-xlanv] 可视化设置页面已就绪: http://${host}:${port}/xlanv`)
    } else {
      console.log('[dsh-xlanv] 可视化设置页面已挂载到 /xlanv 路由')
    }
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
    if (typeof disposeSettingsRoute === 'function') {
      disposeSettingsRoute()
      disposeSettingsRoute = null
    }
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
