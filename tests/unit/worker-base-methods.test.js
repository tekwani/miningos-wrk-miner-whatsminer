'use strict'

const test = require('brittle')
const WrkMinerRack = require('../../workers/lib/worker-base')

const proto = WrkMinerRack.prototype

function ctx (extra = {}) {
  return Object.assign(Object.create(proto), extra)
}

test('worker-base: getThingType / getThingTags / getSpecTags', (t) => {
  const c = ctx()
  t.is(c.getThingType(), 'miner-wm')
  t.alike(c.getThingTags(), ['whatsminer'])
  t.alike(c.getSpecTags(), ['miner'])
})

test('worker-base: getMinerDefaultPort falls back to 4028', (t) => {
  t.is(ctx({ conf: { thing: {} } }).getMinerDefaultPort(), 4028)
  t.is(ctx({ conf: { thing: { minerDefaultPort: 5000 } } }).getMinerDefaultPort(), 5000)
})

test('worker-base: _getDefaultPortForVersion', (t) => {
  const c = ctx()
  t.is(c._getDefaultPortForVersion(null), 4028, 'defaults to 4028 without a version')
  t.is(typeof c._getDefaultPortForVersion('2.0.5'), 'number', 'resolves a port for a version')
})

test('worker-base: getNominalEficiencyWThs uses config then defaults', (t) => {
  const fromConf = ctx({ conf: { thing: { miner: { nominalEfficiencyWThs: { 'miner-wm': 42 } } } } })
  t.is(fromConf.getNominalEficiencyWThs(), 42)
  // no config and base type not in the default (model-keyed) map -> undefined
  t.is(ctx({ conf: { thing: { miner: {} } } }).getNominalEficiencyWThs(), undefined)
})

test('worker-base: collectThingSnap delegates to the controller', async (t) => {
  const c = ctx()
  const thg = { ctrl: { getSnap: async () => ({ ok: 1 }) } }
  t.alike(await c.collectThingSnap(thg), { ok: 1 })
})

test('worker-base: registerThingHook0 records apiVersion from opts', async (t) => {
  const c = ctx({ conf: { thing: {} } })
  // location outside a container makes the super hook a no-op (no IP work)
  const thg = { info: { location: 'site1.rack' }, opts: { apiVersion: '2.0.5' } }
  await c.registerThingHook0(thg)
  t.is(thg.info.apiVersion, '2.0.5')

  const noVer = { info: { location: 'site1.rack' }, opts: {} }
  await c.registerThingHook0(noVer)
  t.absent(noVer.info.apiVersion)
})

test('worker-base: updateThingHook0 syncs apiVersion from opts', async (t) => {
  const c = ctx({ conf: { thing: {} }, debugError: () => {} })
  const thg = { info: { container: 'c1', pos: 'p', apiVersion: '2.0.5' }, opts: { address: '10.0.0.1', apiVersion: '3.0.3' } }
  const thgPrev = { info: { container: 'c1', pos: 'p', apiVersion: '2.0.5' }, opts: { address: '10.0.0.1' } }
  await c.updateThingHook0(thg, thgPrev)
  t.is(thg.info.apiVersion, '3.0.3', 'info.apiVersion updated to the new opts value')
})

test('worker-base: getFirmwareById throws when not found', async (t) => {
  const c = ctx({ conf: { thing: {} }, listFirmwares: async () => [] })
  await t.exception(() => c.getFirmwareById('missing'), /ERR_FIRMWARE_NOT_FOUND/)
})

test('worker-base: getFirmwareById returns the file and rejects a missing file', async (t) => {
  const fs = require('fs/promises')
  const os = require('os')
  const path = require('path')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wm-fw-'))
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }))
  await fs.writeFile(path.join(dir, 'a.bin'), 'fw')

  const found = ctx({
    conf: { thing: { dirFirmwares: dir } },
    listFirmwares: async () => [{ id: '1', file: 'a.bin' }]
  })
  t.is(await found.getFirmwareById('1'), path.join(dir, 'a.bin'))

  const missing = ctx({
    conf: { thing: { dirFirmwares: dir } },
    listFirmwares: async () => [{ id: '2', file: 'nope.bin' }]
  })
  await t.exception(() => missing.getFirmwareById('2'), /ERR_FIRMWARE_FILE_NOT_FOUND/)
})

test('worker-base: getMinerApiRes validates serial, setup, and api name', async (t) => {
  const c = ctx({ mem: { things: {} } })
  await t.exception(() => c.getMinerApiRes({}), /ERR_INVALID_MINER_SERIAL/)
  await t.exception(() => c.getMinerApiRes({ serialNum: 's1', api: 'summary' }), /ERR_MINER_NOT_FOUND/)

  c.mem.things.a = { info: { serialNum: 's1' } }
  await t.exception(() => c.getMinerApiRes({ serialNum: 's1', api: 'summary' }), /ERR_MINER_NOT_SETUP/)

  c.mem.things.a.ctrl = { apiRes: {} }
  await t.exception(() => c.getMinerApiRes({ serialNum: 's1' }), /ERR_INVALID_MINER_API/)
  await t.exception(() => c.getMinerApiRes({ serialNum: 's1', api: 'summary' }), /ERR_INVALID_MINER_API/)

  c.mem.things.a.ctrl.apiRes.summary = { Code: 131 }
  t.alike(await c.getMinerApiRes({ serialNum: 's1', api: 'summary' }), { Code: 131 })
})
