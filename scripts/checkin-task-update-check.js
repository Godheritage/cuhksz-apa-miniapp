'use strict'

const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.join(__dirname, '..')
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const users = Array.from({ length: 55 }, (_, index) => ({
  _id: 'test-user-' + index, openid: 'test-openid-' + index,
  displayName: 'Test member ' + index, role: index === 0 ? 'admin' : 'member',
}))
const admin = users[0]
const alice = users[1]
const bob = users[2]
const carol = users[3]
const initialDay = '2026-10-09'

function fixture() {
  return {
    users: clone(users),
    sites: [{ _id: 'test-site', name: 'Test site', type: 'base', enabled: true, routineDutyEnabled: true }],
    cats: [{ _id: 'test-cat', name: 'Test cat', siteId: 'test-site', status: 'in_care', campusStatus: 'on_campus' }],
    cages: [], assets: [], diet_logs: [], site_feed_logs: [], mobile_feed_logs: [],
    routine_duty_checkins: [], work_tasks: [], work_task_reports: [], work_task_events: [],
    work_credit_events: [], duty_records: [], operation_logs: [], media_files: [], donations: [],
  }
}

function mockHarness() {
  const store = require('../miniprogram/mock/store')
  const api = require('../miniprogram/mock/api')
  const saved = clone(store.load())
  store.save(Object.assign(store.defaultState(), fixture(), { mockDateKey: initialDay }))
  return {
    name: 'mock',
    rows: () => store.load(),
    day: (day) => { const state = store.load(); state.mockDateKey = day; store.save(state) },
    async call(action, data = {}, user = alice) {
      const state = store.load()
      state.currentUserId = user._id
      store.save(state)
      return clone(await api.call(action, data))
    },
    close() { store.save(saved) },
  }
}

function cloudHarness() {
  const rows = fixture()
  let sequence = 0
  let openid = alice.openid
  let now = new Date(initialDay + 'T12:00:00+08:00').getTime()
  let transactionQueue = Promise.resolve()
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const command = Object.fromEntries(['set', 'in', 'neq', 'eq', 'gte', 'lte'].map((op) => [op, (value) => ({ op, value })]))
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (!value || !value.op) return row[key] === value
    if (value.op === 'in') return value.value.includes(row[key])
    if (value.op === 'neq') return row[key] !== value.value
    if (value.op === 'eq') return row[key] === value.value
    if (value.op === 'gte') return row[key] >= value.value
    if (value.op === 'lte') return row[key] <= value.value
    throw new Error('Unsupported query: ' + value.op)
  })
  function collection(source, name) {
    if (!source[name]) source[name] = []
    const query = (where = {}, offset = 0, limit = Infinity, order = null) => ({
      where(value) { return query(value, offset, limit, order) },
      limit(value) { return query(where, offset, value, order) },
      skip(value) { return query(where, value, limit, order) },
      orderBy(field, direction) { return query(where, offset, limit, { field, direction }) },
      async get() {
        let values = source[name].filter((row) => matches(row, where))
        if (order) values = values.slice().sort((a, b) => (a[order.field] > b[order.field] ? 1 : -1) * (order.direction === 'desc' ? -1 : 1))
        return { data: clone(values.slice(offset, offset + limit)) }
      },
      async count() { return { total: source[name].filter((row) => matches(row, where)).length } },
    })
    return {
      ...query(),
      doc(id) {
        return {
          async get() { return { data: clone(source[name].find((row) => row._id === id)) } },
          async update({ data }) {
            const row = source[name].find((item) => item._id === id)
            assert(row, 'Updating a nonexistent record is forbidden')
            for (const [key, value] of Object.entries(data)) row[key] = clone(value && value.op === 'set' ? value.value : value)
            return { stats: { updated: 1 } }
          },
          async remove() {
            source[name] = source[name].filter((row) => row._id !== id)
            return { stats: { removed: 1 } }
          },
        }
      },
      async add({ data }) {
        const id = 'test-record-' + ++sequence
        source[name].push({ _id: id, ...clone(data) })
        return { _id: id }
      },
    }
  }
  const db = {
    command,
    collection: (name) => collection(rows, name),
    async createCollection(name) { if (!rows[name]) rows[name] = [] },
    runTransaction(callback) {
      const result = transactionQueue.then(async () => {
        const draft = clone(rows)
        const result = await callback({ collection: (name) => collection(draft, name) })
        Object.assign(rows, draft)
        return result
      })
      transactionQueue = result.then(() => {}, () => {})
      return result
    },
  }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'offline-tests-only', init() {}, database: () => db,
    getWXContext: () => ({ OPENID: openid }),
    async getTempFileURL({ fileList }) {
      return { fileList: fileList.map((fileID) => ({ fileID, status: 0, tempFileURL: 'https://example.invalid/' + encodeURIComponent(fileID) })) }
    },
  }
  const cache = new Map()
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    if (filename.endsWith('.json')) { module.exports = JSON.parse(fs.readFileSync(filename, 'utf8')); return module.exports }
    const localRequire = (request) => {
      if (request === 'wx-server-sdk') return cloud
      assert(request.startsWith('./'), 'Offline cloud test forbids external dependency: ' + request)
      return load(require.resolve(path.resolve(path.dirname(filename), request)))
    }
    const context = vm.createContext({ require: localRequire, module, exports: module.exports, Date: TestDate, console })
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename })
    return module.exports
  }
  const api = load(path.join(root, 'cloudfunctions/api/index.js'))
  return {
    name: 'cloud', rows: () => rows,
    day: (day) => { now = new Date(day + 'T12:00:00+08:00').getTime() },
    async call(action, data = {}, user = alice) {
      openid = user.openid
      const result = await api.main({ ...data, action })
      if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code })
      return clone(result.data)
    },
    close() {},
  }
}

