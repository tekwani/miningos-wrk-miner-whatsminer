'use strict'

const test = require('brittle')
const WMApiV3 = require('../../workers/lib/protocols/wm-api-v3')

function handler () {
  return new WMApiV3({ rpc: {}, password: 'pw' })
}

test('v3 parseResponse: passes through already-V2 responses', (t) => {
  const h = handler()
  const v2 = { STATUS: 'S', Code: 131, Msg: {} }
  t.is(h.parseResponse(v2, 'summary'), v2)
})

test('v3 parseResponse: summary -> V2 SUMMARY with MH/s conversion', (t) => {
  const h = handler()
  const res = h.parseResponse({
    code: 0,
    when: 123,
    desc: 'get.miner.status',
    msg: { summary: { elapsed: 10, 'hash-average': 100, 'hash-1min': 90, 'hash-15min': 95, 'power-5min': 3000, 'factory-hash': 500 } }
  }, 'summary')
  t.is(res.STATUS, 'S')
  t.is(res.Code, 131)
  t.is(res.SUMMARY[0]['MHS av'], 100 * 1000000, 'TH/s -> MH/s')
  t.is(res.SUMMARY[0]['Factory GHS'], 500 * 1000)
  t.is(res.SUMMARY[0].Power, 3000)
})

test('v3 parseResponse: pools -> V2 POOLS', (t) => {
  const h = handler()
  const res = h.parseResponse({
    code: 0,
    msg: { pools: [{ id: 0, url: 'stratum+tcp://x', status: 'alive', account: 'w1', accepted: 5, rejected: 1 }] }
  }, 'pools')
  t.is(res.POOLS[0].URL, 'stratum+tcp://x')
  t.is(res.POOLS[0].Status, 'Alive', 'status is capitalized')
  t.is(res.POOLS[0].User, 'w1')
  t.is(res.POOLS[0].Accepted, 5)
})

test('v3 parseResponse: edevs -> V2 DEVS with chip temps', (t) => {
  const h = handler()
  const res = h.parseResponse({
    code: 0,
    msg: { edevs: [{ id: 1, slot: 1, 'hash-average': 170, 'factory-hash': 140, freq: 420, 'effective-chips': 288, 'chip-temp-min': 60, 'chip-temp-avg': 65, 'chip-temp-max': 70 }] }
  }, 'edevs')
  t.is(res.DEVS[0].Slot, 1)
  t.is(res.DEVS[0]['MHS av'], 170 * 1000000)
  t.is(res.DEVS[0]['Chip Temp Max'], 70)
})

test('v3 parseResponse: devdetails -> V2 DEVDETAILS', (t) => {
  const h = handler()
  const res = h.parseResponse({
    code: 0,
    msg: { devdetails: [{ slot: 2, id: 2, name: 'SM', driver: 'd', model: 'M' }] }
  }, 'devdetails')
  t.is(res.DEVDETAILS[0].DEVDETAILS, 2)
  t.is(res.DEVDETAILS[0].Model, 'M')
})

test('v3 parseResponse: status/settings -> V2 Msg fields', (t) => {
  const h = handler()
  const res = h.parseResponse({
    code: 0,
    msg: { 'miner-off': 'true', 'power-mode': 'high', 'power-pct': 90, 'liquid-temp': 30 }
  }, 'status')
  t.is(res.Msg.mineroff, 'true')
  t.is(res.Msg.power_mode, 'high')
  t.is(res.Msg.power_pct, '90', 'power_pct stringified')
})

test('v3 parseResponse: non-status object passes through Msg untouched', (t) => {
  const h = handler()
  const res = h.parseResponse({ code: 0, when: 1, msg: { chip: 'C', fw_ver: 'fw' }, desc: 'get.device.info' }, 'get_version')
  t.is(res.Code, 131)
  t.alike(res.Msg, { chip: 'C', fw_ver: 'fw' })
})

test('v3 parseResponse: bare summary/pools/edevs (array/flat form) fallbacks', (t) => {
  const h = handler()
  // summary given flat (not wrapped in {summary})
  const s = h.parseResponse({ code: 0, msg: { elapsed: 5 } }, 'summary')
  t.is(s.SUMMARY[0].Elapsed, 5)
  // pools given as a bare array
  const p = h.parseResponse({ code: 0, msg: [{ id: 0, url: 'u' }] }, 'pools')
  t.is(p.POOLS[0].URL, 'u')
  // edevs given as a bare array
  const e = h.parseResponse({ code: 0, msg: [{ id: 0, slot: 0 }] }, 'edevs')
  t.is(e.DEVS[0].Slot, 0)
})

test('v3 _convert* apply defaults on empty input', (t) => {
  const h = handler()
  const sum = h._convertSummaryFields({})
  t.is(sum['MHS av'], 0)
  t.is(sum.Temperature, 0, 'board-temperature default when absent')
  const pool = h._convertPoolFields({})
  t.is(pool.Status, 'Alive', 'default status when missing')
  t.is(pool.URL, '')
  const det = h._convertDevdetailFields({})
  t.is(det.Name, 'SM', 'default name')
  const setg = h._convertSettingFields({})
  t.is(setg.power_pct, '100', 'default power_pct')
  t.is(setg.power_mode, 'normal')
})

test('v3 parseResponse: board-temperature array takes first element', (t) => {
  const h = handler()
  const res = h.parseResponse({ code: 0, msg: { summary: { 'board-temperature': [55, 60] } } }, 'summary')
  t.is(res.SUMMARY[0].Temperature, 55)
})

test('v3 _convertV3CodeToV2 maps known codes and passes unknown', (t) => {
  const h = handler()
  t.is(h._convertV3CodeToV2(0), 131, 'SUCCESS -> 131')
  t.is(h._convertV3CodeToV2(-2), 14, 'INVALID_COMMAND -> 14')
  t.is(h._convertV3CodeToV2(-4), 135, 'NO_PERMISSION -> 135')
  t.is(h._convertV3CodeToV2(999), 999, 'unknown passes through')
})
