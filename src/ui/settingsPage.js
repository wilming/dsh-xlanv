import { getConfigPath, getPromotedPostsPath, isValidApiSecret, loadConfig, saveConfig } from '../config.js'
import { activityLogger } from '../storage/activityLogger.js'
import {
  actionsArrayToObj,
  actionsObjToArray,
  loadPromotedPostsStore,
  mergePromotedPosts,
  savePromotedPostsStore
} from '../storage/promotedPostsStore.js'

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
  <title>XLANV 蓝V互助插件 · 控制台</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #f1f5f9;
      color: #0f172a;
      padding: 20px 16px 48px;
    }
    .container { max-width: 920px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #fff;
      border-radius: 16px;
      padding: 20px 24px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.14);
    }
    .title-wrap h1 { margin: 0 0 4px; font-size: 19px; font-weight: 800; }
    .title-wrap p { margin: 0; font-size: 12px; color: #94a3b8; }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; }
    .badge {
      padding: 4px 11px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: rgba(255,255,255,0.12);
      color: #e2e8f0;
    }
    .badge.ok { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
    .badge.warn { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .badge.blue { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 10px;
    }
    .tab-btn {
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #334155;
      padding: 8px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }
    .tab-btn.active {
      background: #1d9bf0;
      border-color: #1d9bf0;
      color: #fff;
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .card {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 20px 22px;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
    }
    .card h2 {
      margin: 0 0 14px;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
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
    input[type="text"], input[type="number"], select, textarea {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 13px;
      color: #0f172a;
      background: #fff;
      font-family: inherit;
    }
    textarea { resize: vertical; min-height: 92px; line-height: 1.6; }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #1d9bf0;
      box-shadow: 0 0 0 3px rgba(29, 155, 240, 0.15);
    }
    .switches { display: flex; flex-wrap: wrap; gap: 18px; }
    .switch-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    .switch-item input { width: 15px; height: 15px; accent-color: #1d9bf0; }
    .actions-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .btn {
      border: none;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-primary { background: #1d9bf0; color: #fff; }
    .btn-primary:hover { background: #1a8cd8; }
    .btn-secondary { background: #e2e8f0; color: #1e293b; }
    .btn-secondary:hover { background: #cbd5e1; }
    .btn-success { background: #16a34a; color: #fff; }
    .btn-warn { background: #f59e0b; color: #fff; }
    .btn-sm { padding: 5px 11px; font-size: 12px; border-radius: 6px; }
    .msg { font-size: 13px; font-weight: 600; }
    .msg.ok { color: #16a34a; }
    .msg.err { color: #dc2626; }
    .path-note { font-size: 12px; color: #64748b; font-family: monospace; }

    /* 帖子推广列表 */
    .post-item {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 12px;
      background: #f8fafc;
    }
    .post-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .post-id { font-family: monospace; font-size: 12px; color: #475569; }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
    }
    .tag-active { background: #dcfce7; color: #15803d; }
    .tag-paused { background: #fef3c7; color: #b45309; }
    .tag-pending { background: #e0f2fe; color: #0369a1; }
    .post-content {
      font-size: 13px;
      color: #1e293b;
      line-height: 1.55;
      margin-bottom: 10px;
      word-break: break-word;
    }
    .post-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }

    /* 日志窗口 */
    .log-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }
    .log-list {
      max-height: 460px;
      overflow-y: auto;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #0f172a;
      color: #e2e8f0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      padding: 8px 12px;
    }
    .log-row {
      padding: 7px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .log-row:last-child { border-bottom: none; }
    .log-top {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .log-time { color: #64748b; }
    .log-type {
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
    }
    .t-INTERACT { background: rgba(29,155,240,0.2); color: #38bdf8; }
    .t-FOLLOW { background: rgba(34,197,94,0.2); color: #4ade80; }
    .t-PROMOTE { background: rgba(168,85,247,0.2); color: #c084fc; }
    .t-API_ERROR { background: rgba(239,68,68,0.2); color: #f87171; }
    .t-SYSTEM { background: rgba(148,163,184,0.2); color: #cbd5e1; }
    .log-pts { font-weight: 700; color: #4ade80; }
    .log-api { color: #94a3b8; font-size: 11px; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title-wrap">
        <h1>XLANV 蓝V互助插件 · 控制台</h1>
        <p>本地设置 · 帖子推广管理 · 实时操作与积分日志</p>
      </div>
      <div class="badges">
        <span id="badgeRunner" class="badge">加载中...</span>
        <span id="badgeBrowser" class="badge">浏览器检查中...</span>
        <span id="badgePoints" class="badge blue">积分: --</span>
        <span id="badgeFollowed" class="badge">已关注: 0</span>
      </div>
    </div>

    <div class="tabs">
      <button type="button" class="tab-btn active" data-tab="settings">基础设置 &amp; Prompt</button>
      <button type="button" class="tab-btn" data-tab="posts">帖子推广管理</button>
      <button type="button" class="tab-btn" data-tab="logs">实时运行日志</button>
    </div>

    <!-- Tab 1: 基础设置 & Prompt -->
    <div id="tab-settings" class="tab-panel active">
      <form id="cfgForm">
        <div class="card">
          <h2>1. 账号密钥与自定义 Prompt 提示语</h2>
          <div class="grid">
            <div class="full">
              <label for="apiSecret">平台密钥 (api_secret)</label>
              <input id="apiSecret" type="text" placeholder="请前往 xlanv.net 绑定 X 用户名后复制 32 位 api_secret" />
            </div>
            <div class="full">
              <label for="customPrompt">
                自定义互动 Prompt 提示语（1000 字以内，将作为提示词加入运行上下文窗口）
                <span id="promptCount" style="float:right;color:#64748b;font-weight:500;">0 / 1000</span>
              </label>
              <textarea id="customPrompt" maxlength="1000" placeholder="例如：我是 Web3 与 AI 开发者，评论时多结合工程实践与产品体验切入，保持轻松真诚的口吻，不要生硬推销。"></textarea>
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
              <label for="loopPollIntervalSeconds">主巡检轮询间隔（秒，最低 60s）</label>
              <input id="loopPollIntervalSeconds" type="number" min="60" max="3600" />
            </div>
          </div>
        </div>

        <div class="card">
          <h2>3. 互动动作开关（执行他人帖子时）</h2>
          <div class="switches">
            <label class="switch-item"><input id="enableRetweet" type="checkbox" /> 转发推文 (+3 分)</label>
            <label class="switch-item"><input id="enableReply" type="checkbox" /> 去 AI 味拟人评论 (+2 分)</label>
            <label class="switch-item"><input id="enableLike" type="checkbox" /> 点赞推文 (+1 分)</label>
          </div>
        </div>

        <div class="actions-bar">
          <div>
            <button type="submit" class="btn btn-primary">保存并立即生效</button>
            <span id="saveMsg" class="msg"></span>
          </div>
          <div id="cfgPath" class="path-note"></div>
        </div>
      </form>
    </div>

    <!-- Tab 2: 帖子推广管理 -->
    <div id="tab-posts" class="tab-panel">
      <div class="card">
        <h2>
          <span>默认推广策略（本地合并配置）</span>
          <button type="button" id="btnRefreshPosts" class="btn btn-secondary btn-sm">刷新并抓取主页前 10 条帖子</button>
        </h2>
        <div class="grid">
          <div class="full">
            <label class="switch-item">
              <input id="autoPromoteNew" type="checkbox" />
              <span>新抓取的个人主页帖子默认自动上传到后台并开启推广（不勾选则需人工点击提交）</span>
            </label>
          </div>
          <div>
            <label>默认推广项目</label>
            <div class="switches">
              <label class="switch-item"><input id="defRetweet" type="checkbox" /> 转发 (-3分)</label>
              <label class="switch-item"><input id="defReply" type="checkbox" /> 评论 (-2分)</label>
              <label class="switch-item"><input id="defLike" type="checkbox" /> 点赞 (-1分)</label>
            </div>
          </div>
          <div>
            <label for="defTargetReplies">默认目标评论数</label>
            <input id="defTargetReplies" type="number" min="1" max="500" value="20" />
          </div>
          <div class="full actions-bar">
            <div>
              <button type="button" id="btnSavePostSettings" class="btn btn-primary btn-sm">保存默认推广策略</button>
              <span id="postsMsg" class="msg"></span>
            </div>
            <div id="postsPath" class="path-note"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>我的帖子列表（已合并个人主页前 10 条与本地配置）</h2>
        <div id="postsContainer">正在加载...</div>
      </div>
    </div>

    <!-- Tab 3: 实时运行日志 -->
    <div id="tab-logs" class="tab-panel">
      <div class="card">
        <div class="log-toolbar">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select id="logTypeFilter" style="width:auto;">
              <option value="ALL">全部日志</option>
              <option value="INTERACT">推文互动</option>
              <option value="FOLLOW">会员关注</option>
              <option value="PROMOTE">推广上传</option>
              <option value="API_ERROR">接口异常</option>
              <option value="SYSTEM">系统状态</option>
            </select>
            <span id="logSummary" class="hint" style="margin:0;"></span>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" id="btnRefreshLogs" class="btn btn-secondary btn-sm">立即刷新</button>
            <button type="button" id="btnClearLogs" class="btn btn-warn btn-sm">清空日志</button>
          </div>
        </div>
        <div id="logList" class="log-list">暂无日志</div>
      </div>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id)
    let logTimer = null

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'))
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'))
        btn.classList.add('active')
        $('tab-' + btn.dataset.tab).classList.add('active')
        if (btn.dataset.tab === 'posts') loadPosts(true)
        if (btn.dataset.tab === 'logs') loadLogs(true)
      })
    })

    $('customPrompt').addEventListener('input', () => {
      $('promptCount').textContent = $('customPrompt').value.length + ' / 1000'
    })

    async function loadStatus() {
      const res = await fetch('/xlanv/api/status')
      const data = await res.json()
      const cfg = data.config

      $('apiSecret').value = cfg.apiSecret || ''
      $('customPrompt').value = cfg.customPrompt || ''
      $('promptCount').textContent = (cfg.customPrompt || '').length + ' / 1000'
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
      $('loopPollIntervalSeconds').value = Math.max(60, cfg.loopPollIntervalSeconds ?? 60)
      $('enableRetweet').checked = cfg.actions?.retweet !== false
      $('enableReply').checked = cfg.actions?.reply !== false
      $('enableLike').checked = cfg.actions?.like !== false

      const rBadge = $('badgeRunner')
      rBadge.textContent = data.status.running ? '引擎运行中' : (data.status.hasSecret ? '已待命' : '未配置密钥')
      rBadge.className = 'badge ' + (data.status.running ? 'ok' : 'warn')

      const bBadge = $('badgeBrowser')
      bBadge.textContent = data.status.browserReady ? '浏览器工具已就绪' : '浏览器工具未连接'
      bBadge.className = 'badge ' + (data.status.browserReady ? 'ok' : 'warn')

      $('badgePoints').textContent = '积分: ' + (data.status.currentPoints !== null && data.status.currentPoints !== undefined ? data.status.currentPoints : '--')
      $('badgeFollowed').textContent = '已关注: ' + (data.status.followedCount || 0)
      $('cfgPath').textContent = '配置文件: ' + data.status.configPath
    }

    $('enabled').addEventListener('change', async () => {
      const msg = $('saveMsg')
      const nextEnabled = $('enabled').checked
      msg.textContent = nextEnabled ? ' 正在开启总开关...' : ' 正在关闭总开关并停止巡检...'
      msg.className = 'msg'
      try {
        const res = await fetch('/xlanv/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextEnabled })
        })
        const out = await res.json()
        if (!res.ok) throw new Error(out.error || '切换总开关失败')
        msg.textContent = nextEnabled ? ' ✓ 已开启自动互助巡检' : ' ✓ 已关闭总开关，巡检已停止'
        msg.className = 'msg ok'
        await loadStatus()
      } catch (err) {
        msg.textContent = ' ✗ ' + err.message
        msg.className = 'msg err'
      }
    })

    $('cfgForm').addEventListener('submit', async (e) => {
      e.preventDefault()
      const msg = $('saveMsg')
      msg.textContent = ' 保存中...'
      msg.className = 'msg'

      const payload = {
        apiSecret: $('apiSecret').value.trim(),
        customPrompt: $('customPrompt').value.trim().slice(0, 1000),
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
        loopPollIntervalSeconds: Math.max(60, Number($('loopPollIntervalSeconds').value || 60)),
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

    function renderPosts(data) {
      const store = data.store
      $('autoPromoteNew').checked = Boolean(store.autoPromoteNew)
      $('defRetweet').checked = store.defaultActions?.retweet !== false
      $('defReply').checked = store.defaultActions?.reply !== false
      $('defLike').checked = store.defaultActions?.like !== false
      $('defTargetReplies').value = store.defaultTargetReplies || 20
      $('postsPath').textContent = '本地帖子配置: ' + data.storePath

      const list = store.posts || []
      if (list.length === 0) {
        $('postsContainer').innerHTML = '<div class="hint">暂无帖子记录，请点击右上角「刷新并抓取主页前 10 条帖子」</div>'
        return
      }

      $('postsContainer').innerHTML = list.map((p) => {
        const tagClass = !p.is_uploaded ? 'tag-pending' : (p.is_promoted ? 'tag-active' : 'tag-paused')
        const tagText = !p.is_uploaded ? '待人工提交' : (p.is_promoted ? '推广中' : '已暂停')
        const acts = p.allowed_actions || { retweet: true, reply: true, like: true }
        return \`
          <div class="post-item" data-tid="\${p.tweet_id}">
            <div class="post-head">
              <div>
                <span class="tag \${tagClass}">\${tagText}</span>
                <span class="post-id">ID: \${p.tweet_id}</span>
              </div>
              <div class="hint" style="margin:0;">
                平台互助: 回复 \${p.current_replies || 0}/\${p.target_replies || 20} · 转发 \${p.current_retweets || 0} · 点赞 \${p.current_likes || 0}
                \${typeof p.x_replies === 'number' ? \` | X 实际: 回复 \${p.x_replies} · 转发 \${p.x_retweets || 0} · 点赞 \${p.x_likes || 0}\` : ''}
              </div>
            </div>
            <div class="post-content">\${(p.content || '(无文本摘要)').replace(/</g, '&lt;')}</div>
            <div class="post-footer">
              <div class="switches">
                <label class="switch-item"><input type="checkbox" class="chk-rt" \${acts.retweet !== false ? 'checked' : ''} /> 转发</label>
                <label class="switch-item"><input type="checkbox" class="chk-rp" \${acts.reply !== false ? 'checked' : ''} /> 评论</label>
                <label class="switch-item"><input type="checkbox" class="chk-lk" \${acts.like !== false ? 'checked' : ''} /> 点赞</label>
              </div>
              <div style="display:flex;gap:8px;">
                <button type="button" class="btn btn-primary btn-sm btn-submit-post">\${p.is_uploaded ? '更新推广项目' : '提交上传推广'}</button>
                \${p.is_uploaded ? \`<button type="button" class="btn \${p.is_promoted ? 'btn-warn' : 'btn-success'} btn-sm btn-toggle-post">\${p.is_promoted ? '暂停推广' : '开启推广'}</button>\` : ''}
              </div>
            </div>
          </div>
        \`
      }).join('')

      document.querySelectorAll('.post-item').forEach((row) => {
        const tid = row.dataset.tid
        row.querySelector('.btn-submit-post').addEventListener('click', async () => {
          const allowedActions = []
          if (row.querySelector('.chk-rt').checked) allowedActions.push('RETWEET')
          if (row.querySelector('.chk-rp').checked) allowedActions.push('REPLY')
          if (row.querySelector('.chk-lk').checked) allowedActions.push('LIKE')
          const res = await fetch('/xlanv/api/posts/promote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tweet_id: tid, allowed_actions: allowedActions })
          })
          const out = await res.json()
          if (!res.ok) alert(out.error || '提交失败')
          await loadPosts(false)
        })
        const toggleBtn = row.querySelector('.btn-toggle-post')
        if (toggleBtn) {
          toggleBtn.addEventListener('click', async () => {
            const res = await fetch('/xlanv/api/posts/toggle', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tweet_id: tid })
            })
            const out = await res.json()
            if (!res.ok) alert(out.error || '切换失败')
            await loadPosts(false)
          })
        }
      })
    }

    async function loadPosts(refresh = false) {
      const msg = $('postsMsg')
      if (refresh) {
        msg.textContent = ' 正在同步主页前 10 条帖子与后台数据...'
        msg.className = 'msg'
      }
      try {
        const res = await fetch('/xlanv/api/posts?refresh=' + (refresh ? '1' : '0'))
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '加载失败')
        renderPosts(data)
        if (refresh) {
          msg.textContent = data.scrapeError ? (' ⚠ 已加载本地与后台数据（主页抓取提示: ' + data.scrapeError + '）') : ' ✓ 已同步前 10 条帖子并合并！'
          msg.className = data.scrapeError ? 'msg' : 'msg ok'
        }
      } catch (err) {
        msg.textContent = ' ✗ ' + err.message
        msg.className = 'msg err'
      }
    }

    $('btnRefreshPosts').addEventListener('click', () => loadPosts(true))
    $('btnSavePostSettings').addEventListener('click', async () => {
      const msg = $('postsMsg')
      const res = await fetch('/xlanv/api/posts/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoPromoteNew: $('autoPromoteNew').checked,
          defaultTargetReplies: Number($('defTargetReplies').value || 20),
          defaultActions: {
            retweet: $('defRetweet').checked,
            reply: $('defReply').checked,
            like: $('defLike').checked
          }
        })
      })
      if (res.ok) {
        msg.textContent = ' ✓ 默认策略已保存'
        msg.className = 'msg ok'
      }
    })

    async function loadLogs(refreshProfile = false) {
      const type = $('logTypeFilter').value
      if (refreshProfile) {
        $('logSummary').textContent = '正在请求后台同步最新积分与日志...'
        $('btnRefreshLogs').disabled = true
      }
      try {
        const res = await fetch('/xlanv/api/logs?type=' + encodeURIComponent(type) + '&refresh=' + (refreshProfile ? '1' : '0'))
        const data = await res.json()
        let summaryText = '今日累计获得 +' + (data.todayEarned || 0) + ' 积分 | 共 ' + (data.totalCount || 0) + ' 条记录'
        if (data.profileError) {
          summaryText += ' | ⚠ 积分同步失败: ' + data.profileError
        } else if (refreshProfile && typeof data.lastKnownPoints === 'number') {
          summaryText += ' | ✓ 积分已同步: ' + data.lastKnownPoints
        }
        $('logSummary').textContent = summaryText
        if (typeof data.lastKnownPoints === 'number') {
          $('badgePoints').textContent = '积分: ' + data.lastKnownPoints
        }
        const items = data.items || []
        if (items.length === 0) {
          $('logList').innerHTML = '<div style="color:#64748b;padding:12px;">暂无符合条件的操作日志</div>'
          return
        }
        $('logList').innerHTML = items.map((l) => {
          const t = new Date(l.time).toLocaleString('zh-CN', { hour12: false })
          const ptsText = l.pointsDelta > 0 ? ('+' + l.pointsDelta + ' 分') : (l.pointsDelta < 0 ? (l.pointsDelta + ' 分') : '')
          const balText = typeof l.currentPoints === 'number' ? (' | 余额: ' + l.currentPoints) : ''
          const apiText = l.api ? (l.api + (l.status ? ' [' + l.status + ']' : '') + (l.durationMs ? ' ' + l.durationMs + 'ms' : '')) : ''
          return \`
            <div class="log-row">
              <div class="log-top">
                <span class="log-time">[\${t}]</span>
                <span class="log-type t-\${l.type}">\${l.type}</span>
                <span>\${(l.action || '').replace(/</g, '&lt;')}</span>
                \${ptsText ? \`<span class="log-pts">\${ptsText}\${balText}</span>\` : (balText ? \`<span class="log-api">\${balText}</span>\` : '')}
              </div>
              \${apiText || l.detail ? \`<div class="log-api">\${apiText}\${apiText && l.detail ? ' — ' : ''}\${(l.detail || '').replace(/</g, '&lt;')}</div>\` : ''}
            </div>
          \`
        }).join('')
      } finally {
        if (refreshProfile) {
          $('btnRefreshLogs').disabled = false
        }
      }
    }

    $('logTypeFilter').addEventListener('change', () => loadLogs(false))
    $('btnRefreshLogs').addEventListener('click', () => loadLogs(true))
    $('btnClearLogs').addEventListener('click', async () => {
      await fetch('/xlanv/api/logs/clear', { method: 'POST' })
      await loadLogs(true)
    })

    loadStatus()
    logTimer = setInterval(() => {
      if ($('tab-logs').classList.contains('active')) {
        loadLogs(false)
      }
    }, 4000)
  </script>
</body>
</html>`
}

/**
 * 在 DSH 内置 webServer 上注册专属设置中心、帖子推广管理与日志路由 (/xlanv)
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
        let currentPoints = activityLogger.lastKnownPoints
        if (isValidApiSecret(runner.config.apiSecret)) {
          try {
            const prof = await client.getProfile()
            if (typeof prof?.points === 'number') {
              currentPoints = prof.points
              activityLogger.setCurrentPoints(prof.points)
            }
          } catch {
            // 忽略联网波动
          }
        }
        sendJson(res, 200, {
          config: runner.config,
          status: {
            running: runner.running,
            hasSecret: isValidApiSecret(runner.config.apiSecret),
            browserReady: Boolean(runner.browser),
            followedCount: runner.followedMap.size,
            currentPoints,
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
          if (typeof body.customPrompt === 'string') {
            next.customPrompt = body.customPrompt.trim().slice(0, 1000)
          }
          saveConfig(next)

          runner.config = next
          client.baseUrl = next.baseUrl.replace(/\/+$/, '')
          client.apiSecret = next.apiSecret
          activityLogger.append({
            type: 'SYSTEM',
            action: next.enabled === false ? '已关闭总开关，停止自动巡检' : '更新插件配置并热重载',
            detail: `总开关: ${next.enabled === false ? '关闭' : '开启'} | 模式: ${next.mode} | 运行时段: ${next.activeStartHour}-${next.activeEndHour}点`
          })
          if (typeof onConfigUpdated === 'function') {
            onConfigUpdated(next)
          }

          sendJson(res, 200, { ok: true, configPath: getConfigPath() })
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }

      // 帖子推广管理：读取主页前10条与本地配置合并
      if (req.method === 'GET' && pathname === '/xlanv/api/posts') {
        const refresh = reqUrl.searchParams.get('refresh') === '1'
        let remotePosts = []
        let xUsername = ''
        let scrapeError = ''

        if (isValidApiSecret(runner.config.apiSecret)) {
          try {
            const prof = await client.getProfile()
            xUsername = prof?.x_username || ''
            if (typeof prof?.points === 'number') {
              activityLogger.setCurrentPoints(prof.points)
            }
            const remoteRes = await client.getMyPosts()
            remotePosts = remoteRes?.items || []
          } catch (err) {
            scrapeError = err.message
          }
        }

        let scrapedTweets = []
        if (refresh && xUsername && runner.browser && typeof runner.browser.scanProfileTweets === 'function') {
          try {
            const currentStore = loadPromotedPostsStore()
            const existingContentMap = new Map()
            for (const p of currentStore.posts || []) {
              const txt = String(p?.content || '').trim()
              const bad =
                !txt ||
                txt === '(纯媒体/转发无文字推文)' ||
                txt === '(无文字内容)' ||
                /Security:\s*Enclosed page content/i.test(txt) ||
                /To view keyboard shortcuts|Skip to home timeline|Skip to trending/i.test(txt) ||
                /(?:上午|下午)?\d{1,2}:\d{2}\s*·\s*(?:\d{4}年\d{1,2}月\d{1,2}日|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s*\d{4})/i.test(txt) ||
                /^\d+\s*(?:[smhd]|(?:seconds?|minutes?|hours?|days?)\s+ago|(?:秒|分钟?|小时|天)前?)$/i.test(txt) ||
                /@[A-Za-z0-9_]+\s*·/i.test(txt)
              if (!bad) existingContentMap.set(String(p.tweet_id), txt)
            }
            scrapedTweets = await runner.browser.scanProfileTweets(xUsername, 10, existingContentMap)
          } catch (err) {
            scrapeError = err.message
          }
        } else if (refresh && !xUsername) {
          scrapeError = scrapeError || '请先在 xlanv.net 绑定 X 用户名并配置密钥'
        } else if (refresh && !runner.browser) {
          scrapeError = '浏览器工具未连接，无法抓取个人主页'
        }

        const { store, newlyAdded } = mergePromotedPosts({ scrapedTweets, remotePosts })

        // 若开启默认自动推广，自动把新帖上传后台
        if (store.autoPromoteNew && newlyAdded.length > 0 && isValidApiSecret(runner.config.apiSecret)) {
          const allowedArr = actionsObjToArray(store.defaultActions)
          for (const item of newlyAdded) {
            try {
              await client.promotePost({
                tweetId: item.tweet_id,
                content: item.content,
                targetReplies: store.defaultTargetReplies || 20,
                allowedActions: allowedArr
              })
              item.is_uploaded = true
              item.is_promoted = true
              activityLogger.append({
                type: 'PROMOTE',
                action: `自动上传推广新帖 ${item.tweet_id}`,
                api: 'POST /plugin/posts/promote',
                status: 200,
                detail: `允许项目: ${allowedArr.join(',')}`
              })
            } catch (err) {
              scrapeError = err.message
            }
          }
          savePromotedPostsStore(store)
        }

        sendJson(res, 200, {
          store,
          storePath: getPromotedPostsPath(),
          scrapeError
        })
        return
      }

      if (req.method === 'POST' && pathname === '/xlanv/api/posts/settings') {
        try {
          const body = await readJsonBody(req)
          const store = loadPromotedPostsStore()
          if (typeof body.autoPromoteNew === 'boolean') store.autoPromoteNew = body.autoPromoteNew
          if (typeof body.defaultTargetReplies === 'number') {
            store.defaultTargetReplies = Math.max(1, body.defaultTargetReplies)
          }
          if (body.defaultActions) {
            store.defaultActions = {
              retweet: body.defaultActions.retweet !== false,
              reply: body.defaultActions.reply !== false,
              like: body.defaultActions.like !== false
            }
          }
          savePromotedPostsStore(store)
          sendJson(res, 200, { ok: true, store })
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }

      if (req.method === 'POST' && pathname === '/xlanv/api/posts/promote') {
        try {
          const body = await readJsonBody(req)
          const tweetId = String(body.tweet_id || '').trim()
          const allowedActions = Array.isArray(body.allowed_actions) && body.allowed_actions.length > 0
            ? body.allowed_actions
            : ['RETWEET', 'REPLY', 'LIKE']
          const store = loadPromotedPostsStore()
          const target = store.posts.find((p) => p.tweet_id === tweetId)
          if (!target) {
            sendJson(res, 404, { error: '本地未找到该推文' })
            return
          }

          await client.promotePost({
            tweetId,
            content: target.content,
            targetReplies: target.target_replies || store.defaultTargetReplies || 20,
            allowedActions
          })
          target.is_uploaded = true
          target.is_promoted = true
          target.allowed_actions = actionsArrayToObj(allowedActions)
          target.updated_at = new Date().toISOString()
          savePromotedPostsStore(store)

          activityLogger.append({
            type: 'PROMOTE',
            action: `人工提交/更新推广推文 ${tweetId}`,
            api: 'POST /plugin/posts/promote',
            status: 200,
            detail: `允许项目: ${allowedActions.join(',')}`
          })
          sendJson(res, 200, { ok: true, post: target })
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }

      if (req.method === 'POST' && pathname === '/xlanv/api/posts/toggle') {
        try {
          const body = await readJsonBody(req)
          const tweetId = String(body.tweet_id || '').trim()
          const store = loadPromotedPostsStore()
          const target = store.posts.find((p) => p.tweet_id === tweetId)
          if (!target) {
            sendJson(res, 404, { error: '本地未找到该推文' })
            return
          }
          const resData = await client.togglePostPromote(tweetId, !target.is_promoted)
          target.is_promoted = Boolean(resData?.post?.is_promoted ?? !target.is_promoted)
          target.updated_at = new Date().toISOString()
          savePromotedPostsStore(store)

          activityLogger.append({
            type: 'PROMOTE',
            action: `${target.is_promoted ? '开启' : '暂停'}推文推广 ${tweetId}`,
            api: `PATCH /plugin/posts/${tweetId}/toggle`,
            status: 200
          })
          sendJson(res, 200, { ok: true, post: target })
        } catch (err) {
          sendJson(res, 400, { error: err.message })
        }
        return
      }

      if (req.method === 'GET' && pathname === '/xlanv/api/logs') {
        const type = reqUrl.searchParams.get('type') || 'ALL'
        const refresh = reqUrl.searchParams.get('refresh') === '1'
        let profileError = ''
        if (refresh) {
          if (!isValidApiSecret(runner.config.apiSecret)) {
            profileError = '未配置有效 api_secret'
          } else {
            try {
              const prof = await client.getProfile()
              if (typeof prof?.points === 'number') {
                activityLogger.setCurrentPoints(prof.points)
              }
            } catch (err) {
              profileError = err.message || '请求后台失败'
            }
          }
        }
        sendJson(res, 200, {
          ...activityLogger.list({ type, limit: 200 }),
          profileError
        })
        return
      }

      if (req.method === 'POST' && pathname === '/xlanv/api/logs/clear') {
        activityLogger.clear()
        sendJson(res, 200, { ok: true })
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
      fab.textContent = 'XLANV 控制台';
      fab.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:99998;padding:8px 14px;border-radius:999px;border:1px solid rgba(29,155,240,0.4);background:#0f172a;color:#38bdf8;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(15,23,42,0.22);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';

      var drawer = document.createElement('div');
      drawer.id = 'dsh-xlanv-drawer';
      drawer.style.cssText = 'position:fixed;top:0;right:0;width:min(940px,96vw);height:100vh;z-index:99999;background:#fff;box-shadow:-8px 0 32px rgba(15,23,42,0.25);display:none;flex-direction:column;';

      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#0f172a;color:#fff;font-size:13px;font-weight:700;';
      var title = document.createElement('span');
      title.textContent = 'XLANV 蓝V互助插件 · 控制台';
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
