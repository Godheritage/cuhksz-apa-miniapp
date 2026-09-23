const api = require('../../../services/api')
const { roleText } = require('../../../utils/format')

Page({
  data: { users: [] },

  onShow() {
    getApp().ensureAdmin()
      .then(() => this.reload())
      .catch(() => {})
  },

  reload() {
    api.call('adminListUsers')
      .then((data) => {
        this.setData({
          users: (data.users || []).map((item) => ({
            ...item,
            roleText: roleText(item.role),
          })),
        })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  setRole(e) {
    const { id, role } = e.currentTarget.dataset
    api.call('adminSetRole', { userId: id, role })
      .then(() => {
        wx.showToast({ title: '已更新', icon: 'success' })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})
