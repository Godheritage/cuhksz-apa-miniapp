const { forRole } = require('../../data/guide')

Page({
  data: {
    ready: false,
    error: '',
    title: '',
    lead: '',
    sections: [],
  },

  onShow() {
    this.reload()
  },

  reload() {
    this.setData({ ready: false, error: '', title: '', lead: '', sections: [] })
    wx.setNavigationBarTitle({ title: '使用指南' })
    getApp().refreshUser(true).then((user) => {
      if (!user || (user.role !== 'member' && user.role !== 'admin')) {
        getApp().routeByRole(user)
        return
      }
      const guide = forRole(user.role)
      this.setData({ ready: true, title: guide.title, lead: guide.lead, sections: guide.sections })
      wx.setNavigationBarTitle({ title: guide.title })
    }).catch(() => this.setData({ error: '暂时无法确认身份，请检查网络后重试。' }))
  },
})
