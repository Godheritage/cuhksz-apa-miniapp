const config = require('./config')
const api = require('./services/api')
const { isApproved } = require('./utils/format')

App({
  globalData: {
    ready: false,
    user: null,
    useMock: config.useMock,
  },

  onLaunch() {
    if (!config.useMock) {
      if (!wx.cloud) {
        console.error('请使用 2.2.3 及以上基础库以使用云开发')
      } else {
        wx.cloud.init({
          env: config.cloudEnvId,
          traceUser: true,
        })
      }
    }
    this.refreshUser().catch((err) => console.error('启动登录失败', err))
  },

  refreshUser(force) {
    if (this._refreshing) return this._refreshing
    const loginPromise = Promise.resolve().then(() => api.login())
    let timer
    const pending = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (this._refreshing === pending) this._refreshing = null
        const err = new Error('确认身份超时')
        err.code = 'TIMEOUT'
        reject(err)
      }, 8000)
      loginPromise.then((data) => {
        clearTimeout(timer)
        if (!data || !data.user) return reject(new Error('身份信息未返回，请重试'))
        resolve(data.user)
      }, (err) => {
        clearTimeout(timer)
        reject(err)
      })
    }).then((user) => {
      if (this._refreshing === pending) this._refreshing = null
      this.globalData.user = user
      this.globalData.ready = true
      return user
    }, (err) => {
      if (this._refreshing === pending) this._refreshing = null
      this.globalData.ready = false
      throw err
    })
    this._refreshing = pending
    return pending
  },

  getUser() {
    if (this._refreshing) return this._refreshing
    if (this.globalData.ready) return Promise.resolve(this.globalData.user)
    return this.refreshUser()
  },

  setUser(user) {
    this.globalData.user = user
    this.globalData.ready = true
  },

  routeByRole(user) {
    const role = (user && user.role) || 'guest'
    const go = () => {
      if (isApproved(role)) {
        wx.switchTab({
          url: '/pages/duty/list/list',
          fail: () => {},
        })
        return
      }
      wx.reLaunch({ url: '/pages/guest/guest' })
    }
    if (wx.nextTick) wx.nextTick(go)
    else setTimeout(go, 0)
  },

  ensureApproved() {
    return this.getUser().then((user) => {
      if (isApproved(user && user.role)) return user
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const route = current ? current.route : ''
      if (route !== 'pages/guest/guest' && route !== 'pages/index/index') {
        wx.reLaunch({ url: '/pages/guest/guest' })
      }
      return Promise.reject(new Error('UNAPPROVED'))
    })
  },

  ensureAdmin() {
    return this.ensureApproved().then((user) => {
      if (user.role === 'admin') return user
      wx.showToast({ title: '仅管理员可进入', icon: 'none' })
      wx.switchTab({ url: '/pages/me/me' })
      return Promise.reject(new Error('NOT_ADMIN'))
    })
  },
})
