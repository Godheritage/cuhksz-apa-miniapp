const api = require('../../../services/api')
const photos = require('../../../utils/photos')

const WEEKDAYS = [
  { day: 1, label: '一' }, { day: 2, label: '二' }, { day: 3, label: '三' },
  { day: 4, label: '四' }, { day: 5, label: '五' }, { day: 6, label: '六' },
  { day: 7, label: '日' },
]

Page({
  data: {
    ready: false,
    submitting: false,
    sites: [],
    weekdays: WEEKDAYS,
    publish: {
      siteId: '', scope: 'once', weekdays: [], allowMultiple: false,
      maxParticipants: '2', deadlineDateKey: '', title: '', content: '', photos: [],
    },
  },

  onShow() {
    getApp().ensureAdmin().then(() => api.call('listWorkTasks')).then((data) => {
      this.setData({ ready: true, sites: data.sites || [] })
    }).catch((err) => {
      if (err.message !== 'UNAPPROVED' && err.message !== 'NOT_ADMIN') {
        wx.showToast({ title: photos.failText(err), icon: 'none' })
      }
    })
  },

  onPublish(e) {
    this.setData({ [`publish.${e.currentTarget.dataset.key}`]: e.detail.value })
  },

  pickScope(e) {
    this.setData({ 'publish.scope': e.currentTarget.dataset.id || 'once' })
  },

  pickWeekday(e) {
    const day = Number(e.currentTarget.dataset.day)
    const selected = new Set(this.data.publish.weekdays || [])
    if (selected.has(day)) selected.delete(day)
    else selected.add(day)
    this.setData({
      'publish.weekdays': [...selected].sort(),
      weekdays: WEEKDAYS.map((row) => ({ ...row, selected: selected.has(row.day) })),
    })
  },

  toggleMultiple(e) {
    this.setData({ 'publish.allowMultiple': !!e.detail.value })
  },

  onMaxParticipants(e) {
    this.setData({ 'publish.maxParticipants': e.detail.value })
  },

  onDeadline(e) {
    this.setData({ 'publish.deadlineDateKey': e.detail.value || '' })
  },

  clearDeadline() {
    this.setData({ 'publish.deadlineDateKey': '' })
  },

  pickSite(e) {
    this.setData({ 'publish.siteId': e.currentTarget.dataset.id || '' })
  },

  choosePhoto() {
    photos.pick(this.data.publish.photos, 6).then((next) => this.setData({ 'publish.photos': next }))
  },

  removePhoto(e) {
    this.setData({ 'publish.photos': photos.removeAt(this.data.publish.photos, e.currentTarget.dataset.index) })
  },

  publishTask() {
    if (this.data.submitting) return
    const form = this.data.publish
    if (!String(form.title || '').trim() || !String(form.content || '').trim()) {
      wx.showToast({ title: '请填标题和内容', icon: 'none' })
      return
    }
    if (form.scope === 'weekly' && !form.weekdays.length) {
      wx.showToast({ title: '请选择执行的星期', icon: 'none' })
      return
    }
    const maxParticipants = Number(form.maxParticipants)
    if (form.allowMultiple && (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 50)) {
      wx.showToast({ title: '人数上限填 2–50', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    photos.uploadMany(form.photos, 'task')
      .then((photoFileIds) => api.call('adminPublishWorkTask', {
        siteId: form.siteId, scope: form.scope, weekdays: form.weekdays,
        allowMultiple: form.allowMultiple, maxParticipants,
        deadlineDateKey: form.deadlineDateKey,
        title: form.title, content: form.content, photoFileIds,
      }))
      .then(() => {
        this.setData({ submitting: false })
        wx.showToast({ title: '已发布', icon: 'success' })
        wx.switchTab({ url: '/pages/duty/list/list' })
      })
      .catch((err) => {
        this.setData({ submitting: false })
        wx.showToast({ title: photos.failText(err), icon: 'none' })
      })
  },
})
