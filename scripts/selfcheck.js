'use strict'

const path = require('path')
const mock = require(path.join(__dirname, '..', 'miniprogram', 'mock', 'api'))

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function as(role) {
  return mock.call('switchMockRole', { role })
}

async function main() {
  await mock.call('resetMock')
  let guestBlocked = false
  await as('guest')
  try {
    await mock.call('listSites')
  } catch (e) {
    guestBlocked = true
  }
  assert(guestBlocked, '游客应无法看执勤点')
  let guestFeedBlocked = false
  try { await mock.call('listSiteFeedLogs', { siteId: 'site_ta' }) } catch (e) { guestFeedBlocked = true }
  assert(guestFeedBlocked, '游客不能看点位投喂记录')
  let guestMobileBlocked = false
  try { await mock.call('listMobileFeedLogs', { monthKey: '2026-09' }) } catch (e) { guestMobileBlocked = true }
  assert(guestMobileBlocked, '游客不能看机动投喂日历')
  let guestTaskCalendarBlocked = false
  try { await mock.call('listTaskCalendar', { monthKey: '2026-09' }) } catch (e) { guestTaskCalendarBlocked = true }
  assert(guestTaskCalendarBlocked, '游客不能看组织任务日历')
  let guestRoutineBlocked = false
  try { await mock.call('listRoutineDuty', { monthKey: '2026-09' }) } catch (e) { guestRoutineBlocked = true }
  assert(guestRoutineBlocked, '游客不能看每日执勤打卡')

  await as('admin')
  const created = await mock.call('adminUpsertSite', {
    name: '自检点',
    type: '教学楼天台',
    publicDesc: '自检',
    confidential: false,
  })
  assert(created.siteId, '应能新增执勤点')
  await mock.call('adminUpsertAsset', {
    siteId: created.siteId,
    name: '自检食盆',
    category: 'bowl',
    quantity: 2,
  })
  const sites = await mock.call('adminListSites')
  const site = sites.sites.find((s) => s._id === created.siteId)
  assert(site && site.type === '教学楼天台', '点位类型应可自填')
  assert(site && site.assets.some((a) => a.name === '自检食盆'), '应能加固定资产')
  const renamed = await mock.call('adminRenameSite', { siteId: created.siteId, name: '自检新名' })
  assert(renamed.siteId === created.siteId && renamed.name === '自检新名', '点位改名应保留 ID')
  assert((await mock.call('adminListSites')).sites.some((s) => s._id === created.siteId && s.name === '自检新名'), '点位新名应可读')
  await mock.call('adminSetRoutineDutySite', { siteId: created.siteId, enabled: true })
  const enabledRoutine = await mock.call('listRoutineDuty')
  assert(enabledRoutine.sites.length === 4 && enabledRoutine.sites.some((s) => s._id === created.siteId && s.name === '自检新名'), '管理员开启后新点位应进入同一份每日执勤日历')
  assert((await mock.call('getSiteDetail', { siteId: created.siteId })).site.routineDutyEnabled, '点位档案应同步显示每日执勤开关')
  const archivedRoutine = await mock.call('submitRoutineDuty', { siteId: created.siteId, shiftId: 'morning', note: '停用前的历史打卡' })
  await mock.call('adminRenameSite', { siteId: created.siteId, name: '自检再次改名' })
  const renamedRoutine = await mock.call('listRoutineDuty')
  assert(renamedRoutine.sites.some((s) => s._id === created.siteId && s.name === '自检再次改名')
    && renamedRoutine.logs.some((row) => row._id === archivedRoutine.checkinId && row.siteName === '自检再次改名'), '点位改名应同步到每日执勤及历史记录')
  await mock.call('adminSetRoutineDutySite', { siteId: created.siteId, enabled: false })
  const afterRoutineOff = await mock.call('listRoutineDuty')
  assert(afterRoutineOff.sites.length === 3 && afterRoutineOff.archivedSites.some((s) => s._id === created.siteId)
    && afterRoutineOff.logs.some((row) => row._id === archivedRoutine.checkinId), '关闭点位后不再排新班，但旧打卡须保留')
  await mock.call('deleteRoutineDuty', { checkinId: archivedRoutine.checkinId })
  await mock.call('adminSetRoutineDutySite', { siteId: 'site_base', enabled: false })
  assert((await mock.call('listRoutineDuty')).sites.length === 2, '管理员可关闭默认执勤点位')
  await mock.call('adminSetRoutineDutySite', { siteId: 'site_base', enabled: true })

  await mock.call('updateCatLocation', {
    catId: 'cat_gray',
    siteId: '',
    cageId: '',
    assetId: '',
    status: 'observe',
  })
  const gray = await mock.call('getCatDetail', { catId: 'cat_gray' })
  assert(!gray.cat.siteId && !gray.cat.cageId, '猫可以不挂点、不占用')

  const published = await mock.call('adminPublishWorkTask', {
    siteId: created.siteId,
    title: '补粮',
    content: '把自动喂食机加满并拍照',
  })
  await as('member')
  let memberRoutineToggleBlocked = false
  try { await mock.call('adminSetRoutineDutySite', { siteId: created.siteId, enabled: true }) } catch (e) { memberRoutineToggleBlocked = true }
  assert(memberRoutineToggleBlocked, '普通成员不能改每日执勤点位')
  const beforeClaim = (await mock.call('getWorkTask', { taskId: published.taskId })).task
  assert(beforeClaim.canClaim && !beforeClaim.canSubmit, '待做任务应先显示领取入口')
  await mock.call('claimWorkTask', { taskId: published.taskId })
  const ownClaim = (await mock.call('getWorkTask', { taskId: published.taskId })).task
  assert(ownClaim.canSubmit && ownClaim.canRelease && !ownClaim.canClaim, '领取后应显示回传和退回')
  await mock.call('submitWorkTask', {
    taskId: published.taskId,
    description: '已加满，机器正常',
    workerName: '演示成员',
    photoFileIds: ['demo.jpg'],
  })
  const listed = await mock.call('listWorkTasks', { siteId: created.siteId })
  const waiting = listed.groups[0].tasks.find((t) => t._id === published.taskId)
  assert(waiting.status === 'review', '交回后应待审核')
  await as('admin')
  await mock.call('adminReviewWorkTask', { taskId: published.taskId, approved: false })
  const relisted = await mock.call('listWorkTasks', { siteId: created.siteId })
  assert(relisted.groups[0].tasks.find((t) => t._id === published.taskId).status === 'open', '未通过应重新上架')
  await as('member')
  await mock.call('claimWorkTask', { taskId: published.taskId })
  await mock.call('submitWorkTask', {
    taskId: published.taskId,
    description: '重做完成',
    workerName: '演示成员',
    photoFileIds: [],
  })
  await as('admin')
  await mock.call('adminReviewWorkTask', { taskId: published.taskId, approved: true })
  const done = await mock.call('listWorkTasks', { siteId: created.siteId })
  assert(done.groups[0].tasks.find((t) => t._id === published.taskId).status === 'done', '通过后应完成')

  await as('member')
  const siteFed = await mock.call('addSiteFeedLog', {
    siteId: 'site_ta', fed: true, watered: true, note: '已补充小半碗',
  })
  const siteFeedList = await mock.call('listSiteFeedLogs', { siteId: 'site_ta' })
  assert(siteFeedList.today.count === 1 && siteFeedList.today.fed && siteFeedList.today.watered, '点位应记下今日补粮和添水')
  const healthyCat = (await mock.call('listCats', { campusStatus: 'all' })).cats.find((cat) => cat._id === 'cat_loud')
  assert(healthyCat.siteFeedToday && healthyCat.siteFeedToday.fed, '健康猫可看到所属点位投喂状态')
  assert(!healthyCat.careTimesToday, '点位投喂不能伪装成单猫已经吃到')
  const mobileDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const mobile = await mock.call('addMobileFeedLog', {
    dateKey: mobileDate, catName: '炯', seen: false, fed: false, watered: false,
    note: '今天巡查未见', photoFileIds: ['cloud://qa/mobile-feed/photo.jpg'],
  })
  const mobileList = await mock.call('listMobileFeedLogs', { monthKey: mobileDate.slice(0, 7) })
  assert(mobileList.logs.some((row) => row._id === mobile.logId && !row.seen), '机动猫未出现也能在日历留一笔')
  assert(mobileList.catNames.includes('炯'), '记录过的猫应自动成为机动投喂筛选项')
  assert(mobileList.logs.some((row) => row._id === mobile.logId && row.photoUrls.length === 1), '机动投喂图片应能随记录查看')
  const routineBefore = await mock.call('listRoutineDuty', { monthKey: mobileDate.slice(0, 7) })
  assert(routineBefore.sites.length === 3 && routineBefore.shifts.length === 4, '每日执勤应固定三处四班')
  const signup = await mock.call('signupRoutineDuty', {
    dateKey: mobileDate, siteId: 'site_base', shiftId: 'morning',
  })
  assert(signup.signupId, '成员可提前报名执勤')
  let repeatSignupBlocked = false
  try { await mock.call('signupRoutineDuty', { dateKey: mobileDate, siteId: 'site_base', shiftId: 'morning' }) } catch (e) { repeatSignupBlocked = true }
  assert(repeatSignupBlocked, '同一成员不能重复报名同班')
  const signedList = await mock.call('listRoutineDuty', { monthKey: mobileDate.slice(0, 7) })
  assert(signedList.signups.some((row) => row._id === signup.signupId && row.mine), '成员能看到自己的计划报名')
  const routine = await mock.call('submitRoutineDuty', {
    dateKey: mobileDate, siteId: 'site_base', shiftId: 'morning', fed: true,
    photoFileIds: ['cloud://qa/routine-duty/photo.jpg'],
  })
  const routineList = await mock.call('listRoutineDuty', { monthKey: mobileDate.slice(0, 7) })
  assert(routineList.logs.some((row) => row._id === routine.checkinId && row.mine && row.photoUrls.length === 1), '成员能按地点班次打卡并查看照片')
  assert(!routineList.signups.some((row) => row._id === signup.signupId), '实际打卡后自动撤下自己的计划报名')
  const mochaRoutine = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(mochaRoutine.cat.siteFeedToday && mochaRoutine.cat.siteFeedToday.fed, '固定执勤投喂应同步到所属点位的猫档状态')
  let duplicateRoutineBlocked = false
  try { await mock.call('submitRoutineDuty', { dateKey: mobileDate, siteId: 'site_base', shiftId: 'morning' }) } catch (e) { duplicateRoutineBlocked = true }
  assert(duplicateRoutineBlocked, '同一成员同地点同班次不能重复打卡')
  let specialBlocked = false
  try { await mock.call('adminSetCatSpecialCare', { catId: 'cat_mocha', enabled: true }) } catch (e) { specialBlocked = true }
  assert(specialBlocked, '普通成员不能更改单猫追踪标记')
  await as('admin')
  const adminSignup = await mock.call('signupRoutineDuty', { dateKey: mobileDate, siteId: 'site_base', shiftId: 'evening' })
  const mixedSignups = await mock.call('listRoutineDuty', { monthKey: mobileDate.slice(0, 7) })
  assert(mixedSignups.signups.some((row) => row._id === adminSignup.signupId), '同日计划报名可公开给已审核成员查看')
  await as('member')
  assert((await mock.call('listRoutineDuty', { monthKey: mobileDate.slice(0, 7) })).signups
    .some((row) => row._id === adminSignup.signupId && !row.canCancel), '成员可看他人报名但不能取消')
  let cancelOtherBlocked = false
  try { await mock.call('cancelRoutineDutySignup', { signupId: adminSignup.signupId }) } catch (e) { cancelOtherBlocked = true }
  assert(cancelOtherBlocked, '成员不能取消别人的报名')
  await as('admin')
  await mock.call('cancelRoutineDutySignup', { signupId: adminSignup.signupId })
  const routineAdmin = await mock.call('submitRoutineDuty', {
    dateKey: mobileDate, siteId: 'site_base', shiftId: 'morning', note: '第二位成员同班打卡',
  })
  const multiRoutine = await mock.call('listRoutineDuty', { monthKey: mobileDate.slice(0, 7) })
  assert(multiRoutine.logs.filter((row) => row.dateKey === mobileDate && row.siteId === 'site_base'
    && row.shiftId === 'morning').length === 2, '同一个固定班次应允许多人打卡')
  await mock.call('adminSetCatSpecialCare', { catId: 'cat_mocha', enabled: true })
  const observed = await mock.call('adminApplyChatCatState', {
    catId: 'cat_macchiato', status: 'observe', campusStatus: 'on_campus',
    siteId: '', locationText: '东门', note: '已放归东门',
    sourceId: 'demo-source-1', observedAt: Date.now(),
  })
  assert(observed.lastObservation.locationText === '东门', '有来源的猫动态应写入档案')
  const again = await mock.call('adminApplyChatCatState', {
    catId: 'cat_macchiato', status: 'observe', campusStatus: 'on_campus',
    siteId: '', locationText: '东门', note: '已放归东门',
    sourceId: 'demo-source-1', observedAt: Date.now(),
  })
  assert(again.skipped, '同一群消息不能重复写动态')
  const provisional = await mock.call('adminCreateCat', {
    name: '临时新猫', gender: 'female', siteId: 'site_base', status: 'in_care',
    provisional: true, needsIndividualCare: true,
    sourceId: 'demo-new-cat', observedAt: Date.now(),
    locationText: '豪宅', note: '身份待确认',
  })
  assert(provisional.catId && provisional.provisional, '管理员可建有来源的临时猫档')
  assert((await mock.call('adminCreateCat', { name: '临时新猫' })).skipped, '临时猫档重试不应重复新建')
  await mock.call('adminSetCatProvisional', { catId: provisional.catId, provisional: false })
  await as('member')
  assert((await mock.call('getCatDetail', { catId: 'cat_mocha' })).cat.needsIndividualCare, '管理员可给摩卡标记单猫追踪')
  assert((await mock.call('getCatDetail', { catId: 'cat_macchiato' })).cat.lastObservation.locationText === '东门', '成员可看近期猫动态')
  assert(!(await mock.call('getCatDetail', { catId: provisional.catId })).cat.provisional, '确认身份后可取消临时标记')
  await mock.call('deleteSiteFeedLog', { logId: siteFed.logId })
  assert(!(await mock.call('listSiteFeedLogs', { siteId: 'site_ta' })).today, '删掉错记后点位摘要应更新')
  await mock.call('addFeedLog', { catId: 'cat_mocha', fed: true, watered: true, note: '第一次', photoFileIds: ['feed.jpg'] })
  await mock.call('addFeedLog', { catId: 'cat_mocha', fed: true, watered: false, note: '第二次' })
  const mochaDiet = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(mochaDiet.cat.lastDiet.note === '第二次', '应保留最新喂食喂水')
  assert(mochaDiet.cat.careTimesToday === 2, '一天内投喂次数应累加')
  assert(mochaDiet.feedLogs.length === 2, '应列出投喂记录')
  assert(mochaDiet.feedLogs[0].photoFileIds.length === 0, '第二条没有图')
  assert(mochaDiet.feedLogs[1].photoFileIds[0] === 'feed.jpg', '第一条应保留图片')
  await mock.call('deleteFeedLog', { logId: mochaDiet.feedLogs[0]._id })
  const afterDelFeed = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(afterDelFeed.feedLogs.length === 1 && afterDelFeed.feedLogs[0].note === '第一次', '删除后应回到上一条')
  assert(afterDelFeed.cat.careTimesToday === 1, '删除后次数应重算')

  await as('admin')
  await mock.call('adminDeleteWorkTask', { taskId: published.taskId })
  const gone = await mock.call('listWorkTasks', { siteId: created.siteId })
  assert(!gone.groups[0].tasks.find((t) => t._id === published.taskId), '管理员应能删除任务')

  await as('member')
  const base = (await mock.call('listSites')).sites.find((s) => s.name === '豪宅')
  assert(base.confidential, '豪宅应为保密点')
  const detail = await mock.call('getSiteDetail', { siteId: base._id })
  assert(detail.site.addressHidden && !detail.site.address, '成员默认不能看到保密地址')
  await mock.call('requestSiteAccess', { siteId: base._id })
  await as('admin')
  const reqs = await mock.call('adminListAccessRequests')
  const pending = reqs.requests.find((r) => r.status === 'pending' && r.siteId === base._id)
  await mock.call('adminDecideAccess', { requestId: pending._id, decision: 'approved' })
  await as('member')
  const mine = await mock.call('listMyAccessRequests')
  const approved = mine.requests.find((r) => r.siteId === base._id && r.status === 'approved')
  assert(approved.password, '通过后申请人应拿到动态密码')
  const revealed = await mock.call('revealSiteAddress', { siteId: base._id, password: approved.password })
  assert(revealed.address, '正确密码应能看到地址')
  await mock.call('advanceMockDay')
  let expired = false
  try {
    await mock.call('revealSiteAddress', { siteId: base._id, password: approved.password })
  } catch (e) {
    expired = true
  }
  assert(expired, '下一天密码应失效')

  await as('admin')
  await mock.call('markCatHospital', {
    catId: 'cat_mocha',
    hospitalName: '南山区某宠物医院',
    reason: '自检送医',
    contactName: '演示成员',
    contactPhone: '13800001111',
    insurancePayer: '协会公共保险',
  })
  const mochaDetail = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(mochaDetail.cat.campusStatus === 'medical' && !mochaDetail.cat.cageId, '就医应释放占用')

  const csv = await mock.call('adminExportFinanceCsv')
  assert(csv.csv.indexOf('日期,收支,金额,科目,备注,经手人') === 0, 'CSV 表头应稳定')
  const imported = await mock.call('adminImportFinanceCsv', {
    csv: '日期,收支,金额,科目,备注,经手人\n2026-09-01,收入,10,捐款,自检,演示管理员',
  })
  assert(imported.imported === 1, 'CSV 应能导入')

  await as('member')
  const canned = await mock.call('submitDonation', {
    name: '罐头',
    quantity: '2罐',
    donorName: '演示成员',
    electronic: false,
    location: '驿站',
  })
  await as('admin')
  const adminDons = await mock.call('listDonations')
  assert(adminDons.orgBalance && typeof adminDons.orgBalance.balance === 'number', '管理员应看到组织余额')
  const cannedRow = adminDons.donations.find((d) => d._id === canned.donationId)
  assert(cannedRow && cannedRow.canPublishMove, '登记后应能再发搬运')
  const laterMove = await mock.call('adminPublishMoveTask', {
    donationId: canned.donationId,
    toLocation: '豪宅',
    photoFileIds: ['later.jpg'],
  })
  assert(laterMove.taskId, '登记后再发搬运应成功')
  const afterMoveDons = await mock.call('listDonations')
  assert(!afterMoveDons.donations.find((d) => d._id === canned.donationId).canPublishMove, '已发搬运不应再显示发布入口')
  const board = await mock.call('listWorkTasks')
  const moveGroup = board.groups.find((g) => g.siteId === 'move_board')
  const laterTask = moveGroup && moveGroup.tasks.find((t) => t._id === laterMove.taskId)
  assert(laterTask && laterTask.photoFileIds[0] === 'later.jpg', '搬运应出现在任务看板并带图')

  const together = await mock.call('submitDonation', {
    name: '猫粮',
    quantity: '1袋',
    donorName: '演示管理员',
    electronic: false,
    location: '教学楼',
    publishMove: true,
    toLocation: '豪宅',
    photoFileIds: ['move.jpg'],
  })
  assert(together.moveTaskId, '登记同时应能发搬运')
  const board2 = await mock.call('listWorkTasks')
  const togetherTask = (board2.groups.find((g) => g.siteId === 'move_board') || { tasks: [] })
    .tasks.find((t) => t._id === together.moveTaskId)
  assert(togetherTask && togetherTask.title.indexOf('猫粮') >= 0, '同时发布的搬运应进任务看板')

  let elecFail = false
  try {
    const dons = await mock.call('listDonations')
    const elec = dons.donations.find((d) => d.electronic)
    await mock.call('adminPublishMoveTask', { donationId: elec._id, toLocation: '基地' })
  } catch (e) {
    elecFail = true
  }
  assert(elecFail, '电子物资不能发搬运')

  await as('member')
  const memberDons = await mock.call('listDonations')
  assert(!memberDons.orgBalance, '成员不应看到组织余额')

  await as('admin')
  const noSite = await mock.call('adminPublishWorkTask', {
    title: '校园巡猫',
    content: '路过时看一眼，不必绑点',
  })
  const generalListed = await mock.call('listWorkTasks')
  const generalGroup = generalListed.groups.find((g) => g.siteId === 'general')
  assert(generalGroup && generalGroup.tasks.some((t) => t._id === noSite.taskId), '不选地点的任务应出现在不限地点')
  const taskDetail = await mock.call('getWorkTask', { taskId: noSite.taskId })
  assert(taskDetail.task && taskDetail.task.title === '校园巡猫', '应能打开任务详情')

  const withPhoto = await mock.call('adminPublishWorkTask', {
    siteId: created.siteId,
    title: '带图任务',
    content: '检查水碗',
    photoFileIds: ['task.jpg'],
  })
  const photoListed = await mock.call('listWorkTasks', { siteId: created.siteId })
  const photoTask = photoListed.groups[0].tasks.find((t) => t._id === withPhoto.taskId)
  assert(photoTask && photoTask.photoFileIds[0] === 'task.jpg', '发布任务应能带图')

  await mock.call('adminSaveSzcatConfig', {
    monthKey: '2026-09',
    tutorialText: '先截图再填表',
    photoFileIds: ['tut.jpg'],
  })
  const copy = await mock.call('adminAddSzcatCopy', {
    title: '报名文案',
    body: '化名奶盖，求指标',
    photoFileIds: ['copy.jpg'],
  })
  const panel = await mock.call('getSzcatPanel')
  assert(panel.officialUrl.indexOf('szcat.org') >= 0, '应有深圳猫网官网')
  assert(panel.cats.some((c) => c.name === '好大声'), '待绝育名单应含好大声')
  assert(panel.config.tutorialText === '先截图再填表', '应保存图文教程')
  assert(panel.config.tutorialPhotoFileIds[0] === 'tut.jpg', '教程应带图')
  assert(panel.copies.some((c) => c._id === copy.copyId && c.body.indexOf('奶盖') >= 0), '应能发布可复制文案')
  await mock.call('adminDeleteSzcatCopy', { copyId: copy.copyId })
  const panelAfter = await mock.call('getSzcatPanel')
  assert(!panelAfter.copies.some((c) => c._id === copy.copyId), '管理员应能删除文案')
  const pack = await mock.call('buildSzcatPack', { catId: 'cat_naigai' })
  assert(pack.text.indexOf('奶盖') >= 0, '资料包应含化名')

  await mock.call('adminUpsertCage', {
    siteId: created.siteId,
    code: 'A1',
    photoFileIds: ['cage.jpg'],
  })
  await mock.call('adminUpsertAsset', {
    siteId: created.siteId,
    name: '带图食盆',
    category: 'bowl',
    quantity: 1,
    photoFileIds: ['asset.jpg'],
  })
  const grayNow = await mock.call('getCatDetail', { catId: 'cat_gray' })
  await mock.call('updateCatProfile', {
    catId: 'cat_gray',
    name: grayNow.cat.name,
    photoFileIds: ['cat.jpg'],
  })
  const sites2 = await mock.call('adminListSites')
  const site2 = sites2.sites.find((s) => s._id === created.siteId)
  assert(site2.cages.some((c) => c.code === 'A1' && c.photoFileIds[0] === 'cage.jpg'), '笼子应能带占用图')
  assert(site2.assets.some((a) => a.name === '带图食盆' && a.photoFileIds[0] === 'asset.jpg'), '固定资产应能带图')
  const gray2 = await mock.call('getCatDetail', { catId: 'cat_gray' })
  assert(gray2.cat.photoFileIds[0] === 'cat.jpg', '猫档应能保存图片')

  await mock.call('adminSetSeekingAdopt', { catId: 'cat_gray', seekingAdopt: true })
  const cand = await mock.call('adminUpsertAdoptCandidate', {
    catId: 'cat_gray',
    name: '阿华',
    status: 'contacting',
    note: '周末可看猫',
    photoFileIds: ['adopt.jpg'],
  })
  const adminGray = await mock.call('getCatDetail', { catId: 'cat_gray' })
  assert(adminGray.canManageAdopt && adminGray.cat.seekingAdopt, '管理员应能看到找领养')
  assert(adminGray.adoptCandidates.some((c) => c._id === cand.candidateId && c.photoFileIds[0] === 'adopt.jpg'), '管理员应能看到候选领养人')
  const seekingList = await mock.call('listCats', { campusStatus: 'seeking_adopt' })
  assert(seekingList.cats.some((c) => c._id === 'cat_gray'), '管理员应按找领养筛选')

  await as('member')
  const memberGray = await mock.call('getCatDetail', { catId: 'cat_gray' })
  assert(!memberGray.canManageAdopt && !memberGray.cat.seekingAdopt, '成员不应看到找领养状态')
  assert(!(memberGray.adoptCandidates || []).length, '成员不应看到候选领养人')
  let adoptBlocked = false
  try {
    await mock.call('adminUpsertAdoptCandidate', { catId: 'cat_gray', name: '路人', status: 'contacting', note: 'x' })
  } catch (e) {
    adoptBlocked = true
  }
  assert(adoptBlocked, '成员不能管理领养词条')
  let seekListBlocked = false
  try {
    await mock.call('listCats', { campusStatus: 'seeking_adopt' })
  } catch (e) {
    seekListBlocked = true
  }
  assert(seekListBlocked, '成员不能按找领养筛名单')

  const memberTasks = await mock.call('listWorkTasks')
  assert(memberTasks.groups.every((g) => g.tasks.length), '成员只看到有任务的分组')
  const openTask = memberTasks.groups.map((g) => g.tasks).reduce((a, b) => a.concat(b), []).find((t) => t.status === 'open')
  if (openTask) {
    assert(openTask.canClaim && !openTask.canSubmit && !openTask.canReview && !openTask.canDelete, '成员可领任务，不能审、不能删')
    const memberDetail = await mock.call('getWorkTask', { taskId: openTask._id })
    assert(memberDetail.task.canClaim && !memberDetail.task.canReview, '成员详情页应能领取')
  }
  const memberPublished = await mock.call('adminPublishWorkTask', { title: '成员发布', content: '整理猫粮' })
  assert(memberPublished.task.publisherTag === '普通成员发布' && memberPublished.task.canDelete, '成员发布应标记且可删除自己的任务')
  const minePublished = await mock.call('listWorkTasks', { mineFilter: 'published' })
  assert(minePublished.groups.some((group) => group.tasks.some((task) => task._id === memberPublished.taskId)), '应能筛出自己发布的任务')
  await mock.call('adminDeleteWorkTask', { taskId: memberPublished.taskId })
  const memberPanel = await mock.call('getSzcatPanel')
  assert(memberPanel.officialUrl.indexOf('szcat.org') >= 0 && !memberPanel.isAdmin, '成员能看绝育准备，不是管理员配置')
  const memberSites = await mock.call('listSites')
  assert(memberSites.sites.length > 0, '成员能看执勤点列表')
  const memberDons2 = await mock.call('listDonations')
  assert(!memberDons2.orgBalance, '成员捐助页仍不应看到组织余额')

  await as('guest')
  let guestApplyEmpty = false
  try {
    await mock.call('applyJoin', { displayName: '' })
  } catch (e) {
    guestApplyEmpty = true
  }
  assert(guestApplyEmpty, '游客不填名字不能申请')
  const joined = await mock.call('applyJoin', { displayName: '新同学' })
  assert(joined.user.role === 'pending' && !joined.user.canApply, '提交后应变成待审核且不能再申请')
  let guestTwice = false
  try {
    await mock.call('applyJoin', { displayName: '再来一次' })
  } catch (e) {
    guestTwice = true
  }
  assert(guestTwice, '每个微信号只能提交一次')
  let guestStillBlocked = false
  try {
    await mock.call('listSites')
  } catch (e) {
    guestStillBlocked = true
  }
  assert(guestStillBlocked, '待审核仍看不到点位')
  let guestNoUpdatesProfile = false
  try {
    await mock.call('updateProfile', { displayName: '改名' })
  } catch (e) {
    guestNoUpdatesProfile = true
  }
  assert(guestNoUpdatesProfile, '未通过审核不能改资料')

  await as('admin')
  const userListed = await mock.call('adminListUsers')
  const selfRow = userListed.users.find((u) => u._id === 'user_admin')
  assert(selfRow && selfRow.isSelf && !selfRow.canChangeRole, '管理员不能改自己')
  assert(!userListed.users.some((u) => u.role === 'guest'), '未申请的游客不应出现在审核列表')
  assert(userListed.users.some((u) => u.displayName === '新同学'), '提交过的人应出现在审核列表')
  let selfBlocked = false
  try {
    await mock.call('adminSetRole', { userId: 'user_admin', role: 'member' })
  } catch (e) {
    selfBlocked = true
  }
  assert(selfBlocked, '改自己身份应失败')
  await mock.call('adminSetRole', { userId: 'user_member', role: 'admin' })
  await mock.call('adminSetRole', { userId: 'user_member', role: 'member' })

  const work = await mock.call('adminListWorkload')
  assert(work.records.some((p) => p.workerName === '演示成员'), '通过的任务应留下工作记录')
  let memberWorkBlocked = false
  await as('member')
  try {
    await mock.call('adminListWorkload')
  } catch (e) {
    memberWorkBlocked = true
  }
  assert(memberWorkBlocked, '成员不能看工作记录与 PF')

  await as('admin')
  const orgPack = await mock.call('adminExportOrgCsv')
  assert(orgPack.csv.indexOf('# 地点') >= 0, '导出应含地点')
  assert(orgPack.csv.indexOf('# 校园猫') >= 0, '导出应含校园猫')
  assert(orgPack.csv.indexOf('# 固定资产') >= 0, '导出应含固定资产')
  assert(orgPack.csv.indexOf('# 捐助记录') >= 0, '导出应含捐助')
  assert(orgPack.csv.indexOf('# 工作记录') >= 0 && orgPack.csv.indexOf('名次') < 0, '导出应含逐条工作记录且无排名')
  assert(orgPack.csv.indexOf('# 点位投喂') >= 0, '导出应包含点位投喂记录')
  assert(orgPack.csv.indexOf('# 机动投喂') >= 0, '导出应包含机动投喂日历记录')
  assert(orgPack.csv.indexOf('# 每日执勤打卡') >= 0 && orgPack.csv.indexOf('cloud://qa/routine-duty/photo.jpg') >= 0, '导出应保留固定执勤及其照片')
  await mock.call('deleteRoutineDuty', { checkinId: routine.checkinId })
  await mock.call('deleteRoutineDuty', { checkinId: routineAdmin.checkinId })
  assert(orgPack.csv.indexOf('cloud://qa/mobile-feed/photo.jpg') >= 0, '导出应保留机动投喂图片文件 ID')
  await mock.call('deleteMobileFeedLog', { logId: mobile.logId })
  assert(orgPack.csv.indexOf('# 猫动态') >= 0, '导出应包含群聊来源的猫动态')
  assert(orgPack.csv.indexOf('需单猫追踪') >= 0, '猫档导出应保留单猫追踪标记')
  assert(orgPack.counts['校园猫'] > 0, '校园猫条数应大于 0')
  assert(orgPack.csv.indexOf('晚间巡笼') < 0, '导出不应含每日任务正文')

  const dailyPub = await mock.call('adminPublishWorkTask', {
    siteId: created.siteId,
    title: '每日补水',
    content: '每天换水',
    scope: 'daily',
  })
  assert(dailyPub.task.scope === 'daily', '应能发每日任务')
  let weeklyFail = false
  try {
    await mock.call('adminPublishWorkTask', { title: '每周未选日期', content: '应失败', scope: 'weekly' })
  } catch (e) {
    weeklyFail = true
  }
  assert(weeklyFail, '每周任务必须选星期')
  const oncePub = await mock.call('adminPublishWorkTask', {
    title: '本周绝育',
    content: '带去医院',
    deadlineDateKey: '2099-12-31',
  })
  const compactList = await mock.call('listWorkTasks')
  assert(compactList.groups.every((group) => group.tasks.length), '任务列表不应铺满空地点卡片')
  assert(oncePub.task.scope === 'once' && oncePub.task.deadlineDateKey === '2099-12-31', '默认单次且可选截止日期')
  const weeklyPub = await mock.call('adminPublishWorkTask', {
    title: '每周整理猫档', content: '按周检查', scope: 'weekly', weekdays: [1, 3],
  })
  assert(weeklyPub.task.scope === 'weekly' && weeklyPub.task.weekdays.length === 2, '应能发指定星期任务')
  const scoped = await mock.call('listWorkTasks', { scope: 'weekly' })
  assert(scoped.groups.length && scoped.groups.every((g) => g.tasks.every((t) => t.scope === 'weekly')), '应按频率筛选')
  const { applyScopeView } = require(path.join(__dirname, '..', 'miniprogram', 'utils', 'taskScope'))
  assert(applyScopeView(weeklyPub.task, '2026-09-23').dueToday, '周三应可领取')
  assert(!applyScopeView(weeklyPub.task, '2026-09-24').dueToday, '周四不可领取')
  await as('member')
  await mock.call('claimWorkTask', { taskId: dailyPub.taskId })
  await mock.call('submitWorkTask', {
    taskId: dailyPub.taskId,
    description: '今日已换',
    workerName: '演示成员',
  })
  await as('admin')
  await mock.call('adminReviewWorkTask', { taskId: dailyPub.taskId, approved: true })
  const dailyDone = await mock.call('listWorkTasks', { siteId: created.siteId })
  const dailyRow = dailyDone.groups[0].tasks.find((t) => t._id === dailyPub.taskId)
  assert(dailyRow && dailyRow.status === 'done', '当日完成后应显示已完成')
  const firstDoneDate = dailyRow.lastDoneDateKey
  const calendarAfterFirst = await mock.call('listTaskCalendar', { monthKey: firstDoneDate.slice(0, 7) })
  assert(calendarAfterFirst.items.some((item) => item.taskId === dailyPub.taskId && item.dateKey === firstDoneDate), '审核通过后应进入组织任务日历')
  const workBefore = await mock.call('adminListWorkload')
  const beforeCount = workBefore.records.filter((p) => p.workerName === '演示成员').length
  await mock.call('advanceMockDay')
  const dailyNext = await mock.call('listWorkTasks', { siteId: created.siteId })
  const dailyOpen = dailyNext.groups[0].tasks.find((t) => t._id === dailyPub.taskId)
  assert(dailyOpen && dailyOpen.status === 'open' && dailyOpen.canClaim, '每日任务第二天应重新待领')
  const onceStill = (await mock.call('getWorkTask', { taskId: oncePub.taskId })).task
  assert(onceStill.scope === 'once' && onceStill.status === 'open', '单次任务不应按天重置')
  await as('member')
  await mock.call('claimWorkTask', { taskId: dailyPub.taskId })
  await mock.call('submitWorkTask', {
    taskId: dailyPub.taskId,
    description: '第二天也换了',
    workerName: '演示成员',
  })
  await as('admin')
  await mock.call('adminReviewWorkTask', { taskId: dailyPub.taskId, approved: true })
  const workAfter = await mock.call('adminListWorkload')
  const afterCount = workAfter.records.filter((p) => p.workerName === '演示成员').length
  assert(afterCount >= beforeCount + 1, '每日任务隔天再做应再记一次出力')
  const secondDoneDate = (await mock.call('getWorkTask', { taskId: dailyPub.taskId })).task.lastDoneDateKey
  const calendarAfterSecond = await mock.call('listTaskCalendar', { monthKey: secondDoneDate.slice(0, 7) })
  assert(secondDoneDate !== firstDoneDate && calendarAfterSecond.items.some((item) => item.taskId === dailyPub.taskId && item.dateKey === secondDoneDate), '每日任务两天完成应在日历分别计数')

  const { forRole } = require(path.join(__dirname, '..', 'miniprogram', 'data', 'guide'))
  const memberGuide = forRole('member')
  const adminGuide = forRole('admin')
  const memberText = JSON.stringify(memberGuide.sections)
  assert(memberGuide.title === '成员指南' && memberGuide.sections.length <= 5, '成员指南应简短且只讲成员用法')
  assert(memberText.indexOf('审核成员') < 0 && memberText.indexOf('导出组织资料') < 0, '成员指南不写管理操作')
  assert(memberText.indexOf('交给管理员') >= 0 && memberText.indexOf('每日') >= 0, '成员指南要讲清怎么做任务')
  const adminText = JSON.stringify(adminGuide.sections)
  assert(adminGuide.sections.length <= 6, '管理员指南应简短')
  assert(adminText.indexOf('审核成员') >= 0 && adminText.indexOf('资料导出') >= 0, '管理员指南要讲审核和备份')
  assert(adminText.indexOf('找领养') >= 0, '管理员指南要讲领养只有管理员能改')

  await as('admin')
  const importedRoster = await mock.call('adminImportRoster')
  assert(importedRoster.counts.credits === 1 && importedRoster.counts.feed === 1, '本地演示只导入假样例')
  const rosterWork = await mock.call('adminListWorkload')
  const chu = rosterWork.records.find((person) => person.sourceKey.indexOf('demo:work:1') === 0)
  assert(chu, '演示工作记录应进入列表')
  await mock.call('adminImportRoster')
  const rosterWorkAgain = await mock.call('adminListWorkload')
  const chuAgain = rosterWorkAgain.records.filter((person) => person.sourceKey === chu.sourceKey)
  assert(chuAgain.length === 1, '重复导入不应重复累计')
  await mock.call('adminSetWorkPf', { sourceKey: chu.sourceKey, pf: 2.5 })
  const scored = await mock.call('adminListWorkload')
  assert(scored.records.find((row) => row.sourceKey === chu.sourceKey).pf === 2.5, '管理员能给历史记录补 PF')
  await mock.call('adminAddWorkRecord', { workerName: '新人成员', dateKey: '2026-09-22', title: '清洗食盆', pf: 1.5 })
  assert((await mock.call('adminListWorkload')).records.some((row) => row.workerName === '新人成员' && row.pf === 1.5), '管理员能记新人 PF')
  const knowledge = await mock.call('adminUpsertKnowledge', {
    kind: 'password', title: '演示门禁', body: '测试口令-仅自检',
  })
  const knowledgeList = await mock.call('adminListKnowledge')
  assert(knowledgeList.rows.some((row) => row._id === knowledge.noteId), '管理员能看到资料标题')
  assert(JSON.stringify(knowledgeList).indexOf('测试口令') < 0, '资料列表不返回密码内容')
  assert((await mock.call('adminGetKnowledge', { noteId: knowledge.noteId })).note.body === '测试口令-仅自检', '管理员能单条查看密码')
  await as('member')
  let secretBlocked = false
  try { await mock.call('adminGetKnowledge', { noteId: knowledge.noteId }) } catch (e) { secretBlocked = true }
  assert(secretBlocked, '普通成员不能取密码内容')
  await as('admin')
  const multi = await mock.call('adminPublishWorkTask', {
    title: '多人执勤自检', content: '两人一起检查', scope: 'daily', allowMultiple: true, maxParticipants: 2,
  })
  await mock.call('claimWorkTask', { taskId: multi.taskId })
  await as('member')
  await mock.call('claimWorkTask', { taskId: multi.taskId })
  const multiView = (await mock.call('getWorkTask', { taskId: multi.taskId })).task
  assert(multiView.participants.length === 2 && multiView.canSubmit, '多人任务允许第二个人领取并看到参与者')
  await mock.call('submitWorkTask', { taskId: multi.taskId, description: '成员已检查', workerName: '演示成员' })
  await as('admin')
  await mock.call('submitWorkTask', { taskId: multi.taskId, description: '管理员也检查', workerName: '演示管理员' })
  const multiReview = (await mock.call('getWorkTask', { taskId: multi.taskId })).task
  const memberPart = multiReview.participants.find((row) => row.workerName === '演示成员')
  assert(multiReview.canReview && memberPart.status === 'review', '管理员能单独审核多人回传')
  await mock.call('adminReviewWorkTask', { taskId: multi.taskId, participantKey: memberPart.key, approved: true })
  const multiDone = (await mock.call('getWorkTask', { taskId: multi.taskId })).task
  assert(multiDone.status === 'done' && !multiDone.canSubmit && !multiDone.canClaim, '首位审核通过即完成整项任务')
  assert(multiDone.participants.find((row) => row.key === memberPart.key).status === 'done', '保留通过者的完成记录')
  let afterDoneBlocked = false
  try { await mock.call('submitWorkTask', { taskId: multi.taskId, description: '完成后新提交', workerName: '演示管理员' }) } catch (e) { afterDoneBlocked = true }
  assert(afterDoneBlocked, '整项完成后不能再新提交')
  const multiAdminPart = (await mock.call('getWorkTask', { taskId: multi.taskId })).task.participants
    .find((row) => row.workerName === '演示管理员' && row.status === 'review')
  assert(multiAdminPart.canReview, '完成前已提交的其他回传仍可审核')
  await mock.call('adminReviewWorkTask', { taskId: multi.taskId, participantKey: multiAdminPart.key, approved: true })
  assert((await mock.call('getWorkTask', { taskId: multi.taskId })).task.status === 'done', '继续审核不会重新打开整项任务')
  const multiCalendar = await mock.call('listTaskCalendar', { monthKey: secondDoneDate.slice(0, 7) })
  const multiCalendarRows = multiCalendar.items.filter((item) => item.taskId === multi.taskId)
  assert(multiCalendarRows.length === 1 && multiCalendarRows[0].approvedCount === 2, '多人任务同日两人通过只算一项')
  const roster = await mock.call('listRoster')
  assert(roster.imported && JSON.stringify(roster.roster).indexOf('密码') < 0, '排班可看且不含门禁密码')
  assert(!roster.roster.bazaar && !roster.roster.care && !roster.roster.publicity, '排班不单列义卖、换药、宣传')
  const taskTitles = (await mock.call('listWorkTasks')).groups
    .reduce((all, group) => all.concat(group.tasks || []), [])
    .map((task) => task.title)
  assert(!taskTitles.some((title) => title.indexOf('义卖') >= 0), '导入不应为义卖单独建任务')
  const loud = await mock.call('getCatDetail', { catId: 'cat_loud' })
  assert(loud.cat.notes.indexOf('自费保险') >= 0, '已有猫应补上保险备注')
  const catList = await mock.call('listCats')
  assert(catList.cats.some((cat) => cat.name === '演示新猫'), '假样例里的新猫应建档')
  await as('member')
  const memberRoster = await mock.call('listRoster')
  assert(memberRoster.imported && !memberRoster.isAdmin, '成员能看排班，不能当管理员导入')

  await mock.call('resetMock')
  console.log('SELFCHECK_OK')
}

main().catch((err) => {
  console.error('SELFCHECK_FAIL', err.message)
  process.exit(1)
})
