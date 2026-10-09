const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const SITE_SEED = [
  {
    key: 'base',
    name: '豪宅',
    routineDutyEnabled: true,
    type: '基地',
    confidential: true,
    publicDesc: '寄养与护理主点位，笼子占用以现场为准。',
    address: '详细地址由管理员在后台填写，仅成员可见。',
    lockNote: '门锁说明由管理员自行填写。请勿写入真实密码。',
    sort: 10,
    enabled: true,
    cages: [
      { code: 'A1', note: '靠窗' },
      { code: 'A2', note: '' },
      { code: 'A3', note: '' },
      { code: 'B1', note: '' },
      { code: 'B2', note: '' },
      { code: '观察笼', note: '隔离/观察用' },
    ],
    assets: [
      { name: '不锈钢食盆', category: 'bowl', quantity: 6, note: '日常投喂' },
      { name: '自动饮水机', category: 'water', quantity: 2, note: '' },
      { name: '常用药箱', category: 'medicine', quantity: 1, note: '外用药与驱虫' },
      { name: '备用喂食机', category: 'feeder', quantity: 1, note: '' },
    ],
  },
  {
    key: 'ta',
    name: 'TA',
    routineDutyEnabled: true,
    type: '投喂点',
    publicDesc: '投喂点。幼猫少加粮，优先小包装幼猫粮。',
    address: '详细位置由管理员填写。',
    lockNote: '',
    sort: 20,
    enabled: true,
    cages: [{ code: '临时笼', note: '外出收容时使用' }],
    assets: [
      { name: '投喂食盆', category: 'bowl', quantity: 2, note: '' },
      { name: '饮水碗', category: 'water', quantity: 1, note: '' },
    ],
  },
  {
    key: 'sitin',
    name: '思廷自动喂食机',
    routineDutyEnabled: false,
    type: '自动喂食点',
    publicDesc: '自动喂食机补粮与巡查。',
    address: '详细位置由管理员填写。',
    lockNote: '设备锁说明由管理员填写，勿写入真实密码。',
    sort: 30,
    enabled: true,
    cages: [],
    assets: [
      { name: '思廷喂食机', category: 'feeder', quantity: 1, note: '补粮巡查' },
      { name: '备用食盆', category: 'bowl', quantity: 1, note: '' },
    ],
  },
  {
    key: 'yifu',
    name: '逸夫',
    routineDutyEnabled: false,
    type: '投喂点',
    publicDesc: '投喂点。',
    address: '详细位置由管理员填写。',
    lockNote: '',
    sort: 40,
    enabled: true,
    cages: [],
    assets: [{ name: '逸夫食盆', category: 'bowl', quantity: 2, note: '' }],
  },
  {
    key: 'xiangbo',
    name: '祥波',
    routineDutyEnabled: true,
    type: '投喂点',
    publicDesc: '投喂点，可记录本次是否已喂。',
    address: '详细位置由管理员填写。',
    lockNote: '',
    sort: 50,
    enabled: true,
    cages: [],
    assets: [
      { name: '祥波食盆', category: 'bowl', quantity: 2, note: '' },
      { name: '祥波饮水机', category: 'water', quantity: 1, note: '' },
    ],
  },
]

const CAT_SEED = [
  {
    name: '摩卡',
    status: 'in_care',
    campusStatus: 'on_campus',
    siteKey: 'base',
    cageCode: 'A1',
    assetName: '',
    ageText: '约3岁',
    gender: 'female',
    breed: '狸花',
    healthStatus: 'healthy',
    notes: '按个体护理，执勤时核对现场说明。',
    diet: { ate: true, drank: true, note: '干粮适量' },
  },
  {
    name: '桑葚',
    status: 'medical',
    campusStatus: 'medical',
    siteKey: 'base',
    cageCode: 'A2',
    assetName: '常用药箱',
    ageText: '约2岁',
    gender: 'female',
    breed: '橘白',
    healthStatus: 'recovering',
    notes: '就医中，注意换药与观察。',
    diet: { ate: true, drank: true, note: '按医嘱湿粮' },
  },
  {
    name: '玛奇朵',
    status: 'in_care',
    campusStatus: 'on_campus',
    siteKey: 'base',
    cageCode: 'A3',
    assetName: '',
    ageText: '约1岁',
    gender: 'female',
    breed: '奶牛',
    healthStatus: 'healthy',
    notes: '',
    diet: { ate: true, drank: false, note: '饮水偏少，请留意' },
  },
  {
    name: '好大声',
    status: 'in_care',
    campusStatus: 'on_campus',
    siteKey: 'ta',
    cageCode: '',
    assetName: '投喂食盆',
    ageText: '幼猫约8月',
    gender: 'male',
    breed: '狸花',
    healthStatus: 'healthy',
    notes: '该点活动，未入笼，占用投喂食盆。',
    diet: null,
  },
  {
    name: '小白',
    status: 'pending_release',
    campusStatus: 'on_campus',
    siteKey: 'base',
    cageCode: 'B1',
    assetName: '',
    ageText: '约4岁',
    gender: 'male',
    breed: '白猫',
    healthStatus: 'healthy',
    notes: '待放，确认状态后再移动。',
    diet: { ate: true, drank: true, note: '' },
  },
  {
    name: '小灰',
    status: 'observe',
    campusStatus: 'on_campus',
    siteKey: 'yifu',
    cageCode: '',
    assetName: '',
    ageText: '约2岁',
    gender: 'unknown',
    breed: '灰猫',
    healthStatus: 'unknown',
    notes: '逸夫附近观察，未占用笼子或固定资产。',
    diet: null,
  },
  {
    name: '奶盖',
    status: 'observe',
    campusStatus: 'on_campus',
    siteKey: '',
    cageCode: '',
    assetName: '',
    ageText: '约1岁',
    gender: 'female',
    breed: '乳白',
    healthStatus: 'healthy',
    notes: '校园已发现，暂未挂到固定点位。',
    diet: null,
  },
]

