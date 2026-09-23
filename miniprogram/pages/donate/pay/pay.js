const config = require('../../../config')

Page({
  data: {
    qrPath: config.donationQrPath || '',
    recipient: config.donationRecipient || '',
    configured: !!config.donationQrPath,
    loadError: false,
  },

  previewQr() {
    if (!this.data.configured || this.data.loadError) return
    wx.previewImage({
      current: this.data.qrPath,
      urls: [this.data.qrPath],
      showmenu: true,
      fail: () => wx.showToast({ title: '图片暂时无法打开，请稍后重试', icon: 'none' }),
    })
  },
  onImageError() { this.setData({ loadError: true }) },
})
