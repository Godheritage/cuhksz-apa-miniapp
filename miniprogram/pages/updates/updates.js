const changelog = require('../../data/changelog')

function whoText(item) {
  const names = (item.requesters || []).filter(Boolean)
  if (!names.length) return ''
  return `基于 ${names.join('、')} 的需求`
}

Page({
  data: {
    items: [],
  },

  onShow() {
    getApp().ensureApproved().catch(() => {})
    const items = (changelog.items || []).map((item) => ({
      ...item,
      whoText: whoText(item),
    }))
    this.setData({ items })
  },
})
