import { getConfigPath, isValidApiSecret, loadConfig, saveConfig } from '../config.js'

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  return raw ? JSON.parse(raw) : {}
}

function buildSettingsHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>XLANV 蓝V互助插件 · 设置中心</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #f1f5f9;
      color: #0f172a;
      padding: 28px 16px 48px;
    }
    .container { max-width: 820px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #fff;
      border-radius: 16px;
      padding: 24px 28px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.14);
    }
    .title-wrap h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; }
    .title-wrap p { margin: 0; font-size: 13px; color: #94a3b8; }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; }
    .badge {
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: rgba(255,255,255,0.1);
      color: #e2e8f0;
    }
    .badge.ok { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
    .badge.warn { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 22px 24px;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
    }
    .card h2 {
      margin: 0 0 16px;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 10px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .full { grid-column: 1 / -1; }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      margin-bottom: 6px;
    }
    .hint { font-size: 12px; color: #64748b; margin-top: 4px; }
    input[type="text"], input[type="number"], select {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 14px;
      color: #0f172a;
      background: #fff;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #1d9bf0;
      box-shadow: 0 0 0 3px rgba(29, 155, 240, 0.15);
    }
    .switches { display: flex; flex-wrap: wrap; gap: 20px; }
    .switch-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .switch-item input { width: 16px; height: 16px; accent-color: #1d9bf0; }
    .actions-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 8px;
    }
    .btn-save {
      background: #1d9bf0;
      color: #fff;
      border: none;
      padding: 11px 28px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-save:hover { background: #1a8cd8; }
    .msg { font-size: 13px; font-weight: 600; }
    .msg.ok { color: #16a34a; }
    .msg.err { color: #dc2626; }
    .path-note { font-size: 12px; color: #64748b; font-family: monospace; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title-wrap">
        <h1>XLANV 蓝V互助插件 · 设置中心</h1>
        <p>配置直接持久化到用户目录，保存后立即热更新生效</p>
      </div>
      <div class="badges">
        <span id="badgeRunner" class="badge">加载中...</span>
        <span id="badgeBrowser" class="badge">浏览器检查中...</span>
        <span id="badgeFollowed" class="badge">已关注: 0</span>
      </div>
    </div>

    <form id="cfgForm">
      <div class="card">
        <h2>1. 账号密钥与托管模式</h2>
        <div class="grid">
          <div class="full">
            <label for="apiSecret">平台密钥 (api_secret)</label>
            <input id="apiSecret" type="text" placeholder="请前往 xlanv.net 绑定 X 用户名后复制 32 位 api_secret" />
            <div class="hint">密钥保存在本地 ~/.dsh/xlanv/config.json，绝不上传第三方。</div>
          </div>
          <div class="full">
            <label for="baseUrl">后端服务地址 (baseUrl)</label>
            <input id="baseUrl" type="text" />
          </div>
          <div>
            <label for="mode">运行托管模式</label>
            <select id="mode">
              <option value="semi-auto">半自动（弹窗倒计时人工确认，超时自动执行）</option>
              <option value="auto">全自动托管（无弹窗，按拟人节奏自动执行）</option>
            </select>
          </div>
          <div>
            <label for="confirmTimeoutSeconds">人工确认倒计时（秒）</label>
            <input id="confirmTimeoutSeconds" type="number" min="5" max="120" />
          </div>
          <div class="full">
            <label class="switch-item">
              <input id="enabled" type="checkbox" />
              <span>开启 24 小时自动互助总开关</span>
            </label>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>2. 自动运行时间段与频率间隔</h2>
        <div class="grid">
          <div>
            <label for="activeStartHour">每日开始运行时间（0~23 点）</label>
            <input id="activeStartHour" type="number" min="0" max="23" />
          </div>
          <div>
            <label for="activeEndHour">每日停止运行时间（1~24 点）</label>
            <input id="activeEndHour" type="number" min="1" max="24" />
            <div class="hint">0 到 24 表示全天运行；支持跨午夜如 22 到 6。</div>
          </div>
          <div>
            <label for="intervalMinSeconds">互动最小休息间隔（秒）</label>
            <input id="intervalMinSeconds" type="number" min="10" max="3600" />
          </div>
          <div>
            <label for="intervalMaxSeconds">互动最大休息间隔（秒）</label>
            <input id="intervalMaxSeconds" type="number" min="10" max="3600" />
          </div>
          <div>
            <label for="dwellMinSeconds">推文视口最小停留（秒）</label>
            <input id="dwellMinSeconds" type="number" min="1" max="60" />
          </div>
          <div>
            <label for="dwellMaxSeconds">推文视口最大停留（秒）</label>
            <input id="dwellMaxSeconds" type="number" min="1" max="60" />
          </div>
          <div>
            <label for="recommendFollowIntervalMinutes">推荐关注拉取周期（分钟）</label>
            <input id="recommendFollowIntervalMinutes" type="number" min="10" max="1440" />
          </div>
          <div>
            <label for="loopPollIntervalSeconds">主巡检轮询间隔（秒）</label>
            <input id="loopPollIntervalSeconds" type="number" min="5" max="600" />
          </div>
        </div>
      </div>

      <div class="card">
        <h2>3. 互动动作开关（零和积分）</h2>
        <div class="switches">
          <label class="switch-item"><input id="enableRetweet" type="checkbox" /> 转发推文 (+3 分)</label>
          <label class="switch-item"><input id="enableReply" type="checkbox" /> 去 AI 味拟人评论 (+2 分)</label>
          <label class="switch-item"><input id="enableLike" type="checkbox" /> 点赞推文 (+1 分)</label>
        </div>
      </div>

      <div class="actions-bar">
        <div>
          <button type="submit" class="btn-save">保存并立即生效</button>
          <span id="saveMsg" class="msg"></span>
        </div>
        <div id="cfgPath" class="path-note"></div>
      </div>
    </form>
  </div>

  <script>
    const $ = (id) => document.getElementById(id)

    async function loadStatus() {
      const res = await fetch('/xlanv/api/status')
      const data = await res.json()
      const cfg = data.config

      $('apiSecret').value = cfg.apiSecret || ''
      $('baseUrl').value = cfg.baseUrl || 'https://xlanv.net/api/v1'
      $('enabled').checked = cfg.enabled !== false
      $('mode').value = cfg.mode || 'semi-auto'
      $('confirmTimeoutSeconds').value = cfg.confirmTimeoutSeconds ?? 20
      $('activeStartHour').value = cfg.activeStartHour ?? 0
      $('activeEndHour').value = cfg.activeEndHour ?? 24
      $('intervalMinSeconds').value = Math.round((cfg.timing?.intervalMinMs ?? 60000) / 1000)
      $('intervalMaxSeconds').value = Math.round((cfg.timing?.intervalMaxMs ?? 180000) / 1000)
      $('dwellMinSeconds').value = Math.round((cfg.timing?.dwellMinMs ?? 5000) / 1000)
      $('dwellMaxSeconds').value = Math.round((cfg.timing?.dwellMaxMs ?? 12000) / 1000)
      $('recommendFollowIntervalMinutes').value = Math.round((cfg.timing?.recommendFollowIntervalMs ?? 3600000) / 60000)
      $('loopPollIntervalSeconds').value = cfg.loopPollIntervalSeconds ?? 15
      $('enableRetweet').checked = cfg.actions?.retweet !== false
      $('enableReply').checked = cfg.actions?.reply !== false
      $('enableLike').checked = cfg.actions?.like !== false

      const rBadge = $('badgeRunner')
      rBadge.textContent = data.status.running ? '引擎运行中' : (data.status.hasSecret ? '已待命' : '未配置密钥')
      rBadge.className = 'badge ' + (data.status.running ? 'ok' : 'warn')

      const bBadge = $('badgeBrowser')
      bBadge.textContent = data.status.browserReady ? '浏览器工具已就绪' : '浏览器工具未连接'
      bBadge.className = 'badge ' + (data.status.browserReady ? 'ok' : 'warn')

      $('badgeFollowed').textContent = '已关注: ' + (data.status.followedCount || 0)
      $('cfgPath').textContent = '配置文件: ' + data.status.configPath
    }

    $('cfgForm').addEventListener('submit', async (e) => {
      e.preventDefault()
      const msg = $('saveMsg')
      msg.textContent = ' 保存中...'
      msg.className = 'msg'

      const payload = {
        apiSecret: $('apiSecret').value.trim(),
        baseUrl: $('baseUrl').value.trim(),
        enabled: $('enabled').checked,
        mode: $('mode').value,
        confirmTimeoutSeconds: Number($('confirmTimeoutSeconds').value),
        activeStartHour: Number($('activeStartHour').value),
        activeEndHour: Number($('activeEndHour').value),
        intervalMinSeconds: Number($('intervalMinSeconds').value),
        intervalMaxSeconds: Number($('intervalMaxSeconds').value),
        dwellMinSeconds: Number($('dwellMinSeconds').value),
        dwellMaxSeconds: Number($('dwellMaxSeconds').value),
        recommendFollowIntervalMinutes: Number($('recommendFollowIntervalMinutes').value),
        loopPollIntervalSeconds: Number($('loopPollIntervalSeconds').value),
        enableRetweet: $('enableRetweet').checked,
        enableReply: $('enableReply').checked,
        enableLike: $('enableLike').checked
      }

      try {
        const res = await fetch('/xlanv/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const out = await res.json()
        if (!res.ok) throw new Error(out.error || '保存失败')
        msg.textContent = ' ✓ 已保存并生效！'
        msg.className = 'msg ok'
        await loadStatus()
      } catch (err) {
        msg.textContent = ' ✗ ' + err.message
        msg.className = 'msg err'
      }
    })

    loadStatus()
  </script>
</body>
</html>`
}

/**
 * 在 DSH 内置 webServer 上注册 /xlanv 设置中心页面与热更新接口
 */
export function registerSettingsRoutes(webServer, { runner, client, onConfigUpdated }) {
  return webServer.register({
    kind: 'prefix',
    path: '/xlanv',
    handler: async (req, res) => {
      const reqUrl = new URL(req.url || '/xlanv', 'http://127.0.0.1')
      const pathname = reqUrl.pathname

      if (req.method === 'GET' && (pathname === '/xlanv' || pathname === '/xlanv/')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        })
        res.end(buildSettingsHtml())
        return
      }

      if (req.method === 'GET' && pathname === '/xlanv/api/status') {
        sendJson(res, 200, {
          config: runner.config,
          status: {
            running: runner.running,
            hasSecret: isValidApiSecret(runner.config.apiSecret),
            browserReady: Boolean(runner.browser),
            followedCount: runner.followedMap.size,
            configPath: getConfigPath()
          }
        })
        return
      }

      if (req.method === 'POST' && pathname === '/xlanv/api/config') {
        try {
          const body = await readJsonBody(req)
          const current = loadConfig()
          const next = loadConfig({ ...current, ...body })
          if (typeof body.apiSecret === 'string') {
            next.apiSecret = body.apiSecret.trim()
          }
          saveConfig(next)

          runner.config = next
          client.baseUrl = next.baseUrl.replace(/\/+$/, '')
          client.apiSecret = next.apiSecret
          if (typeof onConfigUpdated === 'function') {
            onConfigUpdated(next)
          }

          sendJson(res, 200, { ok: true, configPath: getConfigPath() })
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }

      sendJson(res, 404, { error: 'Not Found' })
    }
  })
}

/**
 * 注入到 DSH Web UI 的侧边悬浮按钮与抽屉式设置面板脚本（严格不包含 </script ）
 */
export function buildDshUiInjectScript() {
  return `(function(){
    if (window.__dshXlanvUiMounted) return;
    window.__dshXlanvUiMounted = true;
    function mount() {
      if (!document.body || document.getElementById('dsh-xlanv-fab')) return;
      var fab = document.createElement('button');
      fab.id = 'dsh-xlanv-fab';
      fab.type = 'button';
      fab.textContent = 'XLANV 互助设置';
      fab.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:99998;padding:8px 14px;border-radius:999px;border:1px solid rgba(29,155,240,0.4);background:#0f172a;color:#38bdf8;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,0.22);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';

      var drawer = document.createElement('div');
      drawer.id = 'dsh-xlanv-drawer';
      drawer.style.cssText = 'position:fixed;top:0;right:0;width:min(860px,95vw);height:100vh;z-index:99999;background:#fff;box-shadow:-8px 0 32px rgba(15,23,42,0.25);display:none;flex-direction:column;';

      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#0f172a;color:#fff;font-size:13px;font-weight:700;';
      var title = document.createElement('span');
      title.textContent = 'XLANV 蓝V互助插件 · 设置中心';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '关闭 ✕';
      closeBtn.style.cssText = 'border:1px solid #334155;background:#1e293b;color:#e2e8f0;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;';

      var frame = document.createElement('iframe');
      frame.src = '/xlanv';
      frame.style.cssText = 'flex:1;width:100%;border:none;background:#f1f5f9;';

      bar.appendChild(title);
      bar.appendChild(closeBtn);
      drawer.appendChild(bar);
      drawer.appendChild(frame);

      fab.onclick = function() {
        var open = drawer.style.display === 'flex';
        drawer.style.display = open ? 'none' : 'flex';
        if (!open) frame.src = '/xlanv';
      };
      closeBtn.onclick = function() {
        drawer.style.display = 'none';
      };

      document.body.appendChild(fab);
      document.body.appendChild(drawer);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  })();`
}
