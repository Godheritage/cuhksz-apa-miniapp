// 所有敏感读写都走这里，并按 users.role 校验。小程序端不能直接读写数据库。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const APPROVED = new Set(['member', 'admin'])
const CAT_STATUS = new Set(['in_care', 'medical', 'pending_release', 'observe'])
const CAMPUS_STATUS = new Set(['on_campus', 'off_campus', 'medical'])
const GENDERS = new Set(['male', 'female', 'unknown'])
const HEALTH_STATUS = new Set(['healthy', 'under_weather', 'recovering', 'unknown'])
const ASSET_CATEGORIES = new Set(['bowl', 'feeder', 'medicine', 'water', 'cage', 'other'])

function dutySourceText(record) {
  if (record.source === 'task') return '领取任务时到岗'
  if ((record.photoFileIds || []).length) return '已拍照到岗'
  return '已到岗'
}

function ok(data) {
  return { ok: true, data }
}

function fail(code, message) {
  return { ok: false, code, message }
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

function membershipPatch(user) {
  const name = String(user.displayName || '').trim()
  if (user.role === 'pending' && !user.appliedAt && !name) {
    return { role: 'guest' }
  }
  if ((user.role === 'pending' || user.role === 'rejected') && !user.appliedAt && name) {
    return { appliedAt: user.createdAt || new Date() }
  }
  return null
}

function shanghaiDateKey(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000
  const sh = new Date(utc + 8 * 3600000)
  const y = sh.getFullYear()
  const m = String(sh.getMonth() + 1).padStart(2, '0')
  const d = String(sh.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isApproved(user) {
  return !!(user && APPROVED.has(user.role))
}

function isAdmin(user) {
  return !!(user && user.role === 'admin')
}

function maskOpenid(openid) {
  if (!openid) return ''
  return openid.length <= 6 ? openid : openid.slice(-6)
}

function siteForMember(site, { sensitive = true } = {}) {
  const row = {
    _id: site._id,
    name: site.name,
    type: site.type,
    publicDesc: site.publicDesc || '',
    sort: site.sort || 0,
    enabled: site.enabled !== false,
    confidential: !!site.confidential,
  }
  if (sensitive) {
    row.address = site.address || ''
    row.lockNote = site.lockNote || ''
  }
  return row
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

function publicCat(cat, extra = {}) {
  return {
    _id: cat._id,
    name: cat.name,
    status: cat.status,
    campusStatus: cat.campusStatus || 'on_campus',
    siteId: cat.siteId || '',
    cageId: cat.cageId || '',
    assetId: cat.assetId || '',
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

function occupancyLabel(cage, asset) {
  const parts = []
  if (cage) parts.push(`笼 ${cage.code}`)
  if (asset) parts.push(asset.name)
  return parts.length ? parts.join(' · ') : '未占用资源'
}

function parseQuantity(value, fallback = 1) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(1, Math.min(99, n))
}

async function getUserByOpenid(openid) {
  const found = await db.collection('users').where({ openid }).limit(1).get()
  return found.data[0] || null
}

async function ensureUser(openid) {
  let user = await getUserByOpenid(openid)
  if (!user) {
    const now = new Date()
    const doc = {
      openid,
      displayName: '',
      role: 'guest',
      applyNote: '',
      createdAt: now,
      updatedAt: now,
    }
    const added = await db.collection('users').add({ data: doc })
    return { _id: added._id, ...doc }
  }
  const patch = membershipPatch(user)
  if (patch) {
    await db.collection('users').doc(user._id).update({
      data: Object.assign({ updatedAt: new Date() }, patch),
    })
    Object.assign(user, patch)
  }
  return user
}

async function getById(collection, id) {
  if (!id) return null
  try {
    const res = await db.collection(collection).doc(id).get()
    return res.data || null
  } catch (e) {
    return null
  }
}

async function getAll(collection, where = {}, orderBy) {
  const MAX = 200
  let query = db.collection(collection).where(where)
  if (orderBy) {
    query = query.orderBy(orderBy.field, orderBy.dir || 'desc')
  }
  const res = await query.limit(MAX).get()
  return res.data
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) {}
}

async function writeLog(actor, payload) {
  const data = {
    openid: actor.openid,
    displayName: actor.displayName || '',
    action: payload.action,
    targetType: payload.targetType,
    targetId: payload.targetId || '',
    siteId: payload.siteId || '',
    before: payload.before || null,
    after: payload.after || null,
    createdAt: new Date(),
  }
  try {
    await db.collection('operation_logs').add({ data })
  } catch (e) {
    try {
      await ensureCollection('operation_logs')
      await db.collection('operation_logs').add({ data })
    } catch (e2) {}
  }
}

async function addDoc(name, data) {
  try {
    return await db.collection(name).add({ data })
  } catch (e) {
    await ensureCollection(name)
    return await db.collection(name).add({ data })
  }
}

function quietUpdate(name, id, data) {
  if (!name || !id) return
  Promise.resolve(db.collection(name).doc(id).update({ data })).catch(() => {})
}

function quietLog(user, payload) {
  Promise.resolve(writeLog(user, payload)).catch(() => {})
}

function photoIds(event) {
  return (event.photoFileIds || event.photos || []).filter(Boolean).slice(0, 6)
}

async function saveMedia(ownerType, ownerId, ids) {
  const photoFileIds = (ids || []).filter(Boolean).slice(0, 6)
  if (!ownerId) return photoFileIds
  await addDoc('media_files', { ownerType, ownerId, photoFileIds, at: Date.now() })
  const col = { cat: 'cats', asset: 'assets', cage: 'cages' }[ownerType]
  if (col) quietUpdate(col, ownerId, { photoFileIds })
  return photoFileIds
}

async function loadMediaMap(ownerType) {
  let rows = []
  try {
    rows = await getAll('media_files', { ownerType })
  } catch (e) {
    rows = []
  }
  const map = {}
  rows.sort((a, b) => (a.at || 0) - (b.at || 0))
  rows.forEach((row) => {
    map[row.ownerId] = row.photoFileIds || []
  })
  return map
}

async function hasDutyToday(openid, siteId, dateKey) {
  if (!siteId) return false
  const res = await db.collection('duty_records')
    .where({
      openid,
      siteId,
      dateKey,
    })
    .limit(1)
    .get()
  return !!res.data.length
}

async function findDutyToday(openid, siteId, dateKey) {
  if (!siteId) return null
  const res = await db.collection('duty_records')
    .where({ openid, siteId, dateKey })
    .limit(1)
    .get()
  return res.data[0] || null
}

async function ensureOnDuty(user, siteId, source) {
  if (!siteId || !user || !isApproved(user)) return null
  const dateKey = shanghaiDateKey()
  const existing = await findDutyToday(user.openid, siteId, dateKey)
  if (existing) return existing
  const site = await getById('sites', siteId)
  if (!site) return null
  const now = new Date()
  const doc = {
    openid: user.openid,
    displayName: user.displayName || '未署名成员',
    siteId: site._id,
    siteName: site.name,
    dateKey,
    arrivedAt: now,
    actions: [],
    source: source || 'task',
    remark: source === 'arrive' ? '' : '领取今日任务时自动到岗',
    photoFileIds: [],
    location: null,
    locationStatus: 'unavailable',
    createdAt: now,
  }
  const added = await db.collection('duty_records').add({ data: doc })
  return { _id: added._id, ...doc }
}

async function canUpdateCat(user) {
  return isApproved(user)
}

async function attachTempUrls(fileIds) {
  const ids = (fileIds || []).filter(Boolean)
  if (!ids.length) return []
  try {
    const res = await cloud.getTempFileURL({ fileList: ids })
    return (res.fileList || []).map((item) => ({
      fileID: item.fileID,
      tempFileURL: item.tempFileURL || '',
      status: item.status,
    }))
  } catch (e) {
    return ids.map((fileID) => ({ fileID, tempFileURL: '', status: -1 }))
  }
}

async function decorateDuty(record) {
  const photos = await attachTempUrls(record.photoFileIds)
  return {
    _id: record._id,
    siteId: record.siteId,
    siteName: record.siteName,
    displayName: record.displayName || '未署名成员',
    mine: false,
    dateKey: record.dateKey,
    arrivedAt: record.arrivedAt,
    actions: record.actions || [],
    source: record.source || 'arrive',
    sourceText: dutySourceText(record),
    remark: record.remark || '',
    location: record.location || null,
    locationStatus: record.locationStatus || 'unavailable',
    photos,
    createdAt: record.createdAt,
  }
}

async function countCatsBySite(siteIds) {
  const map = {}
  siteIds.forEach((id) => {
    map[id] = 0
  })
  if (!siteIds.length) return map
  const cats = await db.collection('cats').where({ siteId: _.in(siteIds) }).limit(200).get()
  cats.data.forEach((cat) => {
    if (cat.siteId) map[cat.siteId] = (map[cat.siteId] || 0) + 1
  })
  return map
}

function mapAssetRows(assets, cats) {
  return assets
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
    .map((asset) => {
      const occupants = cats.filter((c) => c.assetId === asset._id)
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

async function buildSiteDetail(siteId) {
  const site = await getById('sites', siteId)
  if (!site || site.enabled === false) return null
  const cages = await getAll('cages', { siteId, enabled: _.neq(false) })
  const assets = await getAll('assets', { siteId, enabled: _.neq(false) })
  const cats = await getAll('cats', { siteId })
  const byCage = {}
  cats.forEach((cat) => {
    if (cat.cageId) byCage[cat.cageId] = cat
  })
  return {
    site: {
      ...siteForMember(site, { sensitive: !site.confidential }),
      addressHidden: !!site.confidential,
    },
    cages: cages
      .sort((a, b) => String(a.code).localeCompare(String(b.code), 'zh'))
      .map((cage) => {
        const occupant = byCage[cage._id]
        return {
          _id: cage._id,
          code: cage.code,
          note: cage.note || '',
          occupied: !!occupant,
          cat: occupant
            ? { _id: occupant._id, name: occupant.name, status: occupant.status }
            : null,
        }
      }),
    assets: mapAssetRows(assets, cats),
    cats: cats
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
      .map((cat) => {
        const cage = cages.find((c) => c._id === cat.cageId)
        const asset = assets.find((a) => a._id === cat.assetId)
        return {
          ...publicCat(cat),
          cageCode: cage ? cage.code : '',
          assetName: asset ? asset.name : '',
          occupancyLabel: occupancyLabel(cage, asset),
        }
      }),
  }
}

async function listFeedLogs(catId, user) {
  let rows = []
  try {
    const res = await db.collection('diet_logs').where({ catId }).orderBy('at', 'desc').limit(40).get()
    rows = res.data || []
  } catch (e) {
    rows = []
  }
  return rows.map((log) => ({
    _id: log._id,
    fed: !!(log.fed != null ? log.fed : log.ate),
    watered: !!(log.watered != null ? log.watered : log.drank),
    note: log.note || '',
    photoFileIds: log.photoFileIds || [],
    byName: log.byName || '',
    byOpenid: log.byOpenid || '',
    dateKey: log.dateKey || '',
    at: log.at || 0,
    canDelete: isAdmin(user) || log.byOpenid === user.openid,
  }))
}

function summarizeSiteFeed(rows, dateKey) {
  if (!rows.length) return null
  return {
    dateKey,
    fed: rows.some((row) => !!row.fed),
    watered: rows.some((row) => !!row.watered),
    count: rows.length,
    lastAt: Math.max(...rows.map((row) => Number(row.at) || 0)),
  }
}

async function siteFeedTodayMap(dateKey) {
  let rows = []
  try { rows = await getAll('site_feed_logs', { dateKey }) } catch (e) { return {} }
  const grouped = {}
  rows.forEach((row) => {
    if (!grouped[row.siteId]) grouped[row.siteId] = []
    grouped[row.siteId].push(row)
  })
  const result = {}
  Object.keys(grouped).forEach((siteId) => {
    result[siteId] = summarizeSiteFeed(grouped[siteId], dateKey)
  })
  return result
}

function lastDietFromLogs(logs, dateKey) {
  const latest = logs[0]
  if (!latest) return null
  const times = logs.filter((item) => item.dateKey === dateKey).length
  return {
    ate: !!latest.fed,
    drank: !!latest.watered,
    fed: !!latest.fed,
    watered: !!latest.watered,
    note: latest.note || '',
    dateKey: latest.dateKey,
    times,
    byName: latest.byName || '',
    at: latest.at || null,
  }
}

async function persistCatLastDiet(catId, lastDiet) {
  try {
    await db.collection('cats').doc(catId).update({
      data: { lastDiet, updatedAt: Date.now() },
    })
  } catch (e) {}
  return lastDiet
}

async function createFeedLog(event, user) {
  if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
  const cat = await getById('cats', event.catId)
  if (!cat) return fail('NOT_FOUND', '找不到这只猫')
  const fed = !!(event.fed != null ? event.fed : event.ate)
  const watered = !!(event.watered != null ? event.watered : event.drank)
  if (!fed && !watered) return fail('INVALID', '请至少勾选喂食或喂水')
  const dateKey = shanghaiDateKey()
  const photoFileIds = (event.photoFileIds || []).filter(Boolean).slice(0, 6)
  const prev = cat.lastDiet || {}
  const times = prev.dateKey === dateKey ? (Number(prev.times) || 0) + 1 : 1
  const doc = {
    catId: cat._id,
    catName: cat.name || '',
    fed,
    watered,
    note: String(event.note || '').trim().slice(0, 80),
    photoFileIds,
    byName: String(event.byName || user.displayName || '未署名成员').trim().slice(0, 20),
    byOpenid: user.openid,
    dateKey,
    at: Date.now(),
  }
  let added
  try {
    added = await db.collection('diet_logs').add({ data: doc })
  } catch (e) {
    await ensureCollection('diet_logs')
    added = await db.collection('diet_logs').add({ data: doc })
  }
  const lastDiet = {
    ate: fed,
    drank: watered,
    fed,
    watered,
    note: doc.note,
    dateKey,
    times,
    byName: doc.byName,
    at: doc.at,
  }
  persistCatLastDiet(cat._id, lastDiet)
  return ok({
    catId: cat._id,
    logId: added._id,
    lastDiet,
    careTimesToday: times,
  })
}

const handlers = {
  async getProfile(_event, user) {
    return ok({ user: publicUser(user) })
  },

  async updateProfile(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '未通过审核不能改资料')
    const displayName = String(event.displayName || '').trim().slice(0, 20)
    if (!displayName) return fail('INVALID', '请填写显示名称')
    await db.collection('users').doc(user._id).update({
      data: {
        displayName,
        updatedAt: new Date(),
      },
    })
    return ok({
      user: publicUser({ ...user, displayName }),
    })
  },

  async applyJoin(event, user) {
    if (!canApplyJoin(user)) return fail('INVALID', '每个微信号只能提交一次')
    const displayName = String(event.displayName || '').trim().slice(0, 20)
    const applyNote = String(event.applyNote || '').trim().slice(0, 80)
    if (!displayName) return fail('INVALID', '请填写显示名称')
    const now = new Date()
    const patch = {
      displayName,
      applyNote,
      role: 'pending',
      appliedAt: now,
      updatedAt: now,
    }
    await db.collection('users').doc(user._id).update({ data: patch })
    return ok({ user: publicUser(Object.assign({}, user, patch)) })
  },

  async listSites(_event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看点位')
    const sites = await getAll('sites', { enabled: _.neq(false) })
    sites.sort((a, b) => (a.sort || 0) - (b.sort || 0))
    const counts = await countCatsBySite(sites.map((s) => s._id))
    return ok({
      sites: sites.map((site) => ({
        ...siteForMember(site, { sensitive: false }),
        catCount: counts[site._id] || 0,
      })),
    })
  },

  async getSiteDetail(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看点位')
    const detail = await buildSiteDetail(event.siteId)
    if (!detail) return fail('NOT_FOUND', '点位不存在或已停用')
    if (isAdmin(user) && detail.site.addressHidden) {
      const site = await getById('sites', event.siteId)
      detail.site = { ...siteForMember(site, { sensitive: true }), addressHidden: false }
    }
    let access = null
    if (detail.site.confidential && !isAdmin(user)) {
      const mine = (await getAll('access_requests', { openid: user.openid, siteId: event.siteId }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
      if (mine) {
        const expired = mine.status === 'approved' && mine.expireDateKey && mine.expireDateKey < shanghaiDateKey()
        access = {
          status: expired ? 'expired' : mine.status,
          expireDateKey: mine.expireDateKey || '',
          password: !expired && mine.status === 'approved' ? mine.password : '',
        }
      }
    }
    return ok({ ...detail, access })
  },

  async listCats(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看猫咪档案')
    const wanted = event.campusStatus || 'on_campus'
    if (wanted === 'seeking_adopt' && !isAdmin(user)) return fail('FORBIDDEN', '仅管理员可看找领养名单')
    if (wanted !== 'all' && wanted !== 'seeking_adopt' && !CAMPUS_STATUS.has(wanted)) return fail('INVALID', '状态不合法')
    const cats = await getAll('cats')
    const sites = await getAll('sites')
    const cages = await getAll('cages')
    const assets = await getAll('assets')
    const catPhotos = await loadMediaMap('cat')
    const siteFeedMap = await siteFeedTodayMap(shanghaiDateKey())
    const siteMap = {}
    sites.forEach((s) => { siteMap[s._id] = s })
    const cageMap = {}
    cages.forEach((c) => { cageMap[c._id] = c })
    const assetMap = {}
    assets.forEach((a) => { assetMap[a._id] = a })
    const rows = cats
      .filter((cat) => {
        if (wanted === 'all') return true
        if (wanted === 'seeking_adopt') return !!cat.seekingAdopt
        return (cat.campusStatus || 'on_campus') === wanted
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
      .map((cat) => {
        const site = siteMap[cat.siteId]
        const cage = cageMap[cat.cageId]
        const asset = assetMap[cat.assetId]
        const campus = cat.campusStatus || 'on_campus'
        const resident = campus !== 'off_campus' && campus !== 'medical' && !!site && (!!cat.cageId || site.type === 'base' || site.type === '基地')
        let housingLabel = '流动，无需每日点检'
        if (campus === 'medical') {
          const hospital = cat.hospitalStay && cat.hospitalStay.hospitalName
          housingLabel = hospital ? `就医中 · ${hospital}` : '就医中，不在点上，常规点检已暂停'
        }
        else if (resident) housingLabel = '定点，需每日点检'
        return {
          ...publicCat(cat, {
            careTimesToday: (cat.lastDiet && cat.lastDiet.dateKey === shanghaiDateKey())
              ? (Number(cat.lastDiet.times) || 0) : 0,
            photoFileIds: catPhotos[cat._id] || cat.photoFileIds || [],
            ...(isAdmin(user) ? { seekingAdopt: !!cat.seekingAdopt } : {}),
          }),
          siteName: site ? site.name : '',
          siteFeedToday: cat.siteId ? (siteFeedMap[cat.siteId] || null) : null,
          cageCode: cage ? cage.code : '',
          assetName: asset ? asset.name : '',
          occupancyLabel: occupancyLabel(cage, asset),
          housingLabel,
          resident,
        }
      })
    return ok({ cats: rows, campusStatus: wanted })
  },

  async getCatDetail(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看猫咪档案')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    const dateKey = shanghaiDateKey()
    const [site, cage, asset, feedLogs, sites, cages, assets] = await Promise.all([
      cat.siteId ? getById('sites', cat.siteId) : Promise.resolve(null),
      cat.cageId ? getById('cages', cat.cageId) : Promise.resolve(null),
      cat.assetId ? getById('assets', cat.assetId) : Promise.resolve(null),
      listFeedLogs(cat._id, user),
      getAll('sites', { enabled: _.neq(false) }),
      cat.siteId ? getAll('cages', { siteId: cat.siteId, enabled: _.neq(false) }) : Promise.resolve([]),
      cat.siteId ? getAll('assets', { siteId: cat.siteId, enabled: _.neq(false) }) : Promise.resolve([]),
    ])
    const todayFeeds = feedLogs.filter((log) => log.dateKey === dateKey)
    const lastDiet = lastDietFromLogs(feedLogs, dateKey) || normalizeDiet(cat.lastDiet)
    const catPhotoMap = await loadMediaMap('cat')
    const siteFeedMap = cat.siteId ? await siteFeedTodayMap(dateKey) : {}
    const cagePhotoMap = await loadMediaMap('cage')
    const campus = cat.campusStatus || 'on_campus'
    const resident = campus !== 'off_campus' && campus !== 'medical' && !!site && (!!cat.cageId || site.type === 'base' || site.type === '基地')
    let housingLabel = '流动，无需每日点检'
    if (campus === 'medical') {
      const hospital = cat.hospitalStay && cat.hospitalStay.hospitalName
      housingLabel = hospital ? `就医中 · ${hospital}` : '就医中，不在点上，常规点检已暂停'
    } else if (resident) housingLabel = '定点，需每日点检'
    let adoptCandidates = []
    if (isAdmin(user)) {
      try { adoptCandidates = await getAll('adopt_candidates', { catId: cat._id }) } catch (e) { adoptCandidates = [] }
      const adoptPhotos = await loadMediaMap('adopt')
      adoptCandidates = adoptCandidates
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((row) => ({
          ...row,
          photoFileIds: adoptPhotos[row._id] || row.photoFileIds || [],
        }))
    }
    return ok({
      cat: publicCat(cat, {
        housingLabel,
        resident,
        lastDiet,
        siteFeedToday: cat.siteId ? (siteFeedMap[cat.siteId] || null) : null,
        careTimesToday: todayFeeds.length,
        photoFileIds: catPhotoMap[cat._id] || cat.photoFileIds || [],
        ...(isAdmin(user) ? { seekingAdopt: !!cat.seekingAdopt } : {}),
      }),
      canManageAdopt: isAdmin(user),
      adoptCandidates,
      feedLogs,
      site: site ? siteForMember(site) : null,
      cage: cage ? { _id: cage._id, code: cage.code, note: cage.note || '', photoFileIds: cagePhotoMap[cage._id] || cage.photoFileIds || [] } : null,
      asset: asset ? { _id: asset._id, name: asset.name, category: asset.category } : null,
      canUpdateLocation: isApproved(user),
      canEditProfile: isAdmin(user),
      canEditDiet: isApproved(user),
      canManageHospital: isApproved(user) || campus === 'medical',
      hospitalHistory: [],
      recentDuty: [],
      siteOptions: sites
        .sort((a, b) => (a.sort || 0) - (b.sort || 0))
        .map((s) => ({ _id: s._id, name: s.name })),
      cageOptions: cages.map((c) => ({ _id: c._id, code: c.code, siteId: c.siteId, photoFileIds: cagePhotoMap[c._id] || c.photoFileIds || [] })),
      assetOptions: assets.map((a) => ({
        _id: a._id,
        name: a.name,
        category: a.category,
        quantity: a.quantity || 1,
      })),
    })
  },

  async listCages(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const cages = await getAll('cages', { siteId: event.siteId, enabled: _.neq(false) })
    const cats = await getAll('cats', { siteId: event.siteId })
    const used = {}
    cats.forEach((c) => {
      if (c.cageId) used[c.cageId] = c
    })
    return ok({
      cages: cages.map((cage) => ({
        _id: cage._id,
        code: cage.code,
        occupied: !!used[cage._id],
        catId: used[cage._id] ? used[cage._id]._id : '',
      })),
    })
  },

  async listAssets(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const assets = await getAll('assets', { siteId: event.siteId, enabled: _.neq(false) })
    const cats = await getAll('cats')
    return ok({ assets: mapAssetRows(assets, cats) })
  },

  async updateCatLocation(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    const siteId = String(event.siteId || '')
    const cageId = String(event.cageId || '')
    const assetId = String(event.assetId || '')
    const status = event.status ? String(event.status) : cat.status
    if (!CAT_STATUS.has(status)) return fail('INVALID', '状态不合法')
    let cage = null
    let asset = null
    if (siteId) {
      const site = await getById('sites', siteId)
      if (!site || site.enabled === false) return fail('INVALID', '点位不可用')
      if (cageId) {
        cage = await getById('cages', cageId)
        if (!cage || cage.siteId !== siteId || cage.enabled === false) {
          return fail('INVALID', '笼子不属于该点位')
        }
        const occupant = await db.collection('cats').where({ cageId }).limit(5).get()
        const other = occupant.data.find((item) => item._id !== cat._id)
        if (other) return fail('OCCUPIED', `${cage.code} 已被 ${other.name} 占用`)
      }
      if (assetId) {
        asset = await getById('assets', assetId)
        if (!asset || asset.siteId !== siteId || asset.enabled === false) {
          return fail('INVALID', '固定资产不属于该点位')
        }
        const occupant = await db.collection('cats').where({ assetId }).limit(20).get()
        const others = occupant.data.filter((item) => item._id !== cat._id)
        if (others.length >= (asset.quantity || 1)) {
          return fail('OCCUPIED', `${asset.name} 占用已满（${asset.quantity || 1}）`)
        }
      }
    } else if (cageId || assetId) {
      return fail('INVALID', '未挂点位时不能占用笼子或固定资产')
    }
    const allowed = await canUpdateCat(user)
    if (!allowed) {
      return fail('FORBIDDEN', '通过审核的成员才能更新位置')
    }
    const before = {
      siteId: cat.siteId || '',
      cageId: cat.cageId || '',
      assetId: cat.assetId || '',
      status: cat.status,
    }
    const after = { siteId, cageId, assetId, status }
    const occupancyPhotos = photoIds(event)
    quietUpdate('cats', cat._id, {
      siteId,
      cageId,
      assetId,
      status,
      updatedAt: new Date(),
      updatedBy: user.openid,
    })
    if (cageId && occupancyPhotos.length) {
      await saveMedia('cage', cageId, occupancyPhotos)
    }
    quietLog(user, {
      action: 'update_cat_location',
      targetType: 'cat',
      targetId: cat._id,
      siteId,
      before,
      after,
    })
    return ok({
      catId: cat._id,
      ...after,
      cageCode: cage ? cage.code : '',
      assetName: asset ? asset.name : '',
    })
  },

  async updateCatProfile(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可改猫咪档案')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    const name = String(event.name || cat.name).trim().slice(0, 20)
    const notes = String(event.notes || '').trim().slice(0, 200)
    const status = event.status ? String(event.status) : cat.status
    const campusStatus = event.campusStatus || cat.campusStatus || 'on_campus'
    const gender = event.gender || cat.gender || 'unknown'
    const healthStatus = event.healthStatus || cat.healthStatus || 'unknown'
    if (!name) return fail('INVALID', '名字不能为空')
    if (!CAT_STATUS.has(status)) return fail('INVALID', '状态不合法')
    if (!CAMPUS_STATUS.has(campusStatus)) return fail('INVALID', '在校状态不合法')
    if (!GENDERS.has(gender)) return fail('INVALID', '性别不合法')
    if (!HEALTH_STATUS.has(healthStatus)) return fail('INVALID', '健康状态不合法')
    const ageText = String(event.ageText != null ? event.ageText : cat.ageText || '').trim().slice(0, 20)
    const breed = String(event.breed != null ? event.breed : cat.breed || '').trim().slice(0, 20)
    const photos = photoIds(event)
    quietUpdate('cats', cat._id, {
      name,
      notes,
      status,
      campusStatus,
      ageText,
      gender,
      breed,
      healthStatus,
      photoFileIds: photos.length ? photos : (cat.photoFileIds || []),
      updatedAt: new Date(),
    })
    if (photos.length) await saveMedia('cat', cat._id, photos)
    quietLog(user, {
      action: 'update_cat_profile',
      targetType: 'cat',
      targetId: cat._id,
      siteId: cat.siteId || '',
      before: {
        name: cat.name,
        notes: cat.notes,
        status: cat.status,
        campusStatus: cat.campusStatus,
      },
      after: { name, notes, status, campusStatus, ageText, gender, breed, healthStatus },
    })
    return ok({
      catId: cat._id,
      name,
      notes,
      status,
      campusStatus,
      ageText,
      gender,
      breed,
      healthStatus,
      photoFileIds: photos.length ? photos : (cat.photoFileIds || []),
    })
  },

  async updateCatDiet(event, user) {
    return createFeedLog(event, user)
  },

  async addFeedLog(event, user) {
    return createFeedLog(event, user)
  },

  async deleteFeedLog(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const log = await getById('diet_logs', event.logId)
    if (!log) return fail('NOT_FOUND', '找不到这条投喂记录')
    if (!isAdmin(user) && log.byOpenid !== user.openid) {
      return fail('FORBIDDEN', '只能删除自己写的投喂记录')
    }
    await db.collection('diet_logs').doc(log._id).remove()
    const logs = await listFeedLogs(log.catId, user)
    const lastDiet = lastDietFromLogs(logs, shanghaiDateKey())
    persistCatLastDiet(log.catId, lastDiet)
    return ok({
      logId: log._id,
      lastDiet,
      careTimesToday: logs.filter((item) => item.dateKey === shanghaiDateKey()).length,
    })
  },

  async submitDuty(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能提交执勤')
    const site = await getById('sites', event.siteId)
    if (!site || site.enabled === false) return fail('INVALID', '点位不可用')
    const remark = String(event.remark || '').trim().slice(0, 300)
    const photoFileIds = Array.isArray(event.photoFileIds)
      ? event.photoFileIds.filter((id) => typeof id === 'string' && id).slice(0, 3)
      : []
    const locationStatus = event.locationStatus || 'unavailable'
    let location = null
    if (event.location && typeof event.location.latitude === 'number') {
      location = {
        latitude: event.location.latitude,
        longitude: event.location.longitude,
        accuracy: event.location.accuracy || 0,
      }
    }
    const now = new Date()
    const dateKey = shanghaiDateKey(now)
    const existing = await findDutyToday(user.openid, site._id, dateKey)
    if (existing) {
      const patch = {
        source: 'arrive',
        remark: remark || existing.remark || '',
        locationStatus,
      }
      if (photoFileIds.length) patch.photoFileIds = photoFileIds
      if (location) patch.location = location
      await db.collection('duty_records').doc(existing._id).update({ data: patch })
      return ok({
        recordId: existing._id,
        siteId: site._id,
        dateKey,
      })
    }
    const doc = {
      openid: user.openid,
      displayName: user.displayName || '未署名成员',
      siteId: site._id,
      siteName: site.name,
      dateKey,
      arrivedAt: now,
      actions: [],
      source: 'arrive',
      remark,
      photoFileIds,
      location,
      locationStatus,
      createdAt: now,
    }
    const added = await db.collection('duty_records').add({ data: doc })
    return ok({
      recordId: added._id,
      siteId: site._id,
      dateKey: doc.dateKey,
    })
  },

  async listDuty(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看执勤记录')
    const onlyMine = !!event.onlyMine && !isAdmin(user) ? true : !!event.onlyMine
    const cond = {}
    if (event.siteId) cond.siteId = event.siteId
    if (event.dateKey) cond.dateKey = event.dateKey
    if (onlyMine || (!isAdmin(user) && event.scope === 'mine')) cond.openid = user.openid
    const pageSize = Math.min(Number(event.pageSize) || 20, 50)
    const res = await db.collection('duty_records')
      .where(cond)
      .orderBy('arrivedAt', 'desc')
      .skip(Number(event.skip) || 0)
      .limit(pageSize)
      .get()
    const records = await Promise.all(res.data.map(async (item) => {
      const row = await decorateDuty(item)
      row.mine = item.openid === user.openid
      return row
    }))
    return ok({ records, isAdmin: isAdmin(user) })
  },

  async getTodayProgress(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const siteId = event.siteId
    const dateKey = event.dateKey || shanghaiDateKey()
    const detail = await buildSiteDetail(siteId)
    if (!detail) return fail('NOT_FOUND', '点位不存在')
    const recs = await db.collection('duty_records')
      .where({ siteId, dateKey })
      .orderBy('arrivedAt', 'desc')
      .limit(50)
      .get()
    const records = await Promise.all(recs.data.map(async (item) => {
      const row = await decorateDuty(item)
      row.mine = item.openid === user.openid
      return row
    }))
    const onDuty = isAdmin(user) || records.some((r) => r.mine)
    return ok({
      dateKey,
      onDuty,
      records,
      ...detail,
    })
  },

  async adminListUsers(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可审核成员')
    const users = await getAll('users')
    users.sort((a, b) => {
      const order = { pending: 0, rejected: 1, member: 2, admin: 3 }
      return (order[a.role] ?? 9) - (order[b.role] ?? 9)
    })
    return ok({
      users: users
        .filter((item) => item.role !== 'guest')
        .map((item) => ({
          _id: item._id,
          displayName: item.displayName || '未填写名称',
          role: item.role,
          applyNote: item.applyNote || '',
          openidTail: maskOpenid(item.openid),
          createdAt: item.createdAt,
          approvedAt: item.approvedAt || null,
          appliedAt: item.appliedAt || null,
          isSelf: item._id === user._id,
          canChangeRole: item._id !== user._id,
        })),
    })
  },

  async adminSetRole(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可改角色')
    const target = await getById('users', event.userId)
    if (!target) return fail('NOT_FOUND', '用户不存在')
    const role = String(event.role || '')
    if (!['pending', 'member', 'admin', 'rejected'].includes(role)) {
      return fail('INVALID', '角色不合法')
    }
    if (String(target._id) === String(user._id)) {
      return fail('INVALID', '不能改变自己的身份')
    }
    const patch = {
      role,
      updatedAt: new Date(),
    }
    if (role === 'member' || role === 'admin') {
      patch.approvedAt = target.approvedAt || new Date()
      patch.approvedBy = user.openid
    }
    await db.collection('users').doc(target._id).update({ data: patch })
    await writeLog(user, {
      action: 'set_role',
      targetType: 'user',
      targetId: target._id,
      before: { role: target.role },
      after: { role },
    })
    return ok({ userId: target._id, role })
  },

  async adminUpsertSite(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护点位')
    const name = String(event.name || '').trim().slice(0, 20)
    if (!name) return fail('INVALID', '请填写点位名称')
    const type = String(event.type || '').trim().slice(0, 20) || '点位'
    const now = new Date()
    const data = {
      name,
      type,
      publicDesc: String(event.publicDesc || '').trim().slice(0, 80),
      address: String(event.address || '').trim().slice(0, 80),
      lockNote: String(event.lockNote || '').trim().slice(0, 80),
      confidential: !!event.confidential,
      sort: Number(event.sort) || 99,
      enabled: event.enabled !== false,
      updatedAt: now,
    }
    let siteId = event.siteId
    if (siteId) {
      const site = await getById('sites', siteId)
      if (!site) return fail('NOT_FOUND', '点位不存在')
      await db.collection('sites').doc(siteId).update({ data })
    } else {
      data.createdAt = now
      const added = await db.collection('sites').add({ data })
      siteId = added._id
    }
    await writeLog(user, {
      action: 'upsert_site',
      targetType: 'site',
      targetId: siteId,
      siteId,
      after: data,
    })
    return ok({ siteId })
  },

  async adminRenameSite(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护点位')
    const siteId = String(event.siteId || '')
    const name = String(event.name || '').trim().slice(0, 20)
    if (!name) return fail('INVALID', '请填写新名称')
    const site = await getById('sites', siteId)
    if (!site) return fail('NOT_FOUND', '点位不存在')
    if (site.name === name) return ok({ siteId, name, updated: 0 })
    await db.collection('sites').doc(siteId).update({ data: { name, updatedAt: new Date() } })
    let updated = 0
    for (const collection of ['work_tasks', 'duty_records', 'site_feed_logs', 'access_requests', 'cat_tasks', 'care_plans']) {
      const rows = await getAll(collection, { siteId })
      for (const row of rows) {
        if (row.siteName !== site.name) continue
        await db.collection(collection).doc(row._id).update({ data: { siteName: name } })
        updated += 1
      }
    }
    await writeLog(user, {
      action: 'rename_site', targetType: 'site', targetId: siteId, siteId,
      before: { name: site.name }, after: { name },
    })
    return ok({ siteId, name, updated })
  },

  async adminDeleteSite(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护点位')
    const siteId = String(event.siteId || '')
    const site = await getById('sites', siteId)
    if (!site) return fail('NOT_FOUND', '点位不存在')
    const hanging = await getAll('cats', { siteId })
    if (hanging.length) {
      return fail('HAS_CATS', `该点还有 ${hanging.length} 只猫在册，请先转移到其他点或取消挂点后再删除`)
    }
    const cages = await getAll('cages', { siteId })
    const assets = await getAll('assets', { siteId })
    await Promise.all(cages.map((item) => db.collection('cages').doc(item._id).remove()))
    await Promise.all(assets.map((item) => db.collection('assets').doc(item._id).remove()))
    await db.collection('sites').doc(siteId).remove()
    await writeLog(user, {
      action: 'delete_site',
      targetType: 'site',
      targetId: siteId,
      siteId,
      before: { name: site.name },
    })
    return ok({ siteId })
  },

  async adminUpsertCage(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护笼子')
    const site = await getById('sites', event.siteId)
    if (!site) return fail('NOT_FOUND', '点位不存在')
    const code = String(event.code || '').trim().slice(0, 16)
    if (!code) return fail('INVALID', '请填写笼号')
    const now = new Date()
    const photos = photoIds(event)
    const data = {
      siteId: site._id,
      code,
      note: String(event.note || '').trim().slice(0, 40),
      enabled: event.enabled !== false,
      photoFileIds: photos,
      updatedAt: now,
    }
    let cageId = event.cageId
    if (cageId) {
      const cage = await getById('cages', cageId)
      if (!cage) return fail('NOT_FOUND', '笼子不存在')
      quietUpdate('cages', cageId, data)
    } else {
      data.createdAt = now
      const added = await addDoc('cages', data)
      cageId = added._id
    }
    if (photos.length) await saveMedia('cage', cageId, photos)
    quietLog(user, {
      action: 'upsert_cage',
      targetType: 'cage',
      targetId: cageId,
      siteId: site._id,
      after: data,
    })
    return ok({ cageId, siteId: site._id })
  },

  async adminDeleteCage(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护笼子')
    const cage = await getById('cages', event.cageId)
    if (!cage) return fail('NOT_FOUND', '笼子不存在')
    const occupant = await db.collection('cats').where({ cageId: cage._id }).limit(1).get()
    if (occupant.data.length) {
      return fail('OCCUPIED', `请先把 ${occupant.data[0].name} 移出该笼再删除`)
    }
    await db.collection('cages').doc(cage._id).remove()
    await writeLog(user, {
      action: 'delete_cage',
      targetType: 'cage',
      targetId: cage._id,
      siteId: cage.siteId,
    })
    return ok({ cageId: cage._id })
  },

  async adminUpsertAsset(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护固定资产')
    const site = await getById('sites', event.siteId)
    if (!site) return fail('NOT_FOUND', '点位不存在')
    const name = String(event.name || '').trim().slice(0, 20)
    if (!name) return fail('INVALID', '请填写资产名称')
    const category = ASSET_CATEGORIES.has(event.category) ? event.category : 'other'
    const quantity = parseQuantity(event.quantity, 1)
    const note = String(event.note || '').trim().slice(0, 40)
    const now = new Date()
    const photos = photoIds(event)
    const data = {
      siteId: site._id,
      name,
      category,
      quantity,
      note,
      enabled: event.enabled !== false,
      photoFileIds: photos,
      updatedAt: now,
    }
    let assetId = event.assetId
    if (assetId) {
      const asset = await getById('assets', assetId)
      if (!asset) return fail('NOT_FOUND', '固定资产不存在')
      const used = await db.collection('cats').where({ assetId }).limit(20).get()
      if (quantity < used.data.length) {
        return fail('OCCUPIED', `数量不能少于当前占用（${used.data.length}）`)
      }
      quietUpdate('assets', assetId, data)
    } else {
      data.createdAt = now
      const added = await addDoc('assets', data)
      assetId = added._id
    }
    if (photos.length) await saveMedia('asset', assetId, photos)
    quietLog(user, {
      action: 'upsert_asset',
      targetType: 'asset',
      targetId: assetId,
      siteId: site._id,
      after: data,
    })
    return ok({ assetId, siteId: site._id })
  },

  async adminDeleteAsset(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护固定资产')
    const asset = await getById('assets', event.assetId)
    if (!asset) return fail('NOT_FOUND', '固定资产不存在')
    const occupants = await db.collection('cats').where({ assetId: asset._id }).limit(20).get()
    if (occupants.data.length) {
      return fail('OCCUPIED', `请先取消 ${occupants.data.map((c) => c.name).join('、')} 对该资产的占用再删除`)
    }
    await db.collection('assets').doc(asset._id).remove()
    await writeLog(user, {
      action: 'delete_asset',
      targetType: 'asset',
      targetId: asset._id,
      siteId: asset.siteId,
    })
    return ok({ assetId: asset._id })
  },

  async adminListSites(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护点位')
    const sites = await getAll('sites')
    sites.sort((a, b) => (a.sort || 0) - (b.sort || 0))
    const cages = await getAll('cages')
    const assets = await getAll('assets')
    const cats = await getAll('cats')
    const cagePhotos = await loadMediaMap('cage')
    const assetPhotos = await loadMediaMap('asset')
    return ok({
      sites: sites.map((site) => ({
        ...siteForMember(site),
        catCount: cats.filter((c) => c.siteId === site._id).length,
        cages: cages
          .filter((c) => c.siteId === site._id)
          .map((c) => ({
            _id: c._id,
            code: c.code,
            note: c.note || '',
            enabled: c.enabled !== false,
            occupiedBy: (cats.find((cat) => cat.cageId === c._id) || {}).name || '',
            photoFileIds: cagePhotos[c._id] || c.photoFileIds || [],
          })),
        assets: assets
          .filter((a) => a.siteId === site._id)
          .map((a) => ({
            _id: a._id,
            name: a.name,
            category: a.category,
            quantity: a.quantity || 1,
            note: a.note || '',
            occupiedBy: cats.filter((cat) => cat.assetId === a._id).map((cat) => cat.name).join('、'),
            photoFileIds: assetPhotos[a._id] || a.photoFileIds || [],
          })),
      })),
    })
  },
}

require('./ops')(handlers, {
  db,
  _,
  getAll,
  getById,
  writeLog,
  addDoc,
  quietUpdate,
  quietLog,
  photoIds,
  saveMedia,
  loadMediaMap,
  attachTempUrls,
  ok,
  fail,
  isApproved,
  isAdmin,
  shanghaiDateKey,
  ensureOnDuty,
})

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('NO_OPENID', '无法识别微信身份')

  const action = event.action
  const handler = handlers[action]
  if (!handler) return fail('UNKNOWN_ACTION', '未知操作')

  try {
    const user = await ensureUser(OPENID)
    return await handler(event, user)
  } catch (e) {
    console.error(action, e)
    return fail('INTERNAL', e.message || '服务异常')
  }
}
