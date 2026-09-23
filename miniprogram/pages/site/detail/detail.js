const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { statusText, statusPill, assetCategoryText, accessStatusText, formatTime } = require('../../../utils/format')
const photos = require('../../../utils/photos')

Page({
  behaviors: [auth],
  data: {
    ready: false,
    site: {},
    cages: [],
    assets: [],
    cats: [],
    access: null,
    accessText: '',
    password: '',
    revealed: '',
    siteFeedToday: null,
    siteFeedLogs: [],
    feedForm: { fed: false, watered: false, note: '', photos: [] },
    savingFeed: false,
  },

  onLoad(query) {
    this.siteId = query.id
    this.bindApprovedUser(() => this.reload())
  },

  onShow() {
    if (this.siteId && this.data.ready) this.reload()
  },

  reload() {
    return Promise.all([
      api.call('getSiteDetail', { siteId: this.siteId }),
      api.call('listSiteFeedLogs', { siteId: this.siteId }),
    ]).then(([data, feedData]) => {
        const access = data.access || null
        this.setData({
          ready: true,
          site: data.site,
          cages: data.cages || [],
          assets: (data.assets || []).map((a) => ({
            ...a,
            categoryText: assetCategoryText(a.category),
            occupyText: a.occupied
              ? `${a.occupiedCount}/${a.quantity} 占用 · ${(a.occupants || []).map((o) => o.name).join('、')}`
              : `未占用（${a.quantity}）`,
          })),
          cats: (data.cats || []).map((cat) => ({
            ...cat,
            statusText: statusText(cat.status),
            statusClass: statusPill(cat.status),
          })),
          access,
          accessText: access ? accessStatusText(access.status) : '',
          siteFeedToday: feedData.today || null,
          siteFeedLogs: (feedData.logs || []).map((row) => ({
            ...row,
            timeText: formatTime(row.at),
            photoFileIds: row.photoFileIds || [],
          })),
        })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  goTasks() {
    try { wx.setStorageSync('apa_focus_site', this.siteId) } catch (e) {}
    wx.switchTab({ url: '/pages/duty/list/list' })
  },
  openCat(e) { wx.navigateTo({ url: `/pages/cat/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  toggleFeed(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`feedForm.${key}`]: !this.data.feedForm[key] })
  },
  onFeedNote(e) { this.setData({ 'feedForm.note': e.detail.value }) },
  chooseFeedPhoto() {
    photos.pick(this.data.feedForm.photos, 6)
      .then((next) => this.setData({ 'feedForm.photos': next }))
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  removeFeedPhoto(e) {
    this.setData({ 'feedForm.photos': photos.removeAt(this.data.feedForm.photos, e.currentTarget.dataset.index) })
  },
  previewFeed(e) {
    const urls = e.currentTarget.dataset.urls || []
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },
  saveSiteFeed() {
    if (this.data.savingFeed) return
    const form = this.data.feedForm
    if (!form.fed && !form.watered && !String(form.note || '').trim()) {
      wx.showToast({ title: '勾选投喂、添水或写备注', icon: 'none' })
      return
    }
    this.setData({ savingFeed: true })
    photos.uploadMany(form.photos, 'site-feed')
      .then((photoFileIds) => api.call('addSiteFeedLog', {
        siteId: this.siteId, fed: form.fed, watered: form.watered,
        note: form.note, photoFileIds,
      }))
      .then(() => {
        this.setData({ feedForm: { fed: false, watered: false, note: '', photos: [] } })
        wx.showToast({ title: '已记录', icon: 'success' })
        return this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      .then(() => this.setData({ savingFeed: false }))
  },
  deleteSiteFeed(e) {
    const logId = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除点位投喂记录', content: '确定删掉这条记录？',
      success: (result) => {
        if (!result.confirm) return
        api.call('deleteSiteFeedLog', { logId })
          .then(() => this.reload())
          .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      },
    })
  },
  onPwd(e) { this.setData({ password: e.detail.value }) },

  applyAccess() {
    api.call('requestSiteAccess', { siteId: this.siteId })
      .then(() => { wx.showToast({ title: '已提交申请', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  reveal() {
    api.call('revealSiteAddress', { siteId: this.siteId, password: this.data.password })
      .then((data) => {
        this.setData({
          revealed: `地址：${data.address}\n到达说明：${data.lockNote}\n有效至：${data.expireDateKey || '当天'}`,
        })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})
