const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { taskStatusText, taskStatusPill } = require('../../../utils/format')
const photos = require('../../../utils/photos')

const HERO = {
  '': '单次、每日和每周任务。打开一条即可领取或回传。',
  once: '做完就结束；有截止日期的请留意时间。',
  daily: '每天都可做。',
  weekly: '只在指定星期执行。',
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
    })
  },

  retryLogin() {
    this.setData({ loginSlow: false, ready: false })
    getApp().refreshUser(true).then(() => this.onShow())
      .catch(() => this.setData({ loginSlow: true }))
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
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