const CAT_PROFILE_BY_NAME = CAT_SEED.reduce((map, cat) => {
  map[cat.name] = cat
  return map
}, {})

const SITE_KEY_BY_NAME = SITE_SEED.reduce((map, site) => {
  map[site.name] = site.key
  return map
}, {})

function publicUser(user) {
  return {
    _id: user._id,
    displayName: user.displayName || '',
    role: user.role,
    applyNote: user.applyNote || '',
    createdAt: user.createdAt,
    approvedAt: user.approvedAt || null,
  }
}

function shanghaiDateKey(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000
  const sh = new Date(utc + 8 * 3600000)
  const y = sh.getFullYear()
  const m = String(sh.getMonth() + 1).padStart(2, '0')
  const d = String(sh.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const COLLECTIONS = [
  'users', 'sites', 'cages', 'cats', 'duty_records', 'operation_logs', 'assets',
  'cat_tasks', 'access_requests', 'care_plans', 'finance_entries', 'donations',
  'move_tasks', 'szcat_config', 'szcat_claims', 'szcat_copies', 'hospital_visits', 'work_tasks',
  'diet_logs', 'work_task_reports', 'work_task_events', 'work_credit_events', 'media_files', 'app_meta', 'adopt_candidates', 'routine_duty_checkins',
]

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) {}
}

function dietOf(item, dateKey) {
  if (!item) return null
  return {
    ate: !!item.ate,
    drank: !!item.drank,
    note: item.note || '',
    dateKey,
    times: 1,
    byName: '种子数据',
    at: Date.now(),
  }
}

async function ensureUser(openid) {
  const users = db.collection('users')
  const now = new Date()
  const found = await users.where({ openid }).limit(1).get()
  if (found.data.length) return found.data[0]
  const doc = {
    openid,
    displayName: '',
    role: 'guest',
    applyNote: '',
    createdAt: now,
    updatedAt: now,
  }
  const added = await users.add({ data: doc })
  return { _id: added._id, ...doc }
}

async function getAll(collection) {
  const res = await db.collection(collection).limit(200).get()
  return res.data
}

