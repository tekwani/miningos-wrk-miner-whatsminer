'use strict'

const test = require('brittle')
const WhatsminerMiner = require('../../workers/lib/miner')
const WMApiV2 = require('../../workers/lib/protocols/wm-api-v2')
const { API_VERSIONS } = require('../../workers/lib/protocols')
const { STATUS } = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/constants')

// Raw responses captured from a live v3-firmware WhatsMiner (fw 20260312.16.REL3)
// answering on the v2-compat API port 4028. Compared to classic v2 firmware the
// summary omits `MHS 5s`, `MHS 5m` and `Target MHS`, and edevs carry no `ASC`
// index and no per-board `Chip Temp Min/Max/Avg` — the miner-level chip temps
// are only present in summary.
const REL3_RESPONSES = {
  get_version: {
    STATUS: 'S',
    When: 1786628533,
    Code: 131,
    Msg: {
      api_ver: '2.2.2',
      fw_ver: '20260312.16.REL3',
      platform: 'H616',
      chip: 'KAAP315-2601 BINVLC-199004E',
      miner_type: 'M7BS_VM30'
    },
    Description: ''
  },
  summary: {
    STATUS: 'S',
    When: 1786628534,
    Code: 131,
    Msg: {
      Elapsed: 10658.685546875,
      'MHS av': 692030656,
      'MHS 1m': 692632192,
      'MHS 15m': 692005440,
      'HS RT': 692632192,
      freq_avg: 419.217041015625,
      'Fan Speed In': 0,
      'Fan Speed Out': 0,
      Power: 9763.263333333334,
      'Power Rate': 14.103324890136719,
      'Pool Rejected%': 0,
      Uptime: 12927,
      'Hash Stable': 'true',
      'Hash Stable Cost Seconds': 1299,
      'Target Freq': 0,
      'Env Temp': 45.562,
      'Power Mode': 'High',
      'Factory GHS': 560974,
      'Power Limit': 9758,
      'Chip Temp Min': 57.628570556640625,
      'Chip Temp Max': 77.70713806152344,
      'Chip Temp Avg': 67.5,
      Debug: '15.8 6.9/1.8 6.9/1.8 7.0/1.8 6A:100.0/0.06/0.0/0.0',
      'Btminer Fast Boot': 'disable'
    },
    Description: ''
  },
  edevs: {
    STATUS: [{ STATUS: 'S', Msg: '4 ASC(s)' }],
    DEVS: [
      {
        Slot: 0,
        Temperature: 65.31,
        'Chip Frequency': 413,
        'MHS av': 170.62,
        'MHS 1m': 170.75,
        'MHS 15m': 170.51,
        'HS RT': 170.75,
        'Factory GHS': 139930,
        'Upfreq Complete': 1,
        'Effective Chips': 288,
        'PCB SN': 'BMM7BSFF306311K40019',
        'Chip Data': 'KAAP315-2601 BINVLC-199004E'
      },
      {
        Slot: 1,
        Temperature: 65.31,
        'Chip Frequency': 424,
        'MHS av': 175.49,
        'MHS 1m': 175.6,
        'MHS 15m': 175.47,
        'HS RT': 175.6,
        'Factory GHS': 139930,
        'Upfreq Complete': 1,
        'Effective Chips': 288,
        'PCB SN': 'BMM7BSFF306311K40019',
        'Chip Data': 'KAAP315-2601 BINVLC-199004E'
      },
      {
        Slot: 2,
        Temperature: 54.81,
        'Chip Frequency': 425,
        'MHS av': 175.56,
        'MHS 1m': 175.85,
        'MHS 15m': 175.61,
        'HS RT': 175.85,
        'Factory GHS': 140557,
        'Upfreq Complete': 1,
        'Effective Chips': 288,
        'PCB SN': 'BMM7BSFF306311K40020',
        'Chip Data': 'KAAP315-2601 BINVLC-199004E'
      },
      {
        Slot: 3,
        Temperature: 54.81,
        'Chip Frequency': 413,
        'MHS av': 170.35,
        'MHS 1m': 170.43,
        'MHS 15m': 170.41,
        'HS RT': 170.43,
        'Factory GHS': 140557,
        'Upfreq Complete': 1,
        'Effective Chips': 288,
        'PCB SN': 'BMM7BSFF306311K40020',
        'Chip Data': 'KAAP315-2601 BINVLC-199004E'
      }
    ],
    id: 1
  },
  pools: {
    STATUS: [{ STATUS: 'S', Msg: '1 Pool(s)' }],
    POOLS: [
      {
        POOL: 1,
        URL: 'stratum+tcp://btc.f2pool.com:1314',
        Status: 'Alive',
        Priority: 0,
        Quota: 1,
        Getworks: 574,
        Accepted: 432,
        Rejected: 0,
        Discarded: 0,
        Stale: 0,
        'Get Failures': 0,
        'Remote Failures': 0,
        User: 'haven7346.M7bS_test',
        'Last Share Time': 1786628523,
        'Stratum Active': true,
        'Stratum Difficulty': 4194304,
        'Pool Rejected%': 0,
        'Pool Stale%': 0,
        'Bad Work': 20,
        'To Remove': false
      }
    ],
    id: 1
  },
  status: {
    STATUS: 'S',
    When: 1786628536,
    Code: 131,
    Msg: {
      mineroff: 'false',
      mineroff_reason: '',
      mineroff_time: '',
      FirmwareVersion: '20260312.16.REL3',
      power_mode: 'high',
      power_limit_set: '10030',
      hash_percent: '0',
      fast_mining: 'false',
      fast_hash: 'false',
      liquid_temp: 49,
      power_pct: 120
    },
    Description: ''
  },
  get_miner_info: {
    STATUS: 'S',
    When: 1786628536,
    Code: 131,
    Msg: {
      ip: '10.0.44.105',
      proto: 'dhcp',
      netmask: '255.255.255.0',
      gateway: '10.0.44.1',
      dns: '10.0.44.1',
      hostname: 'WhatsMiner',
      mac: 'A0:5B:06:00:36:60',
      ledstat: '1,200,100,0 0,200,100,0 ',
      minersn: 'BTM7BS30FA26031256090407244H05947',
      powersn: '2F260200665',
      upfreq_speed: '0'
    },
    Description: ''
  },
  get_error_code: {
    STATUS: 'S',
    When: 1786628537,
    Code: 131,
    Msg: { error_code: [] },
    Description: ''
  }
}

