'use strict'

const SCOPES = {
  once: { key: 'once', label: '单次任务', short: '单次' },
  daily: { key: 'daily', label: '每日任务', short: '每日' },
  weekly: { key: 'weekly', label: '每周任务', short: '每周' },
}

function parseDeadlineDateKey(value) {
  const s = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function parseScope(value, fallback) {
  const raw = String(value || '').trim()
  if (SCOPES[raw]) return raw
  return fallback || ''
}

function normalizeScope(task) {
  const raw = String((task && task.scope) || '').trim()
  if (SCOPES[raw]) return raw
  if (task && task.kind === 'move') return 'once'
  return 'once'
}

function parseWeekdays(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(Number)
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort()
}

function isDueToday(task, todayKey) {
  if (normalizeScope(task) !== 'weekly') return true
  const parts = String(todayKey).split('-').map(Number)
  const weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay() || 7
  return parseWeekdays(task.weekdays).includes(weekday)
}

function taskCycleKey(task, todayKey) {
  const scope = normalizeScope(task)
  return scope === 'daily' || scope === 'weekly' ? todayKey : 'all'
}

function shanghaiDayStartMs(dateKey) {
  const parts = String(dateKey || '').split('-').map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return 0
  return Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0) - 8 * 3600000
}

function applyScopeView(task, todayKey) {
  const scope = normalizeScope(task)
  const deadlineDateKey = parseDeadlineDateKey(task && task.deadlineDateKey)
  const lastDoneDateKey = String((task && task.lastDoneDateKey) || '')
  let status = task && task.status
  let report = task && task.report
  let rejectNote = (task && task.rejectNote) || ''
  let cycleReset = false
  if ((scope === 'daily' || scope === 'weekly') && status === 'done' && lastDoneDateKey && lastDoneDateKey < todayKey) {
    status = 'open'
    report = null
    rejectNote = ''
    cycleReset = true
  }
  if ((scope === 'daily' || scope === 'weekly') && status === 'claimed' && task.claimedDateKey && task.claimedDateKey < todayKey) {
    status = 'open'
    cycleReset = true
  }
  const submittedLate = !!(report && report.submittedLate)
  const overdue = !!(scope === 'once' && deadlineDateKey && deadlineDateKey < todayKey && status !== 'done')
  let scopeHint = ''
  if (scope === 'daily') {
    scopeHint = status === 'done' ? '今日已完成，明天再出现' : '每天都要做'
  } else if (scope === 'weekly') {
    const names = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }
    const days = parseWeekdays(task.weekdays).map((day) => names[day]).join('、')
    scopeHint = `每周${days || '未排日期'} · ${isDueToday(task, todayKey) ? (status === 'done' ? '今日已完成' : '今天执行') : '今天不执行'}`
  } else if (scope === 'once') {
    if (!deadlineDateKey) scopeHint = status === 'done' ? '已结束' : '做完即结束'
    else if (status === 'done') scopeHint = submittedLate ? `超时完成 · 截止 ${deadlineDateKey}` : `已完成 · 截止 ${deadlineDateKey}`
    else if (overdue) scopeHint = `已超时，仍可提交 · 截止 ${deadlineDateKey}`
    else scopeHint = `截止 ${deadlineDateKey}`
  } else {
    scopeHint = status === 'done' ? '已结束' : '做完为止'
  }
  return Object.assign({}, task, {
    scope,
    scopeLabel: SCOPES[scope].label,
    scopeShort: SCOPES[scope].short,
    deadlineDateKey,
    lastDoneDateKey,
    status,
    report: report || null,
    rejectNote,
    cycleReset,
    overdue: overdue || submittedLate,
    submittedLate,
    dueToday: isDueToday(task, todayKey),
    scopeHint,
  })
}

function filterOverlaysForScope(task, reports, events, todayKey) {
  const scope = normalizeScope(task)
  if (scope !== 'daily' && scope !== 'weekly') return { reports: reports || [], events: events || [] }
  const start = shanghaiDayStartMs(todayKey)
  return {
    reports: (reports || []).filter((r) => (r.submittedAt || 0) >= start),
    events: (events || []).filter((e) => (e.at || 0) >= start),
  }
}

module.exports = {
  SCOPES,
  parseDeadlineDateKey,
  parseScope,
  normalizeScope,
  parseWeekdays,
  isDueToday,
  taskCycleKey,
  shanghaiDayStartMs,
  applyScopeView,
  filterOverlaysForScope,
}
