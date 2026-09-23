const api = require('../../services/api')
const auth = require('../../behaviors/auth')
const { todayKey, formatTime } = require('../../utils/format')

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

function monthShift(monthKey, amount) {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(year, month - 1 + amount, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

function calendarDays(monthKey, selectedDate, logs) {
  const [year, month] = monthKey.split('-').map(Number)
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const count = new Date(year, month, 0).getDate()
  const byDay = {}
  ;(logs || []).forEach((log) => {
    const row = byDay[log.dateKey] || { seen: false, unseen: false }
    if (log.seen) row.seen = true
    else row.unseen = true
    byDay[log.dateKey] = row
  })
  const cells = []
  for (let i = 0; i < offset; i += 1) cells.push({ key: 'blank-' + i, blank: true })
  for (let day = 1; day <= count; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`
    cells.push({ key, day, selected: key === selectedDate,
      seen: !!byDay[key]?.seen, unseen: !!byDay[key]?.unseen })
  }
  return cells
}

Page({
  behaviors: [auth],
  data: {
    ready: false, monthKey: todayKey().slice(0, 7), selectedDate: todayKey(),
    week: WEEK, days: [], logs: [], selectedLogs: [],
    form: { catName: '', seen: true, fed: false, watered: false, note: '' },
    saving: false,
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 1 })
    this.bindApprovedUser(() => this.reload())
  },

  reload() {
    return api.call('listMobileFeedLogs', { monthKey: this.data.monthKey })
      .then((result) => {
        const logs = (result.logs || []).map((row) => ({ ...row, timeText: formatTime(row.at) }))
        this.setData({
          ready: true, logs,
          days: calendarDays(this.data.monthKey, this.data.selectedDate, logs),
          selectedLogs: logs.filter((row) => row.dateKey === this.data.selectedDate),
        })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  prevMonth() { this.changeMonth(-1) },
  nextMonth() { this.changeMonth(1) },
  changeMonth(amount) {
    const monthKey = monthShift(this.data.monthKey, amount)
    this.setData({ monthKey, selectedDate: monthKey + '-01', ready: false })
    this.reload()
  },
  pickDay(e) {
    const selectedDate = e.currentTarget.dataset.date
    if (!selectedDate) return
    this.setData({
      selectedDate,
      days: calendarDays(this.data.monthKey, selectedDate, this.data.logs),
      selectedLogs: this.data.logs.filter((row) => row.dateKey === selectedDate),
    })
  },
  onName(e) { this.setData({ 'form.catName': e.detail.value }) },
  onNote(e) { this.setData({ 'form.note': e.detail.value }) },
  toggleSeen(e) { this.setData({ 'form.seen': !!e.detail.value }) },
  toggleFlag(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: !this.data.form[key] })
  },

  save() {
    if (this.data.saving) return
    this.setData({ saving: true })
    api.call('addMobileFeedLog', { dateKey: this.data.selectedDate, ...this.data.form })
      .then(() => {
        wx.showToast({ title: '已记下', icon: 'success' })
        this.setData({ form: { catName: '', seen: true, fed: false, watered: false, note: '' } })
        return this.reload()
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
      .then(() => this.setData({ saving: false }))
  },

  deleteLog(e) {
    const logId = e.currentTarget.dataset.id
    wx.showModal({ title: '删除打卡', content: '确定删掉这条记录？', success: (result) => {
      if (!result.confirm) return
      api.call('deleteMobileFeedLog', { logId }).then(() => this.reload())
        .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
    } })
  },
})
