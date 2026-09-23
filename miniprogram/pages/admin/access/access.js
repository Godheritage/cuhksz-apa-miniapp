const api = require('../../../services/api')
const { accessStatusText } = require('../../../utils/format')

Page({
  data: { requests: [] },
  onShow() {
    getApp().ensureAdmin().then(() => this.reload()).catch(() => {})
  },
  reload() {
    api.call('adminListAccessRequests')
      .then((data) => {
        this.setData({
          requests: (data.requests || []).map((r) => ({
            ...r,
            statusText: accessStatusText(r.status),
          })),
        })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  decide(e) {
    api.call('adminDecideAccess', {
      requestId: e.currentTarget.dataset.id,
      decision: e.currentTarget.dataset.decision,
    })
      .then(() => {
        wx.showToast({ title: e.currentTarget.dataset.decision === 'approved' ? '已通过并生成当天密码' : '已拒绝', icon: 'none' })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})
