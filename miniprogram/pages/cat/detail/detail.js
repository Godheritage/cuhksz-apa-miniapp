const share = require('../../../utils/share.js')
const photos = require('../../../utils/photos')
const api = require('../../../services/api')
const confirm = require('../../../utils/confirm')
const auth = require('../../../behaviors/auth')
const { readDraft, writeDraft, clearDraft, createDraftKey } = require('../../../utils/drafts')
const {
  formatTime, statusText, statusPill, campusText, campusPill,
  genderText, healthText, dietText, siteDietText, todayKey, adoptStatusText,
} = require('../../../utils/format')

const ADOPT_STATUS_OPTIONS = [
  { id: 'contacting', name: '沟通中' },
  { id: 'visiting', name: '待见面' },
  { id: 'approved', name: '已通过' },
  { id: 'rejected', name: '未通过' },
]

function emptyAdopt() {
  return { candidateId: '', name: '', status: 'contacting', note: '', photos: [] }
}

function emptyDiet() {
  return { logId: '', dateKey: '', ate: true, drank: true, note: '', photos: [] }
}

function uniqueAssetIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String))]
}

function assetIdsFrom(value) {
  if (value && Array.isArray(value.assetIds)) return uniqueAssetIds(value.assetIds)
  if (value && value.assetId) return uniqueAssetIds([value.assetId])
  return []
}

function markAssetOptions(options, selectedIds) {
  const selected = new Set(selectedIds)
  return (options || []).map((item) => ({
    ...item,
    selected: selected.has(String(item._id)),
  }))
}

function moveWithAssets(move, fallback) {
  const next = { ...(fallback || {}), ...(move || {}) }
  const assetIds = assetIdsFrom(move || fallback)
  return { ...next, assetIds, assetId: assetIds[0] || '' }
}

function assetRows(data) {
  if (data && Array.isArray(data.assets)) return data.assets
  return data && data.asset ? [data.asset] : []
}

const STATUS_OPTIONS = [
  { id: 'in_care', name: '在养' },
  { id: 'medical', name: '就医' },
  { id: 'pending_release', name: '待放' },
  { id: 'observe', name: '观察' },
]
const CAMPUS_OPTIONS = [
  { id: 'on_campus', name: '在校' },
  { id: 'medical', name: '就医' },
  { id: 'off_campus', name: '离校' },
]
const GENDER_OPTIONS = [
  { id: 'male', name: '公' },
  { id: 'female', name: '母' },
  { id: 'unknown', name: '未知' },
]
const HEALTH_OPTIONS = [
  { id: 'healthy', name: '健康' },
  { id: 'under_weather', name: '不适' },
  { id: 'recovering', name: '恢复中' },
  { id: 'unknown', name: '未知' },
]

