const TITLE = '港中深动保工具'
const HOME_PATH = '/pages/index/index'

function appMessage() {
  return { title: TITLE, path: HOME_PATH }
}

function timeline() {
  return { title: TITLE }
}

function copyUrl() {
  return { query: '' }
}

module.exports = { appMessage, timeline, copyUrl }
