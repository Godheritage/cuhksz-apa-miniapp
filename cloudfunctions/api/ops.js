// 功能 5–9：猫务、保密地址、就医特护、财务/捐助/搬运、深圳猫网准备。权限在函数内校验。
const ROUTINE_LABELS = { food: '添食物', water: '添水', litter: '铲猫砂' }
const { buildOrgExport } = require('./csv')
const { buildWorkRecords } = require('./workload')
const { board: ROSTER_BOARD, insuranceLine, creditEvents, storedBoard, boardView } = require('./rosterImport')
const {
  parseDeadlineDateKey, parseScope, parseWeekdays, taskCycleKey,
  normalizeScope, applyScopeView, filterOverlaysForScope,
} = require('./taskScope')
const FINANCE_CATS = { 捐款: 1, 买药: 1, 猫粮: 1, 交通: 1, 其他: 1 }
const DONATE_STATUS = { pending_in: '待入库', on_site: '已在点上', moving: '搬运中', used: '已用完' }
const SZCAT_CLAIM = { open: '待抢', claimed: '已认领', submitted: '已提交', won: '已中签', lost: '未中签', done: '已手术' }

function attachCloudOps(handlers, ctx) {
  const {
    db, _, getAll, getById, writeLog, addDoc, quietUpdate, quietLog, photoIds, saveMedia, loadMediaMap, attachTempUrls, routineDutyEnabled,
    ok, fail, isApproved, isAdmin, shanghaiDateKey, ensureOnDuty,
  } = ctx
  const MOVE_BOARD = { _id: 'move_board', name: '搬运' }
  const GENERAL_BOARD = { _id: 'general', name: '不限地点' }
  const ROUTINE_SITE_ORDER = ['base', 'xiangbo', 'ta']
  const ROUTINE_SHIFTS = [
    { id: 'morning', name: '早班' },
    { id: 'noon', name: '午班' },
    { id: 'evening', name: '晚班' },
    { id: 'overnight', name: '凌晨' },
  ]

  function routineSites(sites) {
    const order = (site) => {
      const key = site.seedKey || ({ 示例寄养点: 'base', 祥波: 'xiangbo', TA: 'ta' })[site.name]
      const index = ROUTINE_SITE_ORDER.indexOf(key)
      return index >= 0 ? index : 100 + (Number(site.sort) || 99)
    }
    return sites.filter((site) => site.enabled !== false && routineDutyEnabled(site))
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, 'zh-CN'))
      .map((site) => ({ _id: site._id, name: site.name }))
  }

  function addDays(dateKey, n) {
    const parts = String(dateKey).split('-').map(Number)
    const dt = new Date(parts[0], parts[1] - 1, parts[2] + n)
    return shanghaiDateKey(dt)
  }

  function makePassword() {
    return String(100000 + Math.floor(Math.random() * 900000))
  }

  function requestStatus(req, dateKey) {
    if (!req) return ''
    if (req.status === 'approved' && req.expireDateKey && req.expireDateKey < dateKey) return 'expired'
    return req.status
  }

  function publicAccess(req, dateKey, includePassword) {
    const status = requestStatus(req, dateKey)
    return {
      _id: req._id,
      siteId: req.siteId,
      siteName: req.siteName,
      displayName: req.displayName,
      status,
      expireDateKey: req.expireDateKey || '',
      password: includePassword && status === 'approved' ? (req.password || '') : '',
      createdAt: req.createdAt,
    }
  }

  async function latestRequest(openid, siteId) {
    const rows = await getAll('access_requests', { openid, siteId })
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return rows[0] || null
  }

  function isResidentCat(cat, site) {
    const campus = cat.campusStatus || 'on_campus'
    if (campus === 'off_campus' || campus === 'medical') return false
    if (!cat.siteId || !site) return false
    return !!cat.cageId || site.type === 'base' || site.type === '基地'
  }

  function emptyRoutineItems() {
    return ['food', 'water', 'litter'].map((key) => ({
      key,
      label: ROUTINE_LABELS[key],
      done: false,
      doneByName: '',
      doneAt: null,
    }))
  }

  function decorateTask(task, user, plan) {
    const items = Array.isArray(task.items) ? task.items : emptyRoutineItems()
    const doneCount = items.filter((i) => i.done).length
    return {
      _id: task._id,
      kind: task.kind || 'routine',
      kindLabel: task.kind === 'care' ? '特护·限时' : '常规点检',
      planId: task.planId || '',
      title: task.title || '每日点检',
      dateKey: task.dateKey,
      catId: task.catId,
      catName: task.catName,
      siteId: task.siteId,
      siteName: task.siteName,
      cageCode: task.cageCode || '',
      status: task.status,
      claimedByName: task.claimedByName || '',
      mine: task.claimedBy === user.openid,
      items,
      doneCount,
      totalCount: items.length,
      canClaim: task.status === 'open',
      canComplete: task.status !== 'done' && (user.role === 'admin' || task.claimedBy === user.openid),
      canReset: user.role === 'admin',
      tutorial: plan && plan.tutorial
        ? { text: plan.tutorial.text || '', photos: plan.tutorial.photoFileIds || [] }
        : { text: '', photos: [] },
    }
  }

  async function ensureRoutineTasks(dateKey) {
    const cats = await getAll('cats')
    const sites = await getAll('sites')
    const cages = await getAll('cages')
    const existing = await getAll('cat_tasks', { dateKey, kind: 'routine' })
    const have = new Set(existing.map((t) => t.catId))
    for (const cat of cats) {
      const site = sites.find((s) => s._id === cat.siteId)
      if (!isResidentCat(cat, site) || have.has(cat._id)) continue
      const cage = cages.find((c) => c._id === cat.cageId)
      await db.collection('cat_tasks').add({
        data: {
          kind: 'routine',
          title: '每日点检',
          dateKey,
          catId: cat._id,
          catName: cat.name,
          siteId: cat.siteId,
          siteName: site.name,
          cageCode: cage ? cage.code : '',
          status: 'open',
          claimedBy: '',
          claimedByName: '',
          claimedAt: null,
          items: emptyRoutineItems(),
          createdAt: Date.now(),
        },
      })
    }
  }

  async function ensureCareTasks(dateKey) {
    const plans = await getAll('care_plans', { enabled: _.neq(false) })
    const existing = await getAll('cat_tasks', { dateKey, kind: 'care' })
    const have = new Set(existing.map((t) => t.planId))
    for (const plan of plans) {
      if (!(plan.startDateKey <= dateKey && plan.endDateKey >= dateKey)) continue
      if (have.has(plan._id)) continue
      await db.collection('cat_tasks').add({
        data: {
          kind: 'care',
          planId: plan._id,
          title: plan.title,
          dateKey,
          catId: plan.catId,
          catName: plan.catName,
          siteId: plan.siteId || '',
          siteName: plan.siteName || '',
          cageCode: '',
          status: 'open',
          claimedBy: '',
          claimedByName: '',
          claimedAt: null,
          items: (plan.items || []).map((item) => ({
            key: item.key,
            label: item.label,
            done: false,
            doneByName: '',
            doneAt: null,
          })),
          createdAt: Date.now(),
        },
      })
    }
  }

  function financeCsv(rows) {
    const header = '日期,收支,金额,科目,备注,经手人'
    const lines = (rows || []).map((r) => [
      r.dateKey,
      r.type === 'income' ? '收入' : '支出',
      Number(r.amount || 0).toFixed(2),
      r.category || '其他',
      String(r.remark || '').replace(/,/g, '，'),
      String(r.handlerName || '').replace(/,/g, '，'),
    ].join(','))
    return [header].concat(lines).join('\n')
  }

  function parseFinanceCsv(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '').trim()
    if (!raw) return { rows: [], errors: ['CSV 为空'] }
    const lines = raw.split(/\r?\n/).filter((l) => l.trim())
    const header = lines[0].replace(/\s/g, '')
    if (header !== '日期,收支,金额,科目,备注,经手人') {
      return { rows: [], errors: ['表头必须是：日期,收支,金额,科目,备注,经手人'] }
    }
    const rows = []
    const errors = []
    lines.slice(1).forEach((line, idx) => {
      const cols = line.split(',')
      const dateKey = String(cols[0] || '').trim()
      const typeText = String(cols[1] || '').trim()
      const amount = Number(cols[2])
      const category = String(cols[3] || '其他').trim()
      const remark = String(cols[4] || '').trim()
      const handlerName = String(cols[5] || '').trim()
      const type = typeText === '收入' ? 'income' : typeText === '支出' ? 'expense' : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !type || Number.isNaN(amount) || amount < 0 || !FINANCE_CATS[category]) {
        errors.push(`第 ${idx + 2} 行无效`)
        return
      }
      rows.push({ dateKey, type, amount, category, remark, handlerName })
    })
    return { rows, errors }
  }

  handlers.listCatTasks = async function listCatTasks(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看猫务')
    const dateKey = event.dateKey || shanghaiDateKey()
    await ensureRoutineTasks(dateKey)
    await ensureCareTasks(dateKey)
    let rows = await getAll('cat_tasks', { dateKey })
    if (event.siteId) rows = rows.filter((t) => t.siteId === event.siteId)
    if (event.kind && event.kind !== 'move') rows = rows.filter((t) => (t.kind || 'routine') === event.kind)
    rows.sort((a, b) => {
      const order = { open: 0, claimed: 1, done: 2 }
      return (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(a.catName).localeCompare(String(b.catName), 'zh')
    })
    const plans = await getAll('care_plans')
    const planMap = {}
    plans.forEach((p) => { planMap[p._id] = p })
    const tasks = rows
      .filter((t) => t.kind !== 'move')
      .map((t) => decorateTask(t, user, planMap[t.planId]))

    let moves = await getAll('move_tasks', { dateKey })
    if (event.siteId || (event.kind && event.kind !== 'move')) moves = []
    const extra = moves.map((task) => ({
      _id: task._id,
      kind: 'move',
      kindLabel: '搬运',
      title: task.title,
      dateKey: task.dateKey,
      catId: '',
      catName: task.itemName,
      siteId: '',
      siteName: `${task.fromLocation} → ${task.toLocation}`,
      cageCode: '',
      status: task.status === 'done' ? 'done' : (task.status === 'claimed' ? 'claimed' : 'open'),
      claimedByName: task.claimedByName || '',
      mine: task.claimedBy === user.openid,
      items: [{ key: 'arrive', label: '送到目的地', done: task.status === 'done' }],
      doneCount: task.status === 'done' ? 1 : 0,
      totalCount: 1,
      canClaim: task.status === 'open',
      canComplete: task.status !== 'done' && (user.role === 'admin' || task.claimedBy === user.openid),
      canReset: false,
      isMove: true,
      tutorial: { text: `把「${task.itemName} ${task.quantity}」从 ${task.fromLocation} 搬到 ${task.toLocation}。`, photos: [] },
    }))
    return ok({ dateKey, isAdmin: isAdmin(user), tasks: tasks.concat(extra) })
  }

  handlers.claimCatTask = async function claimCatTask(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const task = await getById('cat_tasks', event.taskId)
    if (!task) return fail('NOT_FOUND', '任务不存在')
    if (task.status === 'done') return fail('INVALID', '今日该任务已完成')
    if (task.status === 'claimed' && task.claimedBy !== user.openid) {
      return fail('INVALID', `已被 ${task.claimedByName || '其他成员'} 领取`)
    }
    await db.collection('cat_tasks').doc(task._id).update({
      data: {
        status: 'claimed',
        claimedBy: user.openid,
        claimedByName: user.displayName || '未署名成员',
        claimedAt: Date.now(),
      },
    })
    if (typeof ensureOnDuty === 'function') await ensureOnDuty(user, task.siteId, 'task')
    await writeLog(user, { action: 'claim_cat_task', targetType: 'cat_task', targetId: task._id, siteId: task.siteId })
    return ok({ taskId: task._id, status: 'claimed' })
  }

  handlers.completeCatTaskItem = async function completeCatTaskItem(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const task = await getById('cat_tasks', event.taskId)
    if (!task) return fail('NOT_FOUND', '任务不存在')
    if (task.status === 'open' && user.role !== 'admin') return fail('INVALID', '请先领取任务')
    if (task.status === 'claimed' && task.claimedBy !== user.openid && user.role !== 'admin') {
      return fail('FORBIDDEN', '只有领取人或管理员可勾完成')
    }
    if (typeof ensureOnDuty === 'function') await ensureOnDuty(user, task.siteId, 'task')
    const key = String(event.item || '')
    const items = Array.isArray(task.items) ? task.items.slice() : emptyRoutineItems()
    const item = items.find((i) => i.key === key)
    if (!item) return fail('INVALID', '没有这一项')
    item.done = true
    item.doneByName = user.displayName || '未署名成员'
    item.doneAt = Date.now()
    const patch = { items }
    if (task.status === 'open') {
      patch.status = 'claimed'
      patch.claimedBy = user.openid
      patch.claimedByName = user.displayName || '管理员'
      patch.claimedAt = Date.now()
    }
    if (items.every((i) => i.done)) patch.status = 'done'
    await db.collection('cat_tasks').doc(task._id).update({ data: patch })
    await writeLog(user, { action: 'complete_cat_task_item', targetType: 'cat_task', targetId: task._id, siteId: task.siteId, after: { item: key } })
    return ok({ taskId: task._id, status: patch.status || task.status })
  }

  handlers.adminResetCatTask = async function adminResetCatTask(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可重置任务')
    const task = await getById('cat_tasks', event.taskId)
    if (!task) return fail('NOT_FOUND', '任务不存在')
    const items = (Array.isArray(task.items) ? task.items : emptyRoutineItems()).map((item) => ({
      ...item, done: false, doneByName: '', doneAt: null,
    }))
    await db.collection('cat_tasks').doc(task._id).update({
      data: { status: 'open', claimedBy: '', claimedByName: '', claimedAt: null, items },
    })
    return ok({ taskId: task._id, status: 'open' })
  }

  handlers.requestSiteAccess = async function requestSiteAccess(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能申请')
    if (isAdmin(user)) return fail('INVALID', '管理员可直接查看保密地址')
    const site = await getById('sites', event.siteId)
    if (!site) return fail('NOT_FOUND', '点位不存在')
    if (!site.confidential) return fail('INVALID', '该点不是保密地点')
    const dateKey = shanghaiDateKey()
    const prev = await latestRequest(user.openid, site._id)
    const status = requestStatus(prev, dateKey)
    if (status === 'pending') return fail('INVALID', '已有待审批申请')
    if (status === 'approved') return fail('INVALID', '已有当天有效的动态密码')
    const added = await db.collection('access_requests').add({
      data: {
        siteId: site._id,
        siteName: site.name,
        openid: user.openid,
        displayName: user.displayName || '未署名成员',
        status: 'pending',
        password: '',
        expireDateKey: '',
        createdAt: Date.now(),
      },
    })
    return ok({ request: { _id: added._id, siteId: site._id, status: 'pending' } })
  }

  handlers.listMyAccessRequests = async function listMyAccessRequests(_event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const dateKey = shanghaiDateKey()
    const rows = await getAll('access_requests', { openid: user.openid })
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return ok({ requests: rows.map((r) => publicAccess(r, dateKey, true)) })
  }

  handlers.revealSiteAddress = async function revealSiteAddress(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const site = await getById('sites', event.siteId)
    if (!site) return fail('NOT_FOUND', '点位不存在')
    if (!site.confidential || isAdmin(user)) {
      return ok({ address: site.address || '', lockNote: site.lockNote || '', expireDateKey: '' })
    }
    const dateKey = shanghaiDateKey()
    const req = await latestRequest(user.openid, site._id)
    if (requestStatus(req, dateKey) !== 'approved') return fail('FORBIDDEN', '请先申请并由管理员通过')
    if (String(event.password || '').trim() !== req.password) return fail('INVALID', '动态密码不正确')
    return ok({ address: site.address || '未填写', lockNote: site.lockNote || '无', expireDateKey: req.expireDateKey })
  }

  handlers.adminListAccessRequests = async function adminListAccessRequests(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可审批地址申请')
    const dateKey = shanghaiDateKey()
    let rows = await getAll('access_requests')
    if (event.status) rows = rows.filter((r) => requestStatus(r, dateKey) === event.status)
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return ok({ requests: rows.map((r) => publicAccess(r, dateKey, false)) })
  }

  handlers.adminDecideAccess = async function adminDecideAccess(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可审批地址申请')
    const req = await getById('access_requests', event.requestId)
    if (!req) return fail('NOT_FOUND', '申请不存在')
    const decision = event.decision === 'approved' ? 'approved' : 'rejected'
    const patch = { status: decision, decidedAt: Date.now() }
    if (decision === 'approved') {
      patch.password = makePassword()
      patch.expireDateKey = shanghaiDateKey()
    } else {
      patch.password = ''
      patch.expireDateKey = ''
    }
    await db.collection('access_requests').doc(req._id).update({ data: patch })
    await writeLog(user, { action: 'decide_access', targetType: 'access_request', targetId: req._id, siteId: req.siteId, after: { status: decision } })
    return ok({ requestId: req._id, status: decision })
  }

  handlers.listCarePlans = async function listCarePlans(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const dateKey = shanghaiDateKey()
    let rows = await getAll('care_plans')
    if (event.catId) rows = rows.filter((p) => p.catId === event.catId)
    return ok({
      dateKey,
      plans: rows.map((plan) => ({
        ...plan,
        active: !!(plan.enabled && plan.startDateKey <= dateKey && plan.endDateKey >= dateKey),
        expired: plan.endDateKey < dateKey,
      })),
    })
  }

  handlers.adminUpsertCarePlan = async function adminUpsertCarePlan(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护特护方案')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    const title = String(event.title || '').trim().slice(0, 20)
    if (!title) return fail('INVALID', '请填写特护名称')
    const items = (event.items || String(event.itemsText || '').split(/[,，]/))
      .map((item, idx) => {
        if (typeof item === 'string') return { key: `item_${idx + 1}`, label: item.trim().slice(0, 20) }
        return { key: String(item.key || `item_${idx + 1}`).slice(0, 16), label: String(item.label || '').trim().slice(0, 20) }
      })
      .filter((item) => item.label)
      .slice(0, 6)
    if (!items.length) return fail('INVALID', '请至少填写一项每日操作')
    const startDateKey = String(event.startDateKey || shanghaiDateKey())
    const endDateKey = String(event.endDateKey || addDays(startDateKey, 4))
    if (endDateKey < startDateKey) return fail('INVALID', '结束日期不能早于开始日期')
    const tutorial = {
      text: String((event.tutorial && event.tutorial.text) || event.tutorialText || '').trim().slice(0, 400),
      photoFileIds: ((event.tutorial && event.tutorial.photoFileIds) || event.photoFileIds || []).slice(0, 6),
    }
    const data = {
      catId: cat._id,
      catName: cat.name,
      siteId: cat.siteId || '',
      title,
      items,
      startDateKey,
      endDateKey,
      tutorial,
      enabled: event.enabled !== false,
      updatedAt: Date.now(),
    }
    let planId = event.planId
    if (planId) {
      const plan = await getById('care_plans', planId)
      if (!plan) return fail('NOT_FOUND', '特护方案不存在')
      await db.collection('care_plans').doc(planId).update({ data })
    } else {
      data.createdAt = Date.now()
      const added = await db.collection('care_plans').add({ data })
      planId = added._id
    }
    return ok({ planId })
  }

  handlers.adminDisableCarePlan = async function adminDisableCarePlan(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可结束特护')
    const plan = await getById('care_plans', event.planId)
    if (!plan) return fail('NOT_FOUND', '特护方案不存在')
    await db.collection('care_plans').doc(plan._id).update({ data: { enabled: false } })
    return ok({ planId: plan._id, enabled: false })
  }

  function parseHospitalStay(event) {
    const hospitalName = String(event.hospitalName || '').trim().slice(0, 40)
    const reason = String(event.reason || '').trim().slice(0, 80)
    const contactName = String(event.contactName || '').trim().slice(0, 20)
    const contactPhone = String(event.contactPhone || '').replace(/\D/g, '').slice(0, 13)
    const insurancePayer = String(event.insurancePayer || '').trim().slice(0, 40)
    const insuranceNote = String(event.insuranceNote || '').trim().slice(0, 40)
    if (!hospitalName) return { error: '请填写送到哪家医院' }
    if (!reason) return { error: '请填写送医原因' }
    if (!contactName) return { error: '请填写手机号是谁的（联系人）' }
    if (contactPhone.length < 8) return { error: '请填写有效手机号' }
    if (!insurancePayer) return { error: '请填写保险由谁付款' }
    return {
      stay: { hospitalName, reason, contactName, contactPhone, insurancePayer, insuranceNote },
    }
  }

  handlers.markCatHospital = async function markCatHospital(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    const already = (cat.campusStatus || '') === 'medical'
    if (!isAdmin(user) && !isApproved(user) && !already) return fail('FORBIDDEN', '通过审核的成员才能送猫就医')
    const parsed = parseHospitalStay(event)
    if (parsed.error) return fail('INVALID', parsed.error)
    const site = cat.siteId ? await getById('sites', cat.siteId) : null
    const prev = cat.hospitalStay || {}
    const stay = {
      ...parsed.stay,
      sentAt: prev.sentAt || Date.now(),
      sentByName: prev.sentByName || user.displayName || '未署名成员',
      fromSiteName: prev.fromSiteName || (site && site.name) || '',
    }
    await db.collection('cats').doc(cat._id).update({
      data: {
        campusStatus: 'medical',
        status: 'medical',
        siteId: '',
        cageId: '',
        assetId: '',
        hospitalStay: stay,
        updatedAt: new Date(),
      },
    })
    try {
      const open = await db.collection('hospital_visits').where({
        catId: cat._id,
        returnedAt: _.eq(null),
      }).limit(1).get()
      if (open.data.length) {
        await db.collection('hospital_visits').doc(open.data[0]._id).update({
          data: { ...stay, catName: cat.name },
        })
      } else {
        await db.collection('hospital_visits').add({
          data: {
            catId: cat._id,
            catName: cat.name,
            ...stay,
            returnedAt: null,
            returnedByName: '',
            createdAt: Date.now(),
          },
        })
      }
    } catch (e) {
      console.error('hospital_visits', e)
    }
    await writeLog(user, { action: already ? 'update_cat_hospital' : 'mark_cat_hospital', targetType: 'cat', targetId: cat._id })
    return ok({ catId: cat._id, campusStatus: 'medical', released: true, hospitalStay: stay })
  }

  handlers.returnCatFromHospital = async function returnCatFromHospital(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    if ((cat.campusStatus || '') !== 'medical') return fail('INVALID', '这只猫不在就医中')
    const now = Date.now()
    try {
      const open = await db.collection('hospital_visits').where({
        catId: cat._id,
        returnedAt: _.eq(null),
      }).limit(1).get()
      if (open.data.length) {
        await db.collection('hospital_visits').doc(open.data[0]._id).update({
          data: { returnedAt: now, returnedByName: user.displayName || '未署名成员' },
        })
      }
    } catch (e) {
      console.error('hospital_visits return', e)
    }
    await db.collection('cats').doc(cat._id).update({
      data: {
        campusStatus: 'on_campus',
        status: 'observe',
        lastHospitalStay: cat.hospitalStay || null,
        hospitalStay: null,
        updatedAt: new Date(),
      },
    })
    await writeLog(user, { action: 'return_cat_from_hospital', targetType: 'cat', targetId: cat._id })
    return ok({ catId: cat._id, campusStatus: 'on_campus', status: 'observe' })
  }

  handlers.adminListFinance = async function adminListFinance(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可查看台账')
    const entries = await getAll('finance_entries')
    entries.sort((a, b) => String(b.dateKey).localeCompare(a.dateKey))
    const income = entries.filter((e) => e.type === 'income').reduce((s, e) => s + Number(e.amount || 0), 0)
    const expense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + Number(e.amount || 0), 0)
    return ok({
      entries,
      income,
      expense,
      balance: income - expense,
      csv: financeCsv(entries),
      hint: 'CSV 表头必须是：日期,收支,金额,科目,备注,经手人（UTF-8）。',
    })
  }

  handlers.adminUpsertFinance = async function adminUpsertFinance(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可记账')
    const dateKey = String(event.dateKey || shanghaiDateKey())
    const type = event.type === 'income' ? 'income' : 'expense'
    const amount = Number(event.amount)
    const category = FINANCE_CATS[event.category] ? event.category : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return fail('INVALID', '日期不合法')
    if (Number.isNaN(amount) || amount < 0) return fail('INVALID', '金额不合法')
    if (!category) return fail('INVALID', '科目不合法')
    const data = {
      dateKey,
      type,
      amount,
      category,
      remark: String(event.remark || '').trim().slice(0, 80),
      handlerName: String(event.handlerName || user.displayName || '').trim().slice(0, 20),
      updatedAt: Date.now(),
    }
    let entryId = event.entryId
    if (entryId) {
      const row = await getById('finance_entries', entryId)
      if (!row) return fail('NOT_FOUND', '记录不存在')
      await db.collection('finance_entries').doc(entryId).update({ data })
    } else {
      data.createdAt = Date.now()
      const added = await db.collection('finance_entries').add({ data })
      entryId = added._id
    }
    return ok({ entryId })
  }

  handlers.adminDeleteFinance = async function adminDeleteFinance(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可删账')
    const row = await getById('finance_entries', event.entryId)
    if (!row) return fail('NOT_FOUND', '记录不存在')
    await db.collection('finance_entries').doc(row._id).remove()
    return ok({ entryId: row._id })
  }

  handlers.adminExportFinanceCsv = async function adminExportFinanceCsv(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可导出')
    const entries = await getAll('finance_entries')
    return ok({ csv: financeCsv(entries) })
  }

  handlers.adminImportFinanceCsv = async function adminImportFinanceCsv(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可导入')
    const parsed = parseFinanceCsv(event.csv || event.text)
    if (parsed.errors.length && !parsed.rows.length) return fail('INVALID', parsed.errors[0])
    for (const row of parsed.rows) {
      await db.collection('finance_entries').add({
        data: { ...row, createdAt: Date.now(), imported: true },
      })
    }
    return ok({ imported: parsed.rows.length, errors: parsed.errors })
  }

  handlers.submitDonation = async function submitDonation(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能登记捐助')
    const name = String(event.name || '').trim().slice(0, 20)
    const quantity = String(event.quantity || '').trim().slice(0, 16)
    const donorName = String(event.donorName || user.displayName || '').trim().slice(0, 20)
    const electronic = !!event.electronic
    const location = String(event.location || '').trim().slice(0, 40)
    if (!name) return fail('INVALID', '请填写物资名')
    if (!quantity) return fail('INVALID', '请填写数量')
    if (!donorName) return fail('INVALID', '请填写捐助人')
    if (!electronic && !location) return fail('INVALID', '实体物资必须填写当前位置')
    const added = await addDoc('donations', {
      name, quantity, donorName, electronic,
      location: electronic ? '' : location,
      status: electronic ? 'used' : 'pending_in',
      createdBy: user.openid,
      createdAt: Date.now(),
    })
    let moveTaskId = ''
    if (!electronic && event.publishMove) {
      const toLocation = String(event.toLocation || '').trim()
      if (!toLocation) return fail('INVALID', '发布搬运请填写运到哪里')
      const move = await createMoveWorkTask(user, {
        donationId: added._id,
        itemName: name,
        quantity,
        fromLocation: location,
        toLocation,
        photoFileIds: photoIds(event),
      })
      moveTaskId = move.taskId
    }
    return ok({ donationId: added._id, moveTaskId })
  }

  handlers.listDonations = async function listDonations(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    let rows = await getAll('donations')
    if (!isAdmin(user) && event.mineOnly) rows = rows.filter((d) => d.createdBy === user.openid)
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    let orgBalance = null
    if (isAdmin(user)) {
      const entries = await getAll('finance_entries')
      const income = entries.filter((e) => e.type === 'income').reduce((s, e) => s + Number(e.amount || 0), 0)
      const expense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + Number(e.amount || 0), 0)
      orgBalance = {
        income,
        expense,
        balance: income - expense,
      }
    }
    return ok({
      isAdmin: isAdmin(user),
      orgBalance,
      donations: rows.map((d) => ({
        ...d,
        statusText: d.electronic ? '电子捐助（无需仓储）' : (DONATE_STATUS[d.status] || d.status),
        canPublishMove: !d.electronic && d.status !== 'used' && d.status !== 'moving',
      })),
    })
  }

  handlers.adminSetDonationStatus = async function adminSetDonationStatus(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可改捐助状态')
    const row = await getById('donations', event.donationId)
    if (!row) return fail('NOT_FOUND', '捐助不存在')
    if (row.electronic) return fail('INVALID', '电子物资无需改仓储状态')
    if (!DONATE_STATUS[event.status]) return fail('INVALID', '状态不合法')
    const data = { status: event.status }
    if (event.location) data.location = String(event.location).trim().slice(0, 40)
    quietUpdate('donations', row._id, data)
    return ok({ donationId: row._id, status: event.status })
  }

  async function createMoveWorkTask(user, payload) {
    const toLocation = String(payload.toLocation || '').trim()
    const fromLocation = String(payload.fromLocation || '').trim()
    const itemName = String(payload.itemName || '物资').trim()
    const quantity = String(payload.quantity || '').trim()
    const photos = (payload.photoFileIds || []).filter(Boolean).slice(0, 6)
    const data = {
      kind: 'move',
      scope: 'timed',
      siteId: MOVE_BOARD._id,
      siteName: MOVE_BOARD.name,
      title: `搬运 ${itemName}`,
      content: `把「${itemName}${quantity ? ' ' + quantity : ''}」从 ${fromLocation || '未填'} 运到 ${toLocation}`,
      photoFileIds: photos,
      donationId: payload.donationId || '',
      fromLocation,
      toLocation,
      itemName,
      quantity,
      status: 'open',
      createdBy: user.openid,
      createdByName: user.displayName || '管理员',
      createdAt: Date.now(),
      report: null,
      rejectNote: '',
    }
    const added = await addDoc('work_tasks', data)
    if (payload.donationId) quietUpdate('donations', payload.donationId, { status: 'moving' })
    return { taskId: added._id, task: data }
  }

  handlers.adminPublishMoveTask = async function adminPublishMoveTask(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const don = await getById('donations', event.donationId)
    if (!don) return fail('NOT_FOUND', '捐助不存在')
    if (don.electronic) return fail('INVALID', '电子物资不能发搬运任务')
    const toLocation = String(event.toLocation || '').trim()
    if (!toLocation) return fail('INVALID', '请填写运到哪里')
    const move = await createMoveWorkTask(user, {
      donationId: don._id,
      itemName: don.name,
      quantity: don.quantity,
      fromLocation: event.fromLocation || don.location || '',
      toLocation,
      photoFileIds: photoIds(event),
    })
    return ok({ taskId: move.taskId })
  }

  handlers.claimMoveTask = async function claimMoveTask(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const task = await getById('move_tasks', event.taskId)
    if (!task) return fail('NOT_FOUND', '搬运任务不存在')
    if (task.status === 'done') return fail('INVALID', '已完成')
    if (task.status === 'claimed' && task.claimedBy !== user.openid) return fail('INVALID', '已被他人领取')
    await db.collection('move_tasks').doc(task._id).update({
      data: {
        status: 'claimed',
        claimedBy: user.openid,
        claimedByName: user.displayName || '未署名成员',
        claimedAt: Date.now(),
      },
    })
    return ok({ taskId: task._id })
  }

  handlers.completeMoveTask = async function completeMoveTask(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const task = await getById('move_tasks', event.taskId)
    if (!task) return fail('NOT_FOUND', '搬运任务不存在')
    if (task.status === 'open' && user.role !== 'admin') return fail('INVALID', '请先领取任务')
    if (task.status === 'claimed' && task.claimedBy !== user.openid && user.role !== 'admin') {
      return fail('FORBIDDEN', '只有领取人或管理员可完成')
    }
    await db.collection('move_tasks').doc(task._id).update({ data: { status: 'done' } })
    if (task.donationId) {
      await db.collection('donations').doc(task.donationId).update({
        data: { location: task.toLocation, status: 'on_site' },
      })
    }
    return ok({ taskId: task._id, location: task.toLocation })
  }

  handlers.getSzcatPanel = async function getSzcatPanel(_event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看绝育指标')
    const cfgs = await getAll('szcat_config')
    const cfg = cfgs[0] || {
      monthKey: shanghaiDateKey().slice(0, 7),
      officialUrl: 'https://www.szcat.org/',
      platformUrl: 'https://ph.szcat.org/newskin/frmnsszcati.aspx',
    }
    const cats = (await getAll('cats')).filter((c) => !c.neutered && c.sterilizeNeed)
    const claims = await getAll('szcat_claims', { monthKey: cfg.monthKey })
    let copies = []
    try { copies = await getAll('szcat_copies') } catch (e) { copies = [] }
    copies.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const tutorialPhotos = (await loadMediaMap('szcat_tutorial'))[cfg._id || 'szcat'] || cfg.tutorialPhotoFileIds || []
    return ok({
      config: Object.assign({}, cfg, { tutorialPhotoFileIds: tutorialPhotos }),
      copies,
      cats: cats.map((c) => {
        const claim = claims.find((x) => x.catId === c._id)
        return {
          ...c,
          claimStatus: claim ? claim.status : 'open',
          claimStatusText: claim ? (SZCAT_CLAIM[claim.status] || claim.status) : SZCAT_CLAIM.open,
          claimedByName: claim ? claim.claimedByName : '',
          claimId: claim ? claim._id : '',
          mine: claim ? claim.claimedBy === user.openid : false,
        }
      }),
      isAdmin: isAdmin(user),
      officialUrl: cfg.officialUrl || 'https://www.szcat.org/',
      platformUrl: cfg.platformUrl || 'https://ph.szcat.org/newskin/frmnsszcati.aspx',
      disclaimer: '本小程序只做准备与跳转。提交、抢指标仍须在深圳猫网官方网站或公众号完成，禁止刷号或代填自动提交。',
    })
  }

  handlers.adminSaveSzcatConfig = async function adminSaveSzcatConfig(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可配置绝育指标说明')
    const cfgs = await getAll('szcat_config')
    const photos = photoIds(event)
    const data = {
      monthKey: String(event.monthKey || '').slice(0, 7),
      openNote: String(event.openNote || '').trim().slice(0, 120),
      notice: String(event.notice || '').trim().slice(0, 200),
      tutorialText: String(event.tutorialText || '').trim().slice(0, 800),
      officialUrl: String(event.officialUrl || 'https://www.szcat.org/').trim().slice(0, 120),
      platformUrl: String(event.platformUrl || 'https://ph.szcat.org/newskin/frmnsszcati.aspx').trim().slice(0, 160),
      tutorialPhotoFileIds: photos,
    }
    let configId = cfgs[0] && cfgs[0]._id
    if (configId) quietUpdate('szcat_config', configId, data)
    else {
      const added = await addDoc('szcat_config', data)
      configId = added._id
    }
    if (photos.length) await saveMedia('szcat_tutorial', configId || 'szcat', photos)
    return ok({ config: Object.assign({ _id: configId }, data) })
  }

  handlers.adminAddSzcatCopy = async function adminAddSzcatCopy(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可发布绝育文案')
    const title = String(event.title || '').trim().slice(0, 40)
    const body = String(event.body || '').trim().slice(0, 800)
    if (!title || !body) return fail('INVALID', '请填写文案标题和正文')
    const photos = photoIds(event)
    const data = {
      title,
      body,
      photoFileIds: photos,
      createdBy: user.openid,
      createdAt: Date.now(),
    }
    const added = await addDoc('szcat_copies', data)
    return ok({ copyId: added._id })
  }

  handlers.adminDeleteSzcatCopy = async function adminDeleteSzcatCopy(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可删除绝育文案')
    const row = await getById('szcat_copies', event.copyId)
    if (!row) return fail('NOT_FOUND', '找不到这条文案')
    await db.collection('szcat_copies').doc(row._id).remove()
    return ok({ copyId: row._id })
  }

  handlers.claimSzcatSlot = async function claimSzcatSlot(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const cat = await getById('cats', event.catId)
    if (!cat || !cat.sterilizeNeed || cat.neutered) return fail('INVALID', '这只猫不在本月待绝育名单')
    const cfgs = await getAll('szcat_config')
    const monthKey = (cfgs[0] && cfgs[0].monthKey) || shanghaiDateKey().slice(0, 7)
    const exist = (await getAll('szcat_claims', { catId: cat._id, monthKey }))[0]
    if (exist && exist.status !== 'open' && exist.claimedBy !== user.openid) {
      return fail('INVALID', `已由 ${exist.claimedByName} 认领`)
    }
    if (exist) {
      await db.collection('szcat_claims').doc(exist._id).update({
        data: { status: 'claimed', claimedBy: user.openid, claimedByName: user.displayName || '未署名成员' },
      })
      return ok({ claimId: exist._id, status: 'claimed' })
    }
    const added = await db.collection('szcat_claims').add({
      data: {
        catId: cat._id,
        catName: cat.name,
        monthKey,
        status: 'claimed',
        claimedBy: user.openid,
        claimedByName: user.displayName || '未署名成员',
        createdAt: Date.now(),
      },
    })
    return ok({ claimId: added._id, status: 'claimed' })
  }

  handlers.setSzcatClaimStatus = async function setSzcatClaimStatus(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const claim = await getById('szcat_claims', event.claimId)
    if (!claim) return fail('NOT_FOUND', '认领不存在')
    if (claim.claimedBy !== user.openid && !isAdmin(user)) return fail('FORBIDDEN', '只能改自己认领的状态')
    if (!SZCAT_CLAIM[event.status]) return fail('INVALID', '状态不合法')
    await db.collection('szcat_claims').doc(claim._id).update({ data: { status: event.status } })
    return ok({ claimId: claim._id, status: event.status })
  }

  handlers.buildSzcatPack = async function buildSzcatPack(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    const gender = { male: '公', female: '母', unknown: '未知' }[cat.gender] || '未知'
    const health = { healthy: '健康', under_weather: '不适', recovering: '恢复中', unknown: '未知' }[cat.healthStatus] || '未知'
    const campus = { on_campus: '在校', off_campus: '离校', medical: '就医' }[cat.campusStatus || 'on_campus']
    const text = [
      '【深圳猫网报名资料包】',
      `化名：${cat.name}`,
      `性别：${gender}`,
      `大致年龄：${cat.ageText || '未填'}`,
      `品种：${cat.breed || '未填'}`,
      `健康：${health}`,
      `是否在校：${campus}`,
      '提交请到深圳猫网官方网站或公众号「深圳猫网」，本包不能代替官方表单。',
    ].join('\n')
    return ok({ text })
  }

  function decorateWorkTask(task, user, todayKey) {
    const viewed = applyScopeView(task, todayKey || shanghaiDateKey())
    if (viewed.allowMultiple) {
      const day = todayKey || shanghaiDateKey()
      const cycle = taskCycleKey(viewed, day)
      const all = viewed.participants || []
      const participants = all.filter((p) => (p.cycleKey || p.dateKey) === cycle)
      const own = all.find((p) => p.openid === user.openid && p.status === 'claimed')
      const visible = isAdmin(user)
        ? all.filter((p) => (p.cycleKey || p.dateKey) === cycle || p.status === 'review')
        : all.filter((p) => (p.cycleKey || p.dateKey) === cycle || p.openid === user.openid && p.status === 'claimed')
      return {
        ...viewed,
        photoFileIds: viewed.photoFileIds || [],
        participants: visible.map((p) => ({
          key: p.key, workerName: p.workerName, status: p.status, dateKey: p.dateKey,
          report: isAdmin(user) || p.openid === user.openid ? (p.report || null) : null,
        })),
        canClaim: isApproved(user) && viewed.dueToday && !own
          && !participants.some((p) => p.openid === user.openid)
          && participants.length < (viewed.maxParticipants || 2),
        canRelease: !!(own && own.status === 'claimed'),
        canSubmit: !!(own && own.status === 'claimed'),
        canReview: isAdmin(user) && all.some((p) => p.status === 'review'),
        canDelete: isAdmin(user),
        report: null,
      }
    }
    return {
      ...viewed,
      photoFileIds: viewed.photoFileIds || [],
      canClaim: viewed.status === 'open' && viewed.dueToday && isApproved(user),
      canRelease: viewed.status === 'claimed' && viewed.claimedBy === user.openid,
      canSubmit: viewed.status === 'claimed' && viewed.dueToday && viewed.claimedBy === user.openid,
      claimedByName: viewed.status === 'claimed' ? (viewed.claimedByName || '成员') : '',
      canReview: viewed.status === 'review' && isAdmin(user),
      canDelete: isAdmin(user),
      report: viewed.report || null,
    }
  }

  function applyTaskOverlay(task, reports, events, todayKey) {
    if (task.workflowV2) return task
    const dayKey = todayKey || shanghaiDateKey()
    const scoped = filterOverlaysForScope(
      task,
      (reports || []).filter((r) => r.taskId === task._id),
      (events || []).filter((e) => e.taskId === task._id),
      dayKey,
    )
    const next = Object.assign({}, task)
    const reps = scoped.reports.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
    const evs = scoped.events.sort((a, b) => (b.at || 0) - (a.at || 0))
    if (reps[0]) {
      next.report = {
        description: reps[0].description,
        workerName: reps[0].workerName,
        photoFileIds: reps[0].photoFileIds || [],
        submittedBy: reps[0].submittedBy,
        submittedAt: reps[0].submittedAt,
      }
      if (next.status === 'open') next.status = 'review'
    }
    if (evs[0]) {
      next.status = evs[0].status
      next.rejectNote = evs[0].rejectNote || ''
    }
    return next
  }

  async function loadTaskOverlays() {
    let reports = []
    let events = []
    try { reports = await getAll('work_task_reports') } catch (e) { reports = [] }
    try { events = await getAll('work_task_events') } catch (e) { events = [] }
    return { reports, events }
  }

  async function calendarRows(name, where = {}) {
    const rows = []
    for (let skip = 0; skip < 5000; skip += 100) {
      let page
      try {
        page = await db.collection(name).where(where).orderBy('_id', 'asc').skip(skip).limit(100).get()
      } catch (e) {
        if (skip === 0) return []
        throw e
      }
      rows.push(...page.data)
      if (page.data.length < 100) return rows
    }
    throw new Error('任务记录过多，无法完整生成日历')
  }

  handlers.listWorkTasks = async function listWorkTasks(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看任务')
    const sites = (await getAll('sites', { enabled: _.neq(false) }))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    let tasks = []
    try { tasks = await getAll('work_tasks') } catch (e) { tasks = [] }
    const todayKey = shanghaiDateKey()
    const overlays = await loadTaskOverlays()
    tasks = tasks.map((t) => applyTaskOverlay(t, overlays.reports, overlays.events, todayKey))
    const wanted = String(event.siteId || '')
    const wantedScope = parseScope(event.scope, '')
    const boardSites = [GENERAL_BOARD, MOVE_BOARD].concat(sites)
    const groups = boardSites
      .filter((site) => !wanted || site._id === wanted)
      .map((site) => ({
        siteId: site._id,
        siteName: site.name,
        tasks: tasks
          .filter((t) => {
            if (wantedScope && normalizeScope(t) !== wantedScope) return false
            if (site._id === MOVE_BOARD._id) return t.kind === 'move' || t.siteId === MOVE_BOARD._id
            if (site._id === GENERAL_BOARD._id) {
              return t.kind !== 'move' && (!t.siteId || t.siteId === GENERAL_BOARD._id)
            }
            return t.siteId === site._id
          })
          .sort((a, b) => {
            const order = (task) => task.status === 'claimed' && task.claimedBy === user.openid
              ? -1 : ({ open: 0, claimed: 1, review: 2, done: 3 }[task.status] ?? 9)
            return order(a) - order(b) || (b.createdAt || 0) - (a.createdAt || 0)
          })
          .map((t) => decorateWorkTask(t, user, todayKey)),
      }))
      .filter((g) => {
        if (g.tasks.length) return true
        if (wanted) return true
        return false
      })
    return ok({
      isAdmin: isAdmin(user),
      groups,
      sites: sites.map((s) => ({ _id: s._id, name: s.name })),
    })
  }

  handlers.getWorkTask = async function getWorkTask(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看任务')
    const task = await getById('work_tasks', event.taskId)
    if (!task) return fail('NOT_FOUND', '任务不存在')
    const todayKey = shanghaiDateKey()
    const overlays = await loadTaskOverlays()
    const live = applyTaskOverlay(task, overlays.reports, overlays.events, todayKey)
    return ok({
      isAdmin: isAdmin(user),
      task: decorateWorkTask(live, user, todayKey),
    })
  }

  handlers.adminPublishWorkTask = async function adminPublishWorkTask(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可发布任务')
    const sourceId = String(event.sourceId || '').trim().slice(0, 80)
    if (sourceId) {
      const existing = (await getAll('work_tasks', { sourceId }))[0]
      if (existing) return ok({ taskId: existing._id, skipped: true })
    }
    const wantedSite = String(event.siteId || '').trim()
    let site = null
    if (wantedSite && wantedSite !== GENERAL_BOARD._id) {
      site = await getById('sites', wantedSite)
      if (!site || site.enabled === false) return fail('INVALID', '地点不存在')
    }
    const title = String(event.title || '').trim().slice(0, 40)
    const content = String(event.content || '').trim().slice(0, 300)
    if (!title) return fail('INVALID', '请填写任务标题')
    if (!content) return fail('INVALID', '请填写任务内容')
    const scope = parseScope(event.scope, 'once') || 'once'
    const weekdays = parseWeekdays(event.weekdays)
    if (scope === 'weekly' && !weekdays.length) return fail('INVALID', '请选择每周执行的星期')
    const allowMultiple = event.allowMultiple === true
    const maxParticipants = allowMultiple ? Number(event.maxParticipants) : 1
    if (allowMultiple && (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 50)) {
      return fail('INVALID', '多人任务人数上限请填 2–50')
    }
    const deadlineDateKey = parseDeadlineDateKey(event.deadlineDateKey)
    const photos = photoIds(event)
    const data = {
      kind: 'duty',
      scope,
      weekdays: scope === 'weekly' ? weekdays : [],
      allowMultiple,
      maxParticipants,
      participants: [],
      deadlineDateKey: scope === 'once' ? deadlineDateKey : '',
      lastDoneDateKey: '',
      siteId: site ? site._id : GENERAL_BOARD._id,
      siteName: site ? site.name : GENERAL_BOARD.name,
      title,
      content,
      photoFileIds: photos,
      status: 'open',
      workflowV2: true,
      createdBy: user.openid,
      createdByName: user.displayName || '管理员',
      createdAt: Date.now(),
      sourceId,
      sourceAt: Number(event.sourceAt) || 0,
      report: null,
      rejectNote: '',
    }
    const added = await addDoc('work_tasks', data)
    quietLog(user, { action: 'publish_work_task', targetType: 'work_task', targetId: added._id, siteId: data.siteId })
    return ok({ taskId: added._id, task: decorateWorkTask(Object.assign({ _id: added._id }, data), user) })
  }

  handlers.listTaskCalendar = async function listTaskCalendar(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能查看任务日历')
    const monthKey = String(event.monthKey || shanghaiDateKey().slice(0, 7))
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return fail('INVALID', '月份不合法')
    const [events, tasks] = await Promise.all([
      calendarRows('work_task_events', { status: 'done' }),
      calendarRows('work_tasks'),
    ])
    const taskById = Object.fromEntries(tasks.map((task) => [task._id, task]))
    const completed = new Map()
    events.forEach((item) => {
      const task = taskById[item.taskId]
      if (!task) return
      const dateKey = item.dateKey || shanghaiDateKey(new Date(item.at))
      if (!dateKey.startsWith(monthKey + '-')) return
      const key = dateKey + ':' + item.taskId
      const prior = completed.get(key) || {
        taskId: item.taskId, dateKey,
        title: item.title || task.title || '未命名任务',
        siteName: item.siteName || task.siteName || '不限地点',
        approvedCount: 0, workerNames: [], at: 0,
      }
      prior.approvedCount += 1
      prior.at = Math.max(prior.at, Number(item.at) || 0)
      if (item.workerName && !prior.workerNames.includes(item.workerName)) prior.workerNames.push(item.workerName)
      completed.set(key, prior)
    })
    return ok({ items: [...completed.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.at - b.at) })
  }

  handlers.listRoutineDuty = async function listRoutineDuty(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能看每日执勤')
    const monthKey = String(event.monthKey || shanghaiDateKey().slice(0, 7))
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return fail('INVALID', '月份不合法')
    const [sites, rows] = await Promise.all([
      getAll('sites'), calendarRows('routine_duty_checkins', { monthKey }),
    ])
    const activeSites = routineSites(sites)
    const allowed = new Set(activeSites.map((site) => site._id))
    const logs = rows.sort((a, b) => (b.at || 0) - (a.at || 0))
    const siteById = Object.fromEntries(sites.map((site) => [site._id, site]))
    const archivedSites = [...new Set(logs.map((row) => row.siteId).filter((id) => !allowed.has(id)))]
      .map((id) => ({ _id: id, name: siteById[id]?.name
        || logs.find((row) => row.siteId === id)?.siteName || '历史点位', archived: true }))
    const ids = [...new Set(logs.flatMap((row) => row.photoFileIds || []))]
    const urlById = {}
    for (let i = 0; i < ids.length; i += 50) {
      const urls = await attachTempUrls(ids.slice(i, i + 50))
      urls.forEach((item) => { if (item.tempFileURL) urlById[item.fileID] = item.tempFileURL })
    }
    return ok({
      sites: activeSites, archivedSites, shifts: ROUTINE_SHIFTS,
      logs: logs.map((row) => ({
        _id: row._id, dateKey: row.dateKey, siteId: row.siteId,
        shiftId: row.shiftId, fed: !!row.fed, watered: !!row.watered,
        note: row.note || '', byName: row.byName || '', at: row.at,
        photoFileIds: row.photoFileIds || [],
        photoUrls: (row.photoFileIds || []).map((id) => urlById[id]).filter(Boolean),
        mine: row.byOpenid === user.openid,
        canDelete: isAdmin(user) || row.byOpenid === user.openid,
      })),
    })
  }

  handlers.submitRoutineDuty = async function submitRoutineDuty(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const dateKey = String(event.dateKey || shanghaiDateKey())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > shanghaiDateKey()) {
      return fail('INVALID', '只能登记今天或过去的执勤')
    }
    const shiftId = String(event.shiftId || '')
    if (!ROUTINE_SHIFTS.some((shift) => shift.id === shiftId)) return fail('INVALID', '班次不合法')
    const sites = routineSites(await getAll('sites'))
    const site = sites.find((item) => item._id === event.siteId)
    if (!site) return fail('INVALID', '请选择已开启每日执勤的点位')
    const prior = (await calendarRows('routine_duty_checkins', {
      dateKey, siteId: site._id, shiftId, byOpenid: user.openid,
    }))[0]
    if (prior) return fail('ALREADY_DONE', '你已提交过这一天的这个班次')
    const photoFileIds = photoIds(event)
      .filter((id) => typeof id === 'string' && id.startsWith('cloud://')).slice(0, 3)
    const doc = {
      dateKey, monthKey: dateKey.slice(0, 7), siteId: site._id, siteName: site.name,
      shiftId, fed: !!event.fed, watered: !!event.watered,
      note: String(event.note || '').trim().slice(0, 200), photoFileIds,
      byOpenid: user.openid, byName: String(user.displayName || '未署名成员').slice(0, 20),
      at: Date.now(),
    }
    const added = await addDoc('routine_duty_checkins', doc)
    return ok({ checkinId: added._id })
  }

  handlers.deleteRoutineDuty = async function deleteRoutineDuty(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const row = await getById('routine_duty_checkins', event.checkinId)
    if (!row) return fail('NOT_FOUND', '执勤打卡不存在')
    if (!isAdmin(user) && row.byOpenid !== user.openid) return fail('FORBIDDEN', '只能删自己的打卡')
    await db.collection('routine_duty_checkins').doc(row._id).remove()
    return ok({ checkinId: row._id })
  }

  async function taskInTransaction(taskId, change) {
    return db.runTransaction(async (tx) => {
      const ref = tx.collection('work_tasks').doc(taskId)
      const result = await ref.get()
      const task = result.data
      if (!task) return fail('NOT_FOUND', '任务不存在')
      return change(tx, ref, task)
    })
  }

  handlers.claimWorkTask = async function claimWorkTask(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const overlays = await loadTaskOverlays()
    return taskInTransaction(event.taskId, async (_tx, ref, task) => {
      const todayKey = shanghaiDateKey()
      const availability = applyScopeView(task, todayKey)
      if (!availability.dueToday) return fail('INVALID', '今天不是这条任务的执行日')
      if (task.allowMultiple) {
        const cycle = taskCycleKey(task, todayKey)
        const participants = task.participants || []
        const thisCycle = participants.filter((p) => (p.cycleKey || p.dateKey) === cycle)
        if (participants.some((p) => p.openid === user.openid && p.status === 'claimed')
          || thisCycle.some((p) => p.openid === user.openid)) return fail('INVALID', '你还有未回传的领取，或今天已经参与过')
        if (thisCycle.length >= (task.maxParticipants || 2)) return fail('INVALID', '这次任务人数已满')
        participants.push({
          key: `claim:${Date.now()}:${Math.floor(Math.random() * 1000000)}`,
          dateKey: todayKey, cycleKey: cycle, openid: user.openid,
          workerName: user.displayName || '成员', status: 'claimed', report: null,
        })
        await ref.update({ data: { participants, workflowV2: true } })
        return ok({ taskId: task._id, status: 'claimed' })
      }
      const current = task.workflowV2 ? task : applyTaskOverlay(task, overlays.reports, overlays.events, todayKey)
      const live = applyScopeView(current, todayKey)
      if (live.status !== 'open') return fail('INVALID', '这条任务已经被领取或完成，请刷新')
      await ref.update({ data: {
        status: 'claimed', workflowV2: true, claimedBy: user.openid,
        claimedByName: user.displayName || '成员', claimedDateKey: todayKey,
        report: null, rejectNote: '',
      } })
      return ok({ taskId: task._id, status: 'claimed' })
    })
  }

  handlers.releaseWorkTask = async function releaseWorkTask(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    return taskInTransaction(event.taskId, async (_tx, ref, task) => {
      if (task.allowMultiple) {
        const todayKey = shanghaiDateKey()
        const participants = (task.participants || []).filter((p) => {
          return !(p.openid === user.openid && p.status === 'claimed')
        })
        if (participants.length === (task.participants || []).length) return fail('INVALID', '今天没有可退回的领取')
        await ref.update({ data: { participants } })
        return ok({ taskId: task._id, status: 'open' })
      }
      if (task.status !== 'claimed' || task.claimedBy !== user.openid) {
        return fail('INVALID', '任务已改变，请刷新')
      }
      await ref.update({ data: {
        status: 'open', claimedBy: '', claimedByName: '', claimedDateKey: '',
      } })
      return ok({ taskId: task._id, status: 'open' })
    })
  }

  handlers.adminPrepareTrial = async function adminPrepareTrial(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可清理试用数据')
    let metas = []
    try { metas = await getAll('app_meta') } catch (e) { metas = [] }
    if (metas.some((m) => m.key === 'trial_cleaned_v2')) {
      return ok({ skipped: true })
    }
    const names = [
      'work_tasks', 'work_task_reports', 'work_task_events',
      'diet_logs', 'donations', 'move_tasks', 'duty_records',
    ]
    for (const name of names) {
      let rows = []
      try { rows = await getAll(name) } catch (e) { rows = [] }
      await Promise.all(rows.map((row) => db.collection(name).doc(row._id).remove().catch(() => {})))
    }
    const cats = await getAll('cats')
    cats.forEach((cat) => quietUpdate('cats', cat._id, { lastDiet: null }))
    const sites = await getAll('sites')
    const byKey = (key, name) => sites.find((s) => s.seedKey === key || s.name === name)
    const sitin = byKey('sitin', '思廷自动喂食机')
    const examples = [
      {
        siteId: GENERAL_BOARD._id,
        siteName: GENERAL_BOARD.name,
        title: '校园巡猫',
        content: '路过时看一眼在校猫的精神。有异常就记到对应猫档，不必绑到某个点位。',
      },
      sitin && {
        siteId: sitin._id,
        siteName: sitin.name,
        title: '思廷补粮',
        content: '把自动喂食机加满并拍照。幼猫少加粮，优先小包装。',
      },
    ].filter(Boolean)
    for (const item of examples) {
      await addDoc('work_tasks', {
        kind: 'duty',
        scope: 'daily',
        deadlineDateKey: '',
        lastDoneDateKey: '',
        siteId: item.siteId,
        siteName: item.siteName,
        title: item.title,
        content: item.content,
        photoFileIds: [],
        status: 'open',
        createdBy: user.openid,
        createdByName: '试用例子',
        createdAt: Date.now(),
        report: null,
        rejectNote: '',
      })
    }
    const naigai = cats.find((c) => c.name === '奶盖')
    if (naigai) {
      quietUpdate('cats', naigai._id, { seekingAdopt: true })
      await addDoc('adopt_candidates', {
        catId: naigai._id,
        name: '示例家庭',
        status: 'contacting',
        note: '周末可来看猫。这是试用例子，管理员可改可删。',
        photoFileIds: [],
        createdAt: Date.now(),
      })
    }
    await addDoc('app_meta', { key: 'trial_cleaned_v2', at: Date.now() })
    return ok({ skipped: false, examples: examples.length })
  }

  handlers.submitWorkTask = async function submitWorkTask(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const description = String(event.description || '').trim().slice(0, 400)
    const workerName = String(event.workerName || user.displayName || '').trim().slice(0, 20)
    const photos = photoIds(event)
    if (!description) return fail('INVALID', '请填写任务描述')
    if (!workerName) return fail('INVALID', '请填写做任务的人的名字')
    return taskInTransaction(event.taskId, async (tx, ref, task) => {
      if (task.allowMultiple) {
        const participants = task.participants || []
        const index = participants.findIndex((p) => p.openid === user.openid && p.status === 'claimed')
        if (index < 0) return fail('INVALID', '请先领取今天的任务，或刷新查看最新状态')
        const submittedLate = !!(task.deadlineDateKey && shanghaiDateKey() > task.deadlineDateKey)
        const report = { taskId: task._id, participantKey: participants[index].key,
          description, workerName, photoFileIds: photos,
          submittedBy: user.openid, submittedAt: Date.now(), submittedLate }
        participants[index] = { ...participants[index], workerName, status: 'review', report }
        await ref.update({ data: { participants } })
        await tx.collection('work_task_reports').add({ data: report })
        return ok({ taskId: task._id, status: 'review' })
      }
      if (task.status !== 'claimed' || task.claimedBy !== user.openid) {
        return fail('INVALID', '请先领取任务，或刷新查看最新状态')
      }
      const submittedLate = !!(task.deadlineDateKey && shanghaiDateKey() > task.deadlineDateKey)
      const report = {
        taskId: task._id, description, workerName, photoFileIds: photos,
        submittedBy: user.openid, submittedAt: Date.now(), submittedLate,
      }
      await ref.update({ data: { report: _.set(report), status: 'review', rejectNote: '' } })
      await tx.collection('work_task_reports').add({ data: report })
      return ok({ taskId: task._id, status: 'review' })
    })
  }

  handlers.adminReviewWorkTask = async function adminReviewWorkTask(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可审核任务')
    const overlays = await loadTaskOverlays()
    const approved = !(event.approved === false || event.approved === 'false')
    const status = approved ? 'done' : 'open'
    const rejectNote = approved ? '' : String(event.note || '未通过，请按任务内容重做后再交').trim().slice(0, 80)
    return taskInTransaction(event.taskId, async (tx, ref, task) => {
      if (task.allowMultiple) {
        const todayKey = shanghaiDateKey()
        const participants = task.participants || []
        const index = participants.findIndex((p) => p.key === event.participantKey && p.status === 'review')
        if (index < 0) return fail('INVALID', '这条回传已处理，请刷新')
        const participant = participants[index]
        const report = participant.report || {}
        if (approved) participants[index] = { ...participant, status: 'done' }
        else participants.splice(index, 1)
        await ref.update({ data: { participants } })
        await tx.collection('work_task_events').add({ data: {
          taskId: task._id, participantKey: event.participantKey, status,
          rejectNote, at: Date.now(), dateKey: todayKey,
          title: task.title || '', siteName: task.siteName || '', workerName: report.workerName || '',
        } })
        if (approved) {
          await tx.collection('work_credit_events').add({ data: {
            openid: report.submittedBy || '', workerName: report.workerName || '',
            taskId: task._id + ':' + participant.key, title: task.title || '',
            dateKey: participant.dateKey || todayKey, at: Date.now(),
          } })
        }
        return ok({ taskId: task._id, status })
      }
      const todayKey = shanghaiDateKey()
      const live = task.workflowV2 ? task : applyTaskOverlay(task, overlays.reports, overlays.events, todayKey)
      if (live.status !== 'review') return fail('INVALID', '现在没有待审回传')
      const report = live.report || {}
      const patch = {
        status, rejectNote, workflowV2: true, report: _.set(live.report || null),
        claimedBy: '', claimedByName: '', claimedDateKey: '',
      }
      if (approved) patch.lastDoneDateKey = todayKey
      await ref.update({ data: patch })
      await tx.collection('work_task_events').add({ data: {
        taskId: task._id, status, rejectNote, at: Date.now(), dateKey: todayKey,
        title: task.title || '', siteName: task.siteName || '', workerName: report.workerName || '',
      } })
      if (approved) {
        await tx.collection('work_credit_events').add({ data: {
          openid: report.submittedBy || '', workerName: report.workerName || '',
          taskId: task._id, title: task.title || '', dateKey: todayKey, at: Date.now(),
        } })
        if (task.kind === 'move' && task.donationId) {
          await tx.collection('donations').doc(task.donationId).update({ data: { location: task.toLocation, status: 'on_site' } })
        }
      }
      return ok({ taskId: task._id, status })
    })
  }

  handlers.adminDeleteWorkTask = async function adminDeleteWorkTask(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可删除任务')
    const task = await getById('work_tasks', event.taskId)
    if (!task) return fail('NOT_FOUND', '任务不存在')
    await db.collection('work_tasks').doc(task._id).remove()
    quietLog(user, { action: 'delete_work_task', targetType: 'work_task', targetId: task._id, siteId: task.siteId })
    return ok({ taskId: task._id })
  }

  const ADOPT_STATUS = { contacting: '沟通中', visiting: '待见面', approved: '已通过', rejected: '未通过' }

  handlers.adminSetSeekingAdopt = async function adminSetSeekingAdopt(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可改找领养状态')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    const seekingAdopt = !(event.seekingAdopt === false || event.seekingAdopt === 'false')
    quietUpdate('cats', cat._id, { seekingAdopt })
    return ok({ catId: cat._id, seekingAdopt })
  }

  handlers.adminUpsertAdoptCandidate = async function adminUpsertAdoptCandidate(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可管理候选领养人')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '找不到这只猫')
    const name = String(event.name || '').trim().slice(0, 20)
    const note = String(event.note || '').trim().slice(0, 300)
    const status = ADOPT_STATUS[event.status] ? event.status : 'contacting'
    if (!name) return fail('INVALID', '请填写候选领养人称呼')
    const photos = photoIds(event)
    const data = { catId: cat._id, name, status, note, photoFileIds: photos }
    let candidateId = String(event.candidateId || '')
    if (candidateId) {
      const row = await getById('adopt_candidates', candidateId)
      if (!row || row.catId !== cat._id) return fail('NOT_FOUND', '找不到这条候选记录')
      quietUpdate('adopt_candidates', candidateId, data)
    } else {
      data.createdAt = Date.now()
      const added = await addDoc('adopt_candidates', data)
      candidateId = added._id
    }
    if (photos.length) await saveMedia('adopt', candidateId, photos)
    if (!cat.seekingAdopt) quietUpdate('cats', cat._id, { seekingAdopt: true })
    return ok({ candidateId })
  }

  handlers.adminDeleteAdoptCandidate = async function adminDeleteAdoptCandidate(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可管理候选领养人')
    const row = await getById('adopt_candidates', event.candidateId)
    if (!row) return fail('NOT_FOUND', '找不到这条候选记录')
    await db.collection('adopt_candidates').doc(row._id).remove()
    return ok({ candidateId: row._id })
  }

  async function safeAll(name, where = {}) {
    try { return await getAll(name, where) } catch (e) { return [] }
  }

  function siteFeedSummary(rows, dateKey) {
    const today = rows.filter((row) => row.dateKey === dateKey)
    return today.length ? {
      dateKey, count: today.length,
      fed: today.some((row) => !!row.fed),
      watered: today.some((row) => !!row.watered),
    } : null
  }

  handlers.listSiteFeedLogs = async function listSiteFeedLogs(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能看点位投喂')
    const site = await getById('sites', event.siteId)
    if (!site || site.enabled === false) return fail('NOT_FOUND', '点位不存在')
    const rows = (await safeAll('site_feed_logs', { siteId: site._id }))
      .sort((a, b) => (b.at || 0) - (a.at || 0))
    return ok({
      today: siteFeedSummary(rows, shanghaiDateKey()),
      logs: rows.slice(0, 20).map((row) => ({
        _id: row._id, siteId: row.siteId, dateKey: row.dateKey,
        fed: !!row.fed, watered: !!row.watered, note: row.note || '',
        photoFileIds: row.photoFileIds || [], byName: row.byName || '', at: row.at,
        canDelete: isAdmin(user) || row.byOpenid === user.openid,
      })),
    })
  }

  handlers.addSiteFeedLog = async function addSiteFeedLog(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const site = await getById('sites', event.siteId)
    if (!site || site.enabled === false) return fail('NOT_FOUND', '点位不存在')
    const fed = !!event.fed
    const watered = !!event.watered
    const note = String(event.note || '').trim().slice(0, 120)
    if (!fed && !watered && !note) return fail('INVALID', '请勾选投喂、添水，或写清现场情况')
    const data = {
      siteId: site._id, siteName: site.name, fed, watered, note,
      photoFileIds: photoIds(event),
      byName: String(user.displayName || '未署名成员').slice(0, 20),
      byOpenid: user.openid, dateKey: shanghaiDateKey(), at: Date.now(),
    }
    const added = await addDoc('site_feed_logs', data)
    return ok({ logId: added._id })
  }

  handlers.deleteSiteFeedLog = async function deleteSiteFeedLog(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const row = await getById('site_feed_logs', event.logId)
    if (!row) return fail('NOT_FOUND', '点位投喂记录不存在')
    if (!isAdmin(user) && row.byOpenid !== user.openid) return fail('FORBIDDEN', '只能删自己的记录')
    await db.collection('site_feed_logs').doc(row._id).remove()
    return ok({ logId: row._id })
  }

  handlers.listMobileFeedLogs = async function listMobileFeedLogs(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能看机动投喂')
    const monthKey = String(event.monthKey || shanghaiDateKey().slice(0, 7))
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return fail('INVALID', '月份不合法')
    const [monthRows, allRows] = await Promise.all([
      calendarRows('mobile_feed_logs', { monthKey }),
      calendarRows('mobile_feed_logs'),
    ])
    const rows = monthRows
      .sort((a, b) => (b.at || 0) - (a.at || 0))
    const catNames = [...new Set(allRows.map((row) => String(row.catName || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    const ids = [...new Set(rows.flatMap((row) => row.photoFileIds || []))]
    const photoUrlById = {}
    for (let i = 0; i < ids.length; i += 50) {
      const urls = await attachTempUrls(ids.slice(i, i + 50))
      urls.forEach((item) => { if (item.tempFileURL) photoUrlById[item.fileID] = item.tempFileURL })
    }
    return ok({ catNames, logs: rows.map((row) => ({
      _id: row._id, dateKey: row.dateKey, catName: row.catName,
      seen: !!row.seen, fed: !!row.fed, watered: !!row.watered,
      note: row.note || '', byName: row.byName || '', at: row.at,
      photoFileIds: row.photoFileIds || [],
      photoUrls: (row.photoFileIds || []).map((id) => photoUrlById[id]).filter(Boolean),
      canDelete: isAdmin(user) || row.byOpenid === user.openid,
    })) })
  }

  handlers.addMobileFeedLog = async function addMobileFeedLog(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const dateKey = String(event.dateKey || shanghaiDateKey())
    const catName = String(event.catName || '').trim().slice(0, 20)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > shanghaiDateKey()) {
      return fail('INVALID', '只能登记今天或过去的日期')
    }
    if (!catName) return fail('INVALID', '请填写猫名或临时称呼')
    const data = {
      dateKey, monthKey: dateKey.slice(0, 7), catName,
      seen: !!event.seen, fed: !!event.fed, watered: !!event.watered,
      note: String(event.note || '').trim().slice(0, 160),
      photoFileIds: photoIds(event).slice(0, 3),
      byName: String(user.displayName || '未署名成员').slice(0, 20),
      byOpenid: user.openid, at: Date.now(),
    }
    const added = await addDoc('mobile_feed_logs', data)
    return ok({ logId: added._id })
  }

  handlers.deleteMobileFeedLog = async function deleteMobileFeedLog(event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '无权限')
    const row = await getById('mobile_feed_logs', event.logId)
    if (!row) return fail('NOT_FOUND', '机动投喂记录不存在')
    if (!isAdmin(user) && row.byOpenid !== user.openid) return fail('FORBIDDEN', '只能删自己的记录')
    await db.collection('mobile_feed_logs').doc(row._id).remove()
    return ok({ logId: row._id })
  }

  handlers.adminSetCatSpecialCare = async function adminSetCatSpecialCare(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可改单猫追踪标记')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '猫档不存在')
    const enabled = event.enabled === true
    await db.collection('cats').doc(cat._id).update({
      data: { needsIndividualCare: enabled, updatedAt: Date.now() },
    })
    return ok({ catId: cat._id, needsIndividualCare: enabled })
  }

  handlers.adminSetCatProvisional = async function adminSetCatProvisional(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可确认猫身份')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '猫档不存在')
    const provisional = event.provisional === true
    await db.collection('cats').doc(cat._id).update({ data: { provisional, updatedAt: Date.now() } })
    return ok({ catId: cat._id, provisional })
  }

  handlers.adminApplyChatCatState = async function adminApplyChatCatState(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可同步群聊猫状态')
    const cat = await getById('cats', event.catId)
    if (!cat) return fail('NOT_FOUND', '猫档不存在')
    const statuses = { in_care: true, medical: true, pending_release: true, observe: true }
    const campuses = { on_campus: true, off_campus: true, medical: true }
    const status = String(event.status || '')
    const campusStatus = String(event.campusStatus || '')
    if (!statuses[status] || !campuses[campusStatus]) return fail('INVALID', '状态不合法')
    const siteId = String(event.siteId || '')
    if ((campusStatus === 'medical') !== (status === 'medical')) return fail('INVALID', '就医状态不一致')
    if (campusStatus === 'medical' && siteId) return fail('INVALID', '就医中的猫不能占用执勤点')
    if (siteId) {
      const site = await getById('sites', siteId)
      if (!site || site.enabled === false) return fail('INVALID', '点位不可用')
    }
    const sourceId = String(event.sourceId || '').trim().slice(0, 60)
    const note = String(event.note || '').trim().slice(0, 200)
    const locationText = String(event.locationText || '').trim().slice(0, 60)
    const observedAt = Number(event.observedAt)
    if (!sourceId || !note || !Number.isFinite(observedAt) || observedAt <= 0) {
      return fail('INVALID', '请附群消息来源、观察时间和说明')
    }
    if (cat.lastObservation && cat.lastObservation.sourceId === sourceId) {
      return ok({ catId: cat._id, skipped: true, lastObservation: cat.lastObservation })
    }
    if (cat.lastObservation && observedAt < Number(cat.lastObservation.at || 0)) {
      return fail('STALE', '这条群消息早于档案的最近动态')
    }
    const lastObservation = {
      at: observedAt, locationText, note,
      source: '动物保护协会2027过渡群', sourceId,
    }
    await db.collection('cats').doc(cat._id).update({ data: {
      status, campusStatus, siteId, cageId: '', assetId: '',
      lastObservation, updatedAt: Date.now(),
    } })
    await addDoc('cat_observations', {
      catId: cat._id, catName: cat.name,
      before: { status: cat.status, campusStatus: cat.campusStatus, siteId: cat.siteId },
      after: { status, campusStatus, siteId },
      ...lastObservation, recordedAt: Date.now(), recordedBy: user.openid,
    })
    return ok({ catId: cat._id, status, campusStatus, lastObservation })
  }

  handlers.adminCreateCat = async function adminCreateCat(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可新增猫档')
    const name = String(event.name || '').trim().slice(0, 20)
    if (!name) return fail('INVALID', '请填写猫的名字或临时称呼')
    const sourceId = String(event.sourceId || '').trim().slice(0, 60)
    const existing = (await getAll('cats')).find((cat) => cat.name === name
      || (sourceId && cat.lastObservation && cat.lastObservation.sourceId === sourceId))
    if (existing) return ok({ catId: existing._id, skipped: true })
    const siteId = String(event.siteId || '')
    if (siteId) {
      const site = await getById('sites', siteId)
      if (!site || site.enabled === false) return fail('INVALID', '点位不可用')
    }
    const genders = { male: true, female: true, unknown: true }
    const gender = String(event.gender || 'unknown')
    if (!genders[gender]) return fail('INVALID', '性别不合法')
    const observedAt = Number(event.observedAt)
    const note = String(event.note || '').trim().slice(0, 200)
    const lastObservation = sourceId && note && Number.isFinite(observedAt) && observedAt > 0
      ? { at: observedAt, locationText: String(event.locationText || '').trim().slice(0, 60),
        note, source: '动物保护协会2027过渡群', sourceId } : null
    const data = {
      name, status: event.status === 'in_care' ? 'in_care' : 'observe',
      campusStatus: 'on_campus', siteId, cageId: '', assetId: '',
      gender, healthStatus: 'unknown', ageText: '', breed: '',
      notes: note, photoFileIds: [],
      provisional: !!event.provisional, needsIndividualCare: !!event.needsIndividualCare,
      lastObservation, createdAt: Date.now(), updatedAt: Date.now(),
    }
    const added = await addDoc('cats', data)
    if (lastObservation) await addDoc('cat_observations', {
      catId: added._id, catName: name, before: null,
      after: { status: data.status, campusStatus: data.campusStatus, siteId },
      ...lastObservation, recordedAt: Date.now(), recordedBy: user.openid,
    })
    return ok({ catId: added._id, provisional: data.provisional })
  }

  const KNOWLEDGE_KIND = {
    adoption_caution: '领养提醒', guide: '教程', password: '密码备忘',
  }

  handlers.adminListKnowledge = async function adminListKnowledge(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可看内部资料')
    const rows = (await safeAll('knowledge_notes'))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((row) => ({
        _id: row._id, kind: row.kind, kindLabel: KNOWLEDGE_KIND[row.kind] || '资料',
        title: row.title, updatedAt: row.updatedAt,
      }))
    return ok({ rows })
  }

  handlers.adminGetKnowledge = async function adminGetKnowledge(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可看内部资料')
    const row = await getById('knowledge_notes', event.noteId)
    if (!row) return fail('NOT_FOUND', '资料不存在')
    return ok({ note: {
      _id: row._id, kind: row.kind, title: row.title, body: row.body,
      updatedAt: row.updatedAt,
    } })
  }

  handlers.adminUpsertKnowledge = async function adminUpsertKnowledge(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护内部资料')
    const kind = String(event.kind || '')
    const title = String(event.title || '').trim().slice(0, 60)
    const body = String(event.body || '').trim().slice(0, 4000)
    if (!KNOWLEDGE_KIND[kind] || !title || !body) return fail('INVALID', '请选择类型并填写标题和内容')
    let noteId = String(event.noteId || '')
    const data = { kind, title, body, updatedAt: Date.now(), updatedBy: user.openid }
    if (noteId) {
      const existing = await getById('knowledge_notes', noteId)
      if (!existing) return fail('NOT_FOUND', '资料不存在')
      await db.collection('knowledge_notes').doc(noteId).update({ data })
    } else {
      const added = await addDoc('knowledge_notes', { ...data, createdAt: Date.now() })
      noteId = added._id
    }
    return ok({ noteId })
  }

  handlers.adminDeleteKnowledge = async function adminDeleteKnowledge(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可维护内部资料')
    const row = await getById('knowledge_notes', event.noteId)
    if (!row) return fail('NOT_FOUND', '资料不存在')
    await db.collection('knowledge_notes').doc(row._id).remove()
    return ok({ noteId: row._id })
  }

  async function loadWorkloadRows() {
    const [credits, tasks, reports, events, pfRows] = await Promise.all([
      safeAll('work_credit_events'),
      safeAll('work_tasks'),
      safeAll('work_task_reports'),
      safeAll('work_task_events'),
      safeAll('work_pf'),
    ])
    const todayKey = shanghaiDateKey()
    const doneTasks = tasks
      .map((t) => applyTaskOverlay(t, reports, events, todayKey))
      .filter((t) => t.status === 'done' && t.report)
    let rosterCredits = []
    try {
      const metas = await safeAll('app_meta')
      const saved = metas.find((row) => row.key === 'roster922')
      if (saved && saved.board) rosterCredits = creditEvents(saved.board)
    } catch (e) { rosterCredits = [] }
    const pfOverrides = {}
    pfRows.forEach((row) => { pfOverrides[row.sourceKey] = row.pf })
    return buildWorkRecords({ creditEvents: credits.concat(rosterCredits), doneTasks, pfOverrides })
  }

  handlers.adminListWorkload = async function adminListWorkload(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可看工作记录')
    const records = await loadWorkloadRows()
    return ok({ records })
  }

  function parsePf(value) {
    if (value === '' || value == null) return null
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 && n <= 9999 && Math.abs(Math.round(n * 100) - n * 100) < 1e-7 ? n : NaN
  }

  handlers.adminSetWorkPf = async function adminSetWorkPf(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可填写 PF')
    const sourceKey = String(event.sourceKey || '')
    const records = await loadWorkloadRows()
    if (!records.some((row) => row.sourceKey === sourceKey)) return fail('NOT_FOUND', '找不到工作记录')
    const pf = parsePf(event.pf)
    if (Number.isNaN(pf)) return fail('INVALID', 'PF 请填 0–9999 的数字，最多两位小数')
    const existing = (await safeAll('work_pf')).find((row) => row.sourceKey === sourceKey)
    const data = { sourceKey, pf, updatedAt: Date.now(), updatedBy: user.openid }
    if (existing) await db.collection('work_pf').doc(existing._id).update({ data })
    else await addDoc('work_pf', data)
    return ok({ sourceKey, pf })
  }

  handlers.adminAddWorkRecord = async function adminAddWorkRecord(event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可添加工作记录')
    const workerName = String(event.workerName || '').trim().slice(0, 20)
    const title = String(event.title || '').trim().slice(0, 160)
    const dateKey = String(event.dateKey || '').trim()
    const pf = parsePf(event.pf)
    if (!workerName || !title || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return fail('INVALID', '请填写姓名、日期和工作内容')
    }
    if (Number.isNaN(pf)) return fail('INVALID', 'PF 请填 0–9999 的数字，最多两位小数')
    const taskId = `manual:${Date.now()}:${Math.floor(Math.random() * 1000000)}`
    await addDoc('work_credit_events', {
      openid: '', workerName, taskId, title, dateKey, pf,
      at: Date.parse(dateKey + 'T12:00:00+08:00') || Date.now(),
      enteredBy: user.openid,
    })
    return ok({ sourceKey: taskId + ':' + dateKey })
  }

  async function savedRoster() {
    const metas = await safeAll('app_meta')
    return metas.find((row) => row.key === 'roster922') || null
  }

  handlers.listRoster = async function listRoster(_event, user) {
    if (!isApproved(user)) return fail('FORBIDDEN', '需通过成员审核后才能看排班')
    const saved = await savedRoster()
    if (!saved || !saved.board) return ok({ imported: false, isAdmin: isAdmin(user) })
    return ok({ imported: true, isAdmin: isAdmin(user), roster: boardView(saved.board) })
  }

  handlers.adminImportRoster = async function adminImportRoster(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可导入排班表')
    const saved = await savedRoster()
    const payload = { key: 'roster922', board: storedBoard(ROSTER_BOARD), importedAt: Date.now() }
    if (saved) await db.collection('app_meta').doc(saved._id).update({ data: payload })
    else await addDoc('app_meta', payload)
    const cats = await safeAll('cats')
    const jobs = ROSTER_BOARD.insurance.map((row) => {
      const line = insuranceLine(row)
      const cat = cats.find((item) => item.name === row.name)
      if (!cat) {
        return addDoc('cats', {
          name: row.name,
          status: 'observe',
          campusStatus: 'on_campus',
          siteId: '',
          cageId: '',
          assetId: '',
          ageText: '',
          gender: 'unknown',
          breed: '',
          healthStatus: 'unknown',
          notes: line,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }).catch(() => {})
      }
      if (String(cat.notes || '').indexOf('自费保险') >= 0) return null
      const notes = [cat.notes, line].filter(Boolean).join('\n').slice(0, 300)
      return db.collection('cats').doc(cat._id).update({ data: { notes } }).catch(() => {})
    })
    await Promise.all(jobs.filter(Boolean))
    return ok({ imported: true, counts: boardView(ROSTER_BOARD).counts })
  }

  handlers.adminExportOrgCsv = async function adminExportOrgCsv(_event, user) {
    if (!isAdmin(user)) return fail('FORBIDDEN', '仅管理员可导出')
    const [
      sites, cages, assets, cats, catObservations, dietLogs, siteFeedLogs, mobileFeedLogs, routineDutyCheckins, adoptCandidates,
      donations, finance, hospitalVisits, workload,
    ] = await Promise.all([
      safeAll('sites'),
      safeAll('cages'),
      safeAll('assets'),
      safeAll('cats'),
      safeAll('cat_observations'),
      safeAll('diet_logs'),
      safeAll('site_feed_logs'),
      safeAll('mobile_feed_logs'),
      calendarRows('routine_duty_checkins'),
      safeAll('adopt_candidates'),
      safeAll('donations'),
      safeAll('finance_entries'),
      safeAll('hospital_visits'),
      loadWorkloadRows(),
    ])
    const pack = buildOrgExport({
      sites,
      cages,
      assets,
      cats,
      catObservations,
      dietLogs,
      siteFeedLogs,
      mobileFeedLogs,
      routineDutyCheckins,
      adoptCandidates,
      donations,
      finance,
      hospitalVisits,
      workload,
    }, shanghaiDateKey())
    return ok(pack)
  }

  return handlers
}

module.exports = attachCloudOps