Page({
  onShareAppMessage() {
    return share.appMessage()
  },

  onShareTimeline() {
    return share.timeline()
  },
  behaviors: [auth],
  data: {
    ready: false,
    user: null,
    cat: {},
    siteName: '',
    occupancyLabel: '',
    housingLabel: '',
    canUpdateLocation: false,
    canEditProfile: false,
    canEditDiet: false,
    siteOptions: [],
    cageOptions: [],
    assetOptions: [],
    statusOptions: STATUS_OPTIONS,
    campusOptions: CAMPUS_OPTIONS,
    genderOptions: GENDER_OPTIONS,
    healthOptions: HEALTH_OPTIONS,
    recentDuty: [],
    plans: [],
    edit: { name: '', notes: '', ageText: '', breed: '', gender: 'unknown', healthStatus: 'unknown', campusStatus: 'on_campus', photos: [] },
    move: { siteId: '', cageId: '', assetIds: [], assetId: '', status: 'in_care', photos: [] },
    diet: emptyDiet(),
    savingDiet: false,
    dietLabel: '',
    feedLogs: [],
    canManageAdopt: false,
    adoptCandidates: [],
    adoptStatusOptions: ADOPT_STATUS_OPTIONS,
    adoptForm: emptyAdopt(),
    canManageHospital: false,
    hospitalStay: null,
    hosp: { hospitalName: '', reason: '', contactName: '', contactPhone: '', insurancePayer: '', insuranceNote: '' },
    planForm: { title: '术后特护', itemsText: '喂药,换纱布', startDateKey: '', endDateKey: '', tutorialText: '' },
  },

  onLoad(query) {
    this.catId = query.id
    this.draftKey = createDraftKey(`apa_draft_cat_${query.id}`)
    this.bindApprovedUser(() => this.reload())
  },

  persistDraft() {
    if (!this.draftKey) return
    writeDraft(this.draftKey, {
      edit: this.data.edit,
      move: this.data.move,
      diet: this.data.diet,
      hosp: this.data.hosp,
      planForm: this.data.planForm,
    })
  },

  onHide() {
    this.persistDraft()
  },

  clearCatDraft() {
    if (this.draftKey) clearDraft(this.draftKey)
  },

  reload(opts) {
    return Promise.all([
      api.call('getCatDetail', { catId: this.catId }),
      api.call('listCarePlans', { catId: this.catId }).catch(() => ({ plans: [] })),
    ]).then(([data, planData]) => {
      const cat = data.cat
      const assetIds = assetIdsFrom(cat)
      const occupancyAssets = assetRows(data)
      this.setData({
        ready: true,
        cat,
        siteName: (data.site && data.site.name) || '未挂执勤点',
        occupancyLabel: [data.cage ? `笼 ${data.cage.code}` : '', occupancyAssets.map((asset) => asset.name).join('、')].filter(Boolean).join(' · ') || '未占用资源',
        housingLabel: cat.housingLabel || '',
        campusLabel: campusText(cat.campusStatus),
        campusClass: campusPill(cat.campusStatus),
        statusLabel: statusText(cat.status),
        statusClass: statusPill(cat.status),
        genderLabel: genderText(cat.gender),
        healthLabel: healthText(cat.healthStatus),
        canUpdateLocation: data.canUpdateLocation,
        canEditProfile: data.canEditProfile,
        canEditDiet: data.canEditDiet,
        canManageAdopt: !!data.canManageAdopt,
        adoptCandidates: (data.adoptCandidates || []).map((row) => ({
          ...row,
          photoFileIds: row.photoFileIds || [],
          statusText: adoptStatusText(row.status),
        })),
        canManageHospital: !!data.canManageHospital,
        hospitalStay: cat.hospitalStay || null,
        hosp: {
          hospitalName: (cat.hospitalStay && cat.hospitalStay.hospitalName) || '',
          reason: (cat.hospitalStay && cat.hospitalStay.reason) || '',
          contactName: (cat.hospitalStay && cat.hospitalStay.contactName) || '',
          contactPhone: (cat.hospitalStay && cat.hospitalStay.contactPhone) || '',
          insurancePayer: (cat.hospitalStay && cat.hospitalStay.insurancePayer) || '',
          insuranceNote: (cat.hospitalStay && cat.hospitalStay.insuranceNote) || '',
        },
        siteOptions: data.siteOptions || [],
        cageOptions: data.cageOptions || [],
        assetOptions: markAssetOptions(data.assetOptions, assetIds),
        recentDuty: (data.recentDuty || []).map((item) => ({
          ...item,
          timeText: formatTime(item.arrivedAt),
          sourceText: item.sourceText || '已到岗',
        })),
        plans: planData.plans || [],
        feedLogs: (data.feedLogs || []).map((log) => ({
          ...log,
          timeText: formatTime(log.at),
          photoFileIds: log.photoFileIds || [],
        })),
        dietLabel: cat.healthStatus === 'healthy' && cat.campusStatus === 'on_campus' && !cat.needsIndividualCare
          ? siteDietText(cat.siteFeedToday, (data.site && data.site.name) || '')
          : dietText(cat.lastDiet, todayKey(), cat.careTimesToday),
        siteDietLabel: cat.siteId ? siteDietText(cat.siteFeedToday, (data.site && data.site.name) || '') : '',
        observationText: cat.lastObservation
          ? `${formatTime(cat.lastObservation.at)} · ${cat.lastObservation.locationText || '位置待核对'} · ${cat.lastObservation.note}`
          : '',
        edit: {
          name: cat.name,
          notes: cat.notes || '',
          ageText: cat.ageText || '',
          breed: cat.breed || '',
          gender: cat.gender || 'unknown',
          healthStatus: cat.healthStatus || 'unknown',
          campusStatus: cat.campusStatus || 'on_campus',
          photos: cat.photoFileIds || [],
        },
        move: {
          siteId: cat.siteId || '',
          cageId: cat.cageId || '',
          assetIds,
          assetId: assetIds[0] || '',
          status: cat.status,
          photos: (data.cage && data.cage.photoFileIds) || (occupancyAssets[0] && occupancyAssets[0].photoFileIds) || [],
        },
        diet: emptyDiet(),
        planForm: {
          title: '术后特护',
          itemsText: '喂药,换纱布',
          startDateKey: todayKey(),
          endDateKey: todayKey(),
          tutorialText: '',
        },
      })
      const draft = readDraft(this.draftKey)
      if (draft) {
        const draftAssetIds = draft.move ? assetIdsFrom(draft.move) : this.data.move.assetIds
        const nextMove = draft.move ? moveWithAssets(draft.move, this.data.move) : this.data.move
        this.setData({
          edit: draft.edit || this.data.edit,
          move: nextMove,
          assetOptions: markAssetOptions(this.data.assetOptions, draftAssetIds),
          diet: draft.diet && (!draft.diet.logId || this.data.feedLogs.some((log) => log._id === draft.diet.logId && log.canEdit))
            ? draft.diet : this.data.diet,
          hosp: draft.hosp || this.data.hosp,
          planForm: draft.planForm || this.data.planForm,
        })
      }
    }).catch((err) => {
      if (opts && opts.silent) return
      wx.showToast({ title: err.message, icon: 'none' })
    })
  },

  onEdit(e) { this.setData({ [`edit.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  onDietNote(e) { this.setData({ 'diet.note': e.detail.value }) },
  onHosp(e) { this.setData({ [`hosp.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  onPlan(e) { this.setData({ [`planForm.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  pickEdit(e) { this.setData({ [`edit.${e.currentTarget.dataset.field}`]: e.currentTarget.dataset.id }) },
  pickMoveStatus(e) { this.setData({ 'move.status': e.currentTarget.dataset.id }) },
  pickCage(e) { this.setData({ 'move.cageId': e.currentTarget.dataset.id || '' }) },
  pickAsset(e) {
    const assetId = String(e.currentTarget.dataset.id || '')
    const current = assetIdsFrom(this.data.move)
    const assetIds = assetId
      ? (current.includes(assetId) ? current.filter((id) => id !== assetId) : current.concat(assetId))
      : []
    this.setData({
      'move.assetIds': assetIds,
      'move.assetId': assetIds[0] || '',
      assetOptions: markAssetOptions(this.data.assetOptions, assetIds),
    })
  },
  toggleDiet(e) { this.setData({ [`diet.${e.currentTarget.dataset.key}`]: !this.data.diet[e.currentTarget.dataset.key] }) },
  onAdopt(e) { this.setData({ [`adoptForm.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  pickAdoptStatus(e) { this.setData({ 'adoptForm.status': e.currentTarget.dataset.id }) },
  chooseAdoptPhoto() {
    photos.pick(this.data.adoptForm.photos, 6).then((next) => this.setData({ 'adoptForm.photos': next }))
  },
  removeAdoptPhoto(e) {
    this.setData({ 'adoptForm.photos': photos.removeAt(this.data.adoptForm.photos, e.currentTarget.dataset.index) })
  },
  toggleSeeking() {
    const next = !this.data.cat.seekingAdopt
    api.call('adminSetSeekingAdopt', { catId: this.catId, seekingAdopt: next })
      .then(() => {
        wx.showToast({ title: next ? '已设为找领养' : '已关掉找领养', icon: 'success' })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },
  editCandidate(e) {
    const row = (this.data.adoptCandidates || []).find((c) => c._id === e.currentTarget.dataset.id)
    if (!row) return
    this.setData({
      adoptForm: {
        candidateId: row._id,
        name: row.name,
        status: row.status || 'contacting',
        note: row.note || '',
        photos: row.photoFileIds || [],
      },
    })
  },
  deleteCandidate(e) {
    confirm({
      title: '删除候选领养人',
      content: '确定删掉这条？',
      success: (res) => {
        if (!res.confirm) return
        api.call('adminDeleteAdoptCandidate', { candidateId: e.currentTarget.dataset.id })
          .then(() => { wx.showToast({ title: '已删除', icon: 'success' }); this.reload() })
          .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
      },
    })
  },
  saveCandidate() {
    photos.uploadMany(this.data.adoptForm.photos, 'adopt')
      .then((photoFileIds) => api.call('adminUpsertAdoptCandidate', {
        catId: this.catId,
        candidateId: this.data.adoptForm.candidateId,
        name: this.data.adoptForm.name,
        status: this.data.adoptForm.status,
        note: this.data.adoptForm.note,
        photoFileIds,
      }))
      .then(() => {
        wx.showToast({ title: '候选已保存', icon: 'success' })
        this.setData({ adoptForm: emptyAdopt() })
        this.reload()
      })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  pickMoveSite(e) {
    const siteId = e.currentTarget.dataset.id || ''
    const requestId = (this._assetRequestId || 0) + 1
    this._assetRequestId = requestId
    this.setData({
      'move.siteId': siteId,
      'move.cageId': '',
      'move.assetIds': [],
      'move.assetId': '',
      cageOptions: [],
      assetOptions: [],
    })
    if (!siteId) return
    Promise.all([
      api.call('listCages', { siteId }),
      api.call('listAssets', { siteId }),
    ]).then(([c, a]) => {
      if (requestId !== this._assetRequestId || this.data.move.siteId !== siteId) return
      this.setData({
        cageOptions: c.cages || [],
        assetOptions: markAssetOptions(a.assets || [], []),
      })
    })
      .catch((err) => {
        if (requestId !== this._assetRequestId) return
        wx.showToast({ title: err.message, icon: 'none' })
      })
  },

  chooseCatPhoto() {
    photos.pick(this.data.edit.photos, 6).then((next) => this.setData({ 'edit.photos': next }))
  },
  removeCatPhoto(e) {
    this.setData({ 'edit.photos': photos.removeAt(this.data.edit.photos, e.currentTarget.dataset.index) })
  },
  chooseOccupancyPhoto() {
    photos.pick(this.data.move.photos, 6).then((next) => this.setData({ 'move.photos': next }))
  },
  removeOccupancyPhoto(e) {
    this.setData({ 'move.photos': photos.removeAt(this.data.move.photos, e.currentTarget.dataset.index) })
  },

  saveProfile() {
    photos.uploadMany(this.data.edit.photos, 'cat')
      .then((photoFileIds) => api.call('updateCatProfile', { catId: this.catId, ...this.data.edit, photoFileIds }))
      .then(() => { this.clearCatDraft(); wx.showToast({ title: '档案已保存', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  toggleSpecialCare(e) {
    api.call('adminSetCatSpecialCare', { catId: this.catId, enabled: !!e.detail.value })
      .then(() => this.reload())
      .catch((err) => {
        wx.showToast({ title: photos.failText(err), icon: 'none' })
        this.reload()
      })
  },

  toggleProvisional(e) {
    api.call('adminSetCatProvisional', { catId: this.catId, provisional: !!e.detail.value })
      .then(() => this.reload())
      .catch((err) => {
        wx.showToast({ title: photos.failText(err), icon: 'none' })
        this.reload()
      })
  },

  saveLocation() {
    const move = moveWithAssets(this.data.move)
    photos.uploadMany(move.photos, 'occupancy')
      .then((photoFileIds) => api.call('updateCatLocation', {
        catId: this.catId,
        ...move,
        assetIds: move.assetIds,
        assetId: move.assetId,
        photoFileIds,
      }))
      .then(() => { this.clearCatDraft(); wx.showToast({ title: '位置已更新', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  chooseDietPhoto() {
    photos.pick(this.data.diet.photos, 6)
      .then((next) => this.setData({ 'diet.photos': next }))
      .catch((err) => wx.showToast({ title: photos.failText(err), icon: 'none' }))
  },

  removeDietPhoto(e) {
    const photos = (this.data.diet.photos || []).slice()
    photos.splice(e.currentTarget.dataset.index, 1)
    this.setData({ 'diet.photos': photos })
  },

  preview(e) {
    const urls = e.currentTarget.dataset.urls || []
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },

  saveDiet() {
    if (this.data.savingDiet) return
    const diet = { ...this.data.diet, photos: (this.data.diet.photos || []).slice() }
    this.setData({ savingDiet: true })
    photos.uploadMany(diet.photos, 'feed')
      .then((photoFileIds) => api.call(diet.logId ? 'updateFeedLog' : 'addFeedLog', {
        ...(diet.logId ? { logId: diet.logId } : { catId: this.catId }),
        fed: diet.ate,
        watered: diet.drank,
        ate: diet.ate,
        drank: diet.drank,
        note: diet.note,
        photoFileIds,
        ...(diet.logId ? {} : { byName: (this.data.user && this.data.user.displayName) || '' }),
      }))
      .then(() => {
        this.clearCatDraft()
        this.setData({ diet: emptyDiet() })
        wx.showToast({ title: diet.logId ? '已保存修改' : '已记下这次投喂', icon: 'success' })
        return this.reload({ silent: true })
      })
      .catch((err) => {
        const raw = err.message || '记录失败'
        const title = /502001|timeout|超时/i.test(raw) ? '保存超时，请再点一次' : raw
        wx.showToast({ title, icon: 'none' })
      })
      .then(() => this.setData({ savingDiet: false }))
  },

  editFeed(e) {
    if (this.data.savingDiet) return
    const log = this.data.feedLogs.find((row) => row._id === e.currentTarget.dataset.id)
    if (!log || !log.canEdit) return
    this.setData({ diet: {
      logId: log._id, dateKey: log.dateKey || '', ate: !!log.fed, drank: !!log.watered,
      note: log.note || '', photos: (log.photoFileIds || []).slice(),
    } }, () => this.scrollToFeedForm())
  },

  scrollToFeedForm() {
    const query = wx.createSelectorQuery()
    query.select('#cat-feed-form').boundingClientRect()
    query.selectViewport().scrollOffset()
    query.exec((rects) => {
      const rect = rects[0]
      const viewport = rects[1]
      if (rect && viewport) wx.pageScrollTo({ scrollTop: viewport.scrollTop + rect.top, duration: 250 })
    })
  },

  cancelDietEdit() {
    if (this.data.savingDiet) return
    this.setData({ diet: emptyDiet() })
    this.persistDraft()
  },

  deleteFeed(e) {
    if (this.data.savingDiet) return
    const logId = e.currentTarget.dataset.id
    confirm({
      title: '删除投喂记录',
      content: '删掉后次数会重算。确定删除？',
      success: (res) => {
        if (!res.confirm) return
        api.call('deleteFeedLog', { logId })
          .then(() => {
            if (this.data.diet.logId === logId) this.cancelDietEdit()
            wx.showToast({ title: '已删除', icon: 'success' })
            this.reload()
          })
          .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
      },
    })
  },

  markHospital() {
    api.call('markCatHospital', { catId: this.catId, ...this.data.hosp })
      .then(() => { this.clearCatDraft(); wx.showToast({ title: '就医信息已记下', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  returnHospital() {
    api.call('returnCatFromHospital', { catId: this.catId })
      .then(() => { this.clearCatDraft(); wx.showToast({ title: '已接回，档案仍在', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  savePlan() {
    const labels = String(this.data.planForm.itemsText || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    api.call('adminUpsertCarePlan', {
      catId: this.catId,
      title: this.data.planForm.title,
      items: labels.map((label, i) => ({ key: `item_${i + 1}`, label })),
      startDateKey: this.data.planForm.startDateKey,
      endDateKey: this.data.planForm.endDateKey,
      tutorialText: this.data.planForm.tutorialText,
    }).then(() => { this.clearCatDraft(); wx.showToast({ title: '特护已挂上', icon: 'success' }); this.reload() })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  disablePlan(e) {
    api.call('adminDisableCarePlan', { planId: e.currentTarget.dataset.id })
      .then(() => this.reload())
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },
})