async function seedAssetsForExistingSites() {
  const existing = await db.collection('assets').limit(1).get()
  if (existing.data.length) return false
  const sites = await getAll('sites')
  if (!sites.length) return false
  const now = new Date()
  const siteByKey = {}
  sites.forEach((site) => {
    const key = site.seedKey || SITE_KEY_BY_NAME[site.name]
    if (key) siteByKey[key] = site
  })
  let added = false
  for (const item of SITE_SEED) {
    const site = siteByKey[item.key]
    if (!site) continue
    for (const asset of item.assets) {
      await db.collection('assets').add({
        data: {
          siteId: site._id,
          name: asset.name,
          category: asset.category,
          quantity: asset.quantity,
          note: asset.note,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      })
      added = true
    }
  }
  return added
}

async function backfillCats() {
  const cats = await getAll('cats')
  const sites = await getAll('sites')
  const assets = await getAll('assets')
  const siteIdByKey = {}
  sites.forEach((site) => {
    const key = site.seedKey || SITE_KEY_BY_NAME[site.name]
    if (key) siteIdByKey[key] = site._id
  })
  const dateKey = shanghaiDateKey()
  let patched = 0
  for (const cat of cats) {
    if (cat.campusStatus && cat.gender && cat.ageText != null) continue
    const extra = CAT_PROFILE_BY_NAME[cat.name] || {}
    let assetId = cat.assetId || ''
    if (!assetId && extra.assetName && extra.siteKey) {
      const siteId = siteIdByKey[extra.siteKey]
      const found = assets.find((a) => a.siteId === siteId && a.name === extra.assetName)
      if (found) assetId = found._id
    }
    await db.collection('cats').doc(cat._id).update({
      data: {
        campusStatus: cat.campusStatus || extra.campusStatus || 'on_campus',
        ageText: cat.ageText || extra.ageText || '',
        gender: cat.gender || extra.gender || 'unknown',
        breed: cat.breed || extra.breed || '',
        healthStatus: cat.healthStatus || extra.healthStatus || 'unknown',
        assetId,
        lastDiet: cat.lastDiet || dietOf(extra.diet, dateKey),
        updatedAt: new Date(),
      },
    })
    patched += 1
  }
  return patched
}

async function safeGet(name) {
  try {
    return await getAll(name)
  } catch (e) {
    return []
  }
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '无法识别微信身份' }
  }

  await Promise.all(COLLECTIONS.map((name) => ensureCollection(name)))

  const user = await ensureUser(OPENID)
  const adminRes = await db.collection('users').where({ role: 'admin' }).limit(1).get()
  const hasAdmin = !!adminRes.data.length

  if (hasAdmin && user.role !== 'admin') {
    return { ok: false, code: 'FORBIDDEN', message: '已有管理员，仅管理员可再次写入种子数据' }
  }

  let promoted = false
  if (!hasAdmin) {
    await db.collection('users').doc(user._id).update({
      data: {
        role: 'admin',
        approvedAt: new Date(),
        approvedBy: OPENID,
        updatedAt: new Date(),
      },
    })
    user.role = 'admin'
    promoted = true
  }

  const now = new Date()
  const dateKey = shanghaiDateKey()
  let sites = await safeGet('sites')
  let seeded = false
  let patched = false

  if (!sites.length) {
    const addedSites = await Promise.all(SITE_SEED.map((item) => {
      const { cages, assets, key, ...site } = item
      return db.collection('sites').add({
        data: { ...site, seedKey: key, createdAt: now, updatedAt: now },
      }).then((added) => ({ key, _id: added._id, cages, assets, name: site.name }))
    }))
    sites = addedSites.map((s) => ({ _id: s._id, seedKey: s.key, name: s.name }))
    seeded = true

    const siteIdByKey = {}
    addedSites.forEach((s) => { siteIdByKey[s.key] = s._id })

    const cageJobs = []
    const assetJobs = []
    addedSites.forEach((s) => {
      (s.cages || []).forEach((cage) => {
        cageJobs.push(
          db.collection('cages').add({
            data: {
              siteId: s._id,
              code: cage.code,
              note: cage.note,
              enabled: true,
              createdAt: now,
              updatedAt: now,
            },
          }).then((added) => [`${s.key}:${cage.code}`, added._id]),
        )
      })
      ;(s.assets || []).forEach((asset) => {
        assetJobs.push(
          db.collection('assets').add({
            data: {
              siteId: s._id,
              name: asset.name,
              category: asset.category,
              quantity: asset.quantity,
              note: asset.note,
              enabled: true,
              createdAt: now,
              updatedAt: now,
            },
          }).then((added) => [`${s.key}:${asset.name}`, added._id]),
        )
      })
    })
    const [cagePairs, assetPairs] = await Promise.all([
      Promise.all(cageJobs),
      Promise.all(assetJobs),
    ])
    const cageIdBySiteCode = Object.fromEntries(cagePairs)
    const assetIdBySiteName = Object.fromEntries(assetPairs)

    const cats = await safeGet('cats')
    if (!cats.length) {
      await Promise.all(CAT_SEED.map((cat) => db.collection('cats').add({
        data: {
          name: cat.name,
          status: cat.status,
          campusStatus: cat.campusStatus,
          siteId: cat.siteKey ? siteIdByKey[cat.siteKey] || '' : '',
          cageId: cat.cageCode ? cageIdBySiteCode[`${cat.siteKey}:${cat.cageCode}`] || '' : '',
          assetId: cat.assetName ? assetIdBySiteName[`${cat.siteKey}:${cat.assetName}`] || '' : '',
          ageText: cat.ageText,
          gender: cat.gender,
          breed: cat.breed,
          healthStatus: cat.healthStatus,
          notes: cat.notes,
          lastDiet: dietOf(cat.diet, dateKey),
          createdAt: now,
          updatedAt: now,
        },
      })))
    }

  } else {
    const addedAssets = await seedAssetsForExistingSites()
    const patchedCats = await backfillCats()
    patched = patched || addedAssets || patchedCats > 0
  }

  let message = '点位数据已存在，未重复写入。'
  if (seeded) message = '已写入演示点位、笼子、固定资产和猫咪档案。'
  else if (patched) message = '点位已存在。已补写缺失的固定资产或猫档字段。'

  return {
    ok: true,
    data: {
      seeded,
      patched,
      promoted,
      user: publicUser(user),
      message,
    },
  }
}
