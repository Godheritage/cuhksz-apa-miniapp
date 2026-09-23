const STATUS_TEXT = {
  in_care: '在养',
  medical: '就医',
  pending_release: '待放',
  observe: '观察',
}

const STATUS_PILL = {
  in_care: '',
  medical: 'warn',
  pending_release: 'idle',
  observe: 'warn',
}

const CAMPUS_TEXT = {
  on_campus: '在校',
  off_campus: '离校',
  medical: '就医',
}

const CAMPUS_PILL = {
  on_campus: '',
  off_campus: 'idle',
  medical: 'warn',
}

const GENDER_TEXT = {
  male: '公',
  female: '母',
  unknown: '未知',
}

const HEALTH_TEXT = {
  healthy: '健康',
  under_weather: '不适',
  recovering: '恢复中',
  unknown: '未知',
}

const ASSET_CATEGORY_TEXT = {
  bowl: '食盆',
  feeder: '喂食机',
  medicine: '药箱',
  water: '饮水机',
  cage: '笼子',
  other: '其他',
}

const TASK_ITEM_TEXT = {
  food: '添食物',
  water: '添水',
  litter: '铲猫砂',
}

const ADOPT_STATUS_TEXT = {
  contacting: '沟通中',
  visiting: '待见面',
  approved: '已通过',
  rejected: '未通过',
}

const TASK_STATUS_TEXT = {
  open: '待做',
  review: '待审核',
  claimed: '已领取',
  done: '已完成',
}

const TASK_STATUS_PILL = {
  open: 'warn',
  review: '',
  claimed: '',
  done: 'idle',
}

const ACCESS_STATUS_TEXT = {
  pending: '待审批',
  approved: '已通过',
  rejected: '未通过',
  expired: '已过期',
}

const SITE_TYPE_TEXT = {
  base: '基地',
  feeding: '投喂点',
  auto_feeder: '自动喂食',
  other: '其他',
}

const ROLE_TEXT = {
  guest: '游客',
  pending: '待审核',
  rejected: '未通过',
  member: '普通成员',
  admin: '管理员',
}

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'object' && value.$date) return new Date(value.$date)
  return new Date(value)
}

function formatTime(value) {
  const d = toDate(value)
  if (!d || Number.isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateKey(value) {
  const d = toDate(value) || new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function todayKey() {
  return formatDateKey(new Date())
}

function statusText(status) {
  return STATUS_TEXT[status] || status || '未知'
}

function statusPill(status) {
  return STATUS_PILL[status] || 'idle'
}

function siteTypeText(type) {
  const named = SITE_TYPE_TEXT[type]
  if (named) return named
  return String(type || '').trim() || '点位'
}

function roleText(role) {
  return ROLE_TEXT[role] || role || '未知'
}

function campusText(status) {
  return CAMPUS_TEXT[status] || '在校'
}

function campusPill(status) {
  return CAMPUS_PILL[status] || 'idle'
}

function genderText(gender) {
  return GENDER_TEXT[gender] || '未知'
}

function healthText(status) {
  return HEALTH_TEXT[status] || '未知'
}

function assetCategoryText(category) {
  return ASSET_CATEGORY_TEXT[category] || '其他'
}

function occupancyText(cageCode, assetName) {
  const parts = []
  if (cageCode) parts.push(`笼 ${cageCode}`)
  if (assetName) parts.push(assetName)
  return parts.length ? parts.join(' · ') : '未占用资源'
}

function dietText(diet, dateKey, careTimes) {
  if (!diet || !diet.dateKey) return '暂无喂食喂水记录'
  const fed = (diet.fed != null ? diet.fed : diet.ate) ? '已喂食' : '未喂食'
  const watered = (diet.watered != null ? diet.watered : diet.drank) ? '已喂水' : '未喂水'
  const when = diet.dateKey === dateKey ? '今日最新' : diet.dateKey
  const times = Number(careTimes != null ? careTimes : diet.times) || 0
  const count = diet.dateKey === dateKey && times ? ` · 今日喂过 ${times} 次` : ''
  return `${when} · ${fed} · ${watered}${count}`
}

function siteDietText(summary, siteName) {
  if (!siteName) return '未挂点位，投喂情况待核对'
  if (!summary) return `${siteName} · 今日未登记点位投喂`
  return `${siteName}今日 · ${summary.fed ? '已补粮' : '未补粮'} · ${summary.watered ? '已添水' : '未添水'}`
}

function taskItemText(key) {
  return TASK_ITEM_TEXT[key] || key
}

function taskStatusText(status) {
  return TASK_STATUS_TEXT[status] || status || '未知'
}

function taskStatusPill(status) {
  return TASK_STATUS_PILL[status] || 'idle'
}

function housingText(resident) {
  return resident ? '定点，需每日点检' : '流动，无需每日点检'
}

function accessStatusText(status) {
  return ACCESS_STATUS_TEXT[status] || status || '未知'
}

function adoptStatusText(status) {
  return ADOPT_STATUS_TEXT[status] || status || '沟通中'
}

function isApproved(role) {
  return role === 'member' || role === 'admin'
}

module.exports = {
  STATUS_TEXT,
  CAMPUS_TEXT,
  GENDER_TEXT,
  HEALTH_TEXT,
  ASSET_CATEGORY_TEXT,
  TASK_ITEM_TEXT,
  ACCESS_STATUS_TEXT,
  formatTime,
  formatDateKey,
  todayKey,
  statusText,
  statusPill,
  campusText,
  campusPill,
  genderText,
  healthText,
  assetCategoryText,
  occupancyText,
  dietText,
  siteDietText,
  taskItemText,
  taskStatusText,
  taskStatusPill,
  housingText,
  accessStatusText,
  adoptStatusText,
  siteTypeText,
  roleText,
  isApproved,
}
