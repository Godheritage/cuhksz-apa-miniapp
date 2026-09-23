const api = require('../../../services/api')

const KINDS = [
  { id: 'adoption_caution', label: '领养提醒' },
  { id: 'guide', label: '教程' },
  { id: 'password', label: '密码备忘' },
]

Page({
  data: {
    ready: false,
    rows: [],
    kinds: KINDS,
    noteId: '',
    revealed: false,
    form: { kind: 'adoption_caution', title: '', body: '' },
  },

  onShow() {
    getApp().ensureAdmin().then(() => this.reload()).catch(() => {})
  },

  reload() {
    return api.call('adminListKnowledge').then((data) => {
      this.setData({ ready: true, rows: data.rows || [] })
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  pickKind(e) {
    const kind = e.currentTarget.dataset.kind
    this.setData({ 'form.kind': kind, revealed: kind === 'password' && !this.data.noteId })
  },

  onForm(e) {
    this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value })
  },

  openNote(e) {
    api.call('adminGetKnowledge', { noteId: e.currentTarget.dataset.id }).then((data) => {
      const note = data.note
      this.setData({
        noteId: note._id, revealed: note.kind !== 'password',
        form: { kind: note.kind, title: note.title, body: note.body },
      })
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  reveal() {
    this.setData({ revealed: true })
  },

  newNote() {
    this.setData({
      noteId: '', revealed: false,
      form: { kind: 'adoption_caution', title: '', body: '' },
    })
  },

  saveNote() {
    api.call('adminUpsertKnowledge', {
      noteId: this.data.noteId,
      ...this.data.form,
    }).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' })
      this.newNote()
      return this.reload()
    }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
  },

  deleteNote() {
    if (!this.data.noteId) return
    wx.showModal({
      title: '删除资料', content: '删除后无法恢复，确定吗？',
      success: (result) => {
        if (!result.confirm) return
        api.call('adminDeleteKnowledge', { noteId: this.data.noteId }).then(() => {
          this.newNote()
          return this.reload()
        }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
      },
    })
  },
})