async function rejected(harness, action, data, user) {
  await assert.rejects(() => harness.call(action, data, user), (error) => {
    assert.notEqual(error.code, 'INTERNAL', action + ' must reject deliberately, not crash')
    return true
  })
}

async function checkEdits(h) {
  const cases = [
    { table: 'routine_duty_checkins', action: 'updateRoutineDuty', idKey: 'checkinId', list: 'listRoutineDuty', listData: { monthKey: '2026-10' }, limit: 3 },
    { table: 'site_feed_logs', action: 'updateSiteFeedLog', idKey: 'logId', list: 'listSiteFeedLogs', listData: { siteId: 'test-site' }, limit: 6 },
    { table: 'mobile_feed_logs', action: 'updateMobileFeedLog', idKey: 'logId', list: 'listMobileFeedLogs', listData: { monthKey: '2026-10' }, limit: 3 },
    { table: 'diet_logs', action: 'updateFeedLog', idKey: 'logId', list: 'getCatDetail', listData: { catId: 'test-cat' }, listKey: 'feedLogs', limit: 6 },
  ]
  for (const item of cases) {
    const original = {
      _id: 'legacy-' + item.table, byOpenid: alice.openid, byName: 'Original author',
      dateKey: '2026-10-08', monthKey: '2026-10', at: 1791421200000,
      siteId: 'test-site', siteName: 'Original site', shiftId: 'morning',
      catId: 'test-cat', catName: 'Original cat', fed: true, watered: false,
      seen: true, note: 'Original note', photoFileIds: ['cloud://test/old.jpg'],
      customLegacyField: { keep: true },
    }
    if (item.table === 'diet_logs') {
      original.ate = true
      original.drank = false
      delete original.fed
      delete original.watered
    }
    h.rows()[item.table].push(clone(original))
    const request = { [item.idKey]: original._id }
    const current = () => clone(h.rows()[item.table].find((row) => row._id === original._id))
    const listRow = async (user) => (await h.call(item.list, item.listData, user))[item.listKey || 'logs'].find((row) => row._id === original._id)
    assert.equal((await listRow(alice)).canEdit, true, item.table + ': own legacy row is editable')
    for (const user of [bob, admin]) {
      assert.equal((await listRow(user)).canEdit, false, item.table + ': others have no edit control')
      await rejected(h, item.action, { ...request, note: 'Unauthorized' }, user)
      assert.deepEqual(current(), original, item.table + ': failed edit leaves record intact')
    }
    await rejected(h, item.action, { ...request, photoFileIds: 'not-an-array' }, alice)
    assert.deepEqual(current(), original, item.table + ': invalid photos do not alter the record')
    const count = h.rows()[item.table].length
    const photos = Array.from({ length: 8 }, (_, index) => 'cloud://test/photo-' + index + '.jpg')
    const result = await h.call(item.action, {
      ...request, fed: false, watered: true, seen: false, catName: 'Corrected cat',
      note: 'Corrected note', photoFileIds: photos,
      byOpenid: bob.openid, byName: 'Forged author', dateKey: '2099-01-01', monthKey: '2099-01',
      at: 0, siteId: 'forged-site', siteName: 'Forged site', shiftId: 'night', catId: 'forged-cat',
    })
    assert.equal(result[item.idKey], original._id, 'edit returns the existing ID')
    assert.equal(h.rows()[item.table].length, count, 'edit does not create another check-in')
    const updated = current()
    for (const key of ['_id', 'byOpenid', 'byName', 'dateKey', 'monthKey', 'at', 'siteId', 'siteName', 'shiftId', 'catId', 'customLegacyField']) {
      assert.deepEqual(updated[key], original[key], item.table + ': preserve ' + key)
    }
    assert.equal(updated.note, 'Corrected note')
    assert.equal(updated.fed, false)
    assert.equal(updated.watered, true)
    assert(updated.updatedAt)
    assert.deepEqual(updated.photoFileIds, photos.slice(0, item.limit))
    if (item.table === 'diet_logs') {
      assert.equal(updated.ate, false)
      assert.equal(updated.drank, true)
    }
    if (item.table === 'mobile_feed_logs') {
      assert.equal(updated.catName, 'Corrected cat')
      assert.equal(updated.seen, false)
    }
    await h.call(item.action, { ...request, note: 'Text-only edit' })
    assert.deepEqual(current().photoFileIds, updated.photoFileIds, 'omitted photos remain intact')
    await h.call(item.action, { ...request, photoFileIds: [] })
    assert.deepEqual(current().photoFileIds, [], 'explicit empty photos removes all attachments')
    assert.equal(current().at, original.at, 'photo edit preserves original check-in time')
    assert.equal((await listRow(alice)).note, 'Text-only edit', 'list returns the saved edit')
    await rejected(h, item.action, { [item.idKey]: 'missing-record', note: 'Missing' }, alice)
  }
}