// Captured from the same miner's native v3 API (port 4433):
// get.miner.status param edevs — the real per-board chip temps the
// v2-compat edevs no longer carry.
const REL3_V3_EDEVS = [
  { id: 0, slot: 0, 'hash-average': 170.39, 'factory-hash': 139.93, freq: 413.0592956542969, 'effective-chips': 288, 'chip-temp-min': 68, 'chip-temp-avg': 72, 'chip-temp-max': 77.8 },
  { id: 1, slot: 1, 'hash-average': 175.626, 'factory-hash': 139.93, freq: 424.81365966796875, 'effective-chips': 288, 'chip-temp-min': 57.8, 'chip-temp-avg': 63, 'chip-temp-max': 68.6 },
  { id: 2, slot: 2, 'hash-average': 175.483, 'factory-hash': 140.557, freq: 425.5421142578125, 'effective-chips': 288, 'chip-temp-min': 58.9, 'chip-temp-avg': 63, 'chip-temp-max': 68.6 },
  { id: 3, slot: 3, 'hash-average': 170.442, 'factory-hash': 140.557, freq: 413.45306396484375, 'effective-chips': 288, 'chip-temp-min': 67.7, 'chip-temp-avg': 72, 'chip-temp-max': 78 }
]

function buildMiner (responses, v3Edevs) {
  const miner = Object.create(WhatsminerMiner.prototype)
  miner.opts = { id: 'test-rel3', address: '127.0.0.1', port: 4028, type: 'miner-wm-m7bs', password: 'pw' }
  miner.conf = {}
  miner.apiVersion = API_VERSIONS.V2
  miner._cachedPrevHashrate = null
  miner.cachedShares = { accepted: 0, rejected: 0, stale: 0 }
  miner.debugError = () => {}
  miner.updateLastSeen = () => {}
  miner._handleErrorUpdates = () => {}
  miner.v3ChipTempCalls = 0
  miner._getV3ChipTemps = async () => {
    miner.v3ChipTempCalls++
    if (!v3Edevs) throw new Error('ECONNREFUSED')
    return v3Edevs
  }
  miner.protocolHandler = new WMApiV2({
    rpc: { request: async (payload) => JSON.stringify(responses[JSON.parse(payload).cmd]) },
    password: 'pw',
    debugError: () => {}
  })
  return miner
}

