const api = require('../../services/api')
const auth = require('../../behaviors/auth')
const { todayKey, formatTime } = require('../../utils/format')
const photos = require('../../utils/photos')

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const emptyForm = () => ({ catName: '', seen: true, fed: false, watered: false, note: '', photos: [] })

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
    catFilter: '', catOptions: [],
    form: emptyForm(),
    saving: false,
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 2, pendingCount: getApp().globalData.pendingMemberCount || 0 })
    this.bindApprovedUser((user) => {
      if (tabBar) tabBar.setData({ pendingCount: user.role === 'admin' ? getApp().globalData.pendingMemberCount || 0 : 0 })
      this.reload()
    })
  },

  reload() {
    const monthKey = this.data.monthKey
    return api.call('listMobileFeedLogs', { monthKey })
      .then((result) => {
        if (this.data.monthKey !== monthKey) return
        const logs = (result.logs || []).map((row) => ({ ...row, timeText: formatTime(row.at) }))
        const catOptions = result.catNames || []
        const catFilter = catOptions.includes(this.data.catFilter) ? this.data.catFilter : ''
        const visibleLogs = catFilter ? logs.filter((row) => row.catName === catFilter) : logs
        this.setData({
          ready: true, logs, catOptions, catFilter,
          days: calendarDays(monthKey, this.data.selectedDate, visibleLogs),
          selectedLogs: visibleLogs.filter((row) => row.dateKey === this.data.selectedDate),
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
    const visibleLogs = this.data.catFilter
      ? this.data.logs.filter((row) => row.catName === this.data.catFilter) : this.data.logs
    this.setData({
      selectedDate,
      days: calendarDays(this.data.monthKey, selectedDate, visibleLogs),
      selectedLogs: visibleLogs.filter((row) => row.dateKey === selectedDate),
    })
  },
  pickCat(e) {
    const catFilter = e.currentTarget.dataset.name || ''
    const visibleLogs = catFilter
      ? this.data.logs.filter((row) => row.catName === catFilter) : this.data.logs
    this.setData({
      catFilter,
      days: calendarDays(this.data.monthKey, this.data.selectedDate, visibleLogs),
      selectedLogs: visibleLogs.filter((row) => row.dateKey === this.data.selectedDate),
    })
  },
  onName(e) { this.setData({ 'form.catName': e.detail.value }) },
  onNote(e) { this.setData({ 'form.note': e.detail.value }) },
  choosePhoto() {
    if (this.data.form.photos.length >= 3) {
      wx.showToast({ title: '最多选 3 张照片', icon: 'none' })
      return
    }
    photos.pick(this.data.form.photos, 3)
      .then((next) => this.setData({ 'form.photos': next }))
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  removePhoto(e) {
    this.setData({ 'form.photos': photos.removeAt(this.data.form.photos, e.currentTarget.dataset.index) })
  },
  previewPhoto(e) {
    const url = e.currentTarget.dataset.url
    const urls = e.currentTarget.dataset.urls || []
    if (url) wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },
  toggleSeen(e) { this.setData({ 'form.seen': !!e.detail.value }) },
  toggleFlag(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: !this.data.form[key] })
  },

  save() {
    if (this.data.saving) return
    const form = this.data.form
    if (!String(form.catName || '').trim()) {
      wx.showToast({ title: '请填写猫名或临时称呼', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    // 开发者工具把本地临时照片写成 http://usr/...，仍须上传到云存储。
    Promise.all((form.photos || []).map((filePath) => api.uploadDutyPhoto(filePath, 'mobile-feed')))
      .then((photoFileIds) => api.call('addMobileFeedLog', {
        dateKey: this.data.selectedDate,
        catName: form.catName, seen: form.seen, fed: form.fed,
        watered: form.watered, note: form.note, photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: '已记下', icon: 'success' })
        this.setData({ form: emptyForm(), catFilter: String(form.catName).trim() })
        return this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
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
