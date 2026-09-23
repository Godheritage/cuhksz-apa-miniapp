const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { formatTime, statusText, statusPill, assetCategoryText } = require('../../../utils/format')

Page({
  behaviors: [auth],
  data: { ready: false, site: {}, dateKey: '', onDuty: false, records: [], cages: [], assets: [], cats: [] },
  onLoad(query) {
    this.siteId = query.siteId
    this.bindApprovedUser(() => this.reload())
  },
  reload() {
    if (!this.siteId) return
    api.call('getTodayProgress', { siteId: this.siteId })
      .then((data) => {
        this.setData({
          ready: true,
          site: data.site,
          dateKey: data.dateKey,
          onDuty: data.onDuty,
          cages: data.cages || [],
          assets: (data.assets || []).map((a) => ({
            ...a,
            categoryText: assetCategoryText(a.category),
            occupyText: a.occupied ? `${a.occupiedCount}/${a.quantity} 占用` : `未占用（${a.quantity}）`,
          })),
          records: (data.records || []).map((item) => ({
            ...item,
            timeText: formatTime(item.arrivedAt),
            sourceText: item.sourceText || '已到岗',
          })),
          cats: (data.cats || []).map((cat) => ({
            ...cat,
            statusText: statusText(cat.status),
            statusClass: statusPill(cat.status),
          })),
        })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
  openCat(e) { wx.navigateTo({ url: `/pages/cat/detail/detail?id=${e.currentTarget.dataset.id}` }) },
})
