const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const SITE_SEED = [
  {
    key: 'base',
    name: '示例寄养点',
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
    name: '示例自动喂食点',
    type: '自动喂食点',
    publicDesc: '自动喂食机补粮与巡查。',
    address: '详细位置由管理员填写。',
    lockNote: '设备锁说明由管理员填写，勿写入真实密码。',
    sort: 30,
    enabled: true,
    cages: [],
    assets: [
      { name: '示例喂食机', category: 'feeder', quantity: 1, note: '补粮巡查' },
      { name: '备用食盆', category: 'bowl', quantity: 1, note: '' },
    ],
  },
  {
    key: 'yifu',
    name: '示例投喂点 B',
    type: '投喂点',
    publicDesc: '投喂点。',
    address: '详细位置由管理员填写。',
    lockNote: '',
    sort: 40,
    enabled: true,
    cages: [],
    assets: [{ name: '示例 B食盆', category: 'bowl', quantity: 2, note: '' }],
  },
  {
    key: 'xiangbo',
    name: '祥波',
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

const CAT_SEED = []

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
