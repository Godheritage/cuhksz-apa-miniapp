const api = require('../../../services/api')
const { todayKey } = require('../../../utils/format')

const CATS = ['捐款', '买药', '猫粮', '交通', '其他']

Page({
  data: {
    entries: [],
    income: 0,
    expense: 0,
    balance: 0,
    form: { dateKey: '', type: 'expense', amount: '', category: '其他', remark: '', handlerName: '' },
    cats: CATS,
    csvText: '',
    hint: '导出：复制 CSV 或写入本地文件。导入：把 Excel 另存为 UTF-8 CSV，表头必须是 日期,收支,金额,科目,备注,经手人 。',
  },
  onShow() {
    getApp().ensureAdmin().then(() => {
      this.setData({ 'form.dateKey': todayKey() })
      this.reload()
    }).catch(() => {})
  },
  reload() {
    api.call('adminListFinance')
      .then((data) => {
        this.setData({
          entries: data.entries || [],
        income: Number(data.income || 0).toFixed(2),
        expense: Number(data.expense || 0).toFixed(2),
        balance: Number(data.balance || 0).toFixed(2),
        })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  onField(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  pickType(e) { this.setData({ 'form.type': e.currentTarget.dataset.id }) },
  pickCat(e) { this.setData({ 'form.category': e.currentTarget.dataset.id }) },
  save() {
    api.call('adminUpsertFinance', this.data.form)
      .then(() => { wx.showToast({ title: '已入账', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  remove(e) {
    api.call('adminDeleteFinance', { entryId: e.currentTarget.dataset.id })
      .then(() => this.reload())
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  exportCsv() {
    api.call('adminExportFinanceCsv')
      .then((data) => {
        const csv = data.csv || ''
        this.setData({ csvText: csv })
        wx.setClipboardData({
          data: csv,
          success: () => wx.showToast({ title: 'CSV 已复制', icon: 'none' }),
        })
        if (wx.env && wx.env.USER_DATA_PATH && wx.getFileSystemManager) {
          const path = `${wx.env.USER_DATA_PATH}/${data.filename || 'ledger.csv'}`
          try {
            wx.getFileSystemManager().writeFileSync(path, `\uFEFF${csv}`, 'utf8')
            if (wx.openDocument) wx.openDocument({ filePath: path, showMenu: true, fileType: 'csv' })
          } catch (e) {
            // 复制已成功即可
          }
        }
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  onCsv(e) { this.setData({ csvText: e.detail.value }) },
  importCsv() {
    api.call('adminImportFinanceCsv', { csv: this.data.csvText })
      .then((data) => {
        wx.showModal({
          title: '导入完成',
          content: `成功 ${data.imported || 0} 行。${(data.errors || []).join('；')}`,
          showCancel: false,
        })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})