test('rel3 v2-compat - snap has no null hashrate/temperature/frequency', async (t) => {
  const miner = buildMiner(REL3_RESPONSES, REL3_V3_EDEVS)
  // Serialize like the worker does so NaN becomes null in assertions
  const snap = JSON.parse(JSON.stringify(await miner._prepSnap()))

  t.is(snap.stats.status, STATUS.MINING, 'status is mining')
  t.is(snap.stats.hashrate_mhs.avg, 692030656, 'avg from MHS av')
  t.is(snap.stats.hashrate_mhs.t_5s, 692632192, 't_5s falls back to HS RT')
  t.is(snap.stats.hashrate_mhs.t_1m, 692632192, 't_1m from MHS 1m')
  t.is(snap.stats.hashrate_mhs.t_5m, 692632192, 't_5m falls back to MHS 1m')
  t.is(snap.stats.hashrate_mhs.t_15m, 692005440, 't_15m from MHS 15m')
  t.is(snap.stats.hashrate_mhs.target, 560974000, 'target falls back to Factory GHS * 1000')

  t.is(snap.stats.temperature_c.max, 78, 'max chip temp from v3-supplemented boards')
  t.is(snap.stats.temperature_c.avg, 67.5, 'avg chip temp from v3-supplemented boards')
  t.is(snap.stats.temperature_c.ambient, 45.56, 'ambient from Env Temp')
  t.alike(
    snap.stats.temperature_c.pcb,
    [
      { index: 0, current: 65.31 },
      { index: 1, current: 65.31 },
      { index: 2, current: 54.81 },
      { index: 3, current: 54.81 }
    ],
    'board temps from edevs Temperature'
  )
  // v2-compat edevs omit per-board chip temps — the real values come from
  // the native v3 API supplement
  t.alike(
    snap.stats.temperature_c.chips,
    [
      { index: 0, max: 77.8, min: 68, avg: 72 },
      { index: 1, max: 68.59, min: 57.8, avg: 63 },
      { index: 2, max: 68.59, min: 58.9, avg: 63 },
      { index: 3, max: 78, min: 67.7, avg: 72 }
    ],
    'real chip temps from the v3 edevs supplement'
  )
  t.is(miner.v3ChipTempCalls, 1, 'v3 supplement fetched once')

  t.is(snap.stats.frequency_mhz.avg, 419.21, 'freq avg from summary freq_avg')
  t.is(snap.stats.frequency_mhz.target, 0, 'a real 0 Target Freq stays 0')
  t.is(snap.stats.frequency_mhz.chips[0].current, 413, 'chip frequency from edevs')

  t.is(snap.stats.power_w, 9763.26, 'power from summary Power')
  t.is(snap.stats.efficiency_w_ths, 14.1, 'efficiency from summary Power Rate')
  t.is(snap.stats.uptime_ms, 10658685.546875, 'uptime from Elapsed')
  t.alike(
    snap.stats.pool_status,
    [{ pool: 'stratum+tcp://btc.f2pool.com:1314', accepted: 432, rejected: 0, stale: 0 }],
    'pool shares from v2-compat pools'
  )

  t.is(snap.config.power_mode, 'high', 'power mode from status')
  t.is(snap.config.suspended, false, 'not suspended')
  t.is(snap.config.led_status, true, 'led status from ledstat')
  t.is(snap.config.firmware_ver, '20260312.16.REL3', 'firmware version')
})

test('rel3 v2-compat - getDevices index falls back to Slot', async (t) => {
  const miner = buildMiner(REL3_RESPONSES)
  const devices = await miner.getDevices()

  t.is(devices.length, 4)
  t.alike(devices.map((d) => d.index), [0, 1, 2, 3], 'index from Slot when ASC is absent')
})

test('classic v2 - summary fallbacks do not override native fields', async (t) => {
  const summary = {
    ...REL3_RESPONSES.summary,
    Msg: {
      ...REL3_RESPONSES.summary.Msg,
      'MHS 5s': 111,
      'MHS 5m': 222,
      'Target MHS': 333
    }
  }
  const miner = buildMiner({ ...REL3_RESPONSES, summary })
  const stats = await miner.getMinerStats()

  t.is(stats.mhs_5s, 111, 'MHS 5s used when present')
  t.is(stats.mhs_5m, 222, 'MHS 5m used when present')
  t.is(stats.target_mhs, 333, 'Target MHS used when present')
})

test('rel3 v2-compat - chip temps stay null when the v3 API is unreachable', async (t) => {
  const miner = buildMiner(REL3_RESPONSES)
  const snap = JSON.parse(JSON.stringify(await miner._prepSnap()))

  t.is(miner.v3ChipTempCalls, 1, 'v3 supplement attempted')
  // No approximation: missing chip temps stay null, not the board sensor
  t.alike(snap.stats.temperature_c.chips[0], { index: 0, max: null, min: null, avg: null })
  t.is(snap.stats.temperature_c.max, 77.7, 'miner-level max falls back to summary Chip Temp Max')
  t.is(snap.stats.temperature_c.avg, 67.5, 'miner-level avg falls back to summary Chip Temp Avg')
})

test('classic v2 - v3 supplement is skipped when edevs already report chip temps', async (t) => {
  const edevs = JSON.parse(JSON.stringify(REL3_RESPONSES.edevs))
  edevs.DEVS.forEach((dev, i) => {
    dev['Chip Temp Min'] = 50 + i
    dev['Chip Temp Max'] = 90 + i
    dev['Chip Temp Avg'] = 70 + i
  })
  const miner = buildMiner({ ...REL3_RESPONSES, edevs }, REL3_V3_EDEVS)
  const snap = JSON.parse(JSON.stringify(await miner._prepSnap()))

  t.is(miner.v3ChipTempCalls, 0, 'no v3 request when v2 data is complete')
  t.alike(
    snap.stats.temperature_c.chips[0],
    { index: 0, max: 90, min: 50, avg: 70 },
    'chip temps from v2 edevs'
  )
})

test('classic v2 - per-device chip temps take precedence over summary', (t) => {
  const miner = buildMiner(REL3_RESPONSES)
  const devices = [
    { chip_temp_max: 80.129, chip_temp_avg: 70.017 },
    { chip_temp_max: 75.5, chip_temp_avg: 68.5 }
  ]
  const stats = { chip_temp_max: 99, chip_temp_avg: 99 }

  t.is(miner._calcMaxChipTemp(devices, stats), 80.12, 'max from devices')
  t.is(miner._calcAvgTemp(devices, stats), 69.25, 'avg from devices')
})
