const STORAGE_KEY = 'apa_duty_live_v1'
const LEGACY_KEYS = ['apa_duty_mock_v7', 'apa_duty_mock_v6', 'apa_duty_mock_v5']

const SITE_SEED = [
  {
    _id: 'site_base',
    name: '豪宅',
    routineDutyEnabled: true,
    type: '基地',
    publicDesc: '寄养与护理主点位，笼子占用以现场为准。',
    address: '演示用假地址：校园东侧寄养点（非正式门牌）。',
    lockNote: '门锁说明由管理员自行填写。请勿写入真实密码。',
    confidential: true,
    sort: 10,
    enabled: true,
  },
  {
    _id: 'site_ta',
    name: 'TA',
    routineDutyEnabled: true,
    type: '投喂点',
    publicDesc: '投喂点。幼猫少加粮，优先小包装幼猫粮。',
    address: '详细位置由管理员填写。',
    lockNote: '',
    confidential: false,
    sort: 20,
    enabled: true,
  },
  {
    _id: 'site_sitin',
    name: '思廷自动喂食机',
    routineDutyEnabled: false,
    type: '自动喂食点',
    publicDesc: '自动喂食机补粮与巡查。',
    address: '详细位置由管理员填写。',
    lockNote: '设备锁说明由管理员填写，勿写入真实密码。',
    confidential: false,
    sort: 30,
    enabled: true,
  },
  {
    _id: 'site_yifu',
    name: '逸夫',
    routineDutyEnabled: false,
    type: '投喂点',
    publicDesc: '投喂点。',
    address: '详细位置由管理员填写。',
    lockNote: '',
    confidential: false,
    sort: 40,
    enabled: true,
  },
  {
    _id: 'site_xiangbo',
    name: '祥波',
    routineDutyEnabled: true,
    type: '投喂点',
    publicDesc: '投喂点，可记录本次是否已喂。',
    address: '详细位置由管理员填写。',
    lockNote: '',
    confidential: false,
    sort: 50,
    enabled: true,
  },
]

const CAGE_SEED = [
  { _id: 'cage_a1', siteId: 'site_base', code: 'A1', note: '靠窗', enabled: true },
  { _id: 'cage_a2', siteId: 'site_base', code: 'A2', note: '', enabled: true },
  { _id: 'cage_a3', siteId: 'site_base', code: 'A3', note: '', enabled: true },
  { _id: 'cage_b1', siteId: 'site_base', code: 'B1', note: '', enabled: true },
  { _id: 'cage_b2', siteId: 'site_base', code: 'B2', note: '', enabled: true },
  { _id: 'cage_obs', siteId: 'site_base', code: '观察笼', note: '隔离/观察用', enabled: true },
  { _id: 'cage_ta', siteId: 'site_ta', code: '临时笼', note: '外出收容时使用', enabled: true },
]

const ASSET_SEED = [
  { _id: 'asset_base_bowl', siteId: 'site_base', name: '不锈钢食盆', category: 'bowl', quantity: 6, note: '日常投喂', enabled: true },
  { _id: 'asset_base_water', siteId: 'site_base', name: '自动饮水机', category: 'water', quantity: 2, note: '', enabled: true },
  { _id: 'asset_base_med', siteId: 'site_base', name: '常用药箱', category: 'medicine', quantity: 1, note: '外用药与驱虫', enabled: true },
  { _id: 'asset_base_feeder', siteId: 'site_base', name: '备用喂食机', category: 'feeder', quantity: 1, note: '', enabled: true },
  { _id: 'asset_ta_bowl', siteId: 'site_ta', name: '投喂食盆', category: 'bowl', quantity: 2, note: '', enabled: true },
  { _id: 'asset_ta_water', siteId: 'site_ta', name: '饮水碗', category: 'water', quantity: 1, note: '', enabled: true },
  { _id: 'asset_sitin_feeder', siteId: 'site_sitin', name: '思廷喂食机', category: 'feeder', quantity: 1, note: '补粮巡查', enabled: true },
  { _id: 'asset_sitin_bowl', siteId: 'site_sitin', name: '备用食盆', category: 'bowl', quantity: 1, note: '', enabled: true },
  { _id: 'asset_yifu_bowl', siteId: 'site_yifu', name: '逸夫食盆', category: 'bowl', quantity: 2, note: '', enabled: true },
  { _id: 'asset_xiangbo_bowl', siteId: 'site_xiangbo', name: '祥波食盆', category: 'bowl', quantity: 2, note: '', enabled: true },
  { _id: 'asset_xiangbo_water', siteId: 'site_xiangbo', name: '祥波饮水机', category: 'water', quantity: 1, note: '', enabled: true },
]

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(dateKey, n) {
  const parts = String(dateKey).split('-').map(Number)
  const dt = new Date(parts[0], parts[1] - 1, parts[2])
  dt.setDate(dt.getDate() + n)
  return todayKey(dt)
}

