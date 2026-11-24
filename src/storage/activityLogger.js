import fs from 'node:fs'
import path from 'node:path'
import { getLogsPath } from '../config.js'

const MAX_LOGS = 500

class ActivityLogger {
  constructor() {
    this.logs = []
    this.lastKnownPoints = null
    this.loaded = false
  }

  ensureLoaded() {
    if (this.loaded) return
    this.loaded = true
    const logFile = getLogsPath()
    if (fs.existsSync(logFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(logFile, 'utf-8'))
        if (Array.isArray(parsed?.logs)) {
          this.logs = parsed.logs.slice(0, MAX_LOGS)
        }
        if (typeof parsed?.lastKnownPoints === 'number') {
          this.lastKnownPoints = parsed.lastKnownPoints
        }
      } catch {
        // 忽略损坏的日志文件
      }
    }
  }

  persist() {
    const logFile = getLogsPath()
    const dir = path.dirname(logFile)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(
      logFile,
      JSON.stringify(
        {
          lastKnownPoints: this.lastKnownPoints,
          logs: this.logs.slice(0, MAX_LOGS)
        },
        null,
        2
      ),
      'utf-8'
    )
  }

  setCurrentPoints(points) {
    this.ensureLoaded()
    if (typeof points === 'number' && !Number.isNaN(points)) {
      this.lastKnownPoints = points
      this.persist()
    }
  }

  append({
    type = 'SYSTEM',
    action = '',
    api = '',
    status = null,
    durationMs = null,
    pointsDelta = 0,
    currentPoints = null,
    detail = ''
  }) {
    this.ensureLoaded()
    if (typeof currentPoints === 'number' && !Number.isNaN(currentPoints)) {
      this.lastKnownPoints = currentPoints
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      time: new Date().toISOString(),
      type,
      action,
      api,
      status,
      durationMs,
      pointsDelta: Number(pointsDelta || 0),
      currentPoints: typeof currentPoints === 'number' ? currentPoints : this.lastKnownPoints,
      detail
    }
    this.logs.unshift(entry)
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(0, MAX_LOGS)
    }
    this.persist()
    return entry
  }

  list({ type = 'ALL', limit = 200 } = {}) {
    this.ensureLoaded()
    let items = this.logs
    if (type && type !== 'ALL') {
      items = items.filter((l) => l.type === type)
    }
    const todayPrefix = new Date().toISOString().slice(0, 10)
    const todayEarned = this.logs
      .filter((l) => String(l.time).startsWith(todayPrefix) && l.pointsDelta > 0)
      .reduce((acc, l) => acc + l.pointsDelta, 0)

    return {
      items: items.slice(0, limit),
      lastKnownPoints: this.lastKnownPoints,
      todayEarned,
      totalCount: this.logs.length
    }
  }

  clear() {
    this.ensureLoaded()
    this.logs = []
    this.persist()
  }
}

export const activityLogger = new ActivityLogger()
