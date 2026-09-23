const api = require('../../../services/api')
const { saveCsv, writeLocal } = require('../../../utils/saveFile')

Page({
  data: { sheets: [] },

  onShow() {
    getApp().ensureAdmin().catch(() => {})
  },

  exportAll() {
    wx.showLoading({ title: '正在导出', mask: true })
    api.call('adminExportOrgCsv')
      .then((data) => {
        const files = data.files || []
        this.setData({
          sheets: files.map((f) => ({ title: f.title, rows: f.rows })),
        })
        files.forEach((file) => {
          try { writeLocal(file.name, file.csv) } catch (e) {}
        })
        return saveCsv(data.filename || '动保资料备份.csv', data.csv || '')
      })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已导出', icon: 'success' })
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '导出失败', icon: 'none' })
      })
  },
})