function catSeed() {
  const dateKey = todayKey()
  return [
    {
      _id: 'cat_mocha',
      name: '摩卡',
      status: 'in_care',
      campusStatus: 'on_campus',
      siteId: 'site_base',
      cageId: 'cage_a1',
      assetId: '',
      ageText: '约3岁',
      gender: 'female',
      breed: '狸花',
      healthStatus: 'healthy',
      notes: '按个体护理，执勤时核对现场说明。',
      lastDiet: { ate: true, drank: true, note: '干粮适量', dateKey },
      neutered: true,
      sterilizeNeed: false,
    },
    {
      _id: 'cat_sangshen',
      name: '桑葚',
      status: 'medical',
      campusStatus: 'medical',
      siteId: '',
      cageId: '',
      assetId: '',
      ageText: '约2岁',
      gender: 'female',
      breed: '橘白',
      healthStatus: 'recovering',
      notes: '已送医住院。笼子和固定资产已释放，回校后再挂笼。',
      hospitalStay: {
        hospitalName: '演示：南山区某宠物医院',
        reason: '术后换药与观察',
        contactName: '演示成员',
        contactPhone: '13800000000',
        insurancePayer: '协会公共保险',
        insuranceNote: '演示保单，非正式',
        sentAt: Date.now() - 86400000,
        sentByName: '演示管理员',
        fromSiteName: '豪宅',
      },
      neutered: true,
      sterilizeNeed: false,
      lastDiet: { ate: true, drank: true, note: '按医嘱湿粮', dateKey },
    },
    {
      _id: 'cat_macchiato',
      name: '玛奇朵',
      status: 'in_care',
      campusStatus: 'on_campus',
      siteId: 'site_base',
      cageId: 'cage_a3',
      assetId: '',
      ageText: '约1岁',
      gender: 'female',
      breed: '奶牛',
      healthStatus: 'healthy',
      notes: '刚从医院回来，按特护方案喂药、换纱布。',
      neutered: true,
      sterilizeNeed: false,
      lastDiet: { ate: true, drank: false, note: '饮水偏少，请留意', dateKey },
    },
    {
      _id: 'cat_loud',
      name: '好大声',
      status: 'in_care',
      campusStatus: 'on_campus',
      siteId: 'site_ta',
      cageId: '',
      assetId: 'asset_ta_bowl',
      ageText: '幼猫约8月',
      gender: 'male',
      breed: '狸花',
      healthStatus: 'healthy',
      notes: '该点活动，未入笼，占用投喂食盆。待绝育。',
      neutered: false,
      sterilizeNeed: true,
      lastDiet: null,
    },
    {
      _id: 'cat_white',
      name: '小白',
      status: 'pending_release',
      campusStatus: 'on_campus',
      siteId: 'site_base',
      cageId: 'cage_b1',
      assetId: '',
      ageText: '约4岁',
      gender: 'male',
      breed: '白猫',
      healthStatus: 'healthy',
      notes: '待放，确认状态后再移动。',
      neutered: true,
      sterilizeNeed: false,
      lastDiet: { ate: true, drank: true, note: '', dateKey },
    },
    {
      _id: 'cat_gray',
      name: '小灰',
      status: 'observe',
      campusStatus: 'on_campus',
      siteId: 'site_yifu',
      cageId: '',
      assetId: '',
      ageText: '约2岁',
      gender: 'unknown',
      breed: '灰猫',
      healthStatus: 'unknown',
      notes: '逸夫附近观察，未占用笼子或固定资产。',
      neutered: true,
      sterilizeNeed: false,
      lastDiet: null,
    },
    {
      _id: 'cat_naigai',
      name: '奶盖',
      status: 'observe',
      campusStatus: 'on_campus',
      siteId: '',
      cageId: '',
      assetId: '',
      ageText: '约1岁',
      gender: 'female',
      breed: '乳白',
      healthStatus: 'healthy',
      notes: '校园已发现，暂未挂到固定点位。待绝育。',
      neutered: false,
      sterilizeNeed: true,
      lastDiet: null,
    },
  ]
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function emptyTaskItems() {
  return {
    food: { done: false, doneByName: '', doneAt: null },
    water: { done: false, doneByName: '', doneAt: null },
    litter: { done: false, doneByName: '', doneAt: null },
  }
}

function taskSeed(dateKey, now) {
  const doneItems = {
    food: { done: true, doneByName: '演示成员', doneAt: now },
    water: { done: true, doneByName: '演示成员', doneAt: now },
    litter: { done: true, doneByName: '演示成员', doneAt: now },
  }
  return [
    {
      _id: 'task_mocha',
      dateKey,
      catId: 'cat_mocha',
      catName: '摩卡',
      siteId: 'site_base',
      siteName: '豪宅',
      cageCode: 'A1',
      status: 'open',
      claimedBy: '',
      claimedByName: '',
      claimedAt: null,
      items: emptyTaskItems(),
      kind: 'routine',
      createdAt: now,
    },
    {
      _id: 'task_macchiato',
      dateKey,
      catId: 'cat_macchiato',
      catName: '玛奇朵',
      siteId: 'site_base',
      siteName: '豪宅',
      cageCode: 'A3',
      status: 'claimed',
      claimedBy: 'mock_member',
      claimedByName: '演示成员',
      claimedAt: now,
      items: {
        food: { done: true, doneByName: '演示成员', doneAt: now },
        water: { done: false, doneByName: '', doneAt: null },
        litter: { done: false, doneByName: '', doneAt: null },
      },
      kind: 'routine',
      createdAt: now,
    },
    {
      _id: 'task_white',
      dateKey,
      catId: 'cat_white',
      catName: '小白',
      siteId: 'site_base',
      siteName: '豪宅',
      cageCode: 'B1',
      status: 'done',
      claimedBy: 'mock_member',
      claimedByName: '演示成员',
      claimedAt: now,
      items: doneItems,
      kind: 'routine',
      createdAt: now,
    },
    {
      _id: 'task_macchiato_care',
      dateKey,
      kind: 'care',
      planId: 'plan_macchiato',
      catId: 'cat_macchiato',
      catName: '玛奇朵',
      siteId: 'site_base',
      siteName: '豪宅',
      cageCode: 'A3',
      title: '术后特护',
      status: 'open',
      claimedBy: '',
      claimedByName: '',
      claimedAt: null,
      items: [
        { key: 'meds', label: '喂药', done: false, doneByName: '', doneAt: null },
        { key: 'bandage', label: '换纱布', done: false, doneByName: '', doneAt: null },
      ],
      createdAt: now,
    },
  ]
}

function carePlanSeed(dateKey, now) {
  return [
    {
      _id: 'plan_macchiato',
      catId: 'cat_macchiato',
      catName: '玛奇朵',
      siteId: 'site_base',
      title: '术后特护',
      items: [
        { key: 'meds', label: '喂药' },
        { key: 'bandage', label: '换纱布' },
      ],
      startDateKey: dateKey,
      endDateKey: addDays(dateKey, 4),
      tutorial: {
        text: '先洗手。按图示顺序：喂药 → 观察伤口 → 更换纱布。此为演示占位，非正式医嘱。',
        photoFileIds: [],
      },
      enabled: true,
      createdAt: now,
    },
  ]
}

function defaultState() {
  const now = Date.now()
  const dateKey = todayKey()
  return {
    currentUserId: 'user_pending',
    users: [
      {
        _id: 'user_guest',
        openid: 'mock_guest',
        displayName: '',
        role: 'guest',
        applyNote: '',
        createdAt: now,
      },
      {
        _id: 'user_pending',
        openid: 'mock_pending',
        displayName: '等待审核的同学',
        role: 'pending',
        applyNote: '',
        appliedAt: now,
        createdAt: now,
      },
      {
        _id: 'user_member',
        openid: 'mock_member',
        displayName: '演示成员',
        role: 'member',
        applyNote: '本地演示身份',
        createdAt: now,
        approvedAt: now,
      },
      {
        _id: 'user_admin',
        openid: 'mock_admin',
        displayName: '演示管理员',
        role: 'admin',
        applyNote: '',
        createdAt: now,
        approvedAt: now,
      },
    ],
    mockDateKey: dateKey,
    sites: clone(SITE_SEED),
    cages: clone(CAGE_SEED),
    assets: clone(ASSET_SEED),
    cats: catSeed().map((c) => ({ ...c, updatedAt: now })),
    cat_tasks: taskSeed(dateKey, now),
    care_plans: carePlanSeed(dateKey, now),
    access_requests: [],
    finance_entries: [
      { _id: 'fin_1', dateKey, type: 'income', amount: 200, category: '捐款', remark: '演示电子捐助入账', handlerName: '演示管理员', createdAt: now },
      { _id: 'fin_2', dateKey, type: 'expense', amount: 86.5, category: '买药', remark: '演示外用药', handlerName: '演示管理员', createdAt: now },
      { _id: 'fin_3', dateKey, type: 'expense', amount: 120, category: '猫粮', remark: '演示补粮', handlerName: '演示成员', createdAt: now },
    ],
    donations: [
      {
        _id: 'don_e1',
        name: '爱心转账',
        quantity: '200元',
        donorName: '匿名校友',
        electronic: true,
        location: '',
        status: 'used',
        createdBy: 'mock_member',
        createdAt: now,
      },
      {
        _id: 'don_p1',
        name: '成猫粮',
        quantity: '5袋',
        donorName: '演示成员',
        electronic: false,
        location: '校园驿站（演示）',
        status: 'moving',
        createdBy: 'mock_member',
        createdAt: now,
      },
    ],
    move_tasks: [
      {
        _id: 'move_1',
        kind: 'move',
        donationId: 'don_p1',
        dateKey,
        title: '搬运 成猫粮',
        itemName: '成猫粮',
        quantity: '5袋',
        fromLocation: '校园驿站（演示）',
        toLocation: '豪宅',
        status: 'open',
        claimedBy: '',
        claimedByName: '',
        claimedAt: null,
        createdAt: now,
      },
    ],
    szcat_config: {
      monthKey: dateKey.slice(0, 7),
      openNote: '演示：管理员备注本月指标大约在月初开放，以深圳猫网公告为准。',
      notice: '名额有限，按官方规则报名。禁止多人刷号或使用任何自动提交工具。本小程序只做准备与跳转。',
      officialUrl: 'https://www.szcat.org/',
      platformUrl: 'https://ph.szcat.org/newskin/frmnsszcati.aspx',
    },
    szcat_claims: [
      {
        _id: 'szcat_loud',
        catId: 'cat_loud',
        catName: '好大声',
        monthKey: dateKey.slice(0, 7),
        status: 'submitted',
        claimedBy: 'mock_member',
        claimedByName: '演示成员',
        createdAt: now,
      },
    ],
    hospital_visits: [
      {
        _id: 'hosp_sangshen',
        catId: 'cat_sangshen',
        catName: '桑葚',
        hospitalName: '演示：南山区某宠物医院',
        reason: '术后换药与观察',
        contactName: '演示成员',
        contactPhone: '13800000000',
        insurancePayer: '协会公共保险',
        insuranceNote: '演示保单，非正式',
        sentAt: now - 86400000,
        sentByName: '演示管理员',
        fromSiteName: '豪宅',
        returnedAt: null,
        returnedByName: '',
      },
    ],
    duty_records: [],
    routine_duty_checkins: [],
    operation_logs: [],
    work_tasks: [],
    diet_logs: [],
    work_credit_events: [],
  }
}

function ensureShape(state) {
  if (!state || !state.users || !state.sites) return defaultState()
  if (!Array.isArray(state.assets)) state.assets = clone(ASSET_SEED)
  if (!Array.isArray(state.cat_tasks)) state.cat_tasks = []
  if (!Array.isArray(state.routine_duty_checkins)) state.routine_duty_checkins = []
  if (!Array.isArray(state.access_requests)) state.access_requests = []
  if (!Array.isArray(state.care_plans)) state.care_plans = []
  if (!Array.isArray(state.finance_entries)) state.finance_entries = []
  if (!Array.isArray(state.donations)) state.donations = []
  if (!Array.isArray(state.move_tasks)) state.move_tasks = []
  if (!Array.isArray(state.szcat_claims)) state.szcat_claims = []
  if (!Array.isArray(state.hospital_visits)) state.hospital_visits = []
  if (!Array.isArray(state.work_tasks)) state.work_tasks = []
  if (!Array.isArray(state.diet_logs)) state.diet_logs = []
  if (!Array.isArray(state.work_task_reports)) state.work_task_reports = []
  if (!Array.isArray(state.work_task_events)) state.work_task_events = []
  if (!Array.isArray(state.szcat_copies)) state.szcat_copies = []
  if (!Array.isArray(state.adopt_candidates)) state.adopt_candidates = []
  if (!Array.isArray(state.work_credit_events)) state.work_credit_events = []
  if (!Array.isArray(state.media_files)) state.media_files = []
  if (!state.szcat_config) {
    state.szcat_config = {
      monthKey: todayKey().slice(0, 7),
      openNote: '',
      notice: '名额有限，按官方规则报名。本小程序只做准备与跳转。',
      officialUrl: 'https://www.szcat.org/',
      platformUrl: 'https://ph.szcat.org/newskin/frmnsszcati.aspx',
    }
  }
  if (!state.mockDateKey) state.mockDateKey = todayKey()
  state.cats = (state.cats || []).map((c) => ({
    campusStatus: 'on_campus',
    ageText: '',
    gender: 'unknown',
    breed: '',
    healthStatus: 'unknown',
    assetId: '',
    lastDiet: null,
    ...c,
    siteId: c.siteId || '',
    cageId: c.cageId || '',
    assetId: c.assetId || '',
  }))
  return state
}

const memory = { data: null }

function hasWx() {
  return typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function'
}

function applyLoopRole(state) {
  if (!hasWx()) return state
  try {
    const loop = require('./loop-role.js')
    if (loop && loop.userId && (state.users || []).some((u) => u._id === loop.userId)) {
      state.currentUserId = loop.userId
    }
  } catch (e) {
    // 没有 loop-role 就保持原身份
  }
  return state
}

function applyTrialAdmin(state) {
  if (!hasWx()) return state
  try {
    const { isTrial } = require('../utils/env')
    if (!isTrial()) return state
    const admin = (state.users || []).find((u) => u._id === 'user_admin')
      || (state.users || []).find((u) => u.role === 'admin')
    if (admin) state.currentUserId = admin._id
  } catch (e) {
    // 读不到环境就保持原身份
  }
  return state
}

function readPersisted() {
  if (!hasWx()) return memory.data
  const current = wx.getStorageSync(STORAGE_KEY)
  if (current && current.users && current.sites) return current
  for (let i = 0; i < LEGACY_KEYS.length; i += 1) {
    const legacy = wx.getStorageSync(LEGACY_KEYS[i])
    if (legacy && legacy.users && legacy.sites) return legacy
  }
  return null
}

function load() {
  try {
    const raw = readPersisted()
    if (raw && raw.users && raw.sites) {
      const state = applyTrialAdmin(applyLoopRole(ensureShape(raw)))
      save(state)
      return state
    }
  } catch (e) {
    // 读失败时绝不覆盖已有缓存，下面再尝试一次只读路径
    try {
      const raw = readPersisted()
      if (raw && raw.users && raw.sites) return applyTrialAdmin(applyLoopRole(ensureShape(raw)))
    } catch (ignored) {
      // ignore
    }
  }
  const state = defaultState()
  applyTrialAdmin(applyLoopRole(state))
  save(state)
  return state
}

function save(state) {
  if (hasWx()) {
    wx.setStorageSync(STORAGE_KEY, state)
  } else {
    memory.data = state
  }
}

function reset() {
  const state = defaultState()
  save(state)
  return state
}

module.exports = {
  load,
  save,
  reset,
  defaultState,
}
