function envVersion() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync()
    return (info && info.miniProgram && info.miniProgram.envVersion) || 'develop'
  } catch (e) {
    return 'develop'
  }
}

function isTrial() {
  return envVersion() === 'trial'
}

module.exports = {
  envVersion,
  isTrial,
}
