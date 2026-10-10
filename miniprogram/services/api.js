const config = require('../config')
const mock = require('../mock/api')
const session = require('../review/session')
const reviewStore = require('../review/store')
const review = mock.createClient(reviewStore, { review: true })
const userContexts = new WeakMap()

function unwrap(res) {
  const result = (res && res.result) || res
  if (!result || result.ok === false) {
    const err = new Error((result && result.message) || '请求失败')
    err.code = result && result.code
    throw err
  }
  return result.data
}
function context() { return { ...session.snapshot(), mock: !!config.useMock } }
function assertCurrent(scope) {
  session.assertCurrent(scope)
  if (scope.mock !== !!config.useMock) throw session.changedError()
}
function isCurrentUser(user) {
  const scope = user && userContexts.get(user)
  if (!scope) return false
  try { assertCurrent(scope); return true } catch (e) { return false }
}
function request(scope, work, authenticating = false) {
  let pending
  try {
    assertCurrent(scope)
    if (!authenticating) session.assertBusinessAllowed(scope)
    pending = work()
  } catch (error) { pending = Promise.reject(error) }
  return Promise.resolve(pending).then((result) => {
    assertCurrent(scope)
    if (result && result.user) {
      userContexts.set(result.user, scope)
      if (authenticating) session.completeLogin(scope)
    }
    return result
  }, (error) => { assertCurrent(scope); throw error })
}
function call(action, data = {}) {
  const scope = context()
  return request(scope, () => {
    if (scope.review) return review.call(action, data, () => assertCurrent(scope))
    if (scope.mock) return mock.call(action, data, () => assertCurrent(scope))
    return wx.cloud.callFunction({ name: 'api', data: { action, ...data } }).then(unwrap)
  })
}
function login() {
  const scope = context()
  return request(scope, () => {
    if (scope.review) return review.call('login', {}, () => assertCurrent(scope))
    if (scope.mock) return mock.call('login', {}, () => assertCurrent(scope))
    return wx.cloud.callFunction({ name: 'login' }).then(unwrap)
  }, true)
}
function seed() {
  const scope = context()
  return request(scope, () => {
    if (scope.review) return review.call('seed', {}, () => assertCurrent(scope))
    if (scope.mock) return mock.call('seed', {}, () => assertCurrent(scope))
    return wx.cloud.callFunction({ name: 'seed' }).then(unwrap)
  })
}
function uploadDutyPhoto(filePath, openidTail) {
  const scope = context()
  return request(scope, () => {
    if (scope.review || scope.mock) return filePath
    const name = `${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`
    return wx.cloud.uploadFile({ cloudPath: `duty/${openidTail || 'member'}/${name}`, filePath })
      .then((res) => res.fileID)
  })
}
module.exports = { call, login, seed, uploadDutyPhoto, isCurrentUser }