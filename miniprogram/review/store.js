const source = require('../mock/store')
const session = require('./session')
const STORAGE_KEY = 'apa_review_demo_v1'
let memory = null

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function todayKey() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function defaultState() {
  const state = source.defaultState()
  const names = {}
  state.sites.forEach((site, i) => { names[site.name] = `示例点位${i + 1}` })
  state.cats.forEach((cat, i) => { names[cat.name] = `示例猫咪${i + 1}` })
  state.users.forEach((user) => { names[user.openid] = `review_${user.role}` })
  function scrub(value, key) {
    if (Array.isArray(value)) return value.map((item) => scrub(item, key))
    if (value && typeof value === 'object') {
      return Object.keys(value).reduce((out, field) => { out[field] = scrub(value[field], field); return out }, {})
    }
    if (typeof value !== 'string') return value
    if (/phone/i.test(key)) return ''
    if (/hospitalName/i.test(key)) return '示例宠物医院（虚构）'
    let text = value
    Object.keys(names).sort((a, b) => b.length - a.length).forEach((name) => { text = text.split(name).join(names[name]) })
    return text
  }
  const clean = scrub(state, '')
  const now = Date.now()
  clean.schemaVersion = 1
  clean.users = [
    { _id: 'user_guest', openid: 'review_guest', displayName: '示例访客', role: 'guest', createdAt: now },
    { _id: 'user_pending', openid: 'review_pending', displayName: '示例待审成员', role: 'pending',
      applyNote: '虚构申请，可在管理员功能中体验审批。', appliedAt: now, createdAt: now },
    { _id: 'user_member', openid: 'review_member', displayName: '体验成员', role: 'member', createdAt: now, approvedAt: now },
    { _id: 'user_admin', openid: 'review_admin', displayName: '体验管理员', role: 'admin', createdAt: now, approvedAt: now },
  ]
  clean.sites.forEach((site) => {
    site.address = `${site.name}的虚构地址，仅供功能体验`
    site.lockNote = '虚构门锁说明，无真实密码'
    site.publicDesc = '虚构示例，可体验点位编辑、固定资产和日常执勤。'
  })
  clean.cats.forEach((cat) => { cat.notes = '虚构猫咪档案，仅供功能体验。' })
  clean.currentUserId = 'user_member'
  clean.finance_entries = [{ _id: 'review_expense', dateKey: todayKey(), type: 'expense', amount: 20,
    category: '猫粮', remark: '虚构记账示例，不发生支付', handlerName: '体验管理员', createdAt: now }]
  clean.donations = []
  clean.move_tasks = []
  clean.work_tasks = [{
    _id: 'review_task_group', kind: 'duty', scope: 'once', weekdays: [], allowMultiple: true,
    maxParticipants: 50, participants: [], deadlineDateKey: '', lastDoneDateKey: '',
    siteId: clean.sites[0]._id, siteName: clean.sites[0].name, title: '示例：整理点位物资',
    content: '领取后填写完成情况，再切换管理员审核，即可体验完整任务流程。',
    photoFileIds: [], status: 'open', createdBy: 'review_admin', createdByName: '体验管理员',
    publisherTag: '', createdAt: now, sourceId: '', sourceAt: 0, report: null, rejectNote: '',
  }]
  ;['work_task_reports', 'work_task_events', 'szcat_copies', 'adopt_candidates', 'media_files'].forEach((key) => { clean[key] = [] })
  return clean
}
function load() {
  let stored = memory
  if (typeof wx !== 'undefined' && wx.getStorageSync) stored = wx.getStorageSync(STORAGE_KEY)
  const state = stored && stored.schemaVersion === 1 && Array.isArray(stored.users) && Array.isArray(stored.sites)
    ? clone(stored) : defaultState()
  state.currentUserId = `user_${session.getReviewRole() || 'member'}`
  state.mockDateKey = todayKey()
  return state
}
function save(state) {
  const next = clone(state)
  if (typeof wx !== 'undefined' && wx.setStorageSync) wx.setStorageSync(STORAGE_KEY, next)
  memory = next
}
function reset() { const state = defaultState(); save(state); return state }
module.exports = { load, save, reset, defaultState, STORAGE_KEY }