const api = require('../../../services/api')

Page({
  data: { ready: false, error: '', audit: null },
  onShow() {
    this.reloadRole()
  },
  reloadRole() {
    this.setData({ ready: false, error: '', audit: null })
    getApp().refreshUser(true)
      .then(() => getApp().ensureAdmin())
      .then(() => {
        this.setData({ ready: true })
        return Promise.all([
          api.call('listCats', { campusStatus: 'all' }),
          api.call('listSites'),
        ]).then(([catData, siteData]) => {
          const cats = catData.cats || []
          this.setData({ audit: {
            siteCount: (siteData.sites || []).length,
            catCount: cats.length,
            missingSite: cats.filter((cat) => cat.campusStatus === 'on_campus' && !cat.siteId).length,
            missingPhoto: cats.filter((cat) => !(cat.photoFileIds || []).length).length,
          } })
        }).catch(() => {})
      })
      .catch((err) => {
        if (err.message !== 'UNAPPROVED' && err.message !== 'NOT_ADMIN') {
          this.setData({ error: '管理员身份暂时没确认，请重试。' })
        }
      })
  },
  goMembers() { wx.navigateTo({ url: '/pages/admin/members/members' }) },
  goSites() { wx.navigateTo({ url: '/pages/admin/sites/sites' }) },
  goAccess() { wx.navigateTo({ url: '/pages/admin/access/access' }) },
  goFinance() { wx.navigateTo({ url: '/pages/admin/finance/finance' }) },
  goDonate() { wx.navigateTo({ url: '/pages/donate/donate' }) },
  goSzcat() { wx.navigateTo({ url: '/pages/szcat/szcat' }) },
  goCats() { wx.navigateTo({ url: '/pages/cat/list/list' }) },
  goWorkload() { wx.navigateTo({ url: '/pages/admin/workload/workload' }) },
  goPublish() { wx.navigateTo({ url: '/pages/admin/publish/publish' }) },
  goKnowledge() { wx.navigateTo({ url: '/pages/admin/knowledge/knowledge' }) },
  goExport() { wx.navigateTo({ url: '/pages/admin/export/export' }) },
  goRoster() { wx.navigateTo({ url: '/pages/roster/roster' }) },
})
