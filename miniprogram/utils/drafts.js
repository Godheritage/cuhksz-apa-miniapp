function readDraft(key) {
  try {
    return wx.getStorageSync(key) || null
  } catch (e) {
    return null
  }
}

function writeDraft(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    // 存储满时宁可丢掉草稿，也不能把已保存业务数据冲掉
  }
}

function clearDraft(key) {
  try {
    wx.removeStorageSync(key)
  } catch (e) {
    // ignore
  }
}

module.exports = {
  readDraft,
  writeDraft,
  clearDraft,
}
