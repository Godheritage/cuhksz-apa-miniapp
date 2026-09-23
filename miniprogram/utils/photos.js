const api = require('../services/api')

function pick(current, max) {
  const have = current || []
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: Math.max(1, max - have.length),
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath)
        resolve(have.concat(paths).slice(0, max))
      },
      fail: (err) => {
        if (err && /cancel/i.test(err.errMsg || '')) resolve(have)
        else reject(err)
      },
    })
  })
}

function removeAt(list, index) {
  const next = (list || []).slice()
  next.splice(index, 1)
  return next
}

function uploadMany(paths, folder) {
  return Promise.all((paths || []).map((path) => {
    if (!path) return Promise.resolve('')
    const localPreview = /^https?:\/\/(?:usr|tmp)(?:\/|:)/i.test(path)
    if (/^cloud:\/\//.test(path) || (/^https?:\/\//.test(path) && !localPreview)) return Promise.resolve(path)
    return api.uploadDutyPhoto(path, folder)
  })).then((ids) => ids.filter(Boolean))
}

function failText(err) {
  const raw = (err && err.message) || '失败'
  if (/502001|documentupdate|databaserequest/i.test(raw)) return '保存失败，请刷新任务后重试'
  if (/timeout|超时/i.test(raw)) return '网络超时，请刷新确认是否已提交'
  return raw
}

module.exports = { pick, removeAt, uploadMany, failText }
