const review = require('../../review/session')

Component({
  data: { visible: false, role: 'member' },
  lifetimes: {
    attached() { this.refresh() },
  },
  pageLifetimes: {
    show() { this.refresh() },
  },
  methods: {
    refresh() {
      this.setData({ visible: review.isReviewMode(), role: review.getReviewRole() || 'member' })
    },
    switchRole() {
      try {
        review.switchReviewRole(this.data.role === 'admin' ? 'member' : 'admin')
        wx.reLaunch({ url: '/pages/index/index' })
      } catch (err) {
        wx.showToast({ title: err.message || '切换失败，请重试', icon: 'none' })
      }
    },
    exit() {
      review.exitReview()
      wx.reLaunch({ url: '/pages/index/index' })
    },
  },
})
