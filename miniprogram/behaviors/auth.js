module.exports = Behavior({
  methods: {
    bindApprovedUser(onOk) {
      const app = getApp()
      app.ensureApproved()
        .then((user) => {
          this.setData({ user })
          if (onOk) onOk(user)
        })
        .catch((err) => {
          if (err && err.message === 'UNAPPROVED') return
          wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
        })
    },
  },
})
