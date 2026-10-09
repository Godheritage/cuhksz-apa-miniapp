const config = require('../config')
const mock = require('../mock/api')

function unwrap(res) {
  const result = (res && res.result) || res
  if (!result || result.ok === false) {
    const err = new Error((result && result.message) || '请求失败')
    err.code = result && result.code
    throw err
  }
  return result.data
}

function call(action, data = {}) {
  if (config.useMock) {
    return mock.call(action, data)
  }
  return wx.cloud.callFunction({
    name: 'api',
    data: { action, ...data },
  }).then(unwrap)
}

function login() {
  if (config.useMock) return mock.call('login')
  return wx.cloud.callFunction({ name: 'login' }).then(unwrap)
}

function seed() {
  if (config.useMock) return mock.call('seed')
  return wx.cloud.callFunction({ name: 'seed' }).then(unwrap)
}

function uploadDutyPhoto(filePath, openidTail) {
  if (config.useMock) {
    return Promise.resolve(filePath)
  }
  const name = `${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`
  return wx.cloud.uploadFile({
    cloudPath: `duty/${openidTail || 'member'}/${name}`,
    filePath,
  }).then((res) => res.fileID)
}

module.exports = {
  call,
  login,
  seed,
  uploadDutyPhoto,
}
