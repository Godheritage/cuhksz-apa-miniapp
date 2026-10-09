const path = require('path')
const mock = require(path.join(__dirname, '..', 'miniprogram', 'mock', 'api'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectFail(action, message) {
  let failed = false
  try {
    await action()
  } catch (error) {
    failed = true
  }
  assert(failed, message)
}

async function assetRows() {
  const pack = await mock.call('adminListSites')
  return pack.sites.reduce((rows, site) => rows.concat(site.assets || []), [])
}

async function main() {
  await mock.call('resetMock')
  await mock.call('switchMockRole', { role: 'admin' })

  const legacy = await mock.call('getCatDetail', { catId: 'cat_loud' })
  assert(legacy.cat.assetId === 'asset_ta_bowl', 'legacy cat keeps assetId')
  assert(JSON.stringify(legacy.cat.assetIds) === JSON.stringify(['asset_ta_bowl']), 'legacy cat gets assetIds fallback')

  const a = (await mock.call('adminUpsertAsset', {
    siteId: 'site_base', name: 'multi asset A', category: 'bowl', quantity: 1,
  })).assetId
  const b = (await mock.call('adminUpsertAsset', {
    siteId: 'site_base', name: 'multi asset B', category: 'water', quantity: 1,
  })).assetId
  const c = (await mock.call('adminUpsertAsset', {
    siteId: 'site_base', name: 'multi asset C', category: 'feeder', quantity: 2,
  })).assetId

  let saved = await mock.call('updateCatLocation', {
    catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetIds: [a, b, a],
  })
  assert(JSON.stringify(saved.assetIds) === JSON.stringify([a, b]), 'duplicate asset IDs are removed')
  let detail = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(JSON.stringify(detail.cat.assetIds) === JSON.stringify([a, b]), 'multiple assets persist')

  await mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetIds: [b] })
  detail = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(JSON.stringify(detail.cat.assetIds) === JSON.stringify([b]), 'removing A keeps B')
  await mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetIds: [] })
  detail = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(detail.cat.assetIds.length === 0 && detail.cat.assetId === '', 'empty assetIds clears all assets')

  await mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetId: a })
  detail = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(JSON.stringify(detail.cat.assetIds) === JSON.stringify([a]), 'legacy request assetId is accepted')
  await expectFail(
    () => mock.call('updateCatLocation', { catId: 'cat_macchiato', siteId: 'site_base', cageId: '', assetIds: [a] }),
    'full asset rejects another cat',
  )
  const other = await mock.call('getCatDetail', { catId: 'cat_macchiato' })
  assert(other.cat.assetIds.length === 0, 'failed full-asset update preserves old data')
  await mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetIds: [] })

  const beforeCross = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  await expectFail(
    () => mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetIds: ['asset_yifu_bowl'] }),
    'cross-site asset rejects',
  )
  const afterCross = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(afterCross.cat.siteId === beforeCross.cat.siteId && afterCross.cat.assetIds.length === 0, 'cross-site failure preserves data')
  await expectFail(
    () => mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: '', cageId: '', assetIds: [b] }),
    'asset without site rejects',
  )

  await mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetIds: [c] })
  await mock.call('updateCatLocation', { catId: 'cat_macchiato', siteId: 'site_base', cageId: '', assetIds: [c] })
  await expectFail(
    () => mock.call('adminUpsertAsset', { assetId: c, siteId: 'site_base', name: 'multi asset C', category: 'feeder', quantity: 1 }),
    'asset quantity cannot drop below occupants',
  )
  const rowsAfterResize = await assetRows()
  assert(rowsAfterResize.find((row) => row._id === c).quantity === 2, 'failed quantity update preserves asset')
  await expectFail(() => mock.call('adminDeleteAsset', { assetId: c }), 'occupied asset cannot be deleted')
  await mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetIds: [] })
  await mock.call('updateCatLocation', { catId: 'cat_macchiato', siteId: 'site_base', cageId: '', assetIds: [] })
  await mock.call('adminDeleteAsset', { assetId: c })

  await mock.call('updateCatLocation', { catId: 'cat_mocha', siteId: 'site_base', cageId: '', assetIds: [a, b] })
  const exported = await mock.call('adminExportOrgCsv')
  assert(exported.csv.indexOf('multi asset A') >= 0 && exported.csv.indexOf('multi asset B') >= 0, 'export contains all cat asset names')
  const exportedCats = exported.files.find((file) => file.title === '校园猫')
  const exportedAssets = exported.files.find((file) => file.title === '固定资产')
  assert(exportedCats && exportedCats.csv.indexOf('multi asset A') >= 0 && exportedCats.csv.indexOf('multi asset B') >= 0, 'cat export contains all asset names')
  const mocha = (await mock.call('getCatDetail', { catId: 'cat_mocha' })).cat.name
  const occupiedRows = exportedAssets.csv.split('\n').filter((line) => line.indexOf('multi asset A') >= 0 || line.indexOf('multi asset B') >= 0)
  assert(occupiedRows.length === 2 && occupiedRows.every((line) => line.indexOf(mocha) >= 0), 'asset export lists cat on every occupied asset')

  await mock.call('markCatHospital', {
    catId: 'cat_mocha', hospitalName: 'mock hospital', reason: 'multi-select test',
    contactName: 'tester', contactPhone: '13800138000', insurancePayer: 'tester',
  })
  detail = await mock.call('getCatDetail', { catId: 'cat_mocha' })
  assert(detail.cat.campusStatus === 'medical' && detail.cat.assetIds.length === 0, 'sending cat to hospital releases all assets')
  const listed = await mock.call('listAssets', { siteId: 'site_base' })
  assert(!listed.assets.find((row) => row._id === a).occupants.some((row) => row._id === 'cat_mocha'), 'released asset no longer lists hospital cat')
  await mock.call('returnCatFromHospital', { catId: 'cat_mocha' })

  await mock.call('resetMock')
  console.log('ASSET_MULTISELECT_OK')
}

main().catch(async (error) => {
  console.error('ASSET_MULTISELECT_FAIL', error.message)
  try { await mock.call('resetMock') } catch (resetError) {}
  process.exit(1)
})
