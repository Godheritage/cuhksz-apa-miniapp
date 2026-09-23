const api = require('../../services/api')
const config = require('../../config')

const COPY = {
  guest: {
    title: '申请加入',
    desc: '先填显示名称提交一次。通过之前看不到任务、猫档、点位和任何内部信息。',
  },
  pending: {
    title: '已提交，等待审核',
    desc: '管理员会在成员审核里处理。在此之前这里没有别的内容。',
  },
  rejected: {
    title: '申请未通过',
    desc: '每个微信号只能申请一次。如有疑问请私下联系管理员。',
  },
}

Page({
  data: {
    useMock: config.useMock,
    user: { role: 'guest' },
    title: COPY.guest.title,
    desc: COPY.guest.desc,
    canApply: true,
    form: { displayName: '', applyNote: '' },
  },

  onShow() {
    getApp().getUser().then((user) => {
      this.applyUser(user)
      if (user && (user.role === 'member' || user.role === 'admin')) {
        getApp().routeByRole(user)
      }
    })
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
        wx.showToast({ title: '已提交', icon: 'success' })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})
