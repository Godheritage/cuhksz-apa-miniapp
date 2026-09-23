const api = require('../../services/api')
const auth = require('../../behaviors/auth')
const photos = require('../../utils/photos')

Page({
  behaviors: [auth],
  data: {
    ready: false,
    config: { tutorialPhotoFileIds: [] },
    copies: [],
    cats: [],
    isAdmin: false,
    officialUrl: '',
    platformUrl: '',
    disclaimer: '',
    edit: { monthKey: '', openNote: '', tutorialText: '', photos: [] },
    copyForm: { title: '', body: '', photos: [] },
  },
  onShow() {
    this.bindApprovedUser(() => this.reload())
  },
  reload() {
    return api.call('getSzcatPanel')
      .then((data) => {
        const cfg = data.config || {}
        const next = {
          ready: true,
          config: Object.assign({ tutorialPhotoFileIds: [] }, cfg),
          copies: data.copies || [],
          cats: data.cats || [],
          isAdmin: !!data.isAdmin,
          officialUrl: data.officialUrl,
          platformUrl: data.platformUrl,
          disclaimer: data.disclaimer,
        }
        if (!this._editDirty) {
          next.edit = {
            monthKey: cfg.monthKey || '',
            openNote: cfg.openNote || '',
            tutorialText: cfg.tutorialText || cfg.notice || '',
            photos: cfg.tutorialPhotoFileIds || [],
          }
        }
        this.setData(next)
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  onEdit(e) {
    this._editDirty = true
    this.setData({ [`edit.${e.currentTarget.dataset.key}`]: e.detail.value })
  },
  onCopy(e) { this.setData({ [`copyForm.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  chooseTutorialPhoto() {
    photos.pick(this.data.edit.photos, 6).then((next) => {
      this._editDirty = true
      this.setData({ 'edit.photos': next })
    })
  },
  removeTutorialPhoto(e) {
    this.setData({ 'edit.photos': photos.removeAt(this.data.edit.photos, e.currentTarget.dataset.index) })
  },
  chooseCopyPhoto() {
    photos.pick(this.data.copyForm.photos, 6).then((next) => this.setData({ 'copyForm.photos': next }))
  },
  removeCopyPhoto(e) {
    this.setData({ 'copyForm.photos': photos.removeAt(this.data.copyForm.photos, e.currentTarget.dataset.index) })
  },
  preview(e) {
    const urls = e.currentTarget.dataset.urls || []
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },
  saveConfig() {
    photos.uploadMany(this.data.edit.photos, 'szcat')
      .then((photoFileIds) => api.call('adminSaveSzcatConfig', {
        monthKey: this.data.edit.monthKey,
        openNote: this.data.edit.openNote,
        tutorialText: this.data.edit.tutorialText,
        notice: this.data.edit.tutorialText,
        photoFileIds,
      }))
      .then(() => {
        this._editDirty = false
        wx.showToast({ title: '已保存教程', icon: 'success' })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  addCopy() {
    photos.uploadMany(this.data.copyForm.photos, 'szcat')
      .then((photoFileIds) => api.call('adminAddSzcatCopy', {
        title: this.data.copyForm.title,
        body: this.data.copyForm.body,
        photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: '文案已发布', icon: 'success' })
        this.setData({ copyForm: { title: '', body: '', photos: [] } })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  deleteCopy(e) {
    wx.showModal({
      title: '删除文案',
      content: '确定删掉这条要填写的文案？',
      success: (res) => {
        if (!res.confirm) return
        api.call('adminDeleteSzcatCopy', { copyId: e.currentTarget.dataset.id })
          .then(() => this.reload())
          .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      },
    })
  },
  copyText(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.text || '' })
  },
  openOfficial() {
    const url = this.data.officialUrl || 'https://www.szcat.org/'
    wx.setClipboardData({ data: url })
    wx.showModal({
      title: '官网链接已复制',
      content: '请在系统浏览器打开深圳猫网。指标提交只在官方网站或公众号「深圳猫网」完成。',
      showCancel: false,
    })
  },
  copyLink(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.url || this.data.officialUrl })
  },
  copyPack(e) {
    api.call('buildSzcatPack', { catId: e.currentTarget.dataset.id })
      .then((data) => {
        wx.setClipboardData({ data: data.text })
        wx.showToast({ title: '资料包已复制', icon: 'none' })
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  claim(e) {
    api.call('claimSzcatSlot', { catId: e.currentTarget.dataset.id })
      .then(() => { wx.showToast({ title: '已认领报名', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  setStatus(e) {
    api.call('setSzcatClaimStatus', {
      claimId: e.currentTarget.dataset.id,
      status: e.currentTarget.dataset.status,
    }).then(() => this.reload()).catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
})
