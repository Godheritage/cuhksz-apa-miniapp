const session = require('../review/session')

function createDraftKey(key) {
  const context = session.snapshot()
  return { key: session.storageKey(key, context), context }
}
function draftKey(value) { return typeof value === 'string' ? createDraftKey(value) : value }
function readDraft(key) {
  const target = draftKey(key)
  if (!target || !session.isCurrent(target.context)) return null
  try { return wx.getStorageSync(target.key) || null } catch (e) { return null }
}
function writeDraft(key, value) {
  const target = draftKey(key)
  if (!target || !session.isCurrent(target.context)) return
  try { wx.setStorageSync(target.key, value) } catch (e) {}
}
function clearDraft(key) {
  const target = draftKey(key)
  if (!target || !session.isCurrent(target.context)) return
  try { wx.removeStorageSync(target.key) } catch (e) {}
}
module.exports = { readDraft, writeDraft, clearDraft, createDraftKey }