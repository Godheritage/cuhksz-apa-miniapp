function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

function stamp(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function cell(value) {
  let v = value
  if (v == null) return ''
  if (Array.isArray(v)) v = v.filter(Boolean).join('|')
  else if (typeof v === 'boolean') v = v ? '是' : '否'
  else if (v instanceof Date) v = stamp(v)
  else if (typeof v === 'object') v = JSON.stringify(v)
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function table(headers, rows) {
  const head = headers.map((h) => cell(h.label)).join(',')
  const lines = (rows || []).map((row) => headers.map((h) => cell(row[h.key])).join(','))
  return [head].concat(lines).join('\n')
}

const CAT_STATUS = { in_care: '在护', medical: '就医', pending_release: '待放', observe: '观察' }
const CAMPUS = { on_campus: '在校', off_campus: '离校', medical: '就医' }
const GENDER = { male: '公', female: '母', unknown: '未知' }
const HEALTH = { healthy: '健康', under_weather: '不适', recovering: '恢复中', unknown: '未知' }
const ASSET = { bowl: '食盆', feeder: '喂食器', medicine: '药品', water: '饮水', cage: '笼子', other: '其他' }
const DONATE = { pending_in: '待入库', on_site: '已在点上', moving: '搬运中', used: '已用完' }
const ADOPT = { contacting: '沟通中', visiting: '看猫中', approved: '通过', rejected: '未通过' }

function buildOrgExport(input, dateKey) {
  const siteName = {}
  ;(input.sites || []).forEach((s) => { siteName[s._id] = s.name || '' })
  const catName = {}
  ;(input.cats || []).forEach((c) => { catName[c._id] = c.name || '' })

  const stay = (cat) => cat.hospitalStay || {}
  const files = [
    {
      key: 'sites',
      title: '地点',
      name: `地点_${dateKey}.csv`,
      csv: table([
        { key: 'id', label: '编号' },
        { key: 'name', label: '名称' },
        { key: 'type', label: '类型' },
        { key: 'publicDesc', label: '公开说明' },
        { key: 'address', label: '地址' },
        { key: 'lockNote', label: '门锁备注' },
        { key: 'confidential', label: '保密' },
        { key: 'sort', label: '排序' },
        { key: 'enabled', label: '启用' },
        { key: 'catCount', label: '猫数量' },
      ], (input.sites || []).map((s) => ({
        id: s._id,
        name: s.name,
        type: s.type,
        publicDesc: s.publicDesc,
        address: s.address,
        lockNote: s.lockNote,
        confidential: !!s.confidential,
        sort: s.sort || 0,
        enabled: s.enabled !== false,
        catCount: (input.cats || []).filter((c) => c.siteId === s._id).length,
      }))),
      rows: (input.sites || []).length,
    },
    {
      key: 'cages',
      title: '笼子',
      name: `笼子_${dateKey}.csv`,
      csv: table([
        { key: 'id', label: '编号' },
        { key: 'site', label: '地点' },
        { key: 'code', label: '笼号' },
        { key: 'note', label: '备注' },
        { key: 'enabled', label: '启用' },
        { key: 'occupiedBy', label: '占用猫' },
        { key: 'photos', label: '图片文件ID' },
      ], (input.cages || []).map((c) => ({
        id: c._id,
        site: siteName[c.siteId] || c.siteId,
        code: c.code,
        note: c.note,
        enabled: c.enabled !== false,
        occupiedBy: ((input.cats || []).find((cat) => cat.cageId === c._id) || {}).name || '',
        photos: c.photoFileIds || [],
      }))),
      rows: (input.cages || []).length,
    },
    {
      key: 'assets',
      title: '固定资产',
      name: `固定资产_${dateKey}.csv`,
      csv: table([
        { key: 'id', label: '编号' },
        { key: 'site', label: '地点' },
        { key: 'name', label: '名称' },
        { key: 'category', label: '分类' },
        { key: 'quantity', label: '数量' },
        { key: 'note', label: '备注' },
        { key: 'occupiedBy', label: '占用猫' },
        { key: 'photos', label: '图片文件ID' },
      ], (input.assets || []).map((a) => ({
        id: a._id,
        site: siteName[a.siteId] || a.siteId,
        name: a.name,
        category: ASSET[a.category] || a.category,
        quantity: a.quantity || 1,
        note: a.note,
        occupiedBy: (input.cats || []).filter((c) => c.assetId === a._id).map((c) => c.name).join('、'),
        photos: a.photoFileIds || [],
      }))),
      rows: (input.assets || []).length,
    },
    {
      key: 'cats',
      title: '校园猫',
      name: `校园猫_${dateKey}.csv`,
      csv: table([
        { key: 'id', label: '编号' },
        { key: 'name', label: '名字' },
        { key: 'status', label: '状态' },
        { key: 'campus', label: '在校状态' },
        { key: 'site', label: '地点' },
        { key: 'cage', label: '笼子' },
        { key: 'asset', label: '资产' },
        { key: 'age', label: '年龄' },
        { key: 'gender', label: '性别' },
        { key: 'breed', label: '品种' },
        { key: 'health', label: '健康' },
        { key: 'needsIndividualCare', label: '需单猫追踪' },
        { key: 'lastObservation', label: '最近动态' },
        { key: 'neutered', label: '已绝育' },
        { key: 'seekingAdopt', label: '找领养' },
        { key: 'notes', label: '备注' },
        { key: 'hospital', label: '医院' },
        { key: 'hospitalReason', label: '就医原因' },
        { key: 'photos', label: '图片文件ID' },
        { key: 'updatedAt', label: '更新时间' },
      ], (input.cats || []).map((c) => ({
        id: c._id,
        name: c.name,
        status: CAT_STATUS[c.status] || c.status,
        campus: CAMPUS[c.campusStatus] || c.campusStatus || '在校',
        site: siteName[c.siteId] || '',
        cage: ((input.cages || []).find((x) => x._id === c.cageId) || {}).code || '',
        asset: ((input.assets || []).find((x) => x._id === c.assetId) || {}).name || '',
        age: c.ageText,
        gender: GENDER[c.gender] || c.gender,
        breed: c.breed,
        health: HEALTH[c.healthStatus] || c.healthStatus,
        needsIndividualCare: !!c.needsIndividualCare,
        lastObservation: c.lastObservation
          ? `${stamp(c.lastObservation.at)} ${c.lastObservation.locationText || ''} ${c.lastObservation.note || ''}` : '',
        neutered: !!c.neutered,
        seekingAdopt: !!c.seekingAdopt,
        notes: c.notes,
        hospital: stay(c).hospitalName || '',
        hospitalReason: stay(c).reason || '',
        photos: c.photoFileIds || [],
        updatedAt: stamp(c.updatedAt),
      }))),
      rows: (input.cats || []).length,
    },
    {
      key: 'catObservations',
      title: '猫动态',
      name: `猫动态_${dateKey}.csv`,
      csv: table([
        { key: 'cat', label: '猫' },
        { key: 'at', label: '观察时间' },
        { key: 'location', label: '位置' },
        { key: 'note', label: '说明' },
        { key: 'sourceId', label: '群消息编号' },
      ], (input.catObservations || []).map((row) => ({
        cat: catName[row.catId] || row.catName || row.catId,
        at: stamp(row.at), location: row.locationText,
        note: row.note, sourceId: row.sourceId,
      }))),
      rows: (input.catObservations || []).length,
    },
    {
      key: 'dietLogs',
      title: '投喂记录',
      name: `投喂记录_${dateKey}.csv`,
      csv: table([
        { key: 'id', label: '编号' },
        { key: 'cat', label: '猫' },
        { key: 'fed', label: '喂食' },
        { key: 'watered', label: '喂水' },
        { key: 'note', label: '备注' },
        { key: 'dateKey', label: '日期' },
        { key: 'byName', label: '记录人' },
        { key: 'at', label: '时间' },
        { key: 'photos', label: '图片文件ID' },
      ], (input.dietLogs || []).map((l) => ({
        id: l._id,
        cat: catName[l.catId] || l.catId,
        fed: !!(l.fed != null ? l.fed : l.ate),
        watered: !!(l.watered != null ? l.watered : l.drank),
        note: l.note,
        dateKey: l.dateKey,
        byName: l.byName,
        at: stamp(l.at),
        photos: l.photoFileIds || [],
      }))),
      rows: (input.dietLogs || []).length,
    },
    {
      key: 'siteFeedLogs',
      title: '点位投喂',
      name: `点位投喂_${dateKey}.csv`,
      csv: table([
        { key: 'dateKey', label: '日期' },
        { key: 'site', label: '点位' },
        { key: 'fed', label: '补粮' },
        { key: 'watered', label: '添水' },
        { key: 'note', label: '现场备注' },
        { key: 'byName', label: '记录人' },
        { key: 'at', label: '记录时间' },
      ], (input.siteFeedLogs || []).map((row) => ({
        dateKey: row.dateKey,
        site: siteName[row.siteId] || row.siteName || row.siteId,
        fed: !!row.fed,
        watered: !!row.watered,
        note: row.note,
        byName: row.byName,
        at: stamp(row.at),
      }))),
      rows: (input.siteFeedLogs || []).length,
    },
    {
      key: 'mobileFeedLogs',
      title: '机动投喂',
      name: `机动投喂_${dateKey}.csv`,
      csv: table([
        { key: 'dateKey', label: '日期' },
        { key: 'catName', label: '猫' },
        { key: 'seen', label: '见到' },
        { key: 'fed', label: '投喂' },
        { key: 'watered', label: '添水' },
        { key: 'note', label: '备注' },
        { key: 'byName', label: '记录人' },
        { key: 'photos', label: '图片文件ID' },
      ], (input.mobileFeedLogs || []).map((row) => ({
        dateKey: row.dateKey, catName: row.catName,
        seen: !!row.seen, fed: !!row.fed, watered: !!row.watered,
        note: row.note, byName: row.byName, photos: row.photoFileIds || [],
      }))),
      rows: (input.mobileFeedLogs || []).length,
    },
    {
      key: 'routineDutyCheckins',
      title: '每日执勤打卡',
      name: `每日执勤打卡_${dateKey}.csv`,
      csv: table([
        { key: 'dateKey', label: '执勤日期' },
        { key: 'site', label: '地点' },
        { key: 'shift', label: '班次' },
        { key: 'fed', label: '投喂' },
        { key: 'watered', label: '添水' },
        { key: 'note', label: '备注' },
        { key: 'byName', label: '打卡人' },
        { key: 'at', label: '提交时间' },
        { key: 'photos', label: '图片文件ID' },
      ], (input.routineDutyCheckins || []).map((row) => ({
        dateKey: row.dateKey, site: row.siteName,
        shift: ({ morning: '早班', noon: '午班', evening: '晚班', overnight: '凌晨' })[row.shiftId] || row.shiftId,
        fed: !!row.fed, watered: !!row.watered,
        note: row.note, byName: row.byName, at: stamp(row.at),
        photos: row.photoFileIds || [],
      }))),
      rows: (input.routineDutyCheckins || []).length,
    },
    {
      key: 'adopt',
      title: '候选领养人',
      name: `候选领养人_${dateKey}.csv`,
      csv: table([
        { key: 'id', label: '编号' },
        { key: 'cat', label: '猫' },
        { key: 'name', label: '姓名' },
        { key: 'status', label: '状态' },
        { key: 'note', label: '备注' },
        { key: 'photos', label: '图片文件ID' },
      ], (input.adoptCandidates || []).map((a) => ({
        id: a._id,
        cat: catName[a.catId] || a.catId,
        name: a.name,
        status: ADOPT[a.status] || a.status,
        note: a.note,
        photos: a.photoFileIds || [],
      }))),
      rows: (input.adoptCandidates || []).length,
    },
    {
      key: 'donations',
      title: '捐助记录',
      name: `捐助记录_${dateKey}.csv`,
      csv: table([
        { key: 'id', label: '编号' },
        { key: 'name', label: '物品' },
        { key: 'quantity', label: '数量' },
        { key: 'donorName', label: '捐助人' },
        { key: 'electronic', label: '电子' },
        { key: 'location', label: '所在位置' },
        { key: 'status', label: '状态' },
        { key: 'createdAt', label: '登记时间' },
      ], (input.donations || []).map((d) => ({
        id: d._id,
        name: d.name,
        quantity: d.quantity,
        donorName: d.donorName,
        electronic: !!d.electronic,
        location: d.location,
        status: DONATE[d.status] || d.status,
        createdAt: stamp(d.createdAt),
      }))),
      rows: (input.donations || []).length,
    },
    {
      key: 'finance',
      title: '财务台账',
      name: `财务台账_${dateKey}.csv`,
      csv: table([
        { key: 'dateKey', label: '日期' },
        { key: 'type', label: '收支' },
        { key: 'amount', label: '金额' },
        { key: 'category', label: '科目' },
        { key: 'remark', label: '备注' },
        { key: 'handlerName', label: '经手人' },
      ], (input.finance || []).map((e) => ({
        dateKey: e.dateKey,
        type: e.type === 'income' ? '收入' : '支出',
        amount: Number(e.amount || 0).toFixed(2),
        category: e.category || '其他',
        remark: e.remark,
        handlerName: e.handlerName,
      }))),
      rows: (input.finance || []).length,
    },
    {
      key: 'hospital',
      title: '就医记录',
      name: `就医记录_${dateKey}.csv`,
      csv: table([
        { key: 'id', label: '编号' },
        { key: 'cat', label: '猫' },
        { key: 'hospitalName', label: '医院' },
        { key: 'reason', label: '原因' },
        { key: 'contactName', label: '对接人' },
        { key: 'insurancePayer', label: '保险支付方' },
        { key: 'sentAt', label: '送医时间' },
        { key: 'returnedAt', label: '回校时间' },
      ], (input.hospitalVisits || []).map((h) => ({
        id: h._id,
        cat: h.catName || catName[h.catId] || h.catId,
        hospitalName: h.hospitalName,
        reason: h.reason,
        contactName: h.contactName,
        insurancePayer: h.insurancePayer,
        sentAt: stamp(h.sentAt),
        returnedAt: stamp(h.returnedAt),
      }))),
      rows: (input.hospitalVisits || []).length,
    },
    {
      key: 'workload',
      title: '工作记录',
      name: `工作记录_${dateKey}.csv`,
      csv: table([
        { key: 'dateKey', label: '日期' },
        { key: 'workerName', label: '名字' },
        { key: 'title', label: '工作内容' },
        { key: 'pf', label: 'PF' },
        { key: 'sourceKey', label: '记录来源' },
      ], (input.workload || []).map((w) => ({
        dateKey: w.dateKey,
        workerName: w.workerName,
        title: w.title,
        pf: w.pf == null ? '' : w.pf,
        sourceKey: w.sourceKey,
      }))),
      rows: (input.workload || []).length,
    },
  ]

  const counts = {}
  files.forEach((f) => { counts[f.title] = f.rows })
  const csv = [
    `动保组织资料备份,导出日期,${dateKey},不含每日任务`,
    '',
    ...files.map((f) => `# ${f.title}\n${f.csv}`),
  ].join('\n\n')

  return {
    filename: `动保资料备份_${dateKey}.csv`,
    csv,
    files: files.map((f) => ({ name: f.name, title: f.title, csv: f.csv, rows: f.rows })),
    counts,
  }
}

module.exports = { cell, table, stamp, buildOrgExport }