async function publish(h, changes = {}) {
  return h.call('adminPublishWorkTask', { title: 'Test task', content: 'Test task instructions', allowMultiple: true, ...changes }, admin)
}
const taskView = async (h, taskId, user = admin) => (await h.call('getWorkTask', { taskId }, user)).task
const claim = (h, taskId, user) => h.call('claimWorkTask', { taskId }, user)
const submit = (h, taskId, user) => h.call('submitWorkTask', { taskId, description: 'Completed test work', workerName: user.displayName }, user)
const review = (h, taskId, participantKey, approved = true) => h.call('adminReviewWorkTask', { taskId, participantKey, approved }, admin)

async function checkCapacity(h) {
  const omitted = await publish(h)
  const blank = await publish(h, { maxParticipants: '' })
  const spaces = await publish(h, { maxParticipants: '  ' })
  const three = await publish(h, { maxParticipants: 3 })
  const single = await publish(h, { allowMultiple: false })
  for (const row of [omitted, blank, spaces]) assert.equal(row.task.maxParticipants, 50, 'blank or omitted multi cap defaults to 50')
  assert.equal(three.task.maxParticipants, 3)
  assert.equal(single.task.maxParticipants, 1)
  for (const user of [alice, bob, carol]) await claim(h, three.taskId, user)
  await rejected(h, 'claimWorkTask', { taskId: three.taskId }, users[4])
  assert.equal((await taskView(h, three.taskId)).participants.length, 3)
  const capacity = await Promise.allSettled(users.slice(1, 52).map((user) => claim(h, omitted.taskId, user)))
  assert.equal(capacity.filter((result) => result.status === 'fulfilled').length, 50, 'exactly 50 of 51 claimants fit')
  assert.equal((await taskView(h, omitted.taskId)).participants.length, 50, '51st claimant does not overwrite occupants')
  assert.equal((await taskView(h, omitted.taskId, users[52])).canClaim, false)
}

