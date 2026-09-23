Component({
  data: { selected: 0 },
  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      const routes = [
        '/pages/duty/list/list',
        '/pages/mobile-feed/mobile-feed',
        '/pages/me/me',
      ]
      if (!routes[index]) return
      wx.switchTab({ url: routes[index] })
    },
  },
})
