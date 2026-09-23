const api = require('../../../services/api')

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

Page({
  data: {
    records: [],
    form: { workerName: '', dateKey: todayKey(), title: '', pf: '' },
    pfDrafts: {},
  },

  onShow() {
    getApp().ensureAdmin().then(() => this.reload()).catch(() => {})
  },

  reload() {
    return api.call('adminListWorkload').then((data) => {
      this.setData({ records: data.records || [] })
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  onForm(e) {
    this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value })
  },

  onDate(e) {
    this.setData({ 'form.dateKey': e.detail.value })
  },

  addRecord() {
    api.call('adminAddWorkRecord', this.data.form).then(() => {
      wx.showToast({ title: '已记录', icon: 'success' })
      this.setData({ form: { workerName: '', dateKey: todayKey(), title: '', pf: '' } })
      return this.reload()
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  onPf(e) {
    const drafts = Object.assign({}, this.data.pfDrafts)
    drafts[e.currentTarget.dataset.key] = e.detail.value
    this.setData({ pfDrafts: drafts })
  },

  savePf(e) {
    const sourceKey = e.currentTarget.dataset.key
    const pf = this.data.pfDrafts[sourceKey]
    if (pf === undefined) return
    api.call('adminSetWorkPf', { sourceKey, pf }).then(() => {
      wx.showToast({ title: 'PF 已保存', icon: 'success' })
      return this.reload()
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})
