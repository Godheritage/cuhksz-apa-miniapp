const confirm = require('../../utils/confirm')
const share = require('../../utils/share.js')
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

function calendarDays(monthKey, selectedDate, logs, signups) {
  const [year, month] = monthKey.split('-').map(Number)
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const count = new Date(year, month, 0).getDate()
  const slots = {}
  ;(logs || []).forEach((row) => {
    if (!slots[row.dateKey]) slots[row.dateKey] = new Set()
    slots[row.dateKey].add(row.siteId + ':' + row.shiftId)
  })
  const signupCounts = {}
  ;(signups || []).forEach((row) => { signupCounts[row.dateKey] = (signupCounts[row.dateKey] || 0) + 1 })
  const cells = []
  for (let i = 0; i < offset; i += 1) cells.push({ key: 'blank-' + i, blank: true })
  for (let day = 1; day <= count; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`
    cells.push({ key, day, selected: key === selectedDate, count: slots[key]?.size || 0,
      signupCount: signupCounts[key] || 0 })
  }
  return cells
}

function dayCards(sites, archivedSites, shifts, logs, signups, dateKey) {
  const current = (sites || []).map((site) => ({ ...site, archived: false }))
  const history = (archivedSites || []).filter((site) => (logs || []).concat(signups || [])
    .some((row) => row.dateKey === dateKey && row.siteId === site._id))
  return current.concat(history).map((site) => ({
    ...site,
    shifts: (shifts || []).map((shift) => {
      const rows = (logs || []).filter((row) => row.dateKey === dateKey
        && row.siteId === site._id && row.shiftId === shift.id)
      const planned = (signups || []).filter((row) => row.dateKey === dateKey
        && row.siteId === site._id && row.shiftId === shift.id)
      return {
        ...shift, siteId: site._id, siteName: site.name,
        logs: rows, done: rows.length > 0, count: rows.length,
        signups: planned, signupCount: planned.length,
        signupNames: planned.map((row) => row.byName).filter(Boolean).join('、'),
        signedByMe: planned.some((row) => row.mine),
        mine: rows.some((row) => row.mine),
        people: rows.map((row) => row.byName).filter(Boolean).join('、'),
      }
    }),
  }))
}

Page({
  onShareAppMessage() {
    return share.appMessage()
  },

  onShareTimeline() {
    return share.timeline()
  },
  behaviors: [auth],
  data: {
    ready: false, todayKey: todayKey(), monthKey: todayKey().slice(0, 7), selectedDate: todayKey(),
    week: WEEK, days: [], sites: [], archivedSites: [], shifts: [], logs: [], signups: [], cards: [],
    doneSlots: 0, totalSlots: 0, siteNames: '',
    selectedSlot: {}, form: emptyForm(), saving: false,
    pendingMembers: 0,
  },

  onShow() {
    this.setData({ todayKey: todayKey() })
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
      const archivedSites = data.archivedSites || []
      const shifts = data.shifts || []
      const logs = (data.logs || []).map((row) => ({ ...row, timeText: formatTime(row.at) }))
      const signups = data.signups || []
      const cards = dayCards(sites, archivedSites, shifts, logs, signups, this.data.selectedDate)
      this.setData({
        ready: true, sites, archivedSites, shifts, logs, signups, cards,
        siteNames: sites.map((site) => site.name).join('、'),
        totalSlots: sites.length * shifts.length,
        doneSlots: cards.reduce((sum, site) => sum + site.shifts.filter((shift) => shift.done).length, 0),
        days: calendarDays(monthKey, this.data.selectedDate, logs, signups),
      })
    }).catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  prevMonth() { this.changeMonth(-1) },
  nextMonth() { this.changeMonth(1) },
  changeMonth(amount) {
    if (this.data.saving) return
    const monthKey = monthShift(this.data.monthKey, amount)
    this.setData({ monthKey, selectedDate: monthKey + '-01', selectedSlot: {}, form: emptyForm(), ready: false })
    this.reload()
  },
  pickDay(e) {
    if (this.data.saving) return
    const selectedDate = e.currentTarget.dataset.date
    if (!selectedDate) return
    const cards = dayCards(this.data.sites, this.data.archivedSites, this.data.shifts,
      this.data.logs, this.data.signups, selectedDate)
    this.setData({
      selectedDate, cards, selectedSlot: {}, form: emptyForm(),
      doneSlots: cards.reduce((sum, site) => sum + site.shifts.filter((shift) => shift.done).length, 0),
      days: calendarDays(this.data.monthKey, selectedDate, this.data.logs, this.data.signups),
    })
  },
  pickSlot(e) {
    if (this.data.saving) return
    const { siteId, shiftId } = e.currentTarget.dataset
    const site = this.data.cards.find((item) => item._id === siteId)
    const shift = site && site.shifts.find((item) => item.id === shiftId)
    if (!shift) return
    if (site.archived) return
    if (shift.mine) {
      const log = shift.logs.find((row) => row.canEdit)
      if (log) this.editCheckin({ currentTarget: { dataset: { id: log._id } } })
      return
    }
    if (this.data.selectedDate > todayKey()) {
      wx.showToast({ title: '不能提前打卡', icon: 'none' })
      return
    }
    this.setData({
      selectedSlot: { siteId, siteName: site.name, shiftId, shiftName: shift.name },
      form: emptyForm(),
    }, () => this.scrollToCheckinForm())
  },
  editCheckin(e) {
    if (this.data.saving) return
    const log = this.data.logs.find((row) => row._id === e.currentTarget.dataset.id)
    if (!log || !log.canEdit) return
    const site = this.data.cards.find((row) => row._id === log.siteId)
    const shift = this.data.shifts.find((row) => row.id === log.shiftId)
    this.setData({
      selectedSlot: {
        checkinId: log._id, siteId: log.siteId, siteName: (site && site.name) || log.siteName,
        shiftId: log.shiftId, shiftName: (shift && shift.name) || log.shiftId,
      },
      form: { fed: !!log.fed, watered: !!log.watered, note: log.note || '', photos: (log.photoFileIds || []).slice() },
    }, () => this.scrollToCheckinForm())
  },
  scrollToCheckinForm() {
    const query = wx.createSelectorQuery()
    query.select('#checkin-form').boundingClientRect()
    query.selectViewport().scrollOffset()
    query.exec((rects) => {
      const rect = rects[0]
      const viewport = rects[1]
      if (rect && viewport) wx.pageScrollTo({ scrollTop: viewport.scrollTop + rect.top, duration: 250 })
    })
  },
  closeForm() {
    if (this.data.saving) return
    this.setData({ selectedSlot: {}, form: emptyForm() })
  },
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
    const slot = { ...this.data.selectedSlot }
    const form = { ...this.data.form, photos: (this.data.form.photos || []).slice() }
    const dateKey = this.data.selectedDate
    this.setData({ saving: true })
    photos.uploadMany(form.photos, 'routine-duty')
      .then((photoFileIds) => api.call(slot.checkinId ? 'updateRoutineDuty' : 'submitRoutineDuty', {
        ...(slot.checkinId ? { checkinId: slot.checkinId } : { dateKey, siteId: slot.siteId, shiftId: slot.shiftId }),
        fed: form.fed, watered: form.watered, note: form.note, photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: slot.checkinId ? '已保存修改' : '已打卡', icon: 'success' })
        this.setData({ selectedSlot: {}, form: emptyForm() })
        return this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      .then(() => this.setData({ saving: false }))
  },
  deleteCheckin(e) {
    if (this.data.saving) return
    const checkinId = e.currentTarget.dataset.id
    confirm({ title: '删除打卡', content: '确定删掉这条记录？', success: (result) => {
      if (!result.confirm) return
      api.call('deleteRoutineDuty', { checkinId }).then(() => {
        if (this.data.selectedSlot.checkinId === checkinId) this.closeForm()
        return this.reload()
      })
        .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
    } })
  },
  signup(e) {
    const { siteId, shiftId } = e.currentTarget.dataset
    api.call('signupRoutineDuty', { dateKey: this.data.selectedDate, siteId, shiftId })
      .then(() => { wx.showToast({ title: '已报名', icon: 'success' }); return this.reload() })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  cancelSignup(e) {
    api.call('cancelRoutineDutySignup', { signupId: e.currentTarget.dataset.id })
      .then(() => this.reload())
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  openSiteDetail(e) { wx.navigateTo({ url: `/pages/site/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  goReviewMembers() { wx.navigateTo({ url: '/pages/admin/members/members' }) },
  goAdminSites() { wx.navigateTo({ url: '/pages/admin/sites/sites' }) },
})
