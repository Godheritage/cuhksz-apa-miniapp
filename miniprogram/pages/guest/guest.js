const share = require('../../utils/share.js')
const api = require('../../services/api')
const config = require('../../config')

const COPY = {
  guest: {
    title: '申请加入',
    desc: '先填显示名称提交一次。通过之前看不到任务、猫档、点位和任何内部信息。',
  },
  pending: {
    title: '已提交，等待审核',
    desc: '管理员会在成员审核里处理，通过后会自动进入。下方功能演示可直接体验示例数据。',
  },
  rejected: {
    title: '申请未通过',
    desc: '每个微信号只能申请一次。如有疑问请私下联系管理员。',
  },
}

Page({
  onShareAppMessage() {
    return share.appMessage()
  },

  onShareTimeline() {
    return share.timeline()
  },
  data: {
    useMock: config.useMock,
    user: { role: 'guest' },
    title: COPY.guest.title,
    desc: COPY.guest.desc,
    canApply: true,
    form: { displayName: '', applyNote: '' },
  },

  onShow() {
    this._guestVisible = true
    this.refreshIdentity()
    this.startIdentityPolling()
  },

  onHide() {
    this._guestVisible = false
    this.stopIdentityPolling()
  },

  onUnload() {
    this._guestVisible = false
    this.stopIdentityPolling()
  },

  refreshIdentity() {
    return getApp().getUser(true).then((user) => {
      this.applyUser(user)
      if (user && (user.role === 'member' || user.role === 'admin')) {
        getApp().routeByRole(user)
      }
    }).catch(() => {})
  },

  startIdentityPolling() {
    this.stopIdentityPolling()
    this._identityTimer = setInterval(() => {
      if (!this._guestVisible) return
      const role = this.data.user && this.data.user.role
      if (role !== 'pending' && role !== 'rejected') {
        this.stopIdentityPolling()
        return
      }
      this.refreshIdentity()
    }, 5000)
  },

  stopIdentityPolling() {
    if (this._identityTimer) clearInterval(this._identityTimer)
    this._identityTimer = null
  },

  applyUser(user) {
    const role = (user && user.role) || 'guest'
    const copy = COPY[role] || COPY.guest
    this.setData({
      user: user || { role: 'guest' },
      title: copy.title,
      desc: copy.desc,
      canApply: user ? !!user.canApply : true,
      form: {
        displayName: (user && user.displayName) || '',
        applyNote: (user && user.applyNote) || '',
      },
    })
  },

  onName(e) {
    this.setData({ 'form.displayName': e.detail.value })
  },

  onNote(e) {
    this.setData({ 'form.applyNote': e.detail.value })
  },

  submitApply() {
    api.call('applyJoin', this.data.form)
      .then((data) => {
        getApp().setUser(data.user)
        this.applyUser(data.user)
        this.startIdentityPolling()
        wx.showToast({ title: '已提交', icon: 'success' })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  goReview() { wx.navigateTo({ url: '/pages/review/review' }) },
})
