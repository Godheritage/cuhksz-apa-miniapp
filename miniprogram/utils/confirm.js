const session = require('../review/session')

module.exports = function confirm(options) {
  const context = session.snapshot()
  const guarded = { ...options }
  for (const name of ['success', 'fail', 'complete']) {
    if (typeof options[name] !== 'function') continue
    guarded[name] = (result) => {
      if (session.isCurrent(context)) options[name](result)
    }
  }
  return wx.showModal(guarded)
}
