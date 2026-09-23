const api = require('../../services/api')
const auth = require('../../behaviors/auth')
const photos = require('../../utils/photos')

function money(n) {
  const v = Number(n || 0)
  return (v >= 0 ? '' : '-') + '¥' + Math.abs(v).toFixed(2)
}

Page({
  behaviors: [auth],
  data: {
    ready: false,
    isAdmin: false,
    orgBalance: null,
    donations: [],
    form: { name: '', quantity: '', donorName: '', electronic: false, location: '', publishMove: false, toLocation: '', photos: [] },
  },
  onShow() {
    this.bindApprovedUser(() => this.reload())
  },
  reload() {
    return api.call('listDonations')
      .then((data) => {
        const bal = data.orgBalance
        this.setData({
          ready: true,
          isAdmin: !!data.isAdmin,
          orgBalance: bal ? {
            balanceText: money(bal.balance),
            incomeText: money(bal.income),
            expenseText: money(bal.expense),
          } : null,
          donations: (data.donations || []).map((d) => ({
            ...d,
            moveTo: d.moveTo || '',
            movePhotos: d.movePhotos || [],
          })),
        })
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  onField(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  toggleElec() {
    const electronic = !this.data.form.electronic
    this.setData({
      'form.electronic': electronic,
      'form.publishMove': electronic ? false : this.data.form.publishMove,
    })
  },
  toggleMove() { this.setData({ 'form.publishMove': !this.data.form.publishMove }) },
  chooseFormPhoto() {
    photos.pick(this.data.form.photos, 6).then((next) => this.setData({ 'form.photos': next }))
  },
  removeFormPhoto(e) {
    this.setData({ 'form.photos': photos.removeAt(this.data.form.photos, e.currentTarget.dataset.index) })
  },
  submit() {
    const form = this.data.form
    const upload = form.publishMove && !form.electronic ? photos.uploadMany(form.photos, 'move') : Promise.resolve([])
    upload
      .then((photoFileIds) => api.call('submitDonation', {
        name: form.name,
        quantity: form.quantity,
        donorName: form.donorName,
        electronic: form.electronic,
        location: form.location,
        publishMove: !!form.publishMove && !form.electronic,
        toLocation: form.toLocation,
        photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: form.publishMove && !form.electronic ? '已登记并发布搬运' : '已登记', icon: 'success' })
        this.setData({ form: { name: '', quantity: '', donorName: '', electronic: false, location: '', publishMove: false, toLocation: '', photos: [] } })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  setStatus(e) {
    api.call('adminSetDonationStatus', {
      donationId: e.currentTarget.dataset.id,
      status: e.currentTarget.dataset.status,
    }).then(() => this.reload()).catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  onItemMoveTo(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      donations: this.data.donations.map((d) => (d._id === id ? { ...d, moveTo: e.detail.value } : d)),
    })
  },
  chooseItemPhoto(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.donations.find((d) => d._id === id)
    if (!row) return
    photos.pick(row.movePhotos || [], 6).then((next) => {
      this.setData({
        donations: this.data.donations.map((d) => (d._id === id ? { ...d, movePhotos: next } : d)),
      })
    })
  },
  publishMove(e) {
    const id = e.currentTarget.dataset.id
    const row = this.data.donations.find((d) => d._id === id)
    if (!row || !row.moveTo) {
      wx.showToast({ title: '先填写运到哪里', icon: 'none' })
      return
    }
    photos.uploadMany(row.movePhotos || [], 'move')
      .then((photoFileIds) => api.call('adminPublishMoveTask', {
        donationId: id,
        toLocation: row.moveTo,
        photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: '已发到任务看板', icon: 'success' })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
})
