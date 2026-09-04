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
