const api = require('../../../services/api')
const { assetCategoryText } = require('../../../utils/format')
const photos = require('../../../utils/photos')

const ASSET_TYPES = [
  { id: 'bowl', name: '食盆' },
  { id: 'feeder', name: '喂食机' },
  { id: 'medicine', name: '药箱' },
  { id: 'water', name: '饮水机' },
  { id: 'cage', name: '笼子' },
  { id: 'other', name: '其他' },
]

function emptyForm() {
  return {
    siteId: '', name: '', publicDesc: '', address: '', lockNote: '',
    type: '', sort: 99, confidential: false,
  }
}
function emptyAsset() {
  return { assetId: '', name: '', category: 'bowl', quantity: 1, note: '', photos: [] }
}

Page({
  data: {
    assetTypes: ASSET_TYPES,
    sites: [],
    form: emptyForm(),
    assetForm: emptyAsset(),
    assetSiteId: '',
  },

  onShow() {
    getApp().ensureAdmin().then(() => this.reload()).catch(() => {})
  },

  reload() {
    api.call('adminListSites')
      .then((data) => {
        this.setData({
          sites: (data.sites || []).map((site) => ({
            ...site,
            newCage: '',
            newCagePhotos: [],
            assets: (site.assets || []).map((a) => ({
              ...a,
              categoryText: assetCategoryText(a.category),
              occupyText: a.occupiedBy || '未占用',
            })),
          })),
        })
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  onField(e) { this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  toggleConfidential() { this.setData({ 'form.confidential': !this.data.form.confidential }) },

  editSite(e) {
    const site = this.data.sites.find((s) => s._id === e.currentTarget.dataset.id)
    if (!site) return
    this.setData({
      form: {
        siteId: site._id,
        name: site.name,
        publicDesc: site.publicDesc,
        address: site.address,
        lockNote: site.lockNote,
        type: site.type,
        sort: site.sort,
        confidential: !!site.confidential,
      },
    })
  },

  resetForm() { this.setData({ form: emptyForm() }) },

  saveSite() {
    api.call('adminUpsertSite', this.data.form)
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' })
        this.resetForm()
        this.reload()
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  deleteSite(e) {
    const site = this.data.sites.find((s) => s._id === e.currentTarget.dataset.id)
    if (!site) return
    wx.showModal({
      title: '删除执勤点',
      content: `将同时删除「${site.name}」的笼子和固定资产。若还有猫挂在该点会失败，请先转移。确定删除？`,
      success: (res) => {
        if (!res.confirm) return
        api.call('adminDeleteSite', { siteId: site._id })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.reload()
          })
          .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
      },
    })
  },

  onNewCage(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      sites: this.data.sites.map((site) => (site._id === id ? { ...site, newCage: e.detail.value } : site)),
    })
  },

  chooseCagePhoto(e) {
    const id = e.currentTarget.dataset.id
    const site = this.data.sites.find((s) => s._id === id)
    if (!site) return
    photos.pick(site.newCagePhotos || [], 6).then((next) => {
      this.setData({
        sites: this.data.sites.map((s) => (s._id === id ? { ...s, newCagePhotos: next } : s)),
      })
    })
  },

  addCage(e) {
    const site = this.data.sites.find((s) => s._id === e.currentTarget.dataset.id)
    if (!site || !site.newCage) {
      wx.showToast({ title: '请填写笼号', icon: 'none' })
      return
    }
    photos.uploadMany(site.newCagePhotos || [], 'cage')
      .then((photoFileIds) => api.call('adminUpsertCage', { siteId: site._id, code: site.newCage, photoFileIds }))
      .then(() => { wx.showToast({ title: '已加笼', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  deleteCage(e) {
    wx.showModal({
      title: '删除笼子',
      content: '有猫占用时无法删除。',
      success: (res) => {
        if (!res.confirm) return
        api.call('adminDeleteCage', { cageId: e.currentTarget.dataset.id })
          .then(() => this.reload())
          .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
      },
    })
  },

  startAsset(e) {
    this.setData({ assetSiteId: e.currentTarget.dataset.id, assetForm: emptyAsset() })
  },

  editAsset(e) {
    const site = this.data.sites.find((s) => s._id === e.currentTarget.dataset.siteId)
    const asset = site && (site.assets || []).find((a) => a._id === e.currentTarget.dataset.id)
    if (!asset) return
    this.setData({
      assetSiteId: site._id,
      assetForm: {
        assetId: asset._id,
        name: asset.name,
        category: asset.category,
        quantity: asset.quantity,
        note: asset.note || '',
        photos: asset.photoFileIds || [],
      },
    })
  },

  onAssetField(e) { this.setData({ [`assetForm.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  pickAssetCat(e) { this.setData({ 'assetForm.category': e.currentTarget.dataset.id }) },

  chooseAssetPhoto() {
    photos.pick(this.data.assetForm.photos, 6).then((next) => this.setData({ 'assetForm.photos': next }))
  },
  removeAssetPhoto(e) {
    this.setData({ 'assetForm.photos': photos.removeAt(this.data.assetForm.photos, e.currentTarget.dataset.index) })
  },

  saveAsset() {
    if (!this.data.assetSiteId) {
      wx.showToast({ title: '请先点「添加固定资产」', icon: 'none' })
      return
    }
    photos.uploadMany(this.data.assetForm.photos, 'asset')
      .then((photoFileIds) => api.call('adminUpsertAsset', {
        siteId: this.data.assetSiteId,
        ...this.data.assetForm,
        photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: '资产已保存', icon: 'success' })
        this.setData({ assetForm: emptyAsset(), assetSiteId: '' })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  deleteAsset(e) {
    wx.showModal({
      title: '删除固定资产',
      content: '有猫占用时无法删除。',
      success: (res) => {
        if (!res.confirm) return
        api.call('adminDeleteAsset', { assetId: e.currentTarget.dataset.id })
          .then(() => this.reload())
          .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
      },
    })
  },
})
