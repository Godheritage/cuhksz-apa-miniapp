'use strict'

const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
const mini = path.join(root, 'miniprogram')
const credentials = { account: 'APA_REVIEW', password: 'Demo2026!' }
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const tick = () => new Promise((resolve) => setImmediate(resolve))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness(envVersion = 'release') {
  const legacyKeys = ['apa_duty_live_v1', 'apa_duty_mock_v7', 'apa_duty_mock_v6', 'apa_duty_mock_v5']
  const storage = new Map(legacyKeys.map((key) => [key, {
    users: [{ _id: 'production-private-user', openid: 'production-private-openid', role: 'admin' }],
    sites: [{ _id: 'production-private-site', name: 'PRODUCTION_PRIVATE_MARKER' }],
    cats: [{ _id: 'production-private-cat', note: 'DO_NOT_READ_OR_CHANGE' }],
  }]))
  storage.set('test-business-draft', { note: 'production draft must survive' })
  const original = new Map(Array.from(storage, ([key, value]) => [key, clone(value)]))
  const reads = []
  const writes = []
  const cloudCalls = []
  const navigations = []
  const cache = new Map()
  let app
  let cloudHandler = () => Promise.reject(new Error('Unexpected cloud call in offline test'))
  function cloudCall(method, options) {
    cloudCalls.push({ method, options: clone(options) })
    return cloudHandler(method, options)
  }
  const wx = {
    getStorageSync(key) { reads.push(key); return clone(storage.get(key)) },
    setStorageSync(key, value) { writes.push(key); storage.set(key, clone(value)) },
    removeStorageSync(key) { writes.push(key); storage.delete(key) },
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    cloud: {
      init: (options) => cloudCall('init', options),
      callFunction: (options) => cloudCall('callFunction', options),
      uploadFile: (options) => cloudCall('uploadFile', options),
      getTempFileURL: (options) => cloudCall('getTempFileURL', options),
    },
    reLaunch(options) { navigations.push(options.url); if (options.success) options.success() },
    switchTab(options) { navigations.push(options.url); if (options.success) options.success() },
    navigateTo(options) { navigations.push(options.url); if (options.success) options.success() },
    nextTick: (callback) => callback(),
    showToast() {},
    showModal(options) { if (options.success) options.success({ confirm: true }) },
  }
  function load(relative) {
    const filename = require.resolve(path.resolve(mini, relative))
    if (cache.has(filename)) return cache.get(filename).exports
    assert(filename.startsWith(mini + path.sep), 'Test must never load code outside the Mini Program')
    const module = { exports: {} }
    cache.set(filename, module)
    if (filename.endsWith('.json')) {
      module.exports = JSON.parse(fs.readFileSync(filename, 'utf8'))
      return module.exports
    }
    const localRequire = (request) => {
      assert(request.startsWith('.'), 'Offline test forbids external module: ' + request)
      return load(path.relative(mini, path.resolve(path.dirname(filename), request)))
    }
    const context = vm.createContext({
      module, exports: module.exports, require: localRequire, wx, console,
      setTimeout, clearTimeout, setInterval, clearInterval,
      getApp: () => app, getCurrentPages: () => [],
      App(value) { app = value },
    })
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename })
    return module.exports
  }
  return {
    load, wx, storage, reads, writes, cloudCalls, navigations,
    get app() { if (!app) load('app.js'); return app },
    setCloudHandler(handler) { cloudHandler = handler },
    assertOriginalStorage() {
      for (const [key, value] of original) assert.deepEqual(storage.get(key), value, 'Original local data changed: ' + key)
    },
    assertNoLegacyRead() {
      assert(!reads.some((key) => legacyKeys.includes(key)), 'Review loaded production or legacy local data')
    },
  }
}

