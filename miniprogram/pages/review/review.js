const share = require('../../utils/share.js')
const review = require('../../review/session')

Page({
  data: {
    account: 'APA_REVIEW',
    password: '',
    role: 'member',
    error: '',
    entering: false,
  },

  onShareAppMessage() { return share.appMessage() },
  onShareTimeline() { return share.timeline() },
  onAccount(e) { this.setData({ account: e.detail.value, error: '' }) },
  onPassword(e) { this.setData({ password: e.detail.value, error: '' }) },
  chooseRole(e) { this.setData({ role: e.currentTarget.dataset.role }) },

  enter() {
    if (this.data.entering) return
    this.setData({ entering: true, error: '' })
    try {
      review.enterReview({
        account: this.data.account.trim(),
        password: this.data.password,
        role: this.data.role,
      })
      this.setData({ password: '' })
      wx.reLaunch({
        url: '/pages/index/index',
        fail: () => this.setData({ entering: false, error: '页面打开失败，请重试。' }),
      })
    } catch (err) {
      this.setData({ entering: false, error: err.message || '演示账号或密码不正确。' })
    }
  },
})
