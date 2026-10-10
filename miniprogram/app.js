const config = require('./config')
const api = require('./services/api')
const share = require('./utils/share')
const session = require('./review/session')
const { isApproved } = require('./utils/format')

App({
  globalData: {
    ready: false,
    user: null,
    pendingMemberCount: 0,
    useMock: config.useMock,
    reviewMode: false,
    reviewRole: '',
  },

  onLaunch() {
    this._syncSession()
    this._unsubscribeReview = session.subscribe(() => this._syncSession())
    if (typeof wx.onCopyUrl === 'function') wx.onCopyUrl(() => share.copyUrl())
    if (!config.useMock && !session.isReviewMode()) {
      if (!wx.cloud) {
        console.error('请使用 2.2.3 及以上基础库以使用云开发')
      } else {
        wx.cloud.init({ env: config.cloudEnvId, traceUser: true })
      }
    }
    this.refreshUser().catch((err) => {
      if (err.code !== 'SESSION_CHANGED') console.error('启动登录失败', err)
    })
  },

  onShow() {
    this._syncSession()
    if (this.globalData.ready) this.refreshUser(true).catch(() => {})
  },

  _syncSession() {
    if (session.isCurrent(this._session)) return
    this._session = session.snapshot()
    this._refreshing = null
    this.globalData.user = null
    this.globalData.ready = false
    this.globalData.pendingMemberCount = 0
    this.globalData.reviewMode = this._session.review
    this.globalData.reviewRole = this._session.role
  },

  refreshUser(force) {
    this._syncSession()
    if (this._refreshing) return this._refreshing
    const scope = session.snapshot()
    const loginPromise = api.login()
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
      session.assertCurrent(scope)
      if (!api.isCurrentUser(user)) throw session.changedError()
      if (this._refreshing === pending) this._refreshing = null
      this.globalData.user = user
      if (user.role !== 'admin') this.globalData.pendingMemberCount = 0
      this.globalData.ready = true
      return user
    }, (err) => {
      if (session.isCurrent(scope)) {
        if (this._refreshing === pending) this._refreshing = null
        this.globalData.ready = false
      }
      throw err
    })
    this._refreshing = pending
    return pending
  },

  getUser(force = false) {
    this._syncSession()
    if (this._refreshing) return this._refreshing
    if (this.globalData.ready && !force && api.isCurrentUser(this.globalData.user)) {
      return Promise.resolve(this.globalData.user)
    }
    return this.refreshUser(force)
  },

  setUser(user) {
    this._syncSession()
    if (!api.isCurrentUser(user)) throw session.changedError()
    this.globalData.user = user
    this.globalData.ready = true
  },

  routeByRole(user) {
    const scope = session.snapshot()
    const role = (user && user.role) || 'guest'
    const go = () => {
      if (!session.isCurrent(scope)) return
      if (isApproved(role)) {
        wx.switchTab({ url: '/pages/routine-duty/routine-duty', fail: () => {} })
        return
      }
      wx.reLaunch({ url: '/pages/guest/guest' })
    }
    if (wx.nextTick) wx.nextTick(go)
    else setTimeout(go, 0)
  },

  ensureApproved() {
    const scope = session.snapshot()
    return this.getUser().then((user) => {
      session.assertCurrent(scope)
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
    const scope = session.snapshot()
    return this.ensureApproved().then((user) => {
      session.assertCurrent(scope)
      if (user.role === 'admin') return user
      wx.showToast({ title: '仅管理员可进入', icon: 'none' })
      wx.switchTab({ url: '/pages/me/me' })
      return Promise.reject(new Error('NOT_ADMIN'))
    })
  },
})