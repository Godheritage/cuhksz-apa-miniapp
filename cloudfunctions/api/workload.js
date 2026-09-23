function buildWorkRecords({ creditEvents, doneTasks, pfOverrides }) {
  const found = {}
  const overrides = pfOverrides || {}
  function add(event) {
    const sourceKey = String(event.taskId || event._id || '') + ':' + String(event.dateKey || '')
    if (!sourceKey || found[sourceKey]) return
    const dateKey = String(event.dateKey || '')
    const marked = Object.prototype.hasOwnProperty.call(overrides, sourceKey)
    found[sourceKey] = {
      sourceKey,
      workerName: String(event.workerName || '未署名'),
      title: String(event.title || ''),
      dateKey,
      at: Number(event.at) || 0,
      pf: marked ? overrides[sourceKey] : (event.pf == null ? null : event.pf),
    }
  }
  ;(creditEvents || []).forEach(add)
  ;(doneTasks || []).forEach((task) => {
    const report = task.report || {}
    add({
      taskId: task._id, dateKey: task.lastDoneDateKey,
      workerName: report.workerName, title: task.title, at: report.submittedAt,
    })
  })
  return Object.keys(found).map((key) => found[key])
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.at - a.at || a.workerName.localeCompare(b.workerName))
}

module.exports = { buildWorkRecords }
