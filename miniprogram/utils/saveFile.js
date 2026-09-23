function writeLocal(filename, text) {
  if (!wx.env || !wx.env.USER_DATA_PATH || !wx.getFileSystemManager) {
    throw new Error('当前环境不能写本地文件')
  }
  const path = `${wx.env.USER_DATA_PATH}/${filename}`
  wx.getFileSystemManager().writeFileSync(path, `\uFEFF${text}`, 'utf8')
  return path
}

function shareOrOpen(filePath, filename) {
  return new Promise((resolve) => {
    const done = () => resolve(filePath)
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath,
        fileName: filename,
        success: done,
        fail: () => {
          if (wx.openDocument) {
            wx.openDocument({ filePath, showMenu: true, success: done, fail: done })
          } else {
            done()
          }
        },
      })
      return
    }
    if (wx.openDocument) {
      wx.openDocument({ filePath, showMenu: true, success: done, fail: done })
      return
    }
    done()
  })
}

function saveCsv(filename, csv) {
  wx.setClipboardData({
    data: csv,
    success: () => wx.showToast({ title: '已复制，也可转发保存', icon: 'none' }),
  })
  const path = writeLocal(filename, csv)
  return shareOrOpen(path, filename)
}

module.exports = { writeLocal, shareOrOpen, saveCsv }
