'use strict'

const assert = require('assert')
const attach = require('../cloudfunctions/api/ops')

async function main() {
  const rows = {
    work_tasks: [{
      _id: 'task-1', kind: 'duty', scope: 'ongoing', title: '检查饮水',
      content: '检查饮水器并补水', status: 'open', workflowV2: true,
      siteId: 'general', siteName: '不限地点', report: null,
    }],
    work_task_reports: [], work_task_events: [], work_credit_events: [], donations: [],
  }
  let nextId = 0
  let queue = Promise.resolve()
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const collection = (dbRows, name) => ({
    doc(id) {
      return {
        async get() { return { data: clone((dbRows[name] || []).find((row) => row._id === id)) } },
        async update({ data }) {
          const row = (dbRows[name] || []).find((item) => item._id === id)
          if (!row) throw new Error('missing document')
          const patch = {}
          for (const [key, value] of Object.entries(data)) {
            if (value && value.__replaceField) patch[key] = clone(value.value)
            else {
              if (key === 'report' && row.report === null && value && typeof value === 'object') {
                throw new Error('Cannot create nested report fields under null')
              }
              patch[key] = clone(value)
            }
          }
          Object.assign(row, patch)
        },
        async remove() {
          dbRows[name] = (dbRows[name] || []).filter((row) => row._id !== id)
        },
      }
    },
    async add({ data }) {
      const id = 'new-' + ++nextId
      dbRows[name].push({ _id: id, ...clone(data) })
      return { _id: id }
    },
  })
  const db = {
    collection(name) { return collection(rows, name) },
    runTransaction(fn) {
      const run = async () => {
        const draft = clone(rows)
        const tx = { collection(name) { return collection(draft, name) } }
        const result = await fn(tx)
        Object.assign(rows, draft)
        return result
      }
      const result = queue.then(run)
      queue = result.then(() => {}, () => {})
      return result
    },
  }
  const handlers = attach({}, {
    db, _: { set: (value) => ({ __replaceField: true, value }), neq: (value) => value }, getAll: async (name) => clone(rows[name] || []),
    getById: async (name, id) => clone((rows[name] || []).find((row) => row._id === id)),
    writeLog() {}, addDoc: async (name, data) => collection(rows, name).add({ data }),
    quietUpdate() {}, quietLog() {}, photoIds: (event) => event.photoFileIds || [],
    saveMedia() {}, loadMediaMap() {},
    ok: (data) => ({ ok: true, data }), fail: (code, message) => ({ ok: false, code, message }),
    isApproved: (user) => ['admin', 'member'].includes(user.role),
    isAdmin: (user) => user.role === 'admin',
    shanghaiDateKey: () => '2026-09-23', ensureOnDuty() {},
  })
  const admin = { openid: 'admin', role: 'admin', displayName: '管理员' }
  const memberA = { openid: 'a', role: 'member', displayName: '成员甲' }
  const memberB = { openid: 'b', role: 'member', displayName: '成员乙' }
  const event = { taskId: 'task-1' }
  const claims = await Promise.all([
    handlers.claimWorkTask(event, memberA), handlers.claimWorkTask(event, memberB),
  ])
  assert.equal(claims.filter((result) => result.ok).length, 1, 'only one member may claim')
  const owner = claims[0].ok ? memberA : memberB
  const other = claims[0].ok ? memberB : memberA
  const otherView = await handlers.getWorkTask(event, other)
  assert.equal(otherView.data.task.canSubmit, false)
  assert.equal((await handlers.submitWorkTask({ ...event, description: '伪造回传' }, other)).ok, false)
  assert.equal((await handlers.submitWorkTask({ ...event, description: '已补水', workerName: owner.displayName }, owner)).ok, true)
  assert.equal(rows.work_task_reports.length, 1)
  assert.equal(rows.work_tasks[0].status, 'review')
  assert.equal((await handlers.submitWorkTask({ ...event, description: '重复提交' }, owner)).ok, false)
  assert.equal((await handlers.adminReviewWorkTask({ ...event, approved: true }, admin)).ok, true)
  assert.equal(rows.work_credit_events.length, 1)
  assert.equal((await handlers.adminReviewWorkTask({ ...event, approved: true }, admin)).ok, false)
  assert.equal(rows.work_credit_events.length, 1)
  assert.equal(rows.work_tasks[0].status, 'done')
  rows.work_tasks.push({
    _id: 'task-2', kind: 'duty', scope: 'ongoing', title: '检查食盆',
    content: '检查并清洗食盆', status: 'open', workflowV2: true,
    siteId: 'general', siteName: '不限地点', report: null,
  })
  const second = { taskId: 'task-2' }
  assert.equal((await handlers.claimWorkTask(second, memberA)).ok, true)
  assert.equal((await handlers.releaseWorkTask(second, memberB)).ok, false)
  assert.equal((await handlers.releaseWorkTask(second, memberA)).ok, true)
  assert.equal((await handlers.claimWorkTask(second, memberB)).ok, true)
  assert.equal((await handlers.submitWorkTask({ ...second, description: '已清洗', workerName: '成员乙' }, memberB)).ok, true)
  assert.equal((await handlers.adminReviewWorkTask({ ...second, approved: false }, admin)).ok, true)
  assert.equal(rows.work_tasks[1].status, 'open')
  assert.equal(rows.work_credit_events.length, 1, 'rejection must not add credit')
  rows.work_tasks.push({
    _id: 'task-3', kind: 'duty', scope: 'daily', allowMultiple: true,
    participants: [], title: '双人执勤', content: '一起检查',
    status: 'open', workflowV2: true, siteId: 'general', siteName: '不限地点',
  })
  const shared = { taskId: 'task-3' }
  const both = await Promise.all([
    handlers.claimWorkTask(shared, memberA), handlers.claimWorkTask(shared, memberB),
  ])
  assert.equal(both.filter((result) => result.ok).length, 2, 'multi task permits two owners')
  const sharedView = (await handlers.getWorkTask(shared, memberA)).data.task
  assert.equal(sharedView.participants.length, 2)
  assert.equal((await handlers.submitWorkTask({ ...shared, description: '甲已检查', workerName: '成员甲' }, memberA)).ok, true)
  assert.equal((await handlers.submitWorkTask({ ...shared, description: '乙已检查', workerName: '成员乙' }, memberB)).ok, true)
  const reviewView = (await handlers.getWorkTask(shared, admin)).data.task
  assert.equal(reviewView.participants.filter((part) => part.status === 'review').length, 2)
  for (const part of reviewView.participants) {
    assert.equal((await handlers.adminReviewWorkTask({ ...shared, participantKey: part.key, approved: true }, admin)).ok, true)
    const completedView = (await handlers.getWorkTask(shared, memberA)).data.task
    assert.equal(completedView.status, 'done', 'first approval completes the whole task')
    assert.equal(completedView.canSubmit, false)
    assert.equal(completedView.canClaim, false)
  }
  assert.equal(rows.work_credit_events.length, 3, 'already-submitted participants retain individual credit')
  assert.equal((await handlers.claimWorkTask(shared, admin)).ok, false, 'completed multi task cannot be claimed again')
  assert.equal((await handlers.submitWorkTask({ ...shared, description: 'late new report' }, memberA)).ok, false)
  assert.equal(rows.work_task_reports.filter((row) => row.taskId === shared.taskId).length, 2, 'blocked submission must not insert a report')
  const once = await handlers.adminPublishWorkTask({ title: '单次检查', content: '检查猫粮' }, admin)
  assert(once.ok && once.data.task.scope === 'once' && once.data.task.maxParticipants === 1)
  const weekly = await handlers.adminPublishWorkTask({
    title: '每周检查', content: '周三检查', scope: 'weekly', weekdays: [3],
    allowMultiple: true, maxParticipants: 2,
  }, admin)
  assert(weekly.ok && weekly.data.task.dueToday)
  assert.equal((await handlers.claimWorkTask({ taskId: weekly.data.taskId }, memberA)).ok, true)
  const offDay = await handlers.adminPublishWorkTask({
    title: '周四检查', content: '周四检查', scope: 'weekly', weekdays: [4],
  }, admin)
  assert(offDay.ok && !offDay.data.task.dueToday)
  assert.equal((await handlers.claimWorkTask({ taskId: offDay.data.taskId }, memberB)).ok, false)
  const late = await handlers.adminPublishWorkTask({
    title: '已过截止仍可交', content: '测试晚交', scope: 'once', deadlineDateKey: '2026-09-22',
  }, admin)
  assert(late.ok && late.data.task.overdue)
  assert((await handlers.claimWorkTask({ taskId: late.data.taskId }, memberA)).ok)
  assert((await handlers.submitWorkTask({ taskId: late.data.taskId, description: '补交完成', workerName: '成员甲' }, memberA)).ok)
  assert((await handlers.adminReviewWorkTask({ taskId: late.data.taskId, approved: true }, admin)).ok)
  const lateView = (await handlers.getWorkTask({ taskId: late.data.taskId }, memberA)).data.task
  assert(lateView.report.submittedLate && lateView.overdue && lateView.status === 'done', 'late marker survives approval')
  const memberTask = await handlers.adminPublishWorkTask({ title: '成员发的任务', content: '整理猫粮', sourceId: 'spoof' }, memberA)
  assert(memberTask.ok && memberTask.data.task.publisherTag === '普通成员发布')
  assert.equal(rows.work_tasks.find((task) => task._id === memberTask.data.taskId).sourceId, '')
  assert.equal((await handlers.getWorkTask({ taskId: memberTask.data.taskId }, memberA)).data.task.canDelete, true)
  assert.equal((await handlers.getWorkTask({ taskId: memberTask.data.taskId }, memberB)).data.task.canDelete, false)
  const published = await handlers.listWorkTasks({ mineFilter: 'published' }, memberA)
  assert(published.data.groups.some((group) => group.tasks.some((task) => task._id === memberTask.data.taskId)))
  const done = await handlers.listWorkTasks({ mineFilter: 'done' }, memberA)
  assert(done.data.groups.some((group) => group.tasks.some((task) => task._id === late.data.taskId)))
  assert(!done.data.groups.some((group) => group.tasks.some((task) => task._id === memberTask.data.taskId)))
  assert.equal((await handlers.adminDeleteWorkTask({ taskId: memberTask.data.taskId }, memberB)).code, 'FORBIDDEN')
  assert((await handlers.adminDeleteWorkTask({ taskId: memberTask.data.taskId }, memberA)).ok)
  assert((await handlers.adminDeleteWorkTask({ taskId: once.data.taskId }, admin)).ok)
  const completed = await handlers.adminPublishWorkTask({
    title: '已做完的任务', content: '整理猫粮', completionDescription: '已分装并清点',
    completionPhotoFileIds: ['cloud://qa/completed.jpg'],
  }, memberA)
  assert(completed.ok && completed.data.task.status === 'review')
  assert(completed.data.task.report.description === '已分装并清点')
  assert.equal(rows.work_task_reports.at(-1).taskId, completed.data.taskId)
  assert((await handlers.adminReviewWorkTask({ taskId: completed.data.taskId, approved: true }, admin)).ok)
  const completedMulti = await handlers.adminPublishWorkTask({
    title: '已做完的多人任务', content: '一起整理', allowMultiple: true, maxParticipants: 3,
    completionDescription: '我已整理第一箱',
  }, memberA)
  assert(completedMulti.ok && completedMulti.data.task.participants[0].status === 'review')
  const participantKey = completedMulti.data.task.participants[0].key
  assert((await handlers.adminReviewWorkTask({ taskId: completedMulti.data.taskId, participantKey, approved: true }, admin)).ok)
  assert.equal((await handlers.adminPublishWorkTask({
    title: '缺完成说明', content: '整理猫粮', completionPhotoFileIds: ['cloud://qa/only-photo.jpg'],
  }, memberA)).code, 'INVALID')
  console.log('TASK_FLOW_OK claims, reviews, member publish, optional completion, filters, deletion permissions')
}

main().catch((err) => { console.error('TASK_FLOW_FAIL', err); process.exitCode = 1 })
