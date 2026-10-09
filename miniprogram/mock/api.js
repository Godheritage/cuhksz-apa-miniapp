const store = require('./store')
const attachOps = require('./ops')

const APPROVED = { member: true, admin: true }
const CAT_STATUS = { in_care: 1, medical: 1, pending_release: 1, observe: 1 }
const CAMPUS_STATUS = { on_campus: 1, off_campus: 1, medical: 1 }
const GENDERS = { male: 1, female: 1, unknown: 1 }
const HEALTH_STATUS = { healthy: 1, under_weather: 1, recovering: 1, unknown: 1 }
const ASSET_CATEGORIES = { bowl: 1, feeder: 1, medicine: 1, water: 1, cage: 1, other: 1 }

function dutySourceText(record) {
  if (record.source === 'task') return '领取任务时到岗'
  if ((record.photoFileIds || []).length) return '已拍照到岗'
  return '已到岗'
}

function ok(data) {
  return Promise.resolve(data)
}

function fail(message, code) {
  const err = new Error(message)
  err.code = code || 'FAIL'
  return Promise.reject(err)
}

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function canApplyJoin(user) {
  if (!user) return false
  if (user.appliedAt) return false
  if (user.role === 'member' || user.role === 'admin' || user.role === 'rejected') return false
  if (user.role === 'guest') return true
  if (user.role === 'pending' && !String(user.displayName || '').trim()) return true
  return false
}

function publicUser(user) {
  return {
    _id: user._id,
    displayName: user.displayName || '',
    role: user.role,
    applyNote: user.applyNote || '',
    createdAt: user.createdAt,
    approvedAt: user.approvedAt || null,
    appliedAt: user.appliedAt || null,
    canApply: canApplyJoin(user),
  }
}

function currentUser(state) {
  return state.users.find((u) => u._id === state.currentUserId) || state.users[1]
}

function dateKeyOf(state) {
  return state.mockDateKey || todayKey()
}

function routineDutyEnabled(site) {
  if (typeof site.routineDutyEnabled === 'boolean') return site.routineDutyEnabled
  return ['site_base', 'site_xiangbo', 'site_ta'].includes(site._id)
}

function siteForMember(site, sensitive = true) {
  const row = {
    _id: site._id,
    name: site.name,
    type: site.type,
    publicDesc: site.publicDesc || '',
    sort: site.sort || 0,
    enabled: site.enabled !== false,
    confidential: !!site.confidential,
    routineDutyEnabled: routineDutyEnabled(site),
  }
  if (sensitive) {
    row.address = site.address || ''
    row.lockNote = site.lockNote || ''
  }
  return row
}

function isApproved(user) {
  return !!(user && APPROVED[user.role])
}

function decorateFeedLogs(state, catId, user) {
  return (state.diet_logs || [])
    .filter((log) => log.catId === catId)
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 40)
    .map((log) => ({
      ...log,
      fed: !!(log.fed != null ? log.fed : log.ate),
      watered: !!(log.watered != null ? log.watered : log.drank),
      photoFileIds: log.photoFileIds || [],
      canEdit: log.byOpenid === user.openid, updatedAt: log.updatedAt || 0,
      canDelete: user.role === 'admin' || log.byOpenid === user.openid,
    }))
}

function siteFeedTodayFor(state, siteId) {
  if (!siteId) return null
  const dateKey = dateKeyOf(state)
  const rows = (state.site_feed_logs || []).concat(state.routine_duty_checkins || [])
    .filter((log) => log.kind !== 'signup' && log.siteId === siteId && log.dateKey === dateKey)
  if (!rows.length) return null
  return {
    dateKey,
    fed: rows.some((row) => !!row.fed),
    watered: rows.some((row) => !!row.watered),
    count: rows.length,
    lastAt: Math.max(...rows.map((row) => Number(row.at) || 0)),
  }
}

function lastDietFromLogs(logs, dateKey) {
  const latest = logs[0]
  if (!latest) return null
  return {
    ate: !!latest.fed,
    drank: !!latest.watered,
    fed: !!latest.fed,
    watered: !!latest.watered,
    note: latest.note || '',
    dateKey: latest.dateKey,
    times: logs.filter((item) => item.dateKey === dateKey).length,
    byName: latest.byName || '',
    at: latest.at || null,
  }
}

function normalizeDiet(diet) {
  if (!diet || typeof diet !== 'object' || !diet.dateKey) return null
  return {
    ate: !!diet.ate,
    drank: !!diet.drank,
    note: String(diet.note || '').trim().slice(0, 80),
    dateKey: String(diet.dateKey || ''),
    times: Math.max(1, Number(diet.times) || 1),
    byName: String(diet.byName || ''),
    at: diet.at || null,
  }
}

function catAssetIds(cat) {
  const raw = Array.isArray(cat && cat.assetIds)
    ? cat.assetIds
    : (cat && cat.assetId ? [cat.assetId] : [])
  return [...new Set(raw.filter(Boolean).map(String))]
}

function eventAssetIds(event) {
  const raw = Array.isArray(event && event.assetIds) ? event.assetIds : [event && event.assetId]
  return [...new Set(raw.filter(Boolean).map(String))]
}

