const api = require('../../services/api')
const auth = require('../../behaviors/auth')

const TABS = [
  { id: 'duty', name: '示例寄养点执勤' },
  { id: 'feed', name: '投喂' },
]

function groupLines(rows, lineOf) {
  const map = {}
  ;(rows || []).forEach((row) => {
    const key = row.dateKey || row.kind || '其他'
    if (!map[key]) map[key] = { title: key, lines: [] }
    map[key].lines.push(lineOf(row))
  })
  return Object.keys(map).sort().map((key) => map[key])
}

function joinNames(row) {
  const names = (row.names || []).join('、')
  return row.note ? names + '（' + row.note + '）' : names
}

Page({
  behaviors: [auth],
  data: {
    ready: false,
    imported: false,
    isAdmin: false,
    label: '',
    feedRule: '',
    tabs: TABS,
    tab: 'duty',
    groups: [],
    importing: false,
  },

  onShow() {
    this.bindApprovedUser(() => this.reload())
  },

  reload() {
    return api.call('listRoster')
      .then((data) => {
        this.pack = data.roster || null
        this.setData({
          ready: true,
          imported: !!data.imported,
          isAdmin: !!data.isAdmin,
          label: data.roster ? data.roster.label : '排班表',
          feedRule: data.roster ? data.roster.feedRule : '',
        })
        this.renderTab(this.data.tab)
      })
      .catch((err) => {
        if (err.message !== 'UNAPPROVED') wx.showToast({ title: err.message, icon: 'none' })
      })
  },

  renderTab(tab) {
    const roster = this.pack
    if (!roster) {
      this.setData({ tab, groups: [] })
      return
    }
    const groups = tab === 'feed'
      ? groupLines(roster.feed, (row) => row.slot + ' · ' + row.place + ' · ' + joinNames(row))
      : groupLines(roster.duty, (row) => row.shift + ' · ' + joinNames(row))
    this.setData({ tab, groups })
  },

  pickTab(e) {
    this.renderTab(e.currentTarget.dataset.id)
  },

  importRoster() {
    if (this.data.importing) return
    this.setData({ importing: true })
    api.call('adminImportRoster')
      .then(() => {
        wx.showToast({ title: '已导入', icon: 'success' })
        return this.reload()
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
      .then(() => this.setData({ importing: false }))
  },
})