async function rejectCode(work, code) {
  await assert.rejects(work, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

async function checkSessionAndBusiness(envVersion) {
  const h = harness(envVersion)
  const session = h.load('review/session.js')
  const api = h.load('services/api.js')
  const drafts = h.load('utils/drafts.js')
  assert.equal(session.isReviewMode(), false)
  const initial = session.snapshot()
  assert.throws(() => session.enterReview({ ...credentials, password: 'incorrect' }))
  assert.equal(session.isReviewMode(), false)
  assert.equal(session.isCurrent(initial), true, 'Bad login must not switch the active session')
  assert.throws(() => session.enterReview({ ...credentials, role: 'superadmin' }))
  assert.equal(session.isReviewMode(), false)
  assert.throws(() => session.switchReviewRole('admin'))
  session.enterReview({ ...credentials, role: 'member' })
  session.beginEntry()
  assert.equal(session.isReviewMode(), true)
  assert.equal(session.getReviewRole(), 'member')
  h.app.onLaunch()
  assert.equal((await h.app.getUser()).role, 'member')
  assert.equal(h.app.globalData.reviewMode, true)
  assert.equal(session.isCurrent(initial), false)
  assert.equal((await api.login()).user.role, 'member', envVersion + ': member login must keep its chosen role')
  assert.equal(drafts.readDraft('test-business-draft'), null, 'Review must not read a production draft')
  drafts.writeDraft('test-business-draft', { note: 'review-only draft' })
  assert.deepEqual(clone(drafts.readDraft('test-business-draft')), { note: 'review-only draft' })
  assert.notEqual(session.storageKey('test-business-draft'), 'test-business-draft')
  assert.equal(h.cloudCalls.length, 0)

  const sites = (await api.call('listSites')).sites
  assert(sites.length > 0, 'Review has usable sample sites')
  assert(!JSON.stringify(sites).includes('PRODUCTION_PRIVATE_MARKER'))
  await rejectCode(() => api.call('adminListUsers'), 'FORBIDDEN')
  await assert.rejects(() => api.seed())
  await assert.rejects(() => api.call('seed'))
  await assert.rejects(() => api.call('resetMock'))
  await assert.rejects(() => api.call('advanceMockDay'))
  await assert.rejects(() => api.call('switchMockRole', { role: 'admin' }))
  assert.equal((await api.login()).user.role, 'member')
  const photo = await api.uploadDutyPhoto('wxfile://tmp/review-photo.jpg', 'review-test')
  assert.equal(photo, 'wxfile://tmp/review-photo.jpg', 'Review photos stay on device')
  const created = await api.call('adminPublishWorkTask', {
    title: 'Review isolation task', content: 'Check sample supplies', allowMultiple: true,
    completionDescription: 'Sample supplies have been checked',
    completionPhotoFileIds: [photo],
  })
  assert.equal(created.task.maxParticipants, 50)
  assert.equal(created.task.status, 'review')
  const taskId = created.taskId
  const participantKey = created.task.participants.find((part) => part.status === 'review').key
  const memberSnapshot = session.snapshot()
  session.switchReviewRole('admin')
  session.beginEntry()
  assert.equal(session.isCurrent(memberSnapshot), false)
  assert.equal((await api.login()).user.role, 'admin')
  const reviewTask = (await api.call('getWorkTask', { taskId })).task
  assert.equal(reviewTask.status, 'review', 'Role switch must keep shared review business data')
  await api.call('adminReviewWorkTask', { taskId, participantKey, approved: true })
  assert.equal((await api.call('getWorkTask', { taskId })).task.status, 'done')
  const users = (await api.call('adminListUsers')).users
  const pending = users.find((user) => user.role === 'pending')
  assert(pending, 'Review has a pending sample member to approve')
  await api.call('adminSetRole', { userId: pending._id, role: 'member' })
  assert.equal((await api.call('adminListUsers')).users.find((user) => user._id === pending._id).role, 'member')
  session.switchReviewRole('member')
  session.beginEntry()
  await api.login()
  assert.equal((await api.call('getWorkTask', { taskId })).task.status, 'done')
  assert.equal(h.cloudCalls.length, 0, 'Review business flows must never call wx.cloud')
  h.assertNoLegacyRead()
  h.assertOriginalStorage()

  drafts.clearDraft('test-business-draft')
  assert.equal(drafts.readDraft('test-business-draft'), null)
  session.exitReview()
  assert.equal(session.isReviewMode(), false)
  assert.deepEqual(clone(drafts.readDraft('test-business-draft')), { note: 'production draft must survive' })
  assert.equal(session.storageKey('test-business-draft'), 'test-business-draft')
  h.setCloudHandler((_method, options) => {
    assert.equal(options.name, 'login')
    return Promise.resolve({ result: { ok: true, data: { user: { _id: 'real-user', role: 'member' } } } })
  })
  assert.equal((await api.login()).user._id, 'real-user', 'Exit restores normal WeChat cloud login')
  assert.equal(h.cloudCalls.length, 1)
  h.assertOriginalStorage()
  console.log('REVIEW_BUSINESS_' + envVersion.toUpperCase() + '_OK')
}

async function checkStaleRequests() {
  const h = harness()
  const session = h.load('review/session.js')
  const api = h.load('services/api.js')
  for (const invoke of [() => api.login(), () => api.call('listSites'), () => api.uploadDutyPhoto('tmp/photo.jpg'), () => api.seed()]) {
    const pending = deferred()
    h.setCloudHandler(() => pending.promise)
    const result = invoke()
    const rejected = rejectCode(result, 'SESSION_CHANGED')
    await tick()
    session.enterReview({ ...credentials, role: 'member' })
    session.beginEntry()
    pending.resolve({ result: { ok: true, data: { user: { role: 'admin', _id: 'late-production-user' } } }, fileID: 'cloud://late' })
    await rejected
    assert.equal((await api.login()).user.role, 'member')
    session.exitReview()
    session.beginEntry()
    h.setCloudHandler(() => Promise.resolve({ result: { ok: true, data: { user: { _id: 'real-user', role: 'member' } } } }))
    await api.login()
  }
  session.enterReview({ ...credentials, role: 'member' })
  session.beginEntry()
  await api.login()
  const write = api.call('adminPublishWorkTask', { title: 'Stale request', content: 'Must not save' })
  const rejected = rejectCode(write, 'SESSION_CHANGED')
  session.exitReview()
  await rejected
  session.enterReview({ ...credentials, role: 'member' })
  session.beginEntry()
  await api.login()
  const groups = (await api.call('listWorkTasks')).groups
  assert(!groups.some((group) => group.tasks.some((task) => task.title === 'Stale request')), 'Old review mutation must not persist across a session change')
  const memberLogin = api.login()
  const staleMember = rejectCode(memberLogin, 'SESSION_CHANGED')
  session.switchReviewRole('admin')
  await staleMember
  assert.equal((await api.login()).user.role, 'admin')
  h.assertOriginalStorage()
  console.log('REVIEW_STALE_REQUESTS_OK')
}

async function checkEntryBarrier() {
  const h = harness()
  const session = h.load('review/session.js')
  const api = h.load('services/api.js')
  for (const next of [
    () => session.enterReview({ ...credentials, role: 'member' }),
    () => session.switchReviewRole('admin'),
    () => session.exitReview(),
  ]) {
    next()
    h.setCloudHandler(() => Promise.resolve({ result: { ok: true, data: { user: { _id: 'real-user', role: 'member' } } } }))
    const count = h.cloudCalls.length
    for (const invoke of [() => api.call('listSites'), () => api.uploadDutyPhoto('tmp/old.jpg'), () => api.seed()]) {
      await rejectCode(invoke, 'SESSION_CHANGED')
    }
    assert.equal(h.cloudCalls.length, count, 'An old page must not start cloud calls during re-entry')
    await api.login()
    await rejectCode(() => api.call('listSites'), 'SESSION_CHANGED')
    session.beginEntry()
    await api.login()
    if (session.isReviewMode()) assert((await api.call('listSites')).sites.length)
  }
  h.assertOriginalStorage()
  console.log('REVIEW_ENTRY_BARRIER_OK')
}

async function checkStatefulHelpers() {
  const h = harness()
  const session = h.load('review/session.js')
  const drafts = h.load('utils/drafts.js')
  const confirm = h.load('utils/confirm.js')
  const photos = h.load('utils/photos.js')
  const files = h.load('utils/saveFile.js')
  const productionDraft = drafts.createDraftKey('test-business-draft')
  session.enterReview({ ...credentials, role: 'member' })
  const memberDraft = drafts.createDraftKey('test-business-draft')
  drafts.writeDraft(memberDraft, { note: 'member local draft' })
  drafts.writeDraft(productionDraft, { note: 'stale production write' })
  drafts.clearDraft(productionDraft)
  h.assertOriginalStorage()
  session.switchReviewRole('admin')
  assert.equal(drafts.readDraft('test-business-draft'), null, 'Member and administrator drafts are isolated')
  drafts.writeDraft(memberDraft, { note: 'stale member write' })
  drafts.clearDraft(memberDraft)
  const adminDraft = drafts.createDraftKey('test-business-draft')
  drafts.writeDraft(adminDraft, { note: 'admin local draft' })
  session.switchReviewRole('member')
  assert.deepEqual(clone(drafts.readDraft('test-business-draft')), { note: 'member local draft' })
  session.exitReview()
  drafts.writeDraft(adminDraft, { note: 'stale review write' })
  drafts.clearDraft(adminDraft)
  h.assertOriginalStorage()

  let modal
  let completed = 0
  h.wx.showModal = (options) => { modal = options }
  const show = () => confirm({ success: () => completed++, fail: () => completed++, complete: () => completed++ })
  show()
  modal.success({ confirm: true })
  assert.equal(completed, 1, 'Same-session confirmation must still work')
  show()
  session.enterReview({ ...credentials, role: 'member' })
  modal.success({ confirm: true }); modal.fail({}); modal.complete({})
  assert.equal(completed, 1, 'Old production confirmation must not run in review')
  show()
  session.switchReviewRole('admin')
  modal.success({ confirm: true })
  assert.equal(completed, 1, 'Old role confirmation must not run under administrator identity')
  show()
  session.exitReview()
  modal.success({ confirm: true })
  assert.equal(completed, 1, 'Old review confirmation must not run against production')

  let picker
  h.wx.chooseMedia = (options) => { picker = options }
  session.enterReview({ ...credentials, role: 'member' })
  const picked = photos.pick([], 3)
  const oldPicker = rejectCode(picked, 'SESSION_CHANGED')
  session.exitReview()
  picker.success({ tempFiles: [{ tempFilePath: 'tmp/old-review-photo.jpg' }] })
  await oldPicker
  session.enterReview({ ...credentials, role: 'member' })
  const uploaded = photos.uploadMany(['https://example.invalid/already-present.jpg'], 'review')
  const oldUpload = rejectCode(uploaded, 'SESSION_CHANGED')
  session.exitReview()
  await oldUpload

  const savedFiles = new Map()
  h.wx.env = { USER_DATA_PATH: '/offline-user-data' }
  h.wx.getFileSystemManager = () => ({ writeFileSync: (name, text) => savedFiles.set(name, text) })
  const productionPath = files.writeLocal('records.csv', 'production-export')
  session.enterReview({ ...credentials, role: 'member' })
  const reviewPath = files.writeLocal('records.csv', 'review-export')
  assert.notEqual(productionPath, reviewPath, 'Review exports must not overwrite normal exported files')
  assert(savedFiles.get(productionPath).includes('production-export'))
  assert.equal(h.cloudCalls.length, 0)
  h.assertOriginalStorage()
  console.log('REVIEW_HELPERS_OK')
}

async function checkAppIdentity() {
  const h = harness()
  const session = h.load('review/session.js')
  const api = h.load('services/api.js')
  const app = h.app
  const delayed = deferred()
  h.setCloudHandler((method) => method === 'init' ? undefined : delayed.promise)
  app.onLaunch()
  const oldLogin = rejectCode(app.getUser(), 'SESSION_CHANGED')
  session.enterReview({ ...credentials, role: 'member' })
  session.beginEntry()
  assert.equal(app.globalData.user, null, 'Session change immediately discards the previous identity')
  const member = await app.getUser()
  assert.equal(member.role, 'member')
  delayed.resolve({ result: { ok: true, data: { user: { _id: 'late-real-admin', role: 'admin' } } } })
  await oldLogin
  assert.equal(app.globalData.user.role, 'member', 'Late production login must not overwrite review identity')
  assert.equal(app.globalData.ready, true)
  const oldMemberLogin = rejectCode(app.refreshUser(true), 'SESSION_CHANGED')
  session.switchReviewRole('admin')
  session.beginEntry()
  const admin = await app.getUser()
  await oldMemberLogin
  assert.equal(admin.role, 'admin')
  assert.throws(() => app.setUser(member), (error) => error.code === 'SESSION_CHANGED')
  assert.equal(app.globalData.user.role, 'admin')
  session.exitReview()
  session.beginEntry()
  h.setCloudHandler(() => Promise.resolve({ result: { ok: true, data: { user: { _id: 'real-user', role: 'member' } } } }))
  assert.equal((await app.getUser())._id, 'real-user')
  assert.throws(() => app.setUser(admin), (error) => error.code === 'SESSION_CHANGED')
  assert.equal(app.globalData.user._id, 'real-user')
  assert.equal(api.isCurrentUser(admin), false)
  h.assertOriginalStorage()
  console.log('REVIEW_APP_IDENTITY_OK')
}
function checkReleasePackage() {
  const manifest = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'))
  assert(!manifest.pages.some((page) => /\/donate\/pay\//.test(page)), 'Payment page must not be registered in any build')
  const config = fs.readFileSync(path.join(mini, 'config.js'), 'utf8')
  assert(!/donationQrPath|donationRecipient/.test(config), 'Active configuration must not expose a payment QR code')
  for (const page of manifest.pages) {
    for (const extension of ['.js', '.wxml']) {
      const source = fs.readFileSync(path.join(mini, page + extension), 'utf8')
      assert(!/goDonatePay|pages\/donate\/pay|assets\/donate\/wechat-pay/.test(source), 'Registered page exposes payment entry: ' + page)
    }
  }
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
  const excluded = (project.packOptions.ignore || []).map((item) => String(item.value || '').replace(/\\/g, '/').replace(/^miniprogram\//, '').replace(/\/$/, ''))
  for (const folder of ['pages/donate/pay', 'assets/donate/wechat-pay.jpg']) {
    assert(excluded.includes(folder), 'Payment page and QR must be excluded from uploaded package: ' + folder)
  }
  assert(fs.existsSync(path.join(mini, 'assets/donate/wechat-pay.jpg')), 'Original local QR file must be preserved')
  assert(fs.existsSync(path.join(mini, 'pages/donate/pay/pay.js')), 'Original local payment source must be preserved')
  assert(manifest.pages.includes('pages/review/review'), 'Review login must be reachable in the actual release')
  const guestMarkup = fs.readFileSync(path.join(mini, 'pages/guest/guest.wxml'), 'utf8')
  const meMarkup = fs.readFileSync(path.join(mini, 'pages/me/me.wxml'), 'utf8')
  assert(/<view[^>]*bindlongpress="openReviewLogin"[^>]*>身份<\/view>/.test(guestMarkup), 'Review entry must require a deliberate long press')
  assert(!/bindtap="(?:goReview|openReviewLogin)"|进入演示|功能演示（示例数据）/.test(guestMarkup + meMarkup), 'New applicants and members must not see or tap a public demo entry')
  console.log('REVIEW_RELEASE_PACKAGE_OK')
}

async function main() {
  assert.equal(typeof global.wx, 'undefined', 'Run this script in standalone Node, never against a live WeChat process')
  checkReleasePackage()
  for (const environment of ['develop', 'trial', 'release']) await checkSessionAndBusiness(environment)
  await checkStaleRequests()
  await checkEntryBarrier()
  await checkStatefulHelpers()
  await checkAppIdentity()
  console.log('REVIEW_ISOLATION_OK')
}

main().catch((error) => { console.error('REVIEW_ISOLATION_FAIL', error); process.exitCode = 1 })
