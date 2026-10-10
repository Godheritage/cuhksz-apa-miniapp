const confirm = require('../../../utils/confirm')
const reviewSession = require('../../../review/session')
const share = require('../../../utils/share.js')
const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { statusText, statusPill, assetCategoryText, accessStatusText, formatTime } = require('../../../utils/format')
const photos = require('../../../utils/photos')
const emptyFeedForm = () => ({ logId: '', dateKey: '', fed: false, watered: false, note: '', photos: [] })

Page({
  onShareAppMessage() {
    return share.appMessage()
  },

  onShareTimeline() {
    return share.timeline()
  },
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
    isRoutineSite: false,
    siteFeedLogs: [],
    feedForm: emptyFeedForm(),
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
          isRoutineSite: !!data.site.routineDutyEnabled,
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
    try { wx.setStorageSync(reviewSession.storageKey('apa_focus_site'), this.siteId) } catch (e) {}
    wx.switchTab({ url: '/pages/duty/list/list' })
  },
  openCat(e) { wx.navigateTo({ url: `/pages/cat/detail/detail?id=${e.currentTarget.dataset.id}` }) },
  toggleFeed(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`feedForm.${key}`]: !this.data.feedForm[key] })
  },
  goRoutineDuty() { wx.switchTab({ url: '/pages/routine-duty/routine-duty' }) },
  onFeedNote(e) { this.setData({ 'feedForm.note': e.detail.value }) },
  editSiteFeed(e) {
    if (this.data.savingFeed) return
    const log = this.data.siteFeedLogs.find((row) => row._id === e.currentTarget.dataset.id)
    if (!log || !log.canEdit) return
    this.setData({ feedForm: {
      logId: log._id, dateKey: log.dateKey || '', fed: !!log.fed, watered: !!log.watered,
      note: log.note || '', photos: (log.photoFileIds || []).slice(),
    } }, () => this.scrollToFeedForm())
  },
  scrollToFeedForm() {
    const query = wx.createSelectorQuery()
    query.select('#site-feed-form').boundingClientRect()
    query.selectViewport().scrollOffset()
    query.exec((rects) => {
      const rect = rects[0]
      const viewport = rects[1]
      if (rect && viewport) wx.pageScrollTo({ scrollTop: viewport.scrollTop + rect.top, duration: 250 })
    })
  },
  cancelFeedEdit() {
    if (this.data.savingFeed) return
    this.setData({ feedForm: emptyFeedForm() })
  },
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
    const form = { ...this.data.feedForm, photos: (this.data.feedForm.photos || []).slice() }
    if (!form.fed && !form.watered && !String(form.note || '').trim()) {
      wx.showToast({ title: '勾选投喂、添水或写备注', icon: 'none' })
      return
    }
    this.setData({ savingFeed: true })
    photos.uploadMany(form.photos, 'site-feed')
      .then((photoFileIds) => api.call(form.logId ? 'updateSiteFeedLog' : 'addSiteFeedLog', {
        ...(form.logId ? { logId: form.logId } : { siteId: this.siteId }),
        fed: form.fed, watered: form.watered,
        note: form.note, photoFileIds,
      }))
      .then(() => {
        this.setData({ feedForm: emptyFeedForm() })
        wx.showToast({ title: form.logId ? '已保存修改' : '已记录', icon: 'success' })
        return this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      .then(() => this.setData({ savingFeed: false }))
  },
  deleteSiteFeed(e) {
    if (this.data.savingFeed) return
    const logId = e.currentTarget.dataset.id
    confirm({
      title: '删除点位投喂记录', content: '确定删掉这条记录？',
      success: (result) => {
        if (!result.confirm) return
        api.call('deleteSiteFeedLog', { logId })
          .then(() => {
            if (this.data.feedForm.logId === logId) this.cancelFeedEdit()
            return this.reload()
          })
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
