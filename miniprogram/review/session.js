const ACCOUNT = 'APA_REVIEW'
const PASSWORD = 'Demo2026!'
let active = false
let role = 'member'
let epoch = 0
let entryEpoch = -1
let readyEpoch = 0
const listeners = []

function snapshot() { return { review: active, role: active ? role : '', epoch } }
function isReviewMode() { return active }
function getReviewRole() { return active ? role : '' }
function isCurrent(context) {
  return !!context && context.epoch === epoch && context.review === active && context.role === (active ? role : '')
}
function changedError() {
  const error = new Error('体验身份已切换，请重新打开页面')
  error.code = 'SESSION_CHANGED'
  return error
}
function assertCurrent(context) { if (!isCurrent(context)) throw changedError() }
function notify() {
  epoch += 1
  entryEpoch = -1
  readyEpoch = -1
  listeners.slice().forEach((listener) => listener(snapshot()))
  return snapshot()
}
function requireRole(value) {
  if (value !== 'member' && value !== 'admin') throw new Error('请选择成员或管理员体验身份')
  return value
}
function enterReview(options = {}) {
  if (String(options.account || '').trim() !== ACCOUNT || options.password !== PASSWORD) {
    const error = new Error('体验账号或密码不正确')
    error.code = 'REVIEW_LOGIN_FAILED'
    throw error
  }
  role = requireRole(options.role || 'member')
  active = true
  return notify()
}
function switchReviewRole(nextRole) {
  if (!active) throw new Error('请先登录功能体验账号')
  role = requireRole(nextRole)
  return notify()
}
function exitReview() {
  active = false
  role = 'member'
  return notify()
}
function subscribe(listener) {
  listeners.push(listener)
  return () => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1) }
}
function beginEntry() { entryEpoch = epoch }
function completeLogin(context) {
  if (isCurrent(context) && entryEpoch === epoch) readyEpoch = epoch
}
function assertBusinessAllowed(context) {
  assertCurrent(context)
  if (readyEpoch !== epoch) throw changedError()
}
function storageKey(key, context = snapshot()) {
  return context.review ? `apa_review_${context.role}_${key}` : key
}

module.exports = { isReviewMode, getReviewRole, enterReview, switchReviewRole, exitReview,
  snapshot, isCurrent, assertCurrent, changedError, subscribe, storageKey,
  beginEntry, completeLogin, assertBusinessAllowed }