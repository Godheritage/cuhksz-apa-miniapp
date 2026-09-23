const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { taskStatusText, taskStatusPill, todayKey, formatTime } = require('../../../utils/format')
const photos = require('../../../utils/photos')

const HERO = {
  '': '单次、每日和每周任务。打开一条即可领取或回传。',
  once: '做完就结束；有截止日期的请留意时间。',
  daily: '每天都可做。',
  weekly: '只在指定星期执行。',
}
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

function monthShift(monthKey, amount) {
  const [year, month] = monthKey.split('-').map(Number)
  const next = new Date(year, month - 1 + amount, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

function calendarDays(monthKey, selectedDate, items) {
  const [year, month] = monthKey.split('-').map(Number)
  const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const count = new Date(year, month, 0).getDate()
  const counts = {}
  ;(items || []).forEach((item) => { counts[item.dateKey] = (counts[item.dateKey] || 0) + 1 })
  const cells = []
  for (let i = 0; i < offset; i += 1) cells.push({ key: 'blank-' + i, blank: true })
  for (let day = 1; day <= count; day += 1) {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`
    cells.push({ key, day, selected: key === selectedDate, count: counts[key] || 0 })
  }
  return cells
}

Page({
  behaviors: [auth],
  data: {
    ready: false,
    isAdmin: false,
    pendingMembers: 0,
    sites: [],
    siteId: '',
    scopeId: '',
    heroSub: HERO[''],
    groups: [],
    loginSlow: false,
    showFilters: false,
    calendarMonth: todayKey().slice(0, 7),
    calendarSelectedDate: todayKey(),
    calendarWeek: WEEK, calendarDays: [], calendarItems: [], calendarDayItems: [],
    calendarLoading: true,
    calendarCheckins: [], calendarCheckinLoading: true,
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 0, pendingCount: getApp().globalData.pendingMemberCount || 0 })
    this.setData({ loginSlow: false })
    clearTimeout(this.slowTimer)
    this.slowTimer = setTimeout(() => {
      if (!this.data.ready) this.setData({ loginSlow: true })
    }, 4000)
    this.bindApprovedUser(() => {
      clearTimeout(this.slowTimer)
      let siteId = this.data.siteId
      try {
        const focus = wx.getStorageSync('apa_focus_site')
        if (focus) {
          siteId = focus
          wx.removeStorageSync('apa_focus_site')
        }
      } catch (e) {}
      this.setData({ siteId })
      this.reload()
      this.reloadCalendar()
      this.reloadCalendarCheckins()
    })
  },

  retryLogin() {
    this.setData({ loginSlow: false, ready: false })
    getApp().refreshUser(true).then(() => this.onShow())
      .catch(() => this.setData({ loginSlow: true }))
  },

  onPullDownRefresh() {
    Promise.all([this.reload(), this.reloadCalendar(), this.reloadCalendarCheckins()])
      .finally(() => wx.stopPullDownRefresh())
  },

  reload() {
    return api.call('listWorkTasks', {
      siteId: this.data.siteId || undefined,
      scope: this.data.scopeId || undefined,
    }).then((data) => {
      this.setData({
        ready: true,
        loginSlow: false,
        isAdmin: !!data.isAdmin,
        sites: data.sites || [],
        heroSub: HERO[this.data.scopeId] || HERO[''],
        groups: (data.groups || []).map((group) => ({
          ...group,
          tasks: (group.tasks || []).map((task) => ({
            ...task,
            statusText: task.allowMultiple ? '多人可做' : taskStatusText(task.status),
            statusClass: taskStatusPill(task.status),
            participantNames: (task.participants || []).map((p) => p.workerName).join('、'),
          })),
        })),
      })
      return this.loadPendingMembers(!!data.isAdmin)
    }).catch((err) => {
      this.setData({ loginSlow: true })
      if (err.message !== 'UNAPPROVED') wx.showToast({ title: photos.failText(err), icon: 'none' })
    })
  },

  loadPendingMembers(isAdmin) {
    if (!isAdmin) {
      getApp().globalData.pendingMemberCount = 0
      this.setData({ pendingMembers: 0 })
      const tabBar = this.getTabBar && this.getTabBar()
      if (tabBar) tabBar.setData({ pendingCount: 0 })
      return Promise.resolve()
    }
    return api.call('adminListUsers').then((data) => {
      const count = (data.users || []).filter((user) => user.role === 'pending').length
      getApp().globalData.pendingMemberCount = count
      this.setData({ pendingMembers: count })
      const tabBar = this.getTabBar && this.getTabBar()
      if (tabBar) tabBar.setData({ pendingCount: count })
    }).catch(() => {})
  },

  reloadCalendar() {
    const monthKey = this.data.calendarMonth
    this.setData({ calendarLoading: true })
    return api.call('listTaskCalendar', { monthKey })
      .then((data) => {
        if (this.data.calendarMonth !== monthKey) return
        const items = (data.items || []).map((item) => ({
          ...item,
          detailText: [
            item.siteName,
            (item.workerNames || []).join('、'),
            item.approvedCount > 1 ? `${item.approvedCount} 条回传通过` : '',
          ].filter(Boolean).join(' · '),
        }))
        this.setData({
          calendarLoading: false,
          calendarItems: items,
          calendarDays: calendarDays(monthKey, this.data.calendarSelectedDate, items),
          calendarDayItems: items.filter((item) => item.dateKey === this.data.calendarSelectedDate),
        })
      })
      .catch((err) => {
        this.setData({ calendarLoading: false })
        wx.showToast({ title: photos.failText(err), icon: 'none' })
      })
  },

  reloadCalendarCheckins() {
    const dateKey = this.data.calendarSelectedDate
    this.setData({ calendarCheckinLoading: true })
    return api.call('listDuty', { dateKey, pageSize: 50 })
      .then((data) => {
        if (this.data.calendarSelectedDate !== dateKey) return
        this.setData({
          calendarCheckinLoading: false,
          calendarCheckins: (data.records || []).map((record) => ({
            ...record,
            timeText: formatTime(record.arrivedAt),
          })),
        })
      })
      .catch(() => {
        if (this.data.calendarSelectedDate === dateKey) this.setData({ calendarCheckinLoading: false })
      })
  },

  prevCalendarMonth() { this.changeCalendarMonth(-1) },
  nextCalendarMonth() { this.changeCalendarMonth(1) },
  changeCalendarMonth(amount) {
    const calendarMonth = monthShift(this.data.calendarMonth, amount)
    this.setData({ calendarMonth, calendarSelectedDate: calendarMonth + '-01' })
    this.reloadCalendar()
    this.reloadCalendarCheckins()
  },
  pickCalendarDay(e) {
    const calendarSelectedDate = e.currentTarget.dataset.date
    if (!calendarSelectedDate) return
    this.setData({
      calendarSelectedDate,
      calendarDays: calendarDays(this.data.calendarMonth, calendarSelectedDate, this.data.calendarItems),
      calendarDayItems: this.data.calendarItems.filter((item) => item.dateKey === calendarSelectedDate),
    })
    this.reloadCalendarCheckins()
  },

  pickSite(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ siteId: this.data.siteId === id ? '' : id }, () => this.reload())
  },

  toggleFilters() {
    this.setData({ showFilters: !this.data.showFilters })
  },

  pickScope(e) {
    const id = e.currentTarget.dataset.id || ''
    this.setData({ scopeId: this.data.scopeId === id ? '' : id }, () => this.reload())
  },

  openTask(e) {
    wx.navigateTo({ url: `/pages/duty/detail/detail?id=${e.currentTarget.dataset.id}` })
  },

  goPublish() {
    wx.navigateTo({ url: '/pages/admin/publish/publish' })
  },

  goReviewMembers() {
    wx.navigateTo({ url: '/pages/admin/members/members' })
  },
})
