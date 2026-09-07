'use strict'

const test = require('brittle')
const lWrkFunLogs = require('@tetherto/miningos-tpl-wrk-thing/workers/lib/wrk-fun-logs')
const WrkMinerRack = require('../../workers/lib/worker-base')

const saved = []
lWrkFunLogs.saveLogData = async function (key, ts, data) { saved.push({ key, ts, data }) }

const THINGS = {
  a: {
    info: { container: 'group-16', pos: '16-3_12' },
    last: { snap: { stats: { status: 'mining', hashrate_mhs: { t_1m: 485000992 }, power_w: 7621.05, temperature_c: { max: 69.2, chips: [{ index: 0, max: 68.09 }] } }, config: { power_mode: 'normal' } } }
  },
  b: {
    info: { container: 'group-16', pos: '16-3_13' },
    last: { snap: { stats: { status: 'offline' }, config: {} } }
  },
  c: { info: { container: 'maintenance', pos: '' }, last: { snap: { stats: { status: 'offline' } } } }
}

const rack = (extra = {}) => Object.assign(Object.create(WrkMinerRack.prototype), { ctx: {}, loadLib: () => null, mem: { things: THINGS } }, extra)

test('daily position stats: one row with every heatmap metric per racked position', async (t) => {
  saved.length = 0
  await rack().saveDailyPositionStats(new Date('2026-09-04T00:00:00.500Z'))

  t.is(saved.length, 1)
  t.is(saved[0].key, 'stat-position-1D-t-miner', 'writes its own daily log')
  t.is(saved[0].ts, 1788480000000, 'timestamp floored to the scheduler tick')

  const row = saved[0].data
  t.alike(row.status_group, { 'group-16-16-3_12': 'mining', 'group-16-16-3_13': 'offline' }, 'unpositioned miners skipped')
  t.alike(row.hashrate_mhs_1m_group, { 'group-16-16-3_12': 485000992 })
  t.alike(row.power_w_group, { 'group-16-16-3_12': 7621.05 })
  t.alike(row.power_mode_group, { 'group-16-16-3_12': 'normal' })
  t.alike(row.temperature_c_group, { 'group-16-16-3_12': THINGS.a.last.snap.stats.temperature_c }, 'reading stored as-is')
  t.absent('group-16-16-3_13' in row.temperature_c_group, 'miners with no reading get no cell')
})

test('daily position stats: only the daily stat build writes the log', async (t) => {
  saved.length = 0
  await rack().buildStats('stat-5m', new Date())
  t.is(saved.length, 0, 'no write on the 5m build')

  await rack().buildStats('stat-1D', new Date())
  t.is(saved.length, 1, 'written on the daily build')
})

test('daily position stats: a failed write never blocks the normal stat build', async (t) => {
  const c = rack({ saveDailyPositionStats: async () => { throw new Error('ERR_BOOM') }, debugError: () => {} })
  let built = false
  Object.getPrototypeOf(Object.getPrototypeOf(c)).buildStats = async () => { built = true }

  await c.buildStats('stat-1D', new Date())
  t.ok(built, 'super.buildStats still runs')
})
