const config = require('../config')

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
  return wx.cloud.callFunction({
    name: 'api',
    data: { action, ...data },
  }).then(unwrap)
}

function login() {
  return wx.cloud.callFunction({ name: 'login' }).then(unwrap)
}

function seed() {
  return wx.cloud.callFunction({ name: 'seed' }).then(unwrap)
}

function uploadDutyPhoto(filePath, openidTail) {
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
