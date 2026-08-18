'use strict'

const test = require('brittle')
const WrkMinerRack = require('../../workers/lib/worker-base')

function makeCtx (minerConf = {}) {
  const ctx = { conf: { thing: { miner: minerConf } } }
  ctx._getThingCredentials = WrkMinerRack.prototype._getThingCredentials.bind(ctx)
  return ctx
}

test('_getThingCredentials prefers thing opts over config defaults', (t) => {
  const ctx = makeCtx({ defaultUsername: 'confuser', defaultPassword: 'confpass' })
  const thg = { opts: { username: 'optsuser', password: 'optspass' } }
  t.alike(ctx._getThingCredentials(thg), { username: 'optsuser', password: 'optspass' })
})

test('_getThingCredentials falls back to config defaults when opts are missing', (t) => {
  const ctx = makeCtx({ defaultUsername: 'confuser', defaultPassword: 'confpass' })
  const thg = { opts: {} }
  t.alike(ctx._getThingCredentials(thg), { username: 'confuser', password: 'confpass' })
})

test('_getThingCredentials mixes opts and defaults per field', (t) => {
  const ctx = makeCtx({ defaultUsername: 'confuser', defaultPassword: 'confpass' })
  const thg = { opts: { password: 'optspass' } }
  t.alike(ctx._getThingCredentials(thg), { username: 'confuser', password: 'optspass' })
})

test('_getThingCredentials returns undefined when neither opts nor defaults are set', (t) => {
  const ctx = makeCtx()
  const thg = { opts: {} }
  t.alike(ctx._getThingCredentials(thg), { username: undefined, password: undefined })
})

test('_getThingCredentials handles missing miner conf section', (t) => {
  const ctx = { conf: { thing: {} } }
  ctx._getThingCredentials = WrkMinerRack.prototype._getThingCredentials.bind(ctx)
  const thg = { opts: { password: 'p' } }
  t.alike(ctx._getThingCredentials(thg), { username: undefined, password: 'p' })
})

// connectThing guard: a thing may connect on defaultPassword alone, but must be
// blocked when no password can be resolved at all.

function makeConnectCtx (minerConf = {}) {
  const ctx = {
    conf: { thing: { miner: minerConf } },
    tcp_0: { getRPC: () => ({}) },
    logCoreManager: null,
    getNominalEficiencyWThs: () => 0,
    getFirmwareById: () => {},
    debugThingError: () => {}
  }
  ctx._getThingCredentials = WrkMinerRack.prototype._getThingCredentials.bind(ctx)
  ctx.connectThing = WrkMinerRack.prototype.connectThing.bind(ctx)
  return ctx
}

test('connectThing returns 0 when no password can be resolved (opts nor defaults)', async (t) => {
  const ctx = makeConnectCtx()
  const thg = { opts: { address: '10.0.0.1', port: 4028 }, info: {} }
  t.is(await ctx.connectThing(thg), 0)
  t.absent(thg.ctrl, 'no controller created')
})

test('connectThing connects using defaultPassword when the thing has no opts.password', async (t) => {
  const ctx = makeConnectCtx({ defaultUsername: 'confuser', defaultPassword: 'confpass' })
  // apiVersion is set so init() skips network detection
  const thg = { id: 't1', type: 'miner', opts: { address: '10.0.0.1', port: 4028, apiVersion: '2.0.5' }, info: {} }
  const res = await ctx.connectThing(thg)
  t.is(res, 1, 'connected')
  t.ok(thg.ctrl, 'controller created')
  t.is(thg.ctrl.opts.password, 'confpass', 'controller built with the default password')
  t.is(thg.ctrl.opts.username, 'confuser', 'controller built with the default username')
})
