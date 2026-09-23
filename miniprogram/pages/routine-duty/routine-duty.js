const api = require('../../services/api')
const auth = require('../../behaviors/auth')
const photos = require('../../utils/photos')
const { todayKey, formatTime } = require('../../utils/format')

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const emptyForm = () => ({ fed: false, watered: false, note: '', photos: [] })

function monthShift(monthKey, amount) {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(year, month - 1 + amount, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

function calendarDays(monthKey, selectedDate, logs) {
  const [year, month] = monthKey.split('-').map(Number)
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const count = new Date(year, month, 0).getDate()
  const slots = {}
  ;(logs || []).forEach((row) => {
    if (!slots[row.dateKey]) slots[row.dateKey] = new Set()
    slots[row.dateKey].add(row.siteId + ':' + row.shiftId)
  })
  const cells = []
  for (let i = 0; i < offset; i += 1) cells.push({ key: 'blank-' + i, blank: true })
  for (let day = 1; day <= count; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`
    cells.push({ key, day, selected: key === selectedDate, count: slots[key]?.size || 0 })
  }
  return cells
}

function dayCards(sites, shifts, logs, dateKey) {
  return (sites || []).map((site) => ({
    ...site,
    shifts: (shifts || []).map((shift) => {
      const rows = (logs || []).filter((row) => row.dateKey === dateKey
        && row.siteId === site._id && row.shiftId === shift.id)
      return {
        ...shift, siteId: site._id, siteName: site.name,
        logs: rows, done: rows.length > 0, count: rows.length,
        mine: rows.some((row) => row.mine),
        people: rows.map((row) => row.byName).filter(Boolean).join('、'),
      }
    }),
  }))
}

Page({
  behaviors: [auth],
  data: {
    ready: false, monthKey: todayKey().slice(0, 7), selectedDate: todayKey(),
    week: WEEK, days: [], sites: [], shifts: [], logs: [], cards: [],
    doneSlots: 0, totalSlots: 12,
    selectedSlot: {}, form: emptyForm(), saving: false,
    pendingMembers: 0,
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 0, pendingCount: getApp().globalData.pendingMemberCount || 0 })
    this.bindApprovedUser((user) => {
      this.reload()
      this.loadPendingMembers(user)
    })
  },

  onPullDownRefresh() {
    Promise.all([this.reload(), this.loadPendingMembers(this.data.user)])
      .finally(() => wx.stopPullDownRefresh())
  },

  loadPendingMembers(user) {
    if (!user || user.role !== 'admin') {
      this.setData({ pendingMembers: 0 })
      return Promise.resolve()
    }
    return api.call('adminListUsers').then((data) => {
      const count = (data.users || []).filter((row) => row.role === 'pending').length
      getApp().globalData.pendingMemberCount = count
      this.setData({ pendingMembers: count })
      const tabBar = this.getTabBar && this.getTabBar()
      if (tabBar) tabBar.setData({ pendingCount: count })
    }).catch(() => {})
  },

  reload() {
    const monthKey = this.data.monthKey
    return api.call('listRoutineDuty', { monthKey }).then((data) => {
      if (this.data.monthKey !== monthKey) return
      const sites = data.sites || []
      const shifts = data.shifts || []
      const logs = (data.logs || []).map((row) => ({ ...row, timeText: formatTime(row.at) }))
      const cards = dayCards(sites, shifts, logs, this.data.selectedDate)
      this.setData({
        ready: true, sites, shifts, logs, cards,
        totalSlots: sites.length * shifts.length,
        doneSlots: cards.reduce((sum, site) => sum + site.shifts.filter((shift) => shift.done).length, 0),
        days: calendarDays(monthKey, this.data.selectedDate, logs),
      })
    }).catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  prevMonth() { this.changeMonth(-1) },
  nextMonth() { this.changeMonth(1) },
  changeMonth(amount) {
    const monthKey = monthShift(this.data.monthKey, amount)
    this.setData({ monthKey, selectedDate: monthKey + '-01', selectedSlot: {}, ready: false })
    this.reload()
  },
  pickDay(e) {
    const selectedDate = e.currentTarget.dataset.date
    if (!selectedDate) return
    const cards = dayCards(this.data.sites, this.data.shifts, this.data.logs, selectedDate)
    this.setData({
      selectedDate, cards, selectedSlot: {}, form: emptyForm(),
      doneSlots: cards.reduce((sum, site) => sum + site.shifts.filter((shift) => shift.done).length, 0),
      days: calendarDays(this.data.monthKey, selectedDate, this.data.logs),
    })
  },
  pickSlot(e) {
    const { siteId, shiftId } = e.currentTarget.dataset
    const site = this.data.cards.find((item) => item._id === siteId)
    const shift = site && site.shifts.find((item) => item.id === shiftId)
    if (!shift) return
    if (shift.mine) {
      wx.showToast({ title: '你已打过这一班', icon: 'none' })
      return
    }
    if (this.data.selectedDate > todayKey()) {
      wx.showToast({ title: '不能提前打卡', icon: 'none' })
      return
    }
    this.setData({
      selectedSlot: { siteId, siteName: site.name, shiftId, shiftName: shift.name },
      form: emptyForm(),
    }, () => wx.pageScrollTo({ scrollTop: 10000, duration: 250 }))
  },
  closeForm() { this.setData({ selectedSlot: {}, form: emptyForm() }) },
  toggleFlag(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: !this.data.form[key] })
  },
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
  save() {
    if (this.data.saving || !this.data.selectedSlot.siteId) return
    const slot = this.data.selectedSlot
    const form = this.data.form
    this.setData({ saving: true })
    Promise.all((form.photos || []).map((filePath) => api.uploadDutyPhoto(filePath, 'routine-duty')))
      .then((photoFileIds) => api.call('submitRoutineDuty', {
        dateKey: this.data.selectedDate, siteId: slot.siteId, shiftId: slot.shiftId,
        fed: form.fed, watered: form.watered, note: form.note, photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: '已打卡', icon: 'success' })
        this.setData({ selectedSlot: {}, form: emptyForm() })
        return this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      .then(() => this.setData({ saving: false }))
  },
  deleteCheckin(e) {
    const checkinId = e.currentTarget.dataset.id
    wx.showModal({ title: '删除打卡', content: '确定删掉这条记录？', success: (result) => {
      if (!result.confirm) return
      api.call('deleteRoutineDuty', { checkinId }).then(() => this.reload())
        .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
    } })
  },
  goReviewMembers() { wx.navigateTo({ url: '/pages/admin/members/members' }) },
})
