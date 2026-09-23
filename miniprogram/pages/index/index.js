Page({
  data: {
    slow: false,
    error: '',
  },

  onReady() {
    this.enter()
  },

  onUnload() {
    clearTimeout(this.slowTimer)
    clearTimeout(this.jumpTimer)
  },

  enter() {
    const app = getApp()
    this.setData({ slow: false, error: '' })
    clearTimeout(this.slowTimer)
    this.slowTimer = setTimeout(() => this.setData({ slow: true }), 2500)
    app.getUser().then((user) => {
      clearTimeout(this.slowTimer)
      this.go(user)
    }).catch(() => {
      clearTimeout(this.slowTimer)
      this.setData({ slow: true, error: '暂时无法确认身份，请检查网络后重试。' })
    })
  },

  go(user) {
    const role = (user && user.role) || 'guest'
    if (role !== 'member' && role !== 'admin') {
      wx.reLaunch({ url: '/pages/guest/guest', fail: () => this.setData({ slow: true, error: '页面打开失败，请重试。' }) })
      return
    }
    clearTimeout(this.jumpTimer)
    this.jumpTimer = setTimeout(() => {
      wx.switchTab({
        url: '/pages/routine-duty/routine-duty',
        fail: () => this.setData({ slow: true }),
      })
    }, 200)
  },

  retry() {
    this.enter()
  },
})
