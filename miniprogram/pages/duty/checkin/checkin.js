const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { readDraft, writeDraft, clearDraft } = require('../../../utils/drafts')

const DRAFT_KEY = 'apa_draft_checkin'

Page({
  behaviors: [auth],

  data: {
    sites: [],
    photos: [],
    locationLabel: '未获取',
    submitting: false,
    form: {
      siteId: '',
      remark: '',
      location: null,
      locationStatus: 'unavailable',
    },
  },

  onLoad(query) {
    this.bindApprovedUser(() => {
      const draft = readDraft(DRAFT_KEY) || {}
      api.call('listSites')
        .then((data) => {
          this.setData({
            sites: data.sites || [],
            'form.siteId': query.siteId || draft.siteId || '',
            'form.remark': draft.remark || this.data.form.remark,
            'form.location': draft.location || this.data.form.location,
            'form.locationStatus': draft.locationStatus || this.data.form.locationStatus,
            locationLabel: draft.locationLabel || this.data.locationLabel,
          })
        })
        .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
    })
  },

  onHide() {
    writeDraft(DRAFT_KEY, {
      siteId: this.data.form.siteId,
      remark: this.data.form.remark,
      location: this.data.form.location,
      locationStatus: this.data.form.locationStatus,
      locationLabel: this.data.locationLabel,
    })
  },

  pickSite(e) {
    this.setData({ 'form.siteId': e.currentTarget.dataset.id })
  },

  onRemark(e) {
    this.setData({ 'form.remark': e.detail.value })
  },

  fetchLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({
          locationLabel: `${res.latitude.toFixed(4)}, ${res.longitude.toFixed(4)}`,
          'form.location': {
            latitude: res.latitude,
            longitude: res.longitude,
            accuracy: res.accuracy,
          },
          'form.locationStatus': 'ok',
        })
      },
      fail: () => {
        this.setData({
          locationLabel: '未授权或不可用',
          'form.location': null,
          'form.locationStatus': 'denied',
        })
      },
    })
  },

  choosePhoto() {
    wx.chooseMedia({
      count: 3 - this.data.photos.length,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        this.setData({ photos: this.data.photos.concat(paths).slice(0, 3) })
      },
    })
  },

  removePhoto(e) {
    const photos = this.data.photos.slice()
    photos.splice(e.currentTarget.dataset.index, 1)
    this.setData({ photos })
  },

  submit() {
    if (!this.data.form.siteId) {
      wx.showToast({ title: '请先选点位', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    const uploads = this.data.photos.map((path) => api.uploadDutyPhoto(path, 'me'))
    Promise.all(uploads)
      .then((photoFileIds) => api.call('submitDuty', {
        siteId: this.data.form.siteId,
        remark: this.data.form.remark,
        photoFileIds,
        location: this.data.form.location,
        locationStatus: this.data.form.locationStatus,
      }))
      .then(() => {
        clearDraft(DRAFT_KEY)
        wx.showToast({ title: '已到岗', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 400)
      })
      .catch((err) => wx.showToast({ title: err.message || '提交失败', icon: 'none' }))
      .finally(() => this.setData({ submitting: false }))
  },
})