async function checkCompletion(h) {
  const { taskId } = await publish(h, { maxParticipants: 4 })
  for (const user of [alice, bob, carol]) await claim(h, taskId, user)
  await submit(h, taskId, alice)
  await submit(h, taskId, bob)
  let view = await taskView(h, taskId)
  assert.equal(view.status, 'review', 'submission still requires administrator review')
  const first = view.participants.find((row) => row.workerName === alice.displayName)
  const second = view.participants.find((row) => row.workerName === bob.displayName)
  const pendingSnapshot = clone(h.rows().work_task_reports.filter((row) => row.taskId === taskId))
  const reviews = await Promise.allSettled([review(h, taskId, first.key), review(h, taskId, first.key)])
  assert.equal(reviews.filter((result) => result.status === 'fulfilled').length, 1, 'duplicate approvals cannot duplicate credit')
  view = await taskView(h, taskId)
  assert.equal(view.status, 'done', 'first approved participant completes the whole task')
  assert.equal((await taskView(h, taskId, carol)).canSubmit, false)
  assert.equal((await taskView(h, taskId, users[4])).canClaim, false)
  assert.equal(view.participants.find((row) => row.key === second.key).canReview, true, 'already submitted work remains reviewable')
  await rejected(h, 'claimWorkTask', { taskId }, users[4])
  await rejected(h, 'submitWorkTask', { taskId, description: 'Late new submission', workerName: carol.displayName }, carol)
  assert.deepEqual(h.rows().work_task_reports.filter((row) => row.taskId === taskId), pendingSnapshot, 'no report is lost or inserted after completion')
  h.day('2026-10-10')
  await review(h, taskId, second.key)
  assert.equal((await taskView(h, taskId)).status, 'done')
  const calendar = await h.call('listTaskCalendar', { monthKey: '2026-10' }, admin)
  const completedItems = calendar.items.filter((row) => row.taskId === taskId)
  assert.equal(completedItems.length, 1, 'multiple participants count as one whole task even when reviewed on different days')
  assert.equal(completedItems[0].dateKey, initialDay, 'later review preserves the original completion day')
  const credits = h.rows().work_credit_events.filter((row) => row.taskId.startsWith(taskId + ':'))
  assert.equal(credits.length, 2, 'each already-submitted participant keeps individual credit')
  await rejected(h, 'adminReviewWorkTask', { taskId, participantKey: second.key, approved: true }, admin)
  assert.equal(h.rows().work_credit_events.filter((row) => row.taskId.startsWith(taskId + ':')).length, 2)
  h.day('2026-10-10')
  assert.equal((await taskView(h, taskId)).status, 'done', 'once task stays complete on the following day')
  h.day(initialDay)
}

async function checkCycles(h) {
  for (const scope of ['daily', 'weekly']) {
    h.day(initialDay)
    const { taskId } = await publish(h, { scope, weekdays: [5], maxParticipants: 3 })
    await claim(h, taskId, alice)
    await claim(h, taskId, bob)
    await submit(h, taskId, alice)
    const first = (await taskView(h, taskId)).participants.find((row) => row.workerName === alice.displayName)
    await review(h, taskId, first.key)
    const history = clone(h.rows().work_tasks.find((row) => row._id === taskId).participants)
    if (scope === 'weekly') {
      h.day('2026-10-10')
      assert.equal((await taskView(h, taskId, bob)).canClaim, false, 'weekly task stays unavailable on off days')
      await rejected(h, 'claimWorkTask', { taskId }, bob)
    }
    const nextDay = scope === 'daily' ? '2026-10-10' : '2026-10-16'
    h.day(nextDay)
    const fresh = await taskView(h, taskId, bob)
    assert.equal(fresh.status, 'open', scope + ': new scheduled cycle opens')
    assert.equal(fresh.canClaim, true, 'old unsubmitted claim does not block the next cycle')
    await claim(h, taskId, bob)
    await submit(h, taskId, bob)
    const next = (await taskView(h, taskId)).participants.find((row) => row.workerName === bob.displayName && row.status === 'review')
    await review(h, taskId, next.key)
    const stored = h.rows().work_tasks.find((row) => row._id === taskId)
    assert.deepEqual(stored.participants.slice(0, history.length), history, 'new cycle preserves old participant history')
    const calendar = await h.call('listTaskCalendar', { monthKey: '2026-10' }, admin)
    assert.deepEqual(calendar.items.filter((row) => row.taskId === taskId).map((row) => row.dateKey).sort(), [initialDay, nextDay])
  }
  h.day(initialDay)
  const { taskId } = await publish(h, { scope: 'daily' })
  await claim(h, taskId, alice)
  await submit(h, taskId, alice)
  const yesterday = (await taskView(h, taskId)).participants[0]
  h.day('2026-10-10')
  await claim(h, taskId, bob)
  await review(h, taskId, yesterday.key)
  assert.equal((await taskView(h, taskId, bob)).canSubmit, true, 'approving yesterday must not close today')
  h.day(initialDay)
}

async function main() {
  assert.equal(typeof global.wx, 'undefined', 'This test must run in Node without a live WeChat environment')
  for (const create of [mockHarness, cloudHarness]) {
    const harness = create()
    try {
      await checkEdits(harness)
      await checkCapacity(harness)
      await checkCompletion(harness)
      await checkCycles(harness)
      console.log('CHECKIN_TASK_UPDATE_' + harness.name.toUpperCase() + '_OK')
    } finally { harness.close() }
  }
  console.log('CHECKIN_TASK_UPDATE_OK')
}

main().catch((error) => { console.error('CHECKIN_TASK_UPDATE_FAIL', error); process.exitCode = 1 })