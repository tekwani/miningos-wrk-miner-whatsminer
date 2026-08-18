'use strict'

const test = require('brittle')
const WhatsminerMiner = require('../../workers/lib/miner')
const { API_VERSIONS } = require('../../workers/lib/protocols')
const { STATUS, POWER_MODE } = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/constants')

const OK = { Code: 131 }

function buildMiner (opts = {}) {
  const miner = Object.create(WhatsminerMiner.prototype)
  miner.opts = { id: 't', address: '127.0.0.1', port: 4028, type: 'miner-wm-m56s', password: 'pw', ...opts }
  miner.conf = {}
  miner.apiVersion = API_VERSIONS.V2
  miner._cachedPrevHashrate = null
  miner.cachedShares = { accepted: 0, rejected: 0, stale: 0 }
  miner.debugError = () => {}
  return miner
}

// stub the request seams and record the calls
function withWrite (miner, impl) {
  const calls = []
  miner._requestWriteEndpoint = async (cmd, params, json) => {
    calls.push({ cmd, params, json })
    return typeof impl === 'function' ? impl(cmd, params) : impl
  }
  return calls
}
function withRead (miner, byCmd) {
  miner._requestReadEndpoint = async (cmd) => byCmd[cmd]
}

// ---------------------------------------------------------------------------
// pure calc helpers
// ---------------------------------------------------------------------------

test('miner: _getStatus', (t) => {
  const m = buildMiner()
  t.is(m._getStatus(true, { mhs_av: 100 }), STATUS.ERROR)
  t.is(m._getStatus(false, { mhs_av: 100 }), STATUS.MINING)
  t.is(m._getStatus(false, { mhs_av: 0 }), STATUS.SLEEPING)
})

test('miner: _isSuspended', (t) => {
  const m = buildMiner()
  t.is(m._isSuspended({ mhs_av: 0 }), true)
  t.is(m._isSuspended({ mhs_av: 5 }), false)
})

test('miner: _calcPowerW / _calcEfficiency', (t) => {
  const m = buildMiner()
  t.is(m._calcPowerW({ power: '3210.7' }), 3210.7)
  t.is(m._calcEfficiency({ power_rate: '21.678' }), 21.67)
})

test('miner: _getPowerMode', (t) => {
  const m = buildMiner()
  t.is(m._getPowerMode({ mhs_av: 0 }), POWER_MODE.SLEEP)
  t.is(m._getPowerMode({ mhs_av: 10, power_mode: 'Normal' }), 'normal')
})

test('miner: _calcAvgTemp uses devices, falls back to summary, then null', (t) => {
  const m = buildMiner()
  t.is(m._calcAvgTemp([{ chip_temp_avg: '60' }, { chip_temp_avg: '70' }], {}), 65)
  t.is(m._calcAvgTemp([], { chip_temp_avg: '55.5' }), 55.5)
  t.is(m._calcAvgTemp([], {}), null)
})

test('miner: _calcMaxChipTemp uses devices, falls back to summary, then null', (t) => {
  const m = buildMiner()
  t.is(m._calcMaxChipTemp([{ chip_temp_max: '60' }, { chip_temp_max: '80' }], {}), 80)
  t.is(m._calcMaxChipTemp([], { chip_temp_max: '77.9' }), 77.9)
  t.is(m._calcMaxChipTemp([], {}), null)
})

test('miner: _calcHashrates', (t) => {
  const m = buildMiner()
  const hr = m._calcHashrates({ mhs_av: '100.5', target_mhs: '200', mhs_5s: '90', mhs_1m: '95', mhs_5m: '96', mhs_15m: '97' })
  t.is(hr.avg, 100.5)
  t.is(hr.target, 200)
  t.is(hr.t_5s, 90)
})

test('miner: checkIfAllErrorsAreMinor', (t) => {
  t.is(buildMiner({ type: 'miner-wm-m56s' }).checkIfAllErrorsAreMinor([]), true)
  t.is(buildMiner({ type: 'miner-wm-m56s' }).checkIfAllErrorsAreMinor(['999999']), false)
  t.is(buildMiner({ type: 'miner-wm-unknown' }).checkIfAllErrorsAreMinor(['1']), false)
})

test('miner: validateWriteAction', (t) => {
  const m = buildMiner()
  t.is(m.validateWriteAction('setPowerMode', 'normal'), 1)
  t.exception(() => m.validateWriteAction('setPowerMode', 'bogus'), /ERR_SET_POWER_MODE_INVALID/)
  t.is(m.validateWriteAction('downloadLogs'), 1)
})

// ---------------------------------------------------------------------------
// action methods (write)
// ---------------------------------------------------------------------------

const simpleWrites = [
  ['restartMinerSoftware', [], 'restart_btminer'],
  ['factoryReset', [], 'factory_reset'],
  ['enableWebPools', [], 'enable_web_pools'],
  ['disableWebPools', [], 'disable_web_pools'],
  ['setHostname', ['host1'], 'set_hostname'],
  ['setTempOffset', [5], 'set_temp_offset'],
  ['setPowerOffCool', [true], 'set_poweroff_cool'],
  ['setFanZeroSpeed', [false], 'set_fan_zero_speed'],
  ['resumeMining', [], 'power_on'],
  ['setFrequency', [80], 'set_target_freq'],
  ['enableFastBoot', [], 'enable_btminer_fast_boot'],
  ['disableFastBoot', [], 'disable_btminer_fast_boot'],
  ['setPowerLimit', [3000], 'adjust_power_limit'],
  ['setUpfreqSpeed', [2], 'adjust_upfreq_speed']
]

for (const [method, args, cmd] of simpleWrites) {
  test(`miner: ${method} success + failure`, async (t) => {
    const okMiner = buildMiner()
    const calls = withWrite(okMiner, OK)
    const res = await okMiner[method](...args)
    t.is(res.success, true, `${method} returns success`)
    t.is(calls[0].cmd, cmd, `${method} calls ${cmd}`)

    const failMiner = buildMiner()
    withWrite(failMiner, () => { throw new Error('boom') })
    const res2 = await failMiner[method](...args)
    t.is(res2.success, false, `${method} maps error to failure`)
    t.is(res2.error_msg, 'boom')
  })
}

test('miner: updateAdminPassword updates in-memory password on success', async (t) => {
  const m = buildMiner()
  const calls = withWrite(m, OK)
  const res = await m.updateAdminPassword('newpw')
  t.is(res.success, true)
  t.is(calls[0].cmd, 'update_pwd')
  t.is(calls[0].params.old, 'pw')
  t.is(calls[0].params.new, 'newpw')
  t.is(m.opts.password, 'newpw', 'in-memory password updated')
})

test('miner: setZone returns success', async (t) => {
  const m = buildMiner()
  const calls = withWrite(m, OK)
  t.is((await m.setZone('UTC+0', 'UTC')).success, true)
  t.is(calls[0].cmd, 'set_zone')
})

test('miner: reboot fires reboot and returns success', async (t) => {
  const m = buildMiner()
  const calls = withWrite(m, OK)
  t.is(m.reboot().success, true)
  t.is(calls[0].cmd, 'reboot')
})

test('miner: suspendMining fires power_off and returns success', async (t) => {
  const m = buildMiner()
  const calls = withWrite(m, OK)
  t.is(m.suspendMining().success, true)
  t.is(calls[0].cmd, 'power_off')
})

test('miner: setPowerMode low/normal/high powers on then sets mode', async (t) => {
  const m = buildMiner()
  const calls = withWrite(m, OK)
  const res = await m.setPowerMode('high')
  t.is(res.success, true)
  t.is(calls[0].cmd, 'power_on')
  t.is(calls[1].cmd, 'set_high_power')
})

test('miner: setPowerMode sleep suspends', async (t) => {
  const m = buildMiner()
  const calls = withWrite(m, OK)
  const res = await m.setPowerMode(POWER_MODE.SLEEP)
  t.is(res.success, true)
  t.is(calls[0].cmd, 'power_off')
})

test('miner: setPowerMode invalid throws', async (t) => {
  const m = buildMiner()
  withWrite(m, OK)
  await t.exception(() => m.setPowerMode('turbo'), /ERR_INVALID_MODE/)
})

test('miner: setPowerPct normal, >200, and >100 non-liquid', async (t) => {
  const ok = buildMiner()
  const calls = withWrite(ok, OK)
  t.is((await ok.setPowerPct(80)).success, true)
  t.is(calls[0].cmd, 'set_power_pct_v2')

  const over200 = buildMiner()
  withWrite(over200, OK)
  const r2 = await over200.setPowerPct(250)
  t.is(r2.success, false)
  t.ok(/higher than 200/.test(r2.error_msg))

  const over100 = buildMiner({ type: 'miner-wm-m30sp' }) // air-cooled
  withWrite(over100, OK)
  const r3 = await over100.setPowerPct(150)
  t.is(r3.success, false)
  t.ok(/liquid-cooled/.test(r3.error_msg))

  const liquid = buildMiner({ type: 'miner-wm-m56s' }) // immersion, >100 allowed
  const c4 = withWrite(liquid, OK)
  t.is((await liquid.setPowerPct(150)).success, true)
  t.is(c4[0].cmd, 'set_power_pct_v2')
})

test('miner: setLED false and invalid arg', async (t) => {
  const m = buildMiner()
  const calls = withWrite(m, OK)
  t.is((await m.setLED(false)).success, true)
  t.is(calls[0].params.param, 'auto')
  await t.exception(() => m.setLED('yes'), /ERR_INVALID_ARG_TYPE/)
})

test('miner: setLED true issues red+green (timer stubbed)', async (t) => {
  const m = buildMiner()
  const calls = withWrite(m, OK)
  const orig = global.setTimeout
  global.setTimeout = () => 0
  t.teardown(() => { global.setTimeout = orig })
  const res = await m.setLED(true)
  t.is(res.success, true)
  t.is(calls[0].params.color, 'red')
  t.is(calls[1].params.color, 'green')
})

test('miner: setNetworkInformation dhcp and static', async (t) => {
  const dhcp = buildMiner()
  const c1 = withWrite(dhcp, OK)
  t.is((await dhcp.setNetworkInformation({ dhcp: true })).success, true)
  t.is(c1[0].params.param, 'dhcp')

  const stat = buildMiner()
  const c2 = withWrite(stat, OK)
  const res = await stat.setNetworkInformation({ dhcp: false, network: { ip: '10.0.0.2', mask: '255.255.255.0', gateway: '10.0.0.1' }, dns: ['1.1.1.1', '8.8.8.8'] })
  t.is(res.success, true)
  t.is(c2[0].params.ip, '10.0.0.2')
  t.is(c2[0].params.dns, '1.1.1.1 8.8.8.8')
})

test('miner: updateFirmware success and lookup failure', async (t) => {
  const ok = buildMiner()
  ok.opts.findFirmware = async () => ({ id: 'fw1', file: 'x.bin' })
  ok._requestWriteFirmwareEndpoint = async () => OK
  t.is((await ok.updateFirmware('fw1')).success, true)

  const noLookup = buildMiner()
  const res = await noLookup.updateFirmware('fw1')
  t.is(res.success, false)
  t.ok(/ERR_FIRMWARE_LOOKUP_NOT_AVAILABLE/.test(res.error_msg))
})

test('miner: searchFirmwareById requires findFirmware', async (t) => {
  const m = buildMiner()
  await t.exception(() => m.searchFirmwareById('x'), /ERR_FIRMWARE_LOOKUP_NOT_AVAILABLE/)
  m.opts.findFirmware = async (id) => ({ id })
  t.alike(await m.searchFirmwareById('fw9'), { id: 'fw9' })
})

// ---------------------------------------------------------------------------
// read methods
// ---------------------------------------------------------------------------

test('miner: getVersion', async (t) => {
  const m = buildMiner()
  withRead(m, { get_version: { Msg: { chip: 'C', platform: 'P', api_ver: '2.0.5', fw_ver: 'fw1' } } })
  const v = await m.getVersion()
  t.is(v.chip, 'C')
  t.is(v.whatsminer.firmware, 'fw1')
  t.is(v.apiVersion, API_VERSIONS.V2)
})

test('miner: getMinerStatus parses and returns null on bad msg', async (t) => {
  const m = buildMiner()
  withRead(m, { status: { Msg: { mineroff: 'true', power_pct: '90', liquid_temp: '30' } } })
  const s = await m.getMinerStatus()
  t.is(s.mineroff, true)
  t.is(s.power_pct, 90)
  t.is(s.liquid_temp, 30)

  const m2 = buildMiner()
  withRead(m2, { status: { Msg: 'nope' } })
  t.is(await m2.getMinerStatus(), null)
})

test('miner: getMinerStats parses summary and throws without it', async (t) => {
  const m = buildMiner()
  withRead(m, { summary: { SUMMARY: [{ Elapsed: 10, 'MHS av': 500, 'MHS 1m': 490 }] } })
  const s = await m.getMinerStats()
  t.is(s.mhs_av, 500)
  t.is(m._cachedPrevHashrate, s.mhs_5m, 'caches prev hashrate')

  const m2 = buildMiner()
  withRead(m2, { summary: { Code: 45, Msg: 'denied' } })
  await t.exception(() => m2.getMinerStats(), /ERR_MINER_STATS_FAILED/)
})

test('miner: getPools maps and defaults to empty', async (t) => {
  const m = buildMiner()
  withRead(m, { pools: { POOLS: [{ POOL: 0, URL: 'stratum+tcp://x', Status: 'Alive', User: 'w1' }] } })
  const p = await m.getPools()
  t.is(p[0].url, 'stratum+tcp://x')
  t.is(p[0].user, 'w1')

  const m2 = buildMiner()
  withRead(m2, { pools: {} })
  t.alike(await m2.getPools(), [])
})

test('miner: getDevices / getDevicesInfo default to empty', async (t) => {
  const m = buildMiner()
  withRead(m, { edevs: {}, devdetails: {} })
  t.alike(await m.getDevices(), [])
  t.alike(await m.getDevicesInfo(), [])
})

test('miner: getPSUInformation maps fields', async (t) => {
  const m = buildMiner()
  withRead(m, { get_psu: { Msg: { name: 'PSU', hw_version: 'h', sw_version: 's', model: 'M', fan_speed: 3000, iin: '10', vin: '230', serial_no: 'SN', vender: 'V' } } })
  const psu = await m.getPSUInformation()
  t.is(psu.name, 'PSU')
  t.is(psu.version.hardware, 'h')
  t.is(psu.powerInput.voltage, '230')
})

test('miner: getErrors maps error codes', async (t) => {
  const m = buildMiner({ type: 'miner-wm-m56s' })
  withRead(m, { get_error_code: { Msg: { error_code: [{ 2010: 'x' }] } } })
  const errs = await m.getErrors()
  t.is(errs[0].code, '2010')
  t.ok(errs[0].message.includes('2010'))
})

test('miner: getMinerInfo returns Msg', async (t) => {
  const m = buildMiner()
  withRead(m, { get_miner_info: { Msg: { ip: '10.0.0.9' } } })
  t.alike(await m.getMinerInfo(), { ip: '10.0.0.9' })
})
