const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { formatTime, taskStatusText, taskStatusPill } = require('../../../utils/format')
const photos = require('../../../utils/photos')

Page({
  behaviors: [auth],
  data: {
    ready: false,
    task: {},
    statusText: '',
    statusClass: '',
    submittedText: '',
    report: { description: '', workerName: '', photos: [] },
    submitting: false,
  },

  onLoad(query) {
    this.taskId = query.id
    this.bindApprovedUser((user) => {
      this.setData({
        'report.workerName': (user && user.displayName) || this.data.report.workerName,
      })
      this.reload()
    })
  },

  onShow() {
    if (this.taskId) this.reload()
  },

  claimTask() {
    api.call('claimWorkTask', { taskId: this.taskId })
      .then(() => this.reload())
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  releaseTask() {
    api.call('releaseWorkTask', { taskId: this.taskId })
      .then(() => this.reload())
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  reload() {
    return api.call('getWorkTask', { taskId: this.taskId })
      .then((data) => {
        const task = data.task || {}
        task.participants = (task.participants || []).map((item) => ({
          ...item,
          statusText: taskStatusText(item.status),
        }))
        this.setData({
          ready: true,
          task,
          statusText: task.allowMultiple ? '多人可做' : taskStatusText(task.status),
          statusClass: taskStatusPill(task.status),
          submittedText: task.report && task.report.submittedAt ? formatTime(task.report.submittedAt) : '',
        })
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  onReport(e) {
    this.setData({ [`report.${e.currentTarget.dataset.key}`]: e.detail.value })
  },

  choosePhoto() {
    photos.pick(this.data.report.photos, 6).then((next) => this.setData({ 'report.photos': next }))
  },
  removePhoto(e) {
    this.setData({ 'report.photos': photos.removeAt(this.data.report.photos, e.currentTarget.dataset.index) })
  },

  preview(e) {
    const urls = e.currentTarget.dataset.urls || []
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },

  submitTask() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    photos.uploadMany(this.data.report.photos, 'task')
      .then((photoFileIds) => api.call('submitWorkTask', {
        taskId: this.taskId,
        description: this.data.report.description,
        workerName: this.data.report.workerName,
        photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: '已交给管理员', icon: 'success' })
        this.setData({ report: { description: '', workerName: this.data.report.workerName, photos: [] } })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      .then(() => this.setData({ submitting: false }))
  },

  review(e) {
    api.call('adminReviewWorkTask', {
      taskId: this.taskId,
      approved: e.currentTarget.dataset.ok === '1',
    }).then(() => {
      wx.showToast({
        title: e.currentTarget.dataset.ok === '1' ? '已通过' : '已重新上架',
        icon: 'none',
      })
      this.reload()
    }).catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  reviewParticipant(e) {
    api.call('adminReviewWorkTask', {
      taskId: this.taskId,
      participantKey: e.currentTarget.dataset.key,
      approved: e.currentTarget.dataset.ok === '1',
    }).then(() => this.reload())
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  deleteTask() {
    wx.showModal({
      title: '删除任务',
      content: '删除后不能恢复。确定删掉这条任务？',
      success: (res) => {
        if (!res.confirm) return
        api.call('adminDeleteWorkTask', { taskId: this.taskId })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/duty/list/list' }) })
          })
          .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      },
    })
  },
})