function publicCat(cat, extra = {}) {
  const assetIds = normalizedAssetIds(cat)
  return {
    _id: cat._id,
    name: cat.name,
    status: cat.status,
    campusStatus: cat.campusStatus || 'on_campus',
    siteId: cat.siteId || '',
    cageId: cat.cageId || '',
    assetId: assetIds[0] || '',
    assetIds,
    notes: cat.notes || '',
    ageText: cat.ageText || '',
    gender: cat.gender || 'unknown',
    breed: cat.breed || '',
    healthStatus: cat.healthStatus || 'unknown',
    needsIndividualCare: !!cat.needsIndividualCare,
    lastObservation: cat.lastObservation || null,
    provisional: !!cat.provisional,
    lastDiet: normalizeDiet(cat.lastDiet),
    careTimesToday: 0,
    neutered: !!cat.neutered,
    sterilizeNeed: !cat.neutered && !!cat.sterilizeNeed,
    hospitalStay: publicHospitalStay(cat.hospitalStay),
    photoFileIds: cat.photoFileIds || [],
    updatedAt: cat.updatedAt,
    ...extra,
  }
}

function normalizedAssetIds(cat) {
  const raw = Array.isArray(cat && cat.assetIds)
    ? cat.assetIds
    : (cat && cat.assetId ? [cat.assetId] : [])
  return [...new Set(raw.filter((value) => typeof value === 'string' && value))]
}

function setAssetIds(cat, assetIds) {
  const ids = [...new Set((assetIds || []).filter((value) => typeof value === 'string' && value))]
  cat.assetIds = ids
  cat.assetId = ids[0] || ''
  return ids
}

function hasAsset(cat, assetId) {
  return normalizedAssetIds(cat).includes(assetId)
}

function publicHospitalStay(stay) {
  if (!stay || !stay.hospitalName) return null
  return {
    hospitalName: String(stay.hospitalName || ''),
    reason: String(stay.reason || ''),
    contactName: String(stay.contactName || ''),
    contactPhone: String(stay.contactPhone || ''),
    insurancePayer: String(stay.insurancePayer || ''),
    insuranceNote: String(stay.insuranceNote || ''),
    sentAt: stay.sentAt || null,
    sentByName: String(stay.sentByName || ''),
    fromSiteName: String(stay.fromSiteName || ''),
  }
}

function occupancyOf(state, cat) {
  const cage = state.cages.find((c) => c._id === cat.cageId)
  const assets = normalizedAssetIds(cat)
    .map((assetId) => state.assets.find((a) => a._id === assetId))
    .filter(Boolean)
  const parts = []
  if (cage) parts.push(`笼 ${cage.code}`)
  if (assets.length) parts.push(assets.map((asset) => asset.name).join('、'))
  return {
    cageCode: cage ? cage.code : '',
    assetName: assets.map((asset) => asset.name).join('、'),
    occupancyLabel: parts.length ? parts.join(' · ') : '未占用资源',
  }
}

function decorateDuty(state, record, user) {
  return {
    _id: record._id,
    siteId: record.siteId,
    siteName: record.siteName,
    displayName: record.displayName || '未署名成员',
    mine: record.openid === user.openid,
    dateKey: record.dateKey,
    arrivedAt: record.arrivedAt,
    actions: record.actions || [],
    source: record.source || 'arrive',
    sourceText: dutySourceText(record),
    remark: record.remark || '',
    location: record.location || null,
    locationStatus: record.locationStatus || 'unavailable',
    photos: (record.photoFileIds || []).map((fileID) => ({
      fileID,
      tempFileURL: fileID,
    })),
    createdAt: record.createdAt,
  }
}

function mapAssets(state, siteId, cats) {
  return state.assets
    .filter((a) => a.siteId === siteId && a.enabled !== false)
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
    .map((asset) => {
      const occupants = cats.filter((c) => hasAsset(c, asset._id))
      return {
        _id: asset._id,
        name: asset.name,
        category: asset.category,
        quantity: asset.quantity || 1,
        note: asset.note || '',
        occupiedCount: occupants.length,
        vacantCount: Math.max(0, (asset.quantity || 1) - occupants.length),
        occupied: occupants.length > 0,
        occupants: occupants.map((c) => ({ _id: c._id, name: c.name })),
      }
    })
}

function housingOf(state, cat) {
  const campus = cat.campusStatus || 'on_campus'
    if (campus === 'medical') {
    const hospital = cat.hospitalStay && cat.hospitalStay.hospitalName
    return {
      resident: false,
      housingLabel: hospital ? `就医中 · ${hospital}` : '就医中，不在点上，常规点检已暂停',
    }
  }
  const site = state.sites.find((s) => s._id === cat.siteId)
  const resident = campus !== 'off_campus' && !!cat.siteId && !!site && (!!cat.cageId || site.type === 'base' || site.type === '基地')
  return {
    resident,
    housingLabel: resident ? '定点，需每日点检' : '流动，无需每日点检',
  }
}

function buildSiteDetail(state, siteId, user) {
  const site = state.sites.find((s) => s._id === siteId && s.enabled !== false)
  if (!site) return null
  const cages = state.cages.filter((c) => c.siteId === siteId && c.enabled !== false)
  const cats = state.cats.filter((c) => c.siteId === siteId)
  const showAddress = !site.confidential || (user && user.role === 'admin')
  return {
    site: {
      ...siteForMember(site, showAddress),
      addressHidden: !!site.confidential && !(user && user.role === 'admin'),
    },
    cages: cages
      .slice()
      .sort((a, b) => String(a.code).localeCompare(String(b.code), 'zh'))
      .map((cage) => {
        const occupant = cats.find((c) => c.cageId === cage._id)
        return {
          _id: cage._id,
          code: cage.code,
          note: cage.note || '',
          occupied: !!occupant,
          cat: occupant ? { _id: occupant._id, name: occupant.name, status: occupant.status } : null,
        }
      }),
    assets: mapAssets(state, siteId, cats),
    cats: cats
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
      .map((cat) => ({
        ...publicCat(cat),
        ...occupancyOf(state, cat),
        ...housingOf(state, cat),
      })),
  }
}

