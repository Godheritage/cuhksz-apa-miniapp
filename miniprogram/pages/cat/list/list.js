const api = require('../../../services/api')
const auth = require('../../../behaviors/auth')
const { campusText, campusPill, dietText, siteDietText, todayKey, formatTime } = require('../../../utils/format')

const FILTERS = [
  { id: 'on_campus', name: '在校' },
  { id: 'medical', name: '就医' },
  { id: 'off_campus', name: '离校' },
  { id: 'all', name: '全部' },
]
const GENDERS = [
  { id: 'unknown', name: '待确认' },
  { id: 'female', name: '母' },
  { id: 'male', name: '公' },
]

Page({
  behaviors: [auth],
  data: {
    ready: false, cats: [], filters: FILTERS, campusStatus: 'on_campus', isAdmin: false,
    genders: GENDERS, siteOptions: [],
    showNewCatForm: false,
    newCat: { name: '', gender: 'unknown', siteId: '', provisional: false },
  },

  onShow() {
    this.bindApprovedUser((user) => {
      const isAdmin = !!(user && user.role === 'admin')
      const filters = isAdmin
        ? FILTERS.concat([{ id: 'seeking_adopt', name: '找领养' }])
        : FILTERS
      this.setData({ isAdmin, filters })
      this.reload()
      if (isAdmin) {
        api.call('listSites').then((data) => this.setData({ siteOptions: data.sites || [] }))
          .catch(() => {})
      }
    })
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  pickFilter(e) {
    this.setData({ campusStatus: e.currentTarget.dataset.id }, () => this.reload())
  },

  reload() {
    return api.call('listCats', { campusStatus: this.data.campusStatus })
      .then((data) => {
        this.setData({
          ready: true,
          cats: (data.cats || []).map((cat) => ({
            ...cat,
            photoFileIds: cat.photoFileIds || [],
            campusText: cat.seekingAdopt ? '找领养' : campusText(cat.campusStatus),
            campusClass: cat.seekingAdopt ? 'warn' : campusPill(cat.campusStatus),
            dietLabel: cat.healthStatus === 'healthy' && cat.campusStatus === 'on_campus' && !cat.needsIndividualCare
              ? siteDietText(cat.siteFeedToday, cat.siteName)
              : dietText(cat.lastDiet, todayKey(), cat.careTimesToday),
            observationText: cat.lastObservation
              ? `${formatTime(cat.lastObservation.at)} · ${cat.lastObservation.locationText || cat.lastObservation.note}`
              : '',
          })),
        })
      })
      .catch((err) => {
        if (err.message !== 'UNAPPROVED') wx.showToast({ title: err.message, icon: 'none' })
      })
  },

  openCat(e) {
    wx.navigateTo({ url: `/pages/cat/detail/detail?id=${e.currentTarget.dataset.id}` })
  },
  onNewCatName(e) { this.setData({ 'newCat.name': e.detail.value }) },
  toggleNewCatForm() { this.setData({ showNewCatForm: !this.data.showNewCatForm }) },
  pickNewCatGender(e) { this.setData({ 'newCat.gender': e.currentTarget.dataset.id }) },
  pickNewCatSite(e) { this.setData({ 'newCat.siteId': e.currentTarget.dataset.id || '' }) },
  toggleNewCatProvisional(e) { this.setData({ 'newCat.provisional': !!e.detail.value }) },
  addCat() {
    api.call('adminCreateCat', this.data.newCat).then((result) => {
      wx.showToast({ title: result.skipped ? '已有同名猫档' : '猫档已新增', icon: 'none' })
      this.setData({
        showNewCatForm: false,
        newCat: { name: '', gender: 'unknown', siteId: '', provisional: false },
      })
      return this.reload()
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})
