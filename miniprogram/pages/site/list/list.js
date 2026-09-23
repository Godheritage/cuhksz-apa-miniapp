const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { siteTypeText } = require('../../../utils/format')

Page({
  behaviors: [auth],
  data: { ready: false, sites: [] },

  onShow() {
    this.bindApprovedUser(() => this.reload())
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  reload() {
    return api.call('listSites')
      .then((data) => {
        this.setData({
          ready: true,
          sites: (data.sites || []).map((site) => ({
            ...site,
            typeText: siteTypeText(site.type),
          })),
        })
      })
      .catch((err) => {
        if (err.message !== 'UNAPPROVED') wx.showToast({ title: err.message, icon: 'none' })
      })
  },

  openSite(e) {
    wx.navigateTo({ url: `/pages/site/detail/detail?id=${e.currentTarget.dataset.id}` })
  },
  goCats() { wx.navigateTo({ url: '/pages/cat/list/list' }) },
  goRoster() { wx.navigateTo({ url: '/pages/roster/roster' }) },
})
