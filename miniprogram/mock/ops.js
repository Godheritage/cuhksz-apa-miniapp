const ROUTINE_LABELS = { food: '添食物', water: '添水', litter: '铲猫砂' }
const { buildOrgExport } = require('../utils/csv')
const { buildWorkRecords } = require('../utils/workload')
const { board: ROSTER_BOARD, insuranceLine, creditEvents, storedBoard, boardView } = require('../utils/rosterImport')
const {
  parseDeadlineDateKey, parseScope, parseWeekdays, taskCycleKey,
  normalizeScope, applyScopeView,
} = require('../utils/taskScope')
const ROUTINE_SHIFTS = [
  { id: 'morning', name: '早班' },
  { id: 'noon', name: '午班' },
  { id: 'evening', name: '晚班' },
  { id: 'overnight', name: '凌晨' },
]

function attachOps(handlers, u) {
  const { ok, fail, id, isApproved, writeLog, todayKey, ensureOnDuty, routineDutyEnabled } = u

  function setCatAssetIds(cat, assetIds) {
    const ids = [...new Set((assetIds || []).filter((value) => typeof value === 'string' && value))]
    cat.assetIds = ids
    cat.assetId = ids[0] || ''
  }

  function routineSites(state) {
    const order = { site_base: 0, site_xiangbo: 1, site_ta: 2 }
    return (state.sites || []).filter((site) => site.enabled !== false && routineDutyEnabled(site))
      .sort((a, b) => (order[a._id] ?? 100 + (Number(a.sort) || 99))
        - (order[b._id] ?? 100 + (Number(b.sort) || 99)))
      .map((site) => ({ _id: site._id, name: site.name }))
  }

  function dateKeyOf(state) {
    return state.mockDateKey || todayKey()
  }

  function addDays(dateKey, n) {
    const parts = String(dateKey).split('-').map(Number)
    const dt = new Date(parts[0], parts[1] - 1, parts[2])
    dt.setDate(dt.getDate() + n)
    return todayKey(dt)
  }

  function makePassword() {
    return String(100000 + Math.floor(Math.random() * 900000))
  }

  function isResidentCat(state, cat) {
    const campus = cat.campusStatus || 'on_campus'
    if (campus === 'off_campus' || campus === 'medical') return false
    if (!cat.siteId) return false
    const site = state.sites.find((s) => s._id === cat.siteId)
    if (!site) return false
    return !!cat.cageId || site.type === 'base' || site.type === '基地'
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
    const resident = isResidentCat(state, cat)
    return {
      resident,
      housingLabel: resident ? '定点，需每日点检' : '流动，无需每日点检',
    }
  }

  function emptyRoutineItems() {
    return {
      food: { done: false, doneByName: '', doneAt: null },
      water: { done: false, doneByName: '', doneAt: null },
      litter: { done: false, doneByName: '', doneAt: null },
    }
  }

  function taskItemList(task) {
    if (Array.isArray(task.items)) {
      return task.items.map((item) => ({
        key: item.key,
        label: item.label || item.key,
        done: !!item.done,
        doneByName: item.doneByName || '',
      }))
    }
    return ['food', 'water', 'litter'].map((key) => {
      const row = (task.items && task.items[key]) || {}
      return {
        key,
        label: ROUTINE_LABELS[key],
        done: !!row.done,
        doneByName: row.doneByName || '',
      }
    })
  }

  function decorateTask(state, task, user) {
    const items = taskItemList(task)
    const doneCount = items.filter((i) => i.done).length
    const plan = task.planId ? (state.care_plans || []).find((p) => p._id === task.planId) : null
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
        ? {
          text: plan.tutorial.text || '',
          photos: (plan.tutorial.photoFileIds || []).map((fileID) => ({
            fileID,
            tempFileURL: fileID,
          })),
        }
        : { text: '', photos: [] },
    }
  }

  function ensureRoutineTasks(state) {
    const dateKey = dateKeyOf(state)
    const exist = new Set(
      (state.cat_tasks || [])
        .filter((t) => t.dateKey === dateKey && (t.kind || 'routine') === 'routine')
        .map((t) => t.catId),
    )
    state.cats.forEach((cat) => {
      if (!isResidentCat(state, cat) || exist.has(cat._id)) return
      const site = state.sites.find((s) => s._id === cat.siteId)
      const cage = state.cages.find((c) => c._id === cat.cageId)
      state.cat_tasks.push({
        _id: id('task'),
        kind: 'routine',
        dateKey,
        catId: cat._id,
        catName: cat.name,
        siteId: cat.siteId,
        siteName: site ? site.name : '',
        cageCode: cage ? cage.code : '',
        title: '每日点检',
        status: 'open',
        claimedBy: '',
        claimedByName: '',
        claimedAt: null,
        items: emptyRoutineItems(),
        createdAt: Date.now(),
      })
    })
  }

  function ensureCareTasks(state) {
    const dateKey = dateKeyOf(state)
    ;(state.care_plans || []).forEach((plan) => {
      if (!plan.enabled) return
      if (plan.startDateKey > dateKey || plan.endDateKey < dateKey) return
      const cat = state.cats.find((c) => c._id === plan.catId)
      if (!cat || (cat.campusStatus || 'on_campus') !== 'on_campus') return
      const exists = (state.cat_tasks || []).some(
        (t) => t.dateKey === dateKey && t.kind === 'care' && t.planId === plan._id,
      )
      if (exists) return
      const site = state.sites.find((s) => s._id === (plan.siteId || cat.siteId))
      const cage = state.cages.find((c) => c._id === cat.cageId)
      state.cat_tasks.push({
        _id: id('task'),
        kind: 'care',
        planId: plan._id,
        dateKey,
        catId: cat._id,
        catName: cat.name,
        siteId: cat.siteId || plan.siteId || '',
        siteName: site ? site.name : '',
        cageCode: cage ? cage.code : '',
        title: plan.title,
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
      })
    })
  }

  function requestStatus(req, state) {
    if (!req) return null
    const expired = req.status === 'approved' && req.expireDateKey && req.expireDateKey < dateKeyOf(state)
    return expired ? 'expired' : req.status
  }

  function publicAccess(req, state, includePassword) {
    if (!req) return null
    const status = requestStatus(req, state)
    return {
      _id: req._id,
      siteId: req.siteId,
      siteName: req.siteName,
      displayName: req.displayName || '',
      status,
      expireDateKey: req.expireDateKey || '',
      password: includePassword && status === 'approved' ? req.password : '',
      createdAt: req.createdAt,
    }
  }

  function latestRequest(state, openid, siteId) {
    return (state.access_requests || [])
      .filter((r) => r.openid === openid && r.siteId === siteId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
  }

  function applyHospital(cat) {
    cat.campusStatus = 'medical'
    cat.status = 'medical'
    cat.siteId = ''
    cat.cageId = ''
    setCatAssetIds(cat, [])
    cat.updatedAt = Date.now()
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

  function upsertOpenVisit(state, cat, stay) {
    if (!Array.isArray(state.hospital_visits)) state.hospital_visits = []
    let visit = state.hospital_visits.find((v) => v.catId === cat._id && !v.returnedAt)
    if (!visit) {
      visit = {
        _id: id('hosp'),
        catId: cat._id,
        catName: cat.name,
        returnedAt: null,
        returnedByName: '',
        createdAt: Date.now(),
      }
      state.hospital_visits.unshift(visit)
    }
    Object.assign(visit, stay, { catName: cat.name })
    return visit
  }

  handlers.dateKeyOf = dateKeyOf
  handlers.housingOf = housingOf

  handlers.advanceMockDay = function advanceMockDay(state, _event, user) {
    if (!isApproved(user) && user.role !== 'pending') return fail('无权限', 'FORBIDDEN')
    state.mockDateKey = addDays(dateKeyOf(state), 1)
    return ok({ mockDateKey: state.mockDateKey, message: `演示日期已切到 ${state.mockDateKey}` })
  }

  handlers.listCatTasks = function listCatTasks(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能查看猫务', 'FORBIDDEN')
    if (!state.cat_tasks) state.cat_tasks = []
    if (!state.care_plans) state.care_plans = []
    ensureRoutineTasks(state)
    ensureCareTasks(state)
    const dateKey = event.dateKey || dateKeyOf(state)
    let rows = state.cat_tasks.filter((t) => t.dateKey === dateKey)
    if (event.siteId) rows = rows.filter((t) => t.siteId === event.siteId)
    if (event.kind) rows = rows.filter((t) => (t.kind || 'routine') === event.kind)
    rows.sort((a, b) => {
      const order = { open: 0, claimed: 1, done: 2 }
      return (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(a.catName).localeCompare(String(b.catName), 'zh')
    })
    return ok({
      dateKey,
      mockDateKey: state.mockDateKey || dateKey,
      isAdmin: user.role === 'admin',
      tasks: rows.map((t) => decorateTask(state, t, user)),
    })
  }

  handlers.claimCatTask = function claimCatTask(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const task = (state.cat_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    if (task.status === 'done') return fail('今日该任务已完成')
    if (task.status === 'claimed' && task.claimedBy !== user.openid) {
      return fail(`已被 ${task.claimedByName || '其他成员'} 领取`)
    }
    task.status = 'claimed'
    task.claimedBy = user.openid
    task.claimedByName = user.displayName || '未署名成员'
    task.claimedAt = Date.now()
    if (typeof ensureOnDuty === 'function') ensureOnDuty(state, user, task.siteId, 'task')
    writeLog(state, user, {
      action: 'claim_cat_task',
      targetType: 'cat_task',
      targetId: task._id,
      siteId: task.siteId,
      after: { catId: task.catId, kind: task.kind },
    })
    return ok({ taskId: task._id, status: task.status })
  }

  handlers.completeCatTaskItem = function completeCatTaskItem(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const task = (state.cat_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    if (task.status === 'open' && user.role !== 'admin') return fail('请先领取任务')
    if (task.status === 'claimed' && task.claimedBy !== user.openid && user.role !== 'admin') {
      return fail('只有领取人或管理员可勾完成')
    }
    if (typeof ensureOnDuty === 'function') ensureOnDuty(state, user, task.siteId, 'task')
    if (task.status === 'open' && user.role === 'admin') {
      task.status = 'claimed'
      task.claimedBy = user.openid
      task.claimedByName = user.displayName || '管理员'
      task.claimedAt = Date.now()
    }
    const key = String(event.item || '')
    if (Array.isArray(task.items)) {
      const item = task.items.find((i) => i.key === key)
      if (!item) return fail('没有这一项')
      item.done = true
      item.doneByName = user.displayName || '未署名成员'
      item.doneAt = Date.now()
      if (task.items.every((i) => i.done)) task.status = 'done'
    } else {
      if (!ROUTINE_LABELS[key]) return fail('没有这一项')
      if (!task.items[key]) task.items[key] = { done: false }
      task.items[key].done = true
      task.items[key].doneByName = user.displayName || '未署名成员'
      task.items[key].doneAt = Date.now()
      if (['food', 'water', 'litter'].every((k) => task.items[k] && task.items[k].done)) {
        task.status = 'done'
      } else if (task.status === 'open') {
        task.status = 'claimed'
      }
    }
    writeLog(state, user, {
      action: 'complete_cat_task_item',
      targetType: 'cat_task',
      targetId: task._id,
      siteId: task.siteId,
      after: { item: key, catId: task.catId },
    })
    return ok({ taskId: task._id, status: task.status })
  }

  handlers.adminResetCatTask = function adminResetCatTask(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可重置任务', 'FORBIDDEN')
    const task = (state.cat_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    task.status = 'open'
    task.claimedBy = ''
    task.claimedByName = ''
    task.claimedAt = null
    if (Array.isArray(task.items)) {
      task.items.forEach((item) => {
        item.done = false
        item.doneByName = ''
        item.doneAt = null
      })
    } else {
      task.items = emptyRoutineItems()
    }
    return ok({ taskId: task._id, status: 'open' })
  }

  handlers.requestSiteAccess = function requestSiteAccess(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能申请', 'FORBIDDEN')
    if (user.role === 'admin') return fail('管理员可直接查看保密地址')
    const site = state.sites.find((s) => s._id === event.siteId)
    if (!site) return fail('点位不存在', 'NOT_FOUND')
    if (!site.confidential) return fail('该点不是保密地点')
    const prev = latestRequest(state, user.openid, site._id)
    const status = requestStatus(prev, state)
    if (status === 'pending') return fail('已有待审批申请')
    if (status === 'approved') return fail('已有当天有效的动态密码')
    const row = {
      _id: id('access'),
      siteId: site._id,
      siteName: site.name,
      openid: user.openid,
      displayName: user.displayName || '未署名成员',
      status: 'pending',
      password: '',
      expireDateKey: '',
      createdAt: Date.now(),
    }
    state.access_requests.push(row)
    return ok({ request: publicAccess(row, state, false) })
  }

  handlers.listMyAccessRequests = function listMyAccessRequests(state, _event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const rows = (state.access_requests || [])
      .filter((r) => r.openid === user.openid)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((r) => publicAccess(r, state, true))
    return ok({ requests: rows })
  }

  handlers.revealSiteAddress = function revealSiteAddress(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const site = state.sites.find((s) => s._id === event.siteId)
    if (!site) return fail('点位不存在', 'NOT_FOUND')
    if (!site.confidential || user.role === 'admin') {
      return ok({ address: site.address || '', lockNote: site.lockNote || '', expireDateKey: '' })
    }
    const req = latestRequest(state, user.openid, site._id)
    const status = requestStatus(req, state)
    if (status !== 'approved') return fail('请先申请并由管理员通过')
    if (String(event.password || '').trim() !== req.password) return fail('动态密码不正确')
    return ok({
      address: site.address || '未填写',
      lockNote: site.lockNote || '无',
      expireDateKey: req.expireDateKey,
    })
  }

  handlers.adminListAccessRequests = function adminListAccessRequests(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可审批地址申请', 'FORBIDDEN')
    let rows = (state.access_requests || []).slice()
    if (event.status) rows = rows.filter((r) => requestStatus(r, state) === event.status)
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return ok({
      requests: rows.map((r) => publicAccess(r, state, false)),
    })
  }

  handlers.adminDecideAccess = function adminDecideAccess(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可审批地址申请', 'FORBIDDEN')
    const req = (state.access_requests || []).find((r) => r._id === event.requestId)
    if (!req) return fail('申请不存在', 'NOT_FOUND')
    const decision = event.decision === 'approved' ? 'approved' : 'rejected'
    req.status = decision
    req.decidedAt = Date.now()
    if (decision === 'approved') {
      req.password = makePassword()
      req.expireDateKey = dateKeyOf(state)
    } else {
      req.password = ''
      req.expireDateKey = ''
    }
    writeLog(state, user, {
      action: 'decide_access',
      targetType: 'access_request',
      targetId: req._id,
      siteId: req.siteId,
      after: { status: decision },
    })
    return ok({ requestId: req._id, status: decision })
  }

  handlers.listCarePlans = function listCarePlans(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const dateKey = dateKeyOf(state)
    let rows = (state.care_plans || []).slice()
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

  handlers.adminUpsertCarePlan = function adminUpsertCarePlan(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护特护方案', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    const title = String(event.title || '').trim().slice(0, 20)
    if (!title) return fail('请填写特护名称')
    const items = (event.items || [])
      .map((item, idx) => ({
        key: String(item.key || `item_${idx + 1}`).slice(0, 16),
        label: String(item.label || '').trim().slice(0, 20),
      }))
      .filter((item) => item.label)
      .slice(0, 6)
    if (!items.length) return fail('请至少填写一项每日操作')
    const startDateKey = String(event.startDateKey || dateKeyOf(state))
    const endDateKey = String(event.endDateKey || addDays(startDateKey, 4))
    if (endDateKey < startDateKey) return fail('结束日期不能早于开始日期')
    const tutorial = {
      text: String((event.tutorial && event.tutorial.text) || event.tutorialText || '').trim().slice(0, 400),
      photoFileIds: ((event.tutorial && event.tutorial.photoFileIds) || event.photoFileIds || []).slice(0, 6),
    }
    let planId = event.planId
    if (planId) {
      const plan = (state.care_plans || []).find((p) => p._id === planId)
      if (!plan) return fail('特护方案不存在', 'NOT_FOUND')
      Object.assign(plan, {
        title,
        items,
        startDateKey,
        endDateKey,
        tutorial,
        siteId: cat.siteId || plan.siteId || '',
        enabled: event.enabled !== false,
      })
    } else {
      planId = id('plan')
      if (!state.care_plans) state.care_plans = []
      state.care_plans.push({
        _id: planId,
        catId: cat._id,
        catName: cat.name,
        siteId: cat.siteId || '',
        title,
        items,
        startDateKey,
        endDateKey,
        tutorial,
        enabled: true,
        createdAt: Date.now(),
      })
    }
    return ok({ planId })
  }

  handlers.adminDisableCarePlan = function adminDisableCarePlan(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可结束特护', 'FORBIDDEN')
    const plan = (state.care_plans || []).find((p) => p._id === event.planId)
    if (!plan) return fail('特护方案不存在', 'NOT_FOUND')
    plan.enabled = false
    return ok({ planId: plan._id, enabled: false })
  }

  handlers.markCatHospital = function markCatHospital(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    const already = (cat.campusStatus || '') === 'medical'
    const allowed = user.role === 'admin' || isApproved(user) || already
    if (!allowed) return fail('通过审核的成员才能送猫就医', 'FORBIDDEN')
    const parsed = parseHospitalStay(event)
    if (parsed.error) return fail(parsed.error)
    const site = state.sites.find((s) => s._id === cat.siteId)
    const now = Date.now()
    const prev = cat.hospitalStay || {}
    const stay = {
      ...parsed.stay,
      sentAt: prev.sentAt || now,
      sentByName: prev.sentByName || user.displayName || '未署名成员',
      fromSiteName: prev.fromSiteName || (site && site.name) || '',
    }
    const oldSiteId = cat.siteId || ''
    applyHospital(cat)
    cat.hospitalStay = stay
    upsertOpenVisit(state, cat, stay)
    writeLog(state, user, {
      action: already ? 'update_cat_hospital' : 'mark_cat_hospital',
      targetType: 'cat',
      targetId: cat._id,
      siteId: oldSiteId,
      after: stay,
    })
    return ok({ catId: cat._id, campusStatus: 'medical', released: true, hospitalStay: stay })
  }

  handlers.returnCatFromHospital = function returnCatFromHospital(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    if ((cat.campusStatus || '') !== 'medical') return fail('这只猫不在就医中')
    const now = Date.now()
    const visit = (state.hospital_visits || []).find((v) => v.catId === cat._id && !v.returnedAt)
    if (visit) {
      visit.returnedAt = now
      visit.returnedByName = user.displayName || '未署名成员'
    }
    cat.lastHospitalStay = cat.hospitalStay || cat.lastHospitalStay || null
    cat.hospitalStay = null
    cat.campusStatus = 'on_campus'
    cat.status = 'observe'
    cat.updatedAt = now
    writeLog(state, user, {
      action: 'return_cat_from_hospital',
      targetType: 'cat',
      targetId: cat._id,
      after: { campusStatus: 'on_campus' },
    })
    return ok({ catId: cat._id, campusStatus: 'on_campus', status: 'observe' })
  }

  const FINANCE_CATS = { 捐款: 1, 买药: 1, 猫粮: 1, 交通: 1, 其他: 1 }
  const DONATE_STATUS = {
    pending_in: '待入库',
    on_site: '已在点上',
    moving: '搬运中',
    used: '已用完',
  }
  const SZCAT_CLAIM = {
    open: '待抢',
    claimed: '已认领',
    submitted: '已提交',
    won: '已中签',
    lost: '未中签',
    done: '已手术',
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

  handlers.adminListFinance = function adminListFinance(state, _event, user) {
    if (user.role !== 'admin') return fail('仅管理员可查看台账', 'FORBIDDEN')
    const entries = (state.finance_entries || []).slice().sort((a, b) => String(b.dateKey).localeCompare(a.dateKey))
    const income = entries.filter((e) => e.type === 'income').reduce((s, e) => s + Number(e.amount || 0), 0)
    const expense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + Number(e.amount || 0), 0)
    return ok({ entries, income, expense, balance: income - expense, csv: financeCsv(entries) })
  }

  handlers.adminUpsertFinance = function adminUpsertFinance(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可记账', 'FORBIDDEN')
    const dateKey = String(event.dateKey || dateKeyOf(state))
    const type = event.type === 'income' ? 'income' : 'expense'
    const amount = Number(event.amount)
    const category = FINANCE_CATS[event.category] ? event.category : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return fail('日期不合法')
    if (Number.isNaN(amount) || amount < 0) return fail('金额不合法')
    if (!category) return fail('科目不合法')
    if (!state.finance_entries) state.finance_entries = []
    let entryId = event.entryId
    if (entryId) {
      const row = state.finance_entries.find((e) => e._id === entryId)
      if (!row) return fail('记录不存在', 'NOT_FOUND')
      Object.assign(row, {
        dateKey,
        type,
        amount,
        category,
        remark: String(event.remark || '').trim().slice(0, 80),
        handlerName: String(event.handlerName || user.displayName || '').trim().slice(0, 20),
      })
    } else {
      entryId = id('fin')
      state.finance_entries.unshift({
        _id: entryId,
        dateKey,
        type,
        amount,
        category,
        remark: String(event.remark || '').trim().slice(0, 80),
        handlerName: String(event.handlerName || user.displayName || '').trim().slice(0, 20),
        createdAt: Date.now(),
      })
    }
    return ok({ entryId })
  }

  handlers.adminDeleteFinance = function adminDeleteFinance(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可删账', 'FORBIDDEN')
    state.finance_entries = (state.finance_entries || []).filter((e) => e._id !== event.entryId)
    return ok({ entryId: event.entryId })
  }

  handlers.adminExportFinanceCsv = function adminExportFinanceCsv(state, _event, user) {
    if (user.role !== 'admin') return fail('仅管理员可导出', 'FORBIDDEN')
    return ok({ csv: financeCsv(state.finance_entries || []), filename: `动保台账_${dateKeyOf(state)}.csv` })
  }

  handlers.adminImportFinanceCsv = function adminImportFinanceCsv(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可导入', 'FORBIDDEN')
    const parsed = parseFinanceCsv(event.csv)
    if (!parsed.rows.length && parsed.errors.length) return fail(parsed.errors[0])
    if (!state.finance_entries) state.finance_entries = []
    parsed.rows.forEach((row) => {
      state.finance_entries.unshift({
        _id: id('fin'),
        ...row,
        createdAt: Date.now(),
      })
    })
    return ok({ imported: parsed.rows.length, errors: parsed.errors })
  }

  handlers.submitDonation = function submitDonation(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能登记捐助', 'FORBIDDEN')
    const name = String(event.name || '').trim().slice(0, 20)
    const quantity = String(event.quantity || '').trim().slice(0, 16)
    const donorName = String(event.donorName || user.displayName || '').trim().slice(0, 20)
    const electronic = !!event.electronic
    const location = String(event.location || '').trim().slice(0, 40)
    if (!name) return fail('请填写物资名')
    if (!quantity) return fail('请填写数量')
    if (!donorName) return fail('请填写捐助人')
    if (!electronic && !location) return fail('实体物资必须填写当前位置')
    if (!state.donations) state.donations = []
    const row = {
      _id: id('don'),
      name,
      quantity,
      donorName,
      electronic,
      location: electronic ? '' : location,
      status: electronic ? 'used' : 'pending_in',
      statusText: electronic ? '电子捐助（无需仓储）' : DONATE_STATUS.pending_in,
      createdBy: user.openid,
      createdAt: Date.now(),
    }
    state.donations.unshift(row)
    let moveTaskId = ''
    if (!electronic && event.publishMove) {
      const toLocation = String(event.toLocation || '').trim()
      if (!toLocation) return fail('发布搬运请填写运到哪里')
      moveTaskId = createMoveWorkTask(state, user, {
        donationId: row._id,
        itemName: name,
        quantity,
        fromLocation: location,
        toLocation,
        photoFileIds: event.photoFileIds || [],
      }).taskId
    }
    return ok({ donationId: row._id, moveTaskId })
  }

  handlers.listDonations = function listDonations(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    let rows = (state.donations || []).slice()
    if (user.role !== 'admin' && event.mineOnly) rows = rows.filter((d) => d.createdBy === user.openid)
    let orgBalance = null
    if (user.role === 'admin') {
      const entries = state.finance_entries || []
      const income = entries.filter((e) => e.type === 'income').reduce((s, e) => s + Number(e.amount || 0), 0)
      const expense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + Number(e.amount || 0), 0)
      orgBalance = { income, expense, balance: income - expense }
    }
    return ok({
      isAdmin: user.role === 'admin',
      orgBalance,
      donations: rows.map((d) => ({
        ...d,
        statusText: d.electronic ? '电子捐助（无需仓储）' : (DONATE_STATUS[d.status] || d.status),
        canPublishMove: !d.electronic && d.status !== 'used' && d.status !== 'moving',
      })),
    })
  }

  handlers.adminSetDonationStatus = function adminSetDonationStatus(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可改捐助状态', 'FORBIDDEN')
    const row = (state.donations || []).find((d) => d._id === event.donationId)
    if (!row) return fail('捐助不存在', 'NOT_FOUND')
    if (row.electronic) return fail('电子物资无需改仓储状态')
    if (!DONATE_STATUS[event.status]) return fail('状态不合法')
    row.status = event.status
    if (event.location) row.location = String(event.location).trim().slice(0, 40)
    return ok({ donationId: row._id, status: row.status })
  }

  function createMoveWorkTask(state, user, payload) {
    if (!Array.isArray(state.work_tasks)) state.work_tasks = []
    const toLocation = String(payload.toLocation || '').trim()
    const fromLocation = String(payload.fromLocation || '').trim()
    const itemName = String(payload.itemName || '物资').trim()
    const quantity = String(payload.quantity || '').trim()
    const task = {
      _id: id('work'),
      kind: 'move',
      scope: 'timed',
      siteId: 'move_board',
      siteName: '搬运',
      title: `搬运 ${itemName}`,
      content: `把「${itemName}${quantity ? ' ' + quantity : ''}」从 ${fromLocation || '未填'} 运到 ${toLocation}`,
      photoFileIds: (payload.photoFileIds || []).filter(Boolean).slice(0, 6),
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
    state.work_tasks.unshift(task)
    const don = (state.donations || []).find((d) => d._id === payload.donationId)
    if (don) don.status = 'moving'
    return { taskId: task._id, task }
  }

  handlers.adminPublishMoveTask = function adminPublishMoveTask(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const don = (state.donations || []).find((d) => d._id === event.donationId)
    if (!don) return fail('捐助不存在', 'NOT_FOUND')
    if (don.electronic) return fail('电子物资不能发搬运任务')
    const toLocation = String(event.toLocation || '').trim()
    if (!toLocation) return fail('请填写运到哪里')
    const move = createMoveWorkTask(state, user, {
      donationId: don._id,
      itemName: don.name,
      quantity: don.quantity,
      fromLocation: event.fromLocation || don.location || '',
      toLocation,
      photoFileIds: event.photoFileIds || [],
    })
    return ok({ taskId: move.taskId })
  }

  handlers.claimMoveTask = function claimMoveTask(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const task = (state.move_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('搬运任务不存在', 'NOT_FOUND')
    if (task.status === 'done') return fail('已完成')
    if (task.status === 'claimed' && task.claimedBy !== user.openid) return fail('已被他人领取')
    task.status = 'claimed'
    task.claimedBy = user.openid
    task.claimedByName = user.displayName || '未署名成员'
    task.claimedAt = Date.now()
    if (typeof ensureOnDuty === 'function') ensureOnDuty(state, user, task.siteId, 'task')
    return ok({ taskId: task._id })
  }

  handlers.completeMoveTask = function completeMoveTask(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const task = (state.move_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('搬运任务不存在', 'NOT_FOUND')
    if (task.status === 'open' && user.role !== 'admin') return fail('请先领取任务')
    if (task.status === 'claimed' && task.claimedBy !== user.openid && user.role !== 'admin') {
      return fail('只有领取人或管理员可完成')
    }
    task.status = 'done'
    const don = (state.donations || []).find((d) => d._id === task.donationId)
    if (don) {
      don.location = task.toLocation
      don.status = 'on_site'
    }
    return ok({ taskId: task._id, location: task.toLocation })
  }

  const oldList = handlers.listCatTasks
  handlers.listCatTasks = function listCatTasksMerged(state, event, user) {
    return Promise.resolve(oldList(state, event, user)).then((data) => {
      const dateKey = (data && data.dateKey) || dateKeyOf(state)
      let moves = (state.move_tasks || []).filter((t) => !event.dateKey || t.dateKey === dateKey)
      if (event.siteId) moves = []
      if (event.kind && event.kind !== 'move') moves = []
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
      return {
        ...data,
        tasks: (data.tasks || []).concat(extra),
      }
    })
  }

  handlers.getSzcatPanel = function getSzcatPanel(state, _event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能查看绝育指标', 'FORBIDDEN')
    const cfg = state.szcat_config || {}
    const cats = (state.cats || [])
      .filter((c) => !c.neutered && (c.sterilizeNeed || (c.campusStatus || 'on_campus') === 'on_campus'))
      .filter((c) => c.sterilizeNeed)
      .map((c) => {
        const claim = (state.szcat_claims || []).find((x) => x.catId === c._id && x.monthKey === cfg.monthKey)
        return {
          ...c,
          claimStatus: claim ? claim.status : 'open',
          claimStatusText: claim ? (SZCAT_CLAIM[claim.status] || claim.status) : SZCAT_CLAIM.open,
          claimedByName: claim ? claim.claimedByName : '',
          claimId: claim ? claim._id : '',
          mine: claim ? claim.claimedBy === user.openid : false,
        }
      })
    return ok({
      config: cfg,
      copies: state.szcat_copies || [],
      cats,
      claims: (state.szcat_claims || []).filter((c) => c.monthKey === cfg.monthKey),
      isAdmin: user.role === 'admin',
      officialUrl: (cfg.officialUrl || 'https://www.szcat.org/'),
      platformUrl: (cfg.platformUrl || 'https://ph.szcat.org/newskin/frmnsszcati.aspx'),
      disclaimer: '本小程序只做准备与跳转。提交、抢指标仍须在深圳猫网官方网站或公众号完成，禁止刷号或代填自动提交。',
    })
  }

  handlers.adminSaveSzcatConfig = function adminSaveSzcatConfig(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可配置绝育指标说明', 'FORBIDDEN')
    state.szcat_config = Object.assign(state.szcat_config || {}, {
      monthKey: String(event.monthKey || (state.szcat_config && state.szcat_config.monthKey) || '').slice(0, 7),
      openNote: String(event.openNote || '').trim().slice(0, 120),
      notice: String(event.notice || '').trim().slice(0, 200),
      tutorialText: String(event.tutorialText || '').trim().slice(0, 800),
      tutorialPhotoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6),
      officialUrl: String(event.officialUrl || 'https://www.szcat.org/').trim().slice(0, 120),
      platformUrl: String(event.platformUrl || 'https://ph.szcat.org/newskin/frmnsszcati.aspx').trim().slice(0, 160),
    })
    return ok({ config: state.szcat_config })
  }

  handlers.adminAddSzcatCopy = function adminAddSzcatCopy(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可发布绝育文案', 'FORBIDDEN')
    const title = String(event.title || '').trim().slice(0, 40)
    const body = String(event.body || '').trim().slice(0, 800)
    if (!title || !body) return fail('请填写文案标题和正文')
    if (!state.szcat_copies) state.szcat_copies = []
    const row = {
      _id: id('szcopy'),
      title,
      body,
      photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6),
      createdAt: Date.now(),
    }
    state.szcat_copies.unshift(row)
    return ok({ copyId: row._id })
  }

  handlers.adminDeleteSzcatCopy = function adminDeleteSzcatCopy(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可删除绝育文案', 'FORBIDDEN')
    state.szcat_copies = (state.szcat_copies || []).filter((c) => c._id !== event.copyId)
    return ok({ copyId: event.copyId })
  }

  handlers.claimSzcatSlot = function claimSzcatSlot(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat || !cat.sterilizeNeed || cat.neutered) return fail('这只猫不在本月待绝育名单')
    const monthKey = (state.szcat_config && state.szcat_config.monthKey) || ''
    if (!state.szcat_claims) state.szcat_claims = []
    const exist = state.szcat_claims.find((c) => c.catId === cat._id && c.monthKey === monthKey)
    if (exist && exist.status !== 'open' && exist.claimedBy !== user.openid) {
      return fail(`已由 ${exist.claimedByName} 认领`)
    }
    if (exist) {
      exist.status = event.status && SZCAT_CLAIM[event.status] ? event.status : 'claimed'
      exist.claimedBy = user.openid
      exist.claimedByName = user.displayName || '未署名成员'
      return ok({ claimId: exist._id, status: exist.status })
    }
    const row = {
      _id: id('szcat'),
      catId: cat._id,
      catName: cat.name,
      monthKey,
      status: 'claimed',
      claimedBy: user.openid,
      claimedByName: user.displayName || '未署名成员',
      createdAt: Date.now(),
    }
    state.szcat_claims.push(row)
    return ok({ claimId: row._id, status: row.status })
  }

  handlers.setSzcatClaimStatus = function setSzcatClaimStatus(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const claim = (state.szcat_claims || []).find((c) => c._id === event.claimId)
    if (!claim) return fail('认领不存在', 'NOT_FOUND')
    if (claim.claimedBy !== user.openid && user.role !== 'admin') return fail('只能改自己认领的状态')
    if (!SZCAT_CLAIM[event.status]) return fail('状态不合法')
    claim.status = event.status
    return ok({ claimId: claim._id, status: claim.status })
  }

  handlers.buildSzcatPack = function buildSzcatPack(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const cat = state.cats.find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    const gender = { male: '公', female: '母', unknown: '未知' }[cat.gender] || '未知'
    const health = { healthy: '健康', under_weather: '不适', recovering: '恢复中', unknown: '未知' }[cat.healthStatus] || '未知'
    const campus = { on_campus: '在校', off_campus: '离校', medical: '就医' }[cat.campusStatus || 'on_campus']
    const text = [
      '【深圳猫网报名资料包·演示】',
      `化名：${cat.name}`,
      `性别：${gender}`,
      `大致年龄：${cat.ageText || '未填'}`,
      `品种：${cat.breed || '未填'}`,
      `健康：${health}`,
      `是否在校：${campus}`,
      '提交请到深圳猫网官方网站或公众号，本包不能代替官方表单。',
    ].join('\n')
    return ok({ text })
  }

  function decorateWorkTask(task, user, todayKey) {
    const viewed = applyScopeView(task, todayKey || dateKeyOf({}))
    if (viewed.allowMultiple) {
      const day = todayKey || dateKeyOf({})
      const cycle = taskCycleKey(viewed, day)
      const all = viewed.participants || []
      const participants = all.filter((p) => (p.cycleKey || p.dateKey) === cycle)
      const own = all.find((p) => p.openid === user.openid && p.status === 'claimed')
      const visible = user.role === 'admin'
        ? all.filter((p) => (p.cycleKey || p.dateKey) === cycle || p.status === 'review')
        : all.filter((p) => (p.cycleKey || p.dateKey) === cycle || p.openid === user.openid && p.status === 'claimed')
      return {
        ...viewed,
        photoFileIds: viewed.photoFileIds || [],
        participants: visible.map((p) => ({
          key: p.key, workerName: p.workerName, status: p.status, dateKey: p.dateKey,
          report: user.role === 'admin' || p.openid === user.openid ? (p.report || null) : null,
        })),
        canClaim: isApproved(user) && viewed.dueToday && !own
          && !participants.some((p) => p.openid === user.openid)
          && participants.length < (viewed.maxParticipants || 2),
        canRelease: !!(own && own.status === 'claimed'),
        canSubmit: !!(own && own.status === 'claimed'),
        canReview: user.role === 'admin' && all.some((p) => p.status === 'review'),
        canDelete: user.role === 'admin' || !!(viewed.createdBy && viewed.createdBy === user.openid),
        report: null,
      }
    }
    return {
      ...viewed,
      photoFileIds: viewed.photoFileIds || [],
      canClaim: viewed.status === 'open' && viewed.dueToday && isApproved(user),
      canRelease: viewed.status === 'claimed' && viewed.claimedBy === user.openid,
      canSubmit: viewed.status === 'claimed' && viewed.claimedBy === user.openid,
      claimedByName: viewed.status === 'claimed' ? (viewed.claimedByName || '成员') : '',
      canReview: viewed.status === 'review' && user.role === 'admin',
      canDelete: user.role === 'admin' || !!(viewed.createdBy && viewed.createdBy === user.openid),
      report: viewed.report || null,
    }
  }

  handlers.listWorkTasks = function listWorkTasks(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能查看任务', 'FORBIDDEN')
    if (!Array.isArray(state.work_tasks)) state.work_tasks = []
    const sites = (state.sites || []).filter((s) => s.enabled !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0))
    const todayKey = dateKeyOf(state)
    const wanted = String(event.siteId || '')
    const wantedScope = parseScope(event.scope, '')
    const mineFilter = String(event.mineFilter || '')
    const submittedTaskIds = mineFilter === 'done' ? new Set((state.work_task_reports || [])
      .filter((report) => report.submittedBy === user.openid)
      .map((report) => report.taskId)) : null
    const boardSites = [
      { _id: 'general', name: '不限地点' },
      { _id: 'move_board', name: '搬运' },
    ].concat(sites)
    const groups = boardSites
      .filter((site) => !wanted || site._id === wanted)
      .map((site) => {
        const tasks = state.work_tasks
          .filter((t) => {
            if (wantedScope && normalizeScope(t) !== wantedScope) return false
            if (mineFilter === 'published' && t.createdBy !== user.openid) return false
            if (mineFilter === 'done' && !submittedTaskIds.has(t._id)
              && !(t.report && t.report.submittedBy === user.openid)
              && !(t.participants || []).some((p) => p.report && p.report.submittedBy === user.openid)) return false
            if (site._id === 'move_board') return t.kind === 'move' || t.siteId === 'move_board'
            if (site._id === 'general') return t.kind !== 'move' && (!t.siteId || t.siteId === 'general')
            return t.siteId === site._id
          })
          .sort((a, b) => {
            const order = (task) => task.status === 'claimed' && task.claimedBy === user.openid
              ? -1 : ({ open: 0, claimed: 1, review: 2, done: 3 }[task.status] ?? 9)
            return order(a) - order(b) || (b.createdAt || 0) - (a.createdAt || 0)
          })
          .map((t) => decorateWorkTask(t, user, todayKey))
        return { siteId: site._id, siteName: site.name, tasks }
      })
      .filter((g) => {
        if (g.tasks.length) return true
        if (wanted) return true
        return false
      })
    return ok({
      isAdmin: user.role === 'admin',
      groups,
      sites: sites.map((s) => ({ _id: s._id, name: s.name })),
    })
  }

  handlers.getWorkTask = function getWorkTask(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能查看任务', 'FORBIDDEN')
    const task = (state.work_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    return ok({ isAdmin: user.role === 'admin', task: decorateWorkTask(task, user, dateKeyOf(state)) })
  }

  handlers.adminPublishWorkTask = function adminPublishWorkTask(state, event, user) {
    if (!isApproved(user)) return fail('通过审核的成员才能发布任务', 'FORBIDDEN')
    const sourceId = user.role === 'admin' ? String(event.sourceId || '').trim().slice(0, 80) : ''
    if (sourceId) {
      const existing = (state.work_tasks || []).find((task) => task.sourceId === sourceId)
      if (existing) return ok({ taskId: existing._id, skipped: true })
    }
    const wantedSite = String(event.siteId || '').trim()
    const site = wantedSite && wantedSite !== 'general'
      ? (state.sites || []).find((s) => s._id === wantedSite && s.enabled !== false)
      : null
    if (wantedSite && wantedSite !== 'general' && !site) return fail('地点不存在')
    const title = String(event.title || '').trim().slice(0, 40)
    const content = String(event.content || '').trim().slice(0, 300)
    if (!title) return fail('请填写任务标题')
    if (!content) return fail('请填写任务内容')
    const scope = parseScope(event.scope, 'once') || 'once'
    const weekdays = parseWeekdays(event.weekdays)
    if (scope === 'weekly' && !weekdays.length) return fail('请选择每周执行的星期')
    const allowMultiple = event.allowMultiple === true
    const maxParticipants = allowMultiple ? Number(event.maxParticipants) : 1
    if (allowMultiple && (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 50)) {
      return fail('多人任务人数上限请填 2–50')
    }
    const deadlineDateKey = parseDeadlineDateKey(event.deadlineDateKey)
    const completionDescription = String(event.completionDescription || '').trim().slice(0, 400)
    const completionPhotos = (event.completionPhotoFileIds || []).filter(Boolean).slice(0, 6)
    if (completionPhotos.length && !completionDescription) return fail('上传完成照片时请填写完成情况')
    const completedNow = !!completionDescription
    const todayKey = dateKeyOf(state)
    const workerName = String(user.displayName || '成员').trim().slice(0, 20)
    if (!Array.isArray(state.work_tasks)) state.work_tasks = []
    const task = {
      _id: id('work'),
      kind: 'duty',
      scope,
      weekdays: scope === 'weekly' ? weekdays : [],
      allowMultiple,
      maxParticipants,
      participants: [],
      deadlineDateKey: scope === 'once' ? deadlineDateKey : '',
      lastDoneDateKey: '',
      siteId: site ? site._id : 'general',
      siteName: site ? site.name : '不限地点',
      title,
      content,
      photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6),
      status: completedNow && !allowMultiple ? 'review' : 'open',
      createdBy: user.openid,
      createdByName: user.displayName || '成员',
      publisherTag: user.role === 'admin' ? '' : '普通成员发布',
      createdAt: Date.now(),
      sourceId,
      sourceAt: Number(event.sourceAt) || 0,
      report: null,
      rejectNote: '',
    }
    if (completedNow && !applyScopeView(task, todayKey).dueToday) {
      return fail('所选频率今天不执行，已完成的任务请选单次或今天对应的星期')
    }
    if (completedNow) {
      const report = { description: completionDescription, workerName,
        photoFileIds: completionPhotos, submittedBy: user.openid,
        submittedAt: Date.now(), submittedLate: !!(deadlineDateKey && todayKey > deadlineDateKey) }
      if (allowMultiple) {
        const key = `claim:${Date.now()}:${Math.floor(Math.random() * 1000000)}`
        task.participants = [{ key, dateKey: todayKey, cycleKey: taskCycleKey(task, todayKey),
          openid: user.openid, workerName, status: 'review', report: { ...report, participantKey: key } }]
      } else {
        task.claimedBy = user.openid
        task.claimedByName = workerName
        task.claimedDateKey = todayKey
        task.report = report
      }
      if (!Array.isArray(state.work_task_reports)) state.work_task_reports = []
      state.work_task_reports.push({ _id: id('workreport'), taskId: task._id, ...report,
        ...(allowMultiple ? { participantKey: task.participants[0].key } : {}) })
    }
    state.work_tasks.unshift(task)
    writeLog(state, user, { action: 'publish_work_task', targetType: 'work_task', targetId: task._id, siteId: task.siteId })
    return ok({ taskId: task._id, task: decorateWorkTask(task, user, dateKeyOf(state)) })
  }

  handlers.submitWorkTask = function submitWorkTask(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const task = (state.work_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    const live = applyScopeView(task, dateKeyOf(state))
    if (!task.allowMultiple && (live.status !== 'claimed' || task.claimedBy !== user.openid)) return fail('请先领取任务，或刷新查看最新状态')
    const description = String(event.description || '').trim().slice(0, 400)
    const workerName = String(event.workerName || user.displayName || '').trim().slice(0, 20)
    const photoFileIds = (event.photoFileIds || []).filter(Boolean).slice(0, 6)
    if (!description) return fail('请填写任务描述')
    if (!workerName) return fail('请填写做任务的人的名字')
    if (task.allowMultiple) {
      const participants = task.participants || []
      const participant = participants.find((p) => p.openid === user.openid && p.status === 'claimed')
      if (!participant) return fail('请先领取今天的任务，或刷新查看最新状态')
      participant.status = 'review'
      participant.workerName = workerName
      participant.report = { description, workerName, photoFileIds, submittedBy: user.openid, submittedAt: Date.now() }
      participant.report.submittedLate = !!(task.deadlineDateKey && dateKeyOf(state) > task.deadlineDateKey)
      return ok({ taskId: task._id, status: 'review' })
    }
    task.report = {
      description,
      workerName,
      photoFileIds,
      submittedBy: user.openid,
      submittedAt: Date.now(),
      submittedLate: !!(task.deadlineDateKey && dateKeyOf(state) > task.deadlineDateKey),
    }
    task.status = 'review'
    task.rejectNote = ''
    writeLog(state, user, { action: 'submit_work_task', targetType: 'work_task', targetId: task._id, siteId: task.siteId })
    return ok({ taskId: task._id, status: 'review' })
  }

  handlers.listTaskCalendar = function listTaskCalendar(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能查看任务日历', 'FORBIDDEN')
    const monthKey = String(event.monthKey || dateKeyOf(state).slice(0, 7))
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return fail('月份不合法')
    const tasks = Object.fromEntries((state.work_tasks || []).map((task) => [task._id, task]))
    const completed = new Map()
    ;(state.work_task_events || []).filter((item) => item.status === 'done').forEach((item) => {
      const task = tasks[item.taskId]
      if (!task) return
      const dateKey = item.dateKey || dateKeyOf(state)
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

  handlers.listRoutineDuty = function listRoutineDuty(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能看每日执勤', 'FORBIDDEN')
    const monthKey = String(event.monthKey || dateKeyOf(state).slice(0, 7))
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return fail('月份不合法')
    const sites = routineSites(state)
    const logs = (state.routine_duty_checkins || [])
      .filter((row) => row.monthKey === monthKey && row.kind !== 'signup')
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .map((row) => ({
        ...row, photoUrls: row.photoFileIds || [], mine: row.byOpenid === user.openid,
        canDelete: user.role === 'admin' || row.byOpenid === user.openid,
      }))
    const checkedIn = new Set(logs.map((row) => [row.dateKey, row.siteId, row.shiftId, row.byOpenid].join('|')))
    const signups = (state.routine_duty_checkins || []).filter((row) => row.monthKey === monthKey && row.kind === 'signup'
      && !checkedIn.has([row.dateKey, row.siteId, row.shiftId, row.byOpenid].join('|')))
      .map((row) => ({ ...row, mine: row.byOpenid === user.openid,
        canCancel: user.role === 'admin' || row.byOpenid === user.openid }))
    const allowed = new Set(sites.map((site) => site._id))
    const archivedSites = [...new Set(logs.concat(signups).map((row) => row.siteId).filter((id) => !allowed.has(id)))]
      .map((id) => ({ _id: id, name: state.sites.find((site) => site._id === id)?.name
        || logs.concat(signups).find((row) => row.siteId === id)?.siteName || '历史点位', archived: true }))
    return ok({ sites, archivedSites, shifts: ROUTINE_SHIFTS, logs, signups })
  }

  handlers.submitRoutineDuty = function submitRoutineDuty(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const dateKey = String(event.dateKey || dateKeyOf(state))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > dateKeyOf(state)) return fail('只能登记今天或过去的执勤')
    if (!ROUTINE_SHIFTS.some((shift) => shift.id === event.shiftId)) return fail('班次不合法')
    const site = routineSites(state).find((item) => item._id === event.siteId)
    if (!site) return fail('请选择已开启每日执勤的点位')
    if (!Array.isArray(state.routine_duty_checkins)) state.routine_duty_checkins = []
    if (state.routine_duty_checkins.some((row) => row.kind !== 'signup' && row.dateKey === dateKey && row.siteId === site._id
      && row.shiftId === event.shiftId && row.byOpenid === user.openid)) return fail('你已提交过这一天的这个班次', 'ALREADY_DONE')
    const row = {
      _id: id('routine_duty'), kind: 'checkin', dateKey, monthKey: dateKey.slice(0, 7),
      siteId: site._id, siteName: site.name, shiftId: event.shiftId,
      fed: !!event.fed, watered: !!event.watered,
      note: String(event.note || '').trim().slice(0, 200),
      photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 3),
      byOpenid: user.openid, byName: String(user.displayName || '未署名成员').slice(0, 20), at: Date.now(),
    }
    state.routine_duty_checkins.unshift(row)
    state.routine_duty_checkins = state.routine_duty_checkins.filter((signup) =>
      signup.kind !== 'signup' || !(signup.dateKey === dateKey && signup.siteId === site._id
        && signup.shiftId === event.shiftId && signup.byOpenid === user.openid))
    return ok({ checkinId: row._id })
  }

  handlers.signupRoutineDuty = function signupRoutineDuty(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const dateKey = String(event.dateKey || '')
    const today = dateKeyOf(state)
    const limitDate = new Date(today + 'T00:00:00+08:00')
    limitDate.setUTCDate(limitDate.getUTCDate() + 60)
    const limit = todayKey(limitDate)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey < today || dateKey > limit) return fail('只能报名今天起 60 天内的执勤')
    if (!ROUTINE_SHIFTS.some((shift) => shift.id === event.shiftId)) return fail('班次不合法')
    const site = routineSites(state).find((item) => item._id === event.siteId)
    if (!site) return fail('请选择已开启每日执勤的点位')
    const sameSlot = (row) => row.dateKey === dateKey && row.siteId === site._id
      && row.shiftId === event.shiftId && row.byOpenid === user.openid
    if ((state.routine_duty_checkins || []).some((row) => row.kind !== 'signup' && sameSlot(row))) return fail('你已打过这一班', 'ALREADY_DONE')
    if ((state.routine_duty_checkins || []).some((row) => row.kind === 'signup' && sameSlot(row))) return fail('你已报名这一班', 'ALREADY_SIGNED')
    const row = { _id: id('routine_signup'), kind: 'signup', dateKey, monthKey: dateKey.slice(0, 7),
      siteId: site._id, siteName: site.name, shiftId: event.shiftId,
      byOpenid: user.openid, byName: String(user.displayName || '未署名成员').slice(0, 20), at: Date.now() }
    if (!Array.isArray(state.routine_duty_checkins)) state.routine_duty_checkins = []
    state.routine_duty_checkins.unshift(row)
    return ok({ signupId: row._id })
  }

  handlers.cancelRoutineDutySignup = function cancelRoutineDutySignup(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const row = (state.routine_duty_checkins || []).find((item) => item._id === event.signupId && item.kind === 'signup')
    if (!row) return fail('报名不存在', 'NOT_FOUND')
    if (user.role !== 'admin' && row.byOpenid !== user.openid) return fail('只能取消自己的报名', 'FORBIDDEN')
    state.routine_duty_checkins = state.routine_duty_checkins.filter((item) => item._id !== row._id)
    return ok({ signupId: row._id })
  }

  handlers.deleteRoutineDuty = function deleteRoutineDuty(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const row = (state.routine_duty_checkins || []).find((item) => item._id === event.checkinId)
    if (!row || row.kind === 'signup') return fail('执勤打卡不存在', 'NOT_FOUND')
    if (user.role !== 'admin' && row.byOpenid !== user.openid) return fail('只能删自己的打卡', 'FORBIDDEN')
    state.routine_duty_checkins = state.routine_duty_checkins.filter((item) => item._id !== row._id)
    return ok({ checkinId: row._id })
  }

  function siteFeedSummary(rows, dateKey) {
    const today = rows.filter((row) => row.dateKey === dateKey)
    return today.length ? {
      dateKey, count: today.length,
      fed: today.some((row) => !!row.fed),
      watered: today.some((row) => !!row.watered),
    } : null
  }

  handlers.listSiteFeedLogs = function listSiteFeedLogs(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能看点位投喂', 'FORBIDDEN')
    const site = (state.sites || []).find((row) => row._id === event.siteId && row.enabled !== false)
    if (!site) return fail('点位不存在', 'NOT_FOUND')
    const rows = (state.site_feed_logs || []).filter((row) => row.siteId === site._id)
      .sort((a, b) => (b.at || 0) - (a.at || 0))
    return ok({
      today: siteFeedSummary(rows, dateKeyOf(state)),
      logs: rows.slice(0, 20).map((row) => ({
        ...row, canDelete: user.role === 'admin' || row.byOpenid === user.openid,
      })),
    })
  }

  handlers.addSiteFeedLog = function addSiteFeedLog(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const site = (state.sites || []).find((row) => row._id === event.siteId && row.enabled !== false)
    if (!site) return fail('点位不存在', 'NOT_FOUND')
    const fed = !!event.fed
    const watered = !!event.watered
    const note = String(event.note || '').trim().slice(0, 120)
    if (!fed && !watered && !note) return fail('请勾选投喂、添水，或写清现场情况')
    if (!Array.isArray(state.site_feed_logs)) state.site_feed_logs = []
    const row = {
      _id: id('sitefeed'), siteId: site._id, siteName: site.name,
      fed, watered, note, photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6),
      byName: String(user.displayName || '未署名成员').slice(0, 20),
      byOpenid: user.openid, dateKey: dateKeyOf(state), at: Date.now(),
    }
    state.site_feed_logs.unshift(row)
    return ok({ logId: row._id })
  }

  handlers.deleteSiteFeedLog = function deleteSiteFeedLog(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const row = (state.site_feed_logs || []).find((item) => item._id === event.logId)
    if (!row) return fail('点位投喂记录不存在', 'NOT_FOUND')
    if (user.role !== 'admin' && row.byOpenid !== user.openid) return fail('只能删自己的记录', 'FORBIDDEN')
    state.site_feed_logs = state.site_feed_logs.filter((item) => item._id !== row._id)
    return ok({ logId: row._id })
  }

  handlers.listMobileFeedLogs = function listMobileFeedLogs(state, event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能看机动投喂', 'FORBIDDEN')
    const monthKey = String(event.monthKey || dateKeyOf(state).slice(0, 7))
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return fail('月份不合法')
    const rows = (state.mobile_feed_logs || []).filter((row) => row.monthKey === monthKey)
      .sort((a, b) => (b.at || 0) - (a.at || 0))
    const catNames = [...new Set((state.mobile_feed_logs || []).map((row) => row.catName).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return ok({ catNames, logs: rows.map((row) => ({
      ...row, photoFileIds: row.photoFileIds || [], photoUrls: row.photoFileIds || [],
      canDelete: user.role === 'admin' || row.byOpenid === user.openid,
    })) })
  }

  handlers.addMobileFeedLog = function addMobileFeedLog(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const dateKey = String(event.dateKey || dateKeyOf(state))
    const catName = String(event.catName || '').trim().slice(0, 20)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey > dateKeyOf(state)) return fail('只能登记今天或过去的日期')
    if (!catName) return fail('请填写猫名或临时称呼')
    if (!Array.isArray(state.mobile_feed_logs)) state.mobile_feed_logs = []
    const row = {
      _id: id('mobilefeed'), dateKey, monthKey: dateKey.slice(0, 7), catName,
      seen: !!event.seen, fed: !!event.fed, watered: !!event.watered,
      note: String(event.note || '').trim().slice(0, 160),
      photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 3),
      byName: String(user.displayName || '未署名成员').slice(0, 20),
      byOpenid: user.openid, at: Date.now(),
    }
    state.mobile_feed_logs.unshift(row)
    return ok({ logId: row._id })
  }

  handlers.deleteMobileFeedLog = function deleteMobileFeedLog(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const row = (state.mobile_feed_logs || []).find((item) => item._id === event.logId)
    if (!row) return fail('机动投喂记录不存在', 'NOT_FOUND')
    if (user.role !== 'admin' && row.byOpenid !== user.openid) return fail('只能删自己的记录', 'FORBIDDEN')
    state.mobile_feed_logs = state.mobile_feed_logs.filter((item) => item._id !== row._id)
    return ok({ logId: row._id })
  }

  handlers.adminSetCatSpecialCare = function adminSetCatSpecialCare(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可改单猫追踪标记', 'FORBIDDEN')
    const cat = (state.cats || []).find((item) => item._id === event.catId)
    if (!cat) return fail('猫档不存在', 'NOT_FOUND')
    cat.needsIndividualCare = event.enabled === true
    return ok({ catId: cat._id, needsIndividualCare: cat.needsIndividualCare })
  }

  handlers.adminSetCatProvisional = function adminSetCatProvisional(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可确认猫身份', 'FORBIDDEN')
    const cat = (state.cats || []).find((item) => item._id === event.catId)
    if (!cat) return fail('猫档不存在', 'NOT_FOUND')
    cat.provisional = event.provisional === true
    return ok({ catId: cat._id, provisional: cat.provisional })
  }

  handlers.adminApplyChatCatState = function adminApplyChatCatState(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可同步群聊猫状态', 'FORBIDDEN')
    const cat = (state.cats || []).find((item) => item._id === event.catId)
    if (!cat) return fail('猫档不存在', 'NOT_FOUND')
    const statuses = { in_care: true, medical: true, pending_release: true, observe: true }
    const campuses = { on_campus: true, off_campus: true, medical: true }
    if (!statuses[event.status] || !campuses[event.campusStatus]) return fail('状态不合法')
    const siteId = String(event.siteId || '')
    if ((event.campusStatus === 'medical') !== (event.status === 'medical')) return fail('就医状态不一致')
    if (event.campusStatus === 'medical' && siteId) return fail('就医中的猫不能占用执勤点')
    if (siteId && !(state.sites || []).some((site) => site._id === siteId && site.enabled !== false)) return fail('点位不可用')
    const sourceId = String(event.sourceId || '').trim()
    const note = String(event.note || '').trim()
    const observedAt = Number(event.observedAt)
    if (!sourceId || !note || !Number.isFinite(observedAt) || observedAt <= 0) return fail('请附群消息来源、观察时间和说明')
    if (cat.lastObservation && cat.lastObservation.sourceId === sourceId) {
      return ok({ catId: cat._id, skipped: true, lastObservation: cat.lastObservation })
    }
    if (cat.lastObservation && observedAt < Number(cat.lastObservation.at || 0)) return fail('这条群消息早于档案的最近动态')
    const before = { status: cat.status, campusStatus: cat.campusStatus, siteId: cat.siteId }
    cat.status = event.status
    cat.campusStatus = event.campusStatus
    cat.siteId = siteId
    cat.cageId = ''
    setCatAssetIds(cat, [])
    cat.lastObservation = {
      at: observedAt, locationText: String(event.locationText || '').trim().slice(0, 60),
      note: note.slice(0, 200), source: '动物保护协会2027过渡群', sourceId,
    }
    if (!Array.isArray(state.cat_observations)) state.cat_observations = []
    state.cat_observations.push({ _id: id('observation'), catId: cat._id, before,
      after: { status: cat.status, campusStatus: cat.campusStatus, siteId },
      ...cat.lastObservation })
    return ok({ catId: cat._id, status: cat.status, campusStatus: cat.campusStatus, lastObservation: cat.lastObservation })
  }

  handlers.adminCreateCat = function adminCreateCat(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可新增猫档', 'FORBIDDEN')
    const name = String(event.name || '').trim().slice(0, 20)
    if (!name) return fail('请填写猫的名字或临时称呼')
    const sourceId = String(event.sourceId || '').trim().slice(0, 60)
    const existing = (state.cats || []).find((cat) => cat.name === name
      || (sourceId && cat.lastObservation && cat.lastObservation.sourceId === sourceId))
    if (existing) return ok({ catId: existing._id, skipped: true })
    const siteId = String(event.siteId || '')
    if (siteId && !(state.sites || []).some((site) => site._id === siteId && site.enabled !== false)) return fail('点位不可用')
    const genders = { male: true, female: true, unknown: true }
    const gender = String(event.gender || 'unknown')
    if (!genders[gender]) return fail('性别不合法')
    const observedAt = Number(event.observedAt)
    const note = String(event.note || '').trim().slice(0, 200)
    const lastObservation = sourceId && note && Number.isFinite(observedAt) && observedAt > 0
      ? { at: observedAt, locationText: String(event.locationText || '').trim().slice(0, 60),
        note, source: '动物保护协会2027过渡群', sourceId } : null
    const cat = {
      _id: id('cat'), name, status: event.status === 'in_care' ? 'in_care' : 'observe',
      campusStatus: 'on_campus', siteId, cageId: '', assetId: '', assetIds: [],
      gender, healthStatus: 'unknown', ageText: '', breed: '', notes: note,
      photoFileIds: [], provisional: !!event.provisional,
      needsIndividualCare: !!event.needsIndividualCare, lastObservation,
      createdAt: Date.now(), updatedAt: Date.now(),
    }
    if (!Array.isArray(state.cats)) state.cats = []
    state.cats.push(cat)
    return ok({ catId: cat._id, provisional: cat.provisional })
  }

  handlers.claimWorkTask = function claimWorkTask(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const task = (state.work_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    if (!applyScopeView(task, dateKeyOf(state)).dueToday) return fail('今天不是这条任务的执行日')
    if (task.allowMultiple) {
      const day = dateKeyOf(state)
      const cycle = taskCycleKey(task, day)
      if (!Array.isArray(task.participants)) task.participants = []
      const thisCycle = task.participants.filter((p) => (p.cycleKey || p.dateKey) === cycle)
      if (task.participants.some((p) => p.openid === user.openid && p.status === 'claimed')
        || thisCycle.some((p) => p.openid === user.openid)) return fail('你还有未回传的领取，或今天已经参与过')
      if (thisCycle.length >= (task.maxParticipants || 2)) return fail('这次任务人数已满')
      task.participants.push({
        key: id('claim'), dateKey: day, cycleKey: cycle, openid: user.openid,
        workerName: user.displayName || '成员', status: 'claimed', report: null,
      })
      return ok({ taskId: task._id, status: 'claimed' })
    }
    if (applyScopeView(task, dateKeyOf(state)).status !== 'open') return fail('这条任务已经被领取或完成，请刷新')
    task.status = 'claimed'
    task.claimedBy = user.openid
    task.claimedByName = user.displayName || '成员'
    task.claimedDateKey = dateKeyOf(state)
    task.report = null
    task.rejectNote = ''
    return ok({ taskId: task._id, status: 'claimed' })
  }

  handlers.releaseWorkTask = function releaseWorkTask(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const task = (state.work_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    if (task.allowMultiple) {
      const before = (task.participants || []).length
      task.participants = (task.participants || []).filter((p) => {
        return !(p.openid === user.openid && p.status === 'claimed')
      })
      if (before === task.participants.length) return fail('今天没有可退回的领取')
      return ok({ taskId: task._id, status: 'open' })
    }
    if (task.status !== 'claimed' || task.claimedBy !== user.openid) return fail('任务已改变，请刷新')
    task.status = 'open'
    task.claimedBy = ''
    task.claimedByName = ''
    task.claimedDateKey = ''
    return ok({ taskId: task._id, status: 'open' })
  }

  handlers.adminReviewWorkTask = function adminReviewWorkTask(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可审核任务', 'FORBIDDEN')
    const task = (state.work_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    if (task.allowMultiple) {
      const participants = task.participants || []
      const index = participants.findIndex((p) => p.key === event.participantKey && p.status === 'review')
      if (index < 0) return fail('这条回传已处理，请刷新')
      const participant = participants[index]
      if (event.approved === false || event.approved === 'false') {
        participants.splice(index, 1)
        return ok({ taskId: task._id, status: 'open' })
      }
      participant.status = 'done'
      if (!Array.isArray(state.work_task_events)) state.work_task_events = []
      state.work_task_events.push({
        _id: id('workevent'), taskId: task._id, participantKey: participant.key,
        status: 'done', at: Date.now(), dateKey: dateKeyOf(state),
        title: task.title || '', siteName: task.siteName || '', workerName: participant.workerName || '',
      })
      if (!Array.isArray(state.work_credit_events)) state.work_credit_events = []
      state.work_credit_events.push({
        _id: id('credit'), openid: participant.openid,
        workerName: participant.workerName,
        taskId: task._id + ':' + participant.key,
        title: task.title, dateKey: participant.dateKey || dateKeyOf(state), at: Date.now(),
      })
      return ok({ taskId: task._id, status: 'done' })
    }
    if (task.status !== 'review') return fail('现在没有待审回传')
    if (event.approved === false || event.approved === 'false') {
      task.status = 'open'
      task.claimedBy = ''
      task.claimedByName = ''
      task.claimedDateKey = ''
      task.rejectNote = String(event.note || '未通过，请按任务内容重做后再交').trim().slice(0, 80)
      writeLog(state, user, { action: 'reject_work_task', targetType: 'work_task', targetId: task._id, siteId: task.siteId })
      return ok({ taskId: task._id, status: 'open' })
    }
    task.status = 'done'
    task.claimedBy = ''
    task.claimedByName = ''
    task.claimedDateKey = ''
    task.rejectNote = ''
    task.lastDoneDateKey = dateKeyOf(state)
    if (!Array.isArray(state.work_task_events)) state.work_task_events = []
    state.work_task_events.push({
      _id: id('workevent'), taskId: task._id, status: 'done', at: Date.now(),
      dateKey: task.lastDoneDateKey, title: task.title || '', siteName: task.siteName || '',
      workerName: (task.report && task.report.workerName) || '',
    })
    if (!Array.isArray(state.work_credit_events)) state.work_credit_events = []
    state.work_credit_events.push({
      _id: id('credit'),
      openid: (task.report && task.report.submittedBy) || '',
      workerName: (task.report && task.report.workerName) || '',
      taskId: task._id,
      title: task.title || '',
      dateKey: task.lastDoneDateKey,
      at: Date.now(),
    })
    if (task.kind === 'move' && task.donationId) {
      const don = (state.donations || []).find((d) => d._id === task.donationId)
      if (don) {
        don.location = task.toLocation
        don.status = 'on_site'
      }
    }
    writeLog(state, user, { action: 'approve_work_task', targetType: 'work_task', targetId: task._id, siteId: task.siteId })
    return ok({ taskId: task._id, status: 'done' })
  }

  handlers.adminDeleteWorkTask = function adminDeleteWorkTask(state, event, user) {
    if (!isApproved(user)) return fail('无权限', 'FORBIDDEN')
    const task = (state.work_tasks || []).find((t) => t._id === event.taskId)
    if (!task) return fail('任务不存在', 'NOT_FOUND')
    if (user.role !== 'admin' && task.createdBy !== user.openid) return fail('只能删除自己发布的任务', 'FORBIDDEN')
    state.work_tasks = state.work_tasks.filter((t) => t._id !== event.taskId)
    writeLog(state, user, { action: 'delete_work_task', targetType: 'work_task', targetId: task._id, siteId: task.siteId })
    return ok({ taskId: task._id })
  }

  const ADOPT_STATUS = { contacting: 1, visiting: 1, approved: 1, rejected: 1 }

  handlers.adminSetSeekingAdopt = function adminSetSeekingAdopt(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可改找领养状态', 'FORBIDDEN')
    const cat = (state.cats || []).find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    cat.seekingAdopt = !(event.seekingAdopt === false || event.seekingAdopt === 'false')
    return ok({ catId: cat._id, seekingAdopt: cat.seekingAdopt })
  }

  handlers.adminUpsertAdoptCandidate = function adminUpsertAdoptCandidate(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可管理候选领养人', 'FORBIDDEN')
    const cat = (state.cats || []).find((c) => c._id === event.catId)
    if (!cat) return fail('找不到这只猫', 'NOT_FOUND')
    const name = String(event.name || '').trim().slice(0, 20)
    const note = String(event.note || '').trim().slice(0, 300)
    const status = ADOPT_STATUS[event.status] ? event.status : 'contacting'
    if (!name) return fail('请填写候选领养人称呼')
    if (!Array.isArray(state.adopt_candidates)) state.adopt_candidates = []
    let row = state.adopt_candidates.find((c) => c._id === event.candidateId)
    if (row) {
      Object.assign(row, { name, note, status, photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6) })
    } else {
      row = {
        _id: id('adopt'),
        catId: cat._id,
        name,
        status,
        note,
        photoFileIds: (event.photoFileIds || []).filter(Boolean).slice(0, 6),
        createdAt: Date.now(),
      }
      state.adopt_candidates.unshift(row)
    }
    cat.seekingAdopt = true
    return ok({ candidateId: row._id })
  }

  handlers.adminDeleteAdoptCandidate = function adminDeleteAdoptCandidate(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可管理候选领养人', 'FORBIDDEN')
    state.adopt_candidates = (state.adopt_candidates || []).filter((c) => c._id !== event.candidateId)
    return ok({ candidateId: event.candidateId })
  }

  function workloadOf(state) {
    const doneTasks = (state.work_tasks || []).filter((t) => t.status === 'done' && t.report)
    const pfOverrides = {}
    ;(state.work_pf || []).forEach((row) => { pfOverrides[row.sourceKey] = row.pf })
    return buildWorkRecords({
      creditEvents: (state.work_credit_events || []).concat(creditEvents(state.roster_board || { credits: [] })),
      doneTasks,
      pfOverrides,
    })
  }

  handlers.adminListWorkload = function adminListWorkload(state, _event, user) {
    if (user.role !== 'admin') return fail('仅管理员可看工作记录', 'FORBIDDEN')
    return ok({ records: workloadOf(state) })
  }

  const KNOWLEDGE_KIND = { adoption_caution: '领养提醒', guide: '教程', password: '密码备忘' }
  handlers.adminListKnowledge = function adminListKnowledge(state, _event, user) {
    if (user.role !== 'admin') return fail('仅管理员可看内部资料', 'FORBIDDEN')
    return ok({ rows: (state.knowledge_notes || []).map((row) => ({
      _id: row._id, kind: row.kind, kindLabel: KNOWLEDGE_KIND[row.kind],
      title: row.title, updatedAt: row.updatedAt,
    })) })
  }
  handlers.adminGetKnowledge = function adminGetKnowledge(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可看内部资料', 'FORBIDDEN')
    const row = (state.knowledge_notes || []).find((item) => item._id === event.noteId)
    if (!row) return fail('资料不存在', 'NOT_FOUND')
    return ok({ note: { ...row } })
  }
  handlers.adminUpsertKnowledge = function adminUpsertKnowledge(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护内部资料', 'FORBIDDEN')
    const kind = String(event.kind || '')
    const title = String(event.title || '').trim().slice(0, 60)
    const body = String(event.body || '').trim().slice(0, 4000)
    if (!KNOWLEDGE_KIND[kind] || !title || !body) return fail('请选择类型并填写标题和内容')
    if (!Array.isArray(state.knowledge_notes)) state.knowledge_notes = []
    let row = state.knowledge_notes.find((item) => item._id === event.noteId)
    if (row) Object.assign(row, { kind, title, body, updatedAt: Date.now() })
    else {
      row = { _id: id('knowledge'), kind, title, body, updatedAt: Date.now() }
      state.knowledge_notes.unshift(row)
    }
    return ok({ noteId: row._id })
  }
  handlers.adminDeleteKnowledge = function adminDeleteKnowledge(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可维护内部资料', 'FORBIDDEN')
    state.knowledge_notes = (state.knowledge_notes || []).filter((item) => item._id !== event.noteId)
    return ok({ noteId: event.noteId })
  }

  function parsePf(value) {
    if (value === '' || value == null) return null
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 && n <= 9999 && Math.abs(Math.round(n * 100) - n * 100) < 1e-7 ? n : NaN
  }

  handlers.adminSetWorkPf = function adminSetWorkPf(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可填写 PF', 'FORBIDDEN')
    const sourceKey = String(event.sourceKey || '')
    if (!workloadOf(state).some((row) => row.sourceKey === sourceKey)) return fail('找不到工作记录', 'NOT_FOUND')
    const pf = parsePf(event.pf)
    if (Number.isNaN(pf)) return fail('PF 请填 0–9999 的数字，最多两位小数', 'INVALID')
    if (!Array.isArray(state.work_pf)) state.work_pf = []
    const existing = state.work_pf.find((row) => row.sourceKey === sourceKey)
    if (existing) existing.pf = pf
    else state.work_pf.push({ sourceKey, pf })
    return ok({ sourceKey, pf })
  }

  handlers.adminAddWorkRecord = function adminAddWorkRecord(state, event, user) {
    if (user.role !== 'admin') return fail('仅管理员可添加工作记录', 'FORBIDDEN')
    const workerName = String(event.workerName || '').trim().slice(0, 20)
    const title = String(event.title || '').trim().slice(0, 160)
    const dateKey = String(event.dateKey || '').trim()
    const pf = parsePf(event.pf)
    if (!workerName || !title || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return fail('请填写姓名、日期和工作内容')
    if (Number.isNaN(pf)) return fail('PF 请填 0–9999 的数字，最多两位小数')
    const taskId = id('manual')
    if (!Array.isArray(state.work_credit_events)) state.work_credit_events = []
    state.work_credit_events.push({
      _id: id('credit'), openid: '', workerName, taskId, title, dateKey, pf,
      at: Date.parse(dateKey + 'T12:00:00+08:00') || Date.now(),
    })
    return ok({ sourceKey: taskId + ':' + dateKey })
  }

  handlers.listRoster = function listRoster(state, _event, user) {
    if (!isApproved(user)) return fail('需通过成员审核后才能看排班', 'FORBIDDEN')
    if (!state.roster_board) return ok({ imported: false, isAdmin: user.role === 'admin' })
    return ok({ imported: true, isAdmin: user.role === 'admin', roster: boardView(state.roster_board) })
  }

  handlers.adminImportRoster = function adminImportRoster(state, _event, user) {
    if (user.role !== 'admin') return fail('仅管理员可导入排班表', 'FORBIDDEN')
    state.roster_board = storedBoard(ROSTER_BOARD)
    if (!Array.isArray(state.cats)) state.cats = []
    ROSTER_BOARD.insurance.forEach((row) => {
      const line = insuranceLine(row)
      let cat = state.cats.find((item) => item.name === row.name)
      if (!cat) {
        cat = {
          _id: id('cat'),
          name: row.name,
          status: 'observe',
          campusStatus: 'on_campus',
          siteId: '',
          cageId: '',
          assetId: '',
          assetIds: [],
          ageText: '',
          gender: 'unknown',
          breed: '',
          healthStatus: 'unknown',
          notes: line,
          photoFileIds: [],
        }
        state.cats.push(cat)
        return
      }
      if (String(cat.notes || '').indexOf('自费保险') >= 0) return
      cat.notes = [cat.notes, line].filter(Boolean).join('\n').slice(0, 300)
    })
    return ok({ imported: true, counts: boardView(ROSTER_BOARD).counts })
  }

  handlers.adminExportOrgCsv = function adminExportOrgCsv(state, _event, user) {
    if (user.role !== 'admin') return fail('仅管理员可导出', 'FORBIDDEN')
    const pack = buildOrgExport({
      sites: state.sites || [],
      cages: state.cages || [],
      assets: state.assets || [],
      cats: state.cats || [],
      catObservations: state.cat_observations || [],
      dietLogs: state.diet_logs || [],
      siteFeedLogs: state.site_feed_logs || [],
      mobileFeedLogs: state.mobile_feed_logs || [],
      routineDutyCheckins: (state.routine_duty_checkins || []).filter((row) => row.kind !== 'signup'),
      adoptCandidates: state.adopt_candidates || [],
      donations: state.donations || [],
      finance: state.finance_entries || [],
      hospitalVisits: state.hospital_visits || [],
      workload: workloadOf(state),
    }, dateKeyOf(state))
    return ok(pack)
  }
}

module.exports = attachOps
