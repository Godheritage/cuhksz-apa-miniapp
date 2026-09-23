const api = require('../../services/api')
const { roleText } = require('../../utils/format')

Page({
  data: {
    user: {},
    roleLabel: '',
    form: { displayName: '' },
    roleLoading: true,
    roleError: '',
    showMore: false,
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 2, pendingCount: getApp().globalData.pendingMemberCount || 0 })
    this.reloadRole()
  },

  reloadRole() {
    this.setData({ user: {}, roleLabel: '', roleLoading: true, roleError: '' })
    getApp().refreshUser(true).then((user) => {
      if (!user || (user.role !== 'member' && user.role !== 'admin')) {
        getApp().routeByRole(user)
        return
      }
      this.applyUser(user)
    }).catch(() => this.setData({ roleLoading: false, roleError: '身份暂时没确认，请重试。' }))
  },

  applyUser(user) {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ pendingCount: user.role === 'admin' ? getApp().globalData.pendingMemberCount || 0 : 0 })
    this.setData({
      user,
      roleLabel: roleText(user.role),
      form: { displayName: user.displayName || '' },
      roleLoading: false,
      roleError: '',
    })
  },

  onName(e) { this.setData({ 'form.displayName': e.detail.value }) },
  toggleMore() { this.setData({ showMore: !this.data.showMore }) },

  save() {
    api.call('updateProfile', { displayName: this.data.form.displayName })
      .then((data) => {
        getApp().setUser(data.user)
        this.applyUser(data.user)
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  goAdmin() { wx.navigateTo({ url: '/pages/admin/home/home' }) },
  goSites() { wx.navigateTo({ url: '/pages/site/list/list' }) },
  goDonate() { wx.navigateTo({ url: '/pages/donate/donate' }) },
  goSzcat() { wx.navigateTo({ url: '/pages/szcat/szcat' }) },
  goCats() { wx.navigateTo({ url: '/pages/cat/list/list' }) },
  goUpdates() { wx.navigateTo({ url: '/pages/updates/updates' }) },
  goGuide() { wx.navigateTo({ url: '/pages/guide/guide' }) },
})