function hasDutyToday(state, openid, siteId) {
  const dateKey = dateKeyOf(state)
  return state.duty_records.some((r) => r.openid === openid && r.siteId === siteId && r.dateKey === dateKey)
}

function ensureOnDuty(state, user, siteId, source) {
  if (!siteId || !user || !isApproved(user)) return null
  if (hasDutyToday(state, user.openid, siteId)) {
    return state.duty_records.find((r) => r.openid === user.openid && r.siteId === siteId && r.dateKey === dateKeyOf(state))
  }
  const site = state.sites.find((s) => s._id === siteId)
  if (!site) return null
  const now = Date.now()
  const record = {
    _id: id('duty'),
    openid: user.openid,
    displayName: user.displayName || '未署名成员',
    siteId: site._id,
    siteName: site.name,
    dateKey: dateKeyOf(state),
    arrivedAt: now,
    actions: [],
    source: source || 'task',
    remark: source === 'arrive' ? '' : '领取今日任务时自动到岗',
    photoFileIds: [],
    location: null,
    locationStatus: 'unavailable',
    createdAt: now,
  }
  state.duty_records.unshift(record)
  return record
}

function canTouchCat(state, user) {
  return isApproved(user)
}

function writeLog(state, user, payload) {
  state.operation_logs.push({
    _id: `log_${Date.now()}`,
    openid: user.openid,
    displayName: user.displayName || '',
    createdAt: Date.now(),
    ...payload,
  })
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`
}

function parseQuantity(value, fallback = 1) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(1, Math.min(99, n))
}

function assertCageFree(state, cage, catId) {
  const other = state.cats.find((c) => c.cageId === cage._id && c._id !== catId)
  if (other) return `${cage.code} 已被 ${other.name} 占用`
  return ''
}

function assertAssetFree(state, asset, catId) {
  const occupants = state.cats.filter((c) => hasAsset(c, asset._id) && c._id !== catId)
  if (occupants.length >= (asset.quantity || 1)) {
    return `${asset.name} 占用已满（${asset.quantity || 1}）`
  }
  return ''
}

const handlers = {
  login(state) {
    try {
      const { isTrial } = require('../utils/env')
      if (isTrial()) {
        const admin = state.users.find((u) => u._id === 'user_admin') || state.users.find((u) => u.role === 'admin')
        if (admin) state.currentUserId = admin._id
      }
    } catch (e) {
      // 开发者工具/自检没有小程序环境时保持原身份
    }
    const user = currentUser(state)
    return ok({ user: publicUser(user) })
  },

  seed(state) {
    const user = currentUser(state)
    const hasAdmin = state.users.some((u) => u.role === 'admin')
    if (hasAdmin && user.role !== 'admin') {
      return fail('已有管理员，仅管理员可再次写入种子数据', 'FORBIDDEN')
    }
    let promoted = false
    if (!hasAdmin && user.role !== 'guest' && user.role !== 'admin') {
      user.role = 'admin'
      user.approvedAt = Date.now()
      promoted = true
    }
    return ok({
      seeded: true,
      promoted,
      user: publicUser(user),
      message: '本地演示数据已就绪。',
    })
  },

  switchMockRole(state, event) {
    const role = event.role
    const map = {
      guest: 'user_guest',
      pending: 'user_pending',
      member: 'user_member',
      admin: 'user_admin',
    }
    if (!map[role]) return fail('未知演示身份')
    state.currentUserId = map[role]
    const user = currentUser(state)
    return ok({ user: publicUser(user) })
  },

  resetMock(state) {
    const next = store.reset()
    Object.keys(state).forEach((k) => delete state[k])
    Object.assign(state, next)
    return ok({ user: publicUser(currentUser(state)) })
  },

  getProfile(state) {
    return handlers.login(state)
  },

  updateProfile(state, event) {
    const user = currentUser(state)
    if (!isApproved(user)) return fail('未通过审核不能改资料', 'FORBIDDEN')
    const displayName = String(event.displayName || '').trim().slice(0, 20)
    if (!displayName) return fail('请填写显示名称')
    user.displayName = displayName
    return ok({ user: publicUser(user) })
  },

  applyJoin(state, event) {
    const user = currentUser(state)
    if (!canApplyJoin(user)) return fail('每个微信号只能提交一次')
    const displayName = String(event.displayName || '').trim().slice(0, 20)
    if (!displayName) return fail('请填写显示名称')
    user.displayName = displayName
    user.applyNote = String(event.applyNote || '').trim().slice(0, 80)
    user.role = 'pending'
    user.appliedAt = Date.now()
    return ok({ user: publicUser(user) })
  },

  listSites(state) {
    const user = currentUser(state)
    if (!isApproved(user)) return fail('需通过成员审核后才能查看点位', 'FORBIDDEN')
    const sites = state.sites
      .filter((s) => s.enabled !== false)
      .sort((a, b) => a.sort - b.sort)
      .map((site) => ({
        ...siteForMember(site, false),
        catCount: state.cats.filter((c) => c.siteId === site._id).length,
      }))
    return ok({ sites })
  },

  getSiteDetail(state, event) {
    const user = currentUser(state)
    if (!isApproved(user)) return fail('需通过成员审核后才能查看点位', 'FORBIDDEN')
    const detail = buildSiteDetail(state, event.siteId, user)
    if (!detail) return fail('点位不存在或已停用', 'NOT_FOUND')
    const mine = (state.access_requests || [])
      .filter((r) => r.openid === user.openid && r.siteId === event.siteId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
    let access = null
    if (mine) {
      const expired = mine.status === 'approved' && mine.expireDateKey && mine.expireDateKey < dateKeyOf(state)
      access = {
        status: expired ? 'expired' : mine.status,
        expireDateKey: mine.expireDateKey || '',
        password: !expired && mine.status === 'approved' ? mine.password : '',
      }
    }
    return ok({ ...detail, access })
  },

  listCats(state, event) {
    const user = currentUser(state)
    if (!isApproved(user)) return fail('需通过成员审核后才能查看猫咪档案', 'FORBIDDEN')
    const wanted = event.campusStatus || 'on_campus'
    if (wanted === 'seeking_adopt' && user.role !== 'admin') return fail('仅管理员可看找领养名单', 'FORBIDDEN')
    if (wanted !== 'all' && wanted !== 'seeking_adopt' && !CAMPUS_STATUS[wanted]) return fail('状态不合法')
    const cats = state.cats
      .filter((cat) => {
        if (wanted === 'all') return true
        if (wanted === 'seeking_adopt') return !!cat.seekingAdopt
        return (cat.campusStatus || 'on_campus') === wanted
      })
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
      .map((cat) => {
        const site = state.sites.find((s) => s._id === cat.siteId)
        return {
          ...publicCat(cat, user.role === 'admin' ? { seekingAdopt: !!cat.seekingAdopt } : {}),
          siteName: site ? site.name : '',
          siteFeedToday: siteFeedTodayFor(state, cat.siteId),
          careTimesToday: (cat.lastDiet && cat.lastDiet.dateKey === dateKeyOf(state))
            ? (Number(cat.lastDiet.times) || 0) : 0,
          ...occupancyOf(state, cat),
          ...housingOf(state, cat),
        }
      })
    return ok({ cats, campusStatus: wanted })
  },

  getCatDetail(state, event) {
    const user = currentUser(state)
    if (!isApproved(user)) return fail('需通过成员审核后才能查看猫咪档案', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    const site = state.sites.find((s) => s._id === cat.siteId)
    const cage = state.cages.find((c) => c._id === cat.cageId)
    const assets = normalizedAssetIds(cat)
      .map((assetId) => state.assets.find((a) => a._id === assetId))
      .filter(Boolean)
    const asset = assets[0] || null
    const medical = (cat.campusStatus || '') === 'medical'
    const recentDuty = cat.siteId
      ? state.duty_records
        .filter((r) => r.siteId === cat.siteId)
        .sort((a, b) => b.arrivedAt - a.arrivedAt)
        .slice(0, 5)
        .map((r) => decorateDuty(state, r, user))
      : []
    const adoptCandidates = user.role === 'admin'
      ? (state.adopt_candidates || []).filter((row) => row.catId === cat._id)
      : []
    return ok({
      cat: {
        ...publicCat(cat, user.role === 'admin' ? { seekingAdopt: !!cat.seekingAdopt } : {}),
        ...housingOf(state, cat),
        careTimesToday: decorateFeedLogs(state, cat._id, user)
          .filter((log) => log.dateKey === dateKeyOf(state)).length,
        siteFeedToday: siteFeedTodayFor(state, cat.siteId),
      },
      canManageAdopt: user.role === 'admin',
      adoptCandidates,
      feedLogs: decorateFeedLogs(state, cat._id, user),
      site: site ? siteForMember(site, user.role === 'admin' || !site.confidential) : null,
      cage: cage ? { _id: cage._id, code: cage.code, note: cage.note || '' } : null,
      asset: asset ? { _id: asset._id, name: asset.name, category: asset.category } : null,
      assets: assets.map((item) => ({ _id: item._id, name: item.name, category: item.category })),
      canUpdateLocation: isApproved(user),
      canEditProfile: user.role === 'admin',
      canEditDiet: isApproved(user),
      canManageHospital: isApproved(user) || medical,
      hospitalHistory: (state.hospital_visits || [])
        .filter((v) => v.catId === cat._id && v.returnedAt)
        .slice(0, 5),
      recentDuty,
      siteOptions: state.sites.filter((s) => s.enabled !== false).map((s) => ({ _id: s._id, name: s.name })),
      cageOptions: state.cages
        .filter((c) => c.siteId === cat.siteId && c.enabled !== false)
        .map((c) => ({ _id: c._id, code: c.code, siteId: c.siteId })),
      assetOptions: state.assets
        .filter((a) => a.siteId === cat.siteId && a.enabled !== false)
        .map((a) => {
          const occupants = state.cats.filter((item) => hasAsset(item, a._id) && item._id !== cat._id)
          return {
            _id: a._id,
            name: a.name,
            category: a.category,
            quantity: a.quantity || 1,
            occupiedCount: occupants.length,
            vacantCount: Math.max(0, (a.quantity || 1) - occupants.length),
          }
        }),
    })
  },

  listCages(state, event) {
    const user = currentUser(state)
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const cages = state.cages.filter((c) => c.siteId === event.siteId && c.enabled !== false)
    return ok({
      cages: cages.map((cage) => {
        const occupant = state.cats.find((c) => c.cageId === cage._id)
        return {
          _id: cage._id,
          code: cage.code,
          occupied: !!occupant,
          catId: occupant ? occupant._id : '',
        }
      }),
    })
  },

  listAssets(state, event) {
    const user = currentUser(state)
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    return ok({
      assets: mapAssets(state, event.siteId, state.cats),
    })
  },

  updateCatLocation(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    const siteId = String(event.siteId || '')
    const cageId = String(event.cageId || '')
    const hasAssetIds = Object.prototype.hasOwnProperty.call(event, 'assetIds')
    let assetIds
    if (hasAssetIds) {
      if (!Array.isArray(event.assetIds)) return fail('固定资产必须是数组')
      if (event.assetIds.some((value) => typeof value !== 'string')) return fail('固定资产 ID 不合法')
      assetIds = [...new Set(event.assetIds.filter((value) => value))]
    } else {
      assetIds = event.assetId ? [String(event.assetId)] : []
    }
    const assetId = assetIds[0] || ''
    const status = event.status ? String(event.status) : cat.status
    if (!CAT_STATUS[status]) return fail('状态不合法')
    let site = null
    let cage = null
    let asset = null
    if (siteId) {
      site = state.sites.find((s) => s._id === siteId && s.enabled !== false)
      if (!site) return fail('点位不可用')
      if (cageId) {
        cage = state.cages.find((c) => c._id === cageId)
        if (!cage || cage.siteId !== siteId) return fail('笼子不属于该点位')
        const busy = assertCageFree(state, cage, cat._id)
        if (busy) return fail(busy)
      }
      for (const selectedAssetId of assetIds) {
        const selectedAsset = state.assets.find((a) => a._id === selectedAssetId)
        if (!selectedAsset || selectedAsset.siteId !== siteId) return fail('固定资产不属于该点位')
        const busy = assertAssetFree(state, selectedAsset, cat._id)
        if (busy) return fail(busy)
        if (!asset) asset = selectedAsset
      }
    } else if (cageId || assetIds.length) {
      return fail('未挂点位时不能占用笼子或固定资产')
    }
    if (!canTouchCat(state, user)) {
      return fail('通过审核的成员才能更新位置', 'FORBIDDEN')
    }
    const before = {
      siteId: cat.siteId,
      cageId: cat.cageId,
      assetId: cat.assetId || '',
      assetIds: normalizedAssetIds(cat),
      status: cat.status,
    }
    cat.siteId = siteId
    cat.cageId = cageId
    setAssetIds(cat, assetIds)
    cat.status = status
    cat.updatedAt = Date.now()
    writeLog(state, user, {
      action: 'update_cat_location',
      targetType: 'cat',
      targetId: cat._id,
      siteId,
      before,
      after: { siteId, cageId, assetId, assetIds, status },
    })
    return ok({
      catId: cat._id,
      siteId,
      cageId,
      assetId,
      assetIds,
      status,
      cageCode: cage ? cage.code : '',
      assetName: assetIds.map((selectedAssetId) => state.assets.find((item) => item._id === selectedAssetId))
        .filter(Boolean).map((item) => item.name).join('、'),
    })
  },

  updateCatProfile(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可改猫咪档案', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫')
    const name = String(event.name || cat.name).trim().slice(0, 20)
    if (!name) return fail('名字不能为空')
    const campusStatus = event.campusStatus || cat.campusStatus || 'on_campus'
    const gender = event.gender || cat.gender || 'unknown'
    const healthStatus = event.healthStatus || cat.healthStatus || 'unknown'
    if (!CAMPUS_STATUS[campusStatus]) return fail('在校状态不合法')
    if (!GENDERS[gender]) return fail('性别不合法')
    if (!HEALTH_STATUS[healthStatus]) return fail('健康状态不合法')
    if (event.status && !CAT_STATUS[event.status]) return fail('状态不合法')
    cat.name = name
    cat.notes = String(event.notes || '').trim().slice(0, 200)
    cat.ageText = String(event.ageText != null ? event.ageText : cat.ageText || '').trim().slice(0, 20)
    cat.gender = gender
    cat.breed = String(event.breed != null ? event.breed : cat.breed || '').trim().slice(0, 20)
    cat.healthStatus = healthStatus
    cat.campusStatus = campusStatus
    if (event.status && CAT_STATUS[event.status]) cat.status = event.status
    if (event.neutered != null) cat.neutered = !!event.neutered
    if (event.sterilizeNeed != null) cat.sterilizeNeed = !!event.sterilizeNeed
    if (event.photoFileIds) cat.photoFileIds = (event.photoFileIds || []).filter(Boolean).slice(0, 6)
    if (campusStatus === 'medical') {
      if (!publicHospitalStay(cat.hospitalStay)) {
        return fail('请用「送去医院」填写医院、原因、联系人和保险付款')
      }
      cat.status = 'medical'
      cat.cageId = ''
      setAssetIds(cat, [])
      cat.siteId = ''
    } else if (cat.hospitalStay) {
      const visit = (state.hospital_visits || []).find((v) => v.catId === cat._id && !v.returnedAt)
      if (visit) {
        visit.returnedAt = Date.now()
        visit.returnedByName = user.displayName || '管理员'
      }
      cat.hospitalStay = null
    }
    cat.updatedAt = Date.now()
    return ok(publicCat(cat))
  },

  updateCatDiet(state, event, user) {
    return handlers.addFeedLog(state, event, user)
  },

  addFeedLog(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    const fed = !!(event.fed != null ? event.fed : event.ate)
    const watered = !!(event.watered != null ? event.watered : event.drank)
    if (!fed && !watered) return fail('请至少勾选喂食或喂水')
    if (!Array.isArray(state.diet_logs)) state.diet_logs = []
    const dateKey = dateKeyOf(state)
    const log = {
      _id: id('feed'),
      catId: cat._id,
      catName: cat.name,
      fed,
      watered,
      ate: fed,
      drank: watered,
      note: String(event.note || '').trim().slice(0, 80),
      photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6),
      byName: String(event.byName || user.displayName || '未署名成员').trim().slice(0, 20),
      byOpenid: user.openid,
      dateKey,
      at: Date.now(),
    }
    state.diet_logs.unshift(log)
    const logs = decorateFeedLogs(state, cat._id, user)
    cat.lastDiet = lastDietFromLogs(logs, dateKey)
    cat.updatedAt = Date.now()
    writeLog(state, user, {
      action: 'add_feed_log',
      targetType: 'diet_log',
      targetId: log._id,
      siteId: cat.siteId || '',
      after: cat.lastDiet,
    })
    return ok({
      catId: cat._id,
      logId: log._id,
      lastDiet: cat.lastDiet,
      careTimesToday: logs.filter((item) => item.dateKey === dateKey).length,
    })
  },

  updateFeedLog(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    if (event.photoFileIds != null && !Array.isArray(event.photoFileIds)) return fail('照片列表不合法')
    const log = (state.diet_logs || []).find((item) => item._id === event.logId)
    if (!log) return fail('找不到这条投喂记录', 'NOT_FOUND')
    if (!user.openid || log.byOpenid !== user.openid) return fail('只能编辑自己写的投喂记录', 'FORBIDDEN')
    const fed = event.fed == null ? !!(log.fed != null ? log.fed : log.ate) : !!event.fed
    const watered = event.watered == null ? !!(log.watered != null ? log.watered : log.drank) : !!event.watered
    if (!fed && !watered) return fail('请至少勾选喂食或喂水')
    Object.assign(log, {
      fed, watered, ate: fed, drank: watered,
      note: event.note == null ? (log.note || '') : String(event.note).trim().slice(0, 80),
      photoFileIds: event.photoFileIds == null ? (log.photoFileIds || [])
        : event.photoFileIds.filter((id) => typeof id === 'string' && id).slice(0, 6),
      updatedAt: Date.now(),
    })
    const cat = (state.cats || []).find((row) => row._id === log.catId)
    const logs = decorateFeedLogs(state, log.catId, user)
    const lastDiet = lastDietFromLogs(logs, dateKeyOf(state))
    if (cat && cat.lastDiet && cat.lastDiet.at === log.at) {
      cat.lastDiet = { ...cat.lastDiet, fed, watered, ate: fed, drank: watered, note: log.note }
      cat.updatedAt = log.updatedAt
    }
    return ok({ logId: log._id, catId: log.catId, updatedAt: log.updatedAt, lastDiet,
      careTimesToday: logs.filter((item) => item.dateKey === dateKeyOf(state)).length })
  },

  deleteFeedLog(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    if (!Array.isArray(state.diet_logs)) state.diet_logs = []
    const log = state.diet_logs.find((item) => item._id === event.logId)
    if (!log) return fail('找不到这条投喂记录', 'NOT_FOUND')
    if (user.role !== 'admin' && log.byOpenid !== user.openid) {
      return fail('只能删除自己写的投喂记录', 'FORBIDDEN')
    }
    state.diet_logs = state.diet_logs.filter((item) => item._id !== log._id)
    const cat = state.cats.find((c) => c._id === log.catId)
    const logs = decorateFeedLogs(state, log.catId, user)
    if (cat) {
      cat.lastDiet = lastDietFromLogs(logs, dateKeyOf(state))
      cat.updatedAt = Date.now()
    }
    writeLog(state, user, {
      action: 'delete_feed_log',
      targetType: 'diet_log',
      targetId: log._id,
      after: { catId: log.catId },
    })
    return ok({
      logId: log._id,
      lastDiet: cat ? cat.lastDiet : null,
      careTimesToday: logs.filter((item) => item.dateKey === dateKeyOf(state)).length,
    })
  },

  submitDuty(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能提交执勤', 'FORBIDDEN')
    const site = state.sites.find((s) => s._id === event.siteId && s.enabled !== false)
    if (!site) return fail('点位不可用')
    const now = Date.now()
    const remark = String(event.remark || '').trim().slice(0, 300)
    const photoFileIds = (event.photoFileIds || []).slice(0, 3)
    const existing = state.duty_records.find((r) => (
      r.openid === user.openid && r.siteId === site._id && r.dateKey === dateKeyOf(state)
    ))
    if (existing) {
      existing.source = 'arrive'
      existing.remark = remark || existing.remark
      if (photoFileIds.length) existing.photoFileIds = photoFileIds
      if (event.location) existing.location = event.location
      if (event.locationStatus) existing.locationStatus = event.locationStatus
      return ok({ recordId: existing._id, siteId: site._id, dateKey: existing.dateKey })
    }
    const record = {
      _id: id('duty'),
      openid: user.openid,
      displayName: user.displayName || '未署名成员',
      siteId: site._id,
      siteName: site.name,
      dateKey: dateKeyOf(state),
      arrivedAt: now,
      actions: [],
      source: 'arrive',
      remark,
      photoFileIds,
      location: event.location || null,
      locationStatus: event.locationStatus || 'unavailable',
      createdAt: now,
    }
    state.duty_records.unshift(record)
    return ok({ recordId: record._id, siteId: site._id, dateKey: record.dateKey })
  },

  listDuty(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能查看执勤记录', 'FORBIDDEN')
    let rows = state.duty_records.slice()
    if (event.siteId) rows = rows.filter((r) => r.siteId === event.siteId)
    if (event.dateKey) rows = rows.filter((r) => r.dateKey === event.dateKey)
    if (event.onlyMine) rows = rows.filter((r) => r.openid === user.openid)
    rows.sort((a, b) => b.arrivedAt - a.arrivedAt)
    return ok({
      records: rows.slice(0, 50).map((r) => decorateDuty(state, r, user)),
      isAdmin: user.role === 'admin',
    })
  },

  getTodayProgress(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const dateKey = event.dateKey || dateKeyOf(state)
    const detail = buildSiteDetail(state, event.siteId)
    if (!detail) return fail('点位不存在', 'NOT_FOUND')
    const records = state.duty_records
      .filter((r) => r.siteId === event.siteId && r.dateKey === dateKey)
      .map((r) => decorateDuty(state, r, user))
    return ok({
      dateKey,
      onDuty: user.role === 'admin' || records.some((r) => r.mine),
      records,
      ...detail,
    })
  },

  adminListUsers(state, _event, user) {
    if (user.role !== 'admin') return fail('仅管理员可审核成员', 'FORBIDDEN')
    return ok({
      users: state.users
        .filter((u) => u.role !== 'guest')
        .map((item) => ({
          _id: item._id,
          displayName: item.displayName || '未填写名称',
          role: item.role,
          applyNote: item.applyNote || '',
          openidTail: item.openid.slice(-6),
          createdAt: item.createdAt,
          approvedAt: item.approvedAt || null,
          appliedAt: item.appliedAt || null,
          isSelf: item._id === user._id,
          canChangeRole: item._id !== user._id,
        })),
    })
  },

  adminSetRole(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可改角色', 'FORBIDDEN')
    const target = state.users.find((u) => u._id === event.userId)
    if (!target) return fail('用户不存在')
    if (target._id === user._id) return fail('不能改变自己的身份')
    target.role = event.role
    if (event.role === 'member' || event.role === 'admin') target.approvedAt = Date.now()
    return ok({ userId: target._id, role: target.role })
  },

  adminUpsertSite(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护点位', 'FORBIDDEN')
    const name = String(event.name || '').trim()
    if (!name) return fail('请填写点位名称')
    let siteId = event.siteId
    if (siteId) {
      const site = state.sites.find((s) => s._id === siteId)
      if (!site) return fail('点位不存在')
      Object.assign(site, {
        name,
        type: String(event.type || site.type || '点位').trim().slice(0, 20) || '点位',
        publicDesc: event.publicDesc || '',
        address: event.address || '',
        lockNote: event.lockNote || '',
        confidential: !!event.confidential,
        sort: Number(event.sort) || site.sort,
        enabled: event.enabled !== false,
      })
    } else {
      siteId = id('site')
      state.sites.push({
        _id: siteId,
        name,
        type: String(event.type || '点位').trim().slice(0, 20) || '点位',
        publicDesc: event.publicDesc || '',
        address: event.address || '',
        lockNote: event.lockNote || '',
        confidential: !!event.confidential,
        sort: Number(event.sort) || 99,
        enabled: true,
      })
    }
    return ok({ siteId })
  },

  adminSetRoutineDutySite(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可设置每日执勤点位', 'FORBIDDEN')
    const site = state.sites.find((row) => row._id === event.siteId)
    if (!site) return fail('点位不存在', 'NOT_FOUND')
    site.routineDutyEnabled = event.enabled === true
    return ok({ siteId: site._id, routineDutyEnabled: site.routineDutyEnabled })
  },

  adminRenameSite(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护点位', 'FORBIDDEN')
    const site = state.sites.find((row) => row._id === event.siteId)
    if (!site) return fail('点位不存在', 'NOT_FOUND')
    const name = String(event.name || '').trim().slice(0, 20)
    if (!name) return fail('请填写新名称', 'INVALID')
    const oldName = site.name
    site.name = name
    let updated = 0
    for (const collection of ['work_tasks', 'duty_records', 'site_feed_logs', 'routine_duty_checkins', 'access_requests', 'cat_tasks', 'care_plans']) {
      for (const row of state[collection] || []) {
        if (row.siteId !== site._id || row.siteName !== oldName) continue
        row.siteName = name
        updated += 1
      }
    }
    return ok({ siteId: site._id, name, updated })
  },

  adminDeleteSite(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护点位', 'FORBIDDEN')
    const siteId = String(event.siteId || '')
    const site = state.sites.find((s) => s._id === siteId)
    if (!site) return fail('点位不存在', 'NOT_FOUND')
    const hanging = state.cats.filter((c) => c.siteId === siteId)
    if (hanging.length) {
      return fail(`该点还有 ${hanging.length} 只猫在册，请先转移到其他点或取消挂点后再删除`)
    }
    state.cages = state.cages.filter((c) => c.siteId !== siteId)
    state.assets = state.assets.filter((a) => a.siteId !== siteId)
    state.sites = state.sites.filter((s) => s._id !== siteId)
    writeLog(state, user, {
      action: 'delete_site',
      targetType: 'site',
      targetId: siteId,
      siteId,
      before: { name: site.name },
    })
    return ok({ siteId })
  },

  adminUpsertCage(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护笼子', 'FORBIDDEN')
    const code = String(event.code || '').trim()
    if (!code) return fail('请填写笼号')
    let cageId = event.cageId
    if (cageId) {
      const cage = state.cages.find((c) => c._id === cageId)
      if (!cage) return fail('笼子不存在')
      cage.code = code
      cage.note = event.note || ''
      if (event.photoFileIds) cage.photoFileIds = (event.photoFileIds || []).filter(Boolean).slice(0, 6)
    } else {
      cageId = id('cage')
      state.cages.push({
        _id: cageId,
        siteId: event.siteId,
        code,
        note: event.note || '',
        photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6),
        enabled: true,
      })
    }
    return ok({ cageId, siteId: event.siteId })
  },

  adminDeleteCage(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护笼子', 'FORBIDDEN')
    const cage = state.cages.find((c) => c._id === event.cageId)
    if (!cage) return fail('笼子不存在', 'NOT_FOUND')
    const occupant = state.cats.find((c) => c.cageId === cage._id)
    if (occupant) return fail(`请先把 ${occupant.name} 移出该笼再删除`)
    state.cages = state.cages.filter((c) => c._id !== cage._id)
    writeLog(state, user, {
      action: 'delete_cage',
      targetType: 'cage',
      targetId: cage._id,
      siteId: cage.siteId,
    })
    return ok({ cageId: cage._id })
  },

  adminUpsertAsset(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护固定资产', 'FORBIDDEN')
    const site = state.sites.find((s) => s._id === event.siteId)
    if (!site) return fail('点位不存在', 'NOT_FOUND')
    const name = String(event.name || '').trim().slice(0, 20)
    if (!name) return fail('请填写资产名称')
    const category = ASSET_CATEGORIES[event.category] ? event.category : 'other'
    const quantity = parseQuantity(event.quantity, 1)
    const note = String(event.note || '').trim().slice(0, 40)
    let assetId = event.assetId
    if (assetId) {
      const asset = state.assets.find((a) => a._id === assetId)
      if (!asset) return fail('固定资产不存在', 'NOT_FOUND')
      const used = state.cats.filter((c) => hasAsset(c, assetId)).length
      if (quantity < used) return fail(`数量不能少于当前占用（${used}）`)
      Object.assign(asset, { name, category, quantity, note, photoFileIds: (event.photoFileIds || asset.photoFileIds || []).filter(Boolean).slice(0, 6) })
    } else {
      assetId = id('asset')
      state.assets.push({
        _id: assetId,
        siteId: site._id,
        name,
        category,
        quantity,
        note,
        photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6),
        enabled: true,
      })
    }
    return ok({ assetId, siteId: site._id })
  },

  adminDeleteAsset(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护固定资产', 'FORBIDDEN')
    const asset = state.assets.find((a) => a._id === event.assetId)
    if (!asset) return fail('固定资产不存在', 'NOT_FOUND')
    const occupants = state.cats.filter((c) => hasAsset(c, asset._id))
    if (occupants.length) {
      return fail(`请先取消 ${occupants.map((c) => c.name).join('、')} 对该资产的占用再删除`)
    }
    state.assets = state.assets.filter((a) => a._id !== asset._id)
    writeLog(state, user, {
      action: 'delete_asset',
      targetType: 'asset',
      targetId: asset._id,
      siteId: asset.siteId,
    })
    return ok({ assetId: asset._id })
  },

  adminListSites(state, _event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护点位', 'FORBIDDEN')
    return ok({
      sites: state.sites.map((site) => ({
        ...siteForMember(site),
        catCount: state.cats.filter((c) => c.siteId === site._id).length,
        cages: state.cages
          .filter((c) => c.siteId === site._id)
          .map((c) => ({
            _id: c._id,
            code: c.code,
            note: c.note || '',
            enabled: c.enabled !== false,
            occupiedBy: (state.cats.find((cat) => cat.cageId === c._id) || {}).name || '',
            photoFileIds: c.photoFileIds || [],
          })),
        assets: state.assets
          .filter((a) => a.siteId === site._id)
          .map((a) => ({
            _id: a._id,
            name: a.name,
            category: a.category,
            quantity: a.quantity || 1,
            note: a.note || '',
            occupiedBy: state.cats.filter((cat) => hasAsset(cat, a._id)).map((cat) => cat.name).join('、'),
            photoFileIds: a.photoFileIds || [],
          })),
      })),
    })
  },
}

attachOps(handlers, { ok, fail, id, isApproved, writeLog, todayKey, ensureOnDuty, routineDutyEnabled })

function call(action, data = {}) {
  const state = store.load()
  const user = currentUser(state)
  const handler = handlers[action]
  if (!handler) return fail('未知操作', 'UNKNOWN_ACTION')
  return Promise.resolve()
    .then(() => handler(state, data, user))
    .then((res) => {
      store.save(state)
      return res
    })
}

module.exports = { call }
