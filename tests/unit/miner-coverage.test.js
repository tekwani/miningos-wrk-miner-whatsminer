'use strict'

const test = require('brittle')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const WhatsminerMiner = require('../../workers/lib/miner')
const { API_VERSIONS } = require('../../workers/lib/protocols')
const { aesEncrypt } = require('../../workers/lib/utils/crypto')
const { RESPONSE_CODES_V2 } = require('../../workers/lib/protocols/constants')

const OK = { Code: 131 }

function buildMiner (opts = {}) {
  const miner = Object.create(WhatsminerMiner.prototype)
  miner.opts = { id: 't', address: '127.0.0.1', port: 4028, type: 'miner-wm-m56s', password: 'pw', username: 'super', ...opts }
  miner.conf = {}
  miner.apiVersion = API_VERSIONS.V2
  miner.apiRes = {}
  miner._cachedPrevHashrate = null
  miner.cachedShares = { accepted: 0, rejected: 0, stale: 0 }
  miner.debugError = () => {}
  return miner
}

function listen (onConnection) {
  const sockets = new Set()
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
      onConnection(socket)
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.trackedSockets = sockets
      resolve(server)
    })
  })
}

function closeServer (server) {
  if (!server.listening) return Promise.resolve()
  for (const socket of server.trackedSockets || []) socket.destroy()
  return new Promise((resolve) => server.close(() => resolve()))
}

function encrypted (obj, key) {
  return JSON.stringify({ enc: aesEncrypt(JSON.stringify(obj), key) })
}

function frameV3 (payload) {
  const body = Buffer.from(JSON.stringify(payload))
  const frame = Buffer.alloc(4 + body.length)
  frame.writeUInt32LE(body.length, 0)
  body.copy(frame, 4)
  return frame
}

test('miner: init detects a version when none was configured', async (t) => {
  const m = buildMiner()
  m.apiVersion = null
  m.rpc = {}
  await m.init()
  t.is(m.apiVersion, API_VERSIONS.V2)
  t.ok(m.protocolHandler)
})

test('miner: _detectApiVersion uses the port, then probes, then defaults to v2', async (t) => {
  const v3 = buildMiner({ port: 4433 })
  t.is(await v3._detectApiVersion(), API_VERSIONS.V3)

  const v2 = buildMiner({ port: 4028 })
  t.is(await v2._detectApiVersion(), API_VERSIONS.V2)

  const probed = buildMiner({ port: 5000 })
  probed._execCommand = async (cmd) => {
    if (cmd === 'get_token') throw new Error('no v2')
    return { Msg: { salt: 'x' } }
  }
  t.is(await probed._detectApiVersion(), API_VERSIONS.V3)

  const down = buildMiner({ port: 5000 })
  down._execCommand = async () => { throw new Error('down') }
  t.is(await down._detectApiVersion(), API_VERSIONS.V2)
})

test('miner: _execCommand sends json and parses the reply', async (t) => {
  const m = buildMiner()
  m.rpc = {
    request: async (body) => JSON.stringify({ echo: JSON.parse(body).cmd, Msg: 'ok' })
  }
  t.alike(await m._execCommand('get_token'), { echo: 'get_token', Msg: 'ok' })
})

test('miner: close stops the rpc client', async (t) => {
  const m = buildMiner()
  let stopped = false
  m.rpc = { stop: async () => { stopped = true } }
  await m.close()
  t.ok(stopped)
})

test('miner: token getter and setter delegate to the protocol handler', (t) => {
  const m = buildMiner()
  t.is(m.token, undefined)
  m.token = undefined

  let cleared = false
  m.protocolHandler = {
    getTokenInfo: () => ({ token: 't', sign: 's', key: 'k' }),
    clearToken: () => { cleared = true }
  }
  t.is(m.token.token, 't')
  m.token = 'keep'
  t.absent(cleared)
  m.token = undefined
  t.ok(cleared)
})

test('miner: _getToken and _refreshToken', async (t) => {
  const m = buildMiner()
  m.protocolHandler = {
    authenticate: async () => ({ token: 't' }),
    refreshToken: async () => {}
  }
  t.alike(await m._getToken(), { token: 't' })
  await m._refreshToken()

  m.protocolHandler.refreshToken = async () => { throw new Error('refresh failed') }
  await t.exception(() => m._refreshToken(), /refresh failed/)
})

test('miner: _requestMiner parses json unless asked not to', async (t) => {
  const m = buildMiner()
  m.rpc = { request: async (body) => body }
  t.alike(await m._requestMiner({ cmd: 'summary' }), { cmd: 'summary' })
  t.is(await m._requestMiner({ cmd: 'summary' }, false), '{"cmd":"summary"}')
  t.ok(m._lastSeen)
})

test('miner: read and write endpoints store params and a null write', async (t) => {
  const m = buildMiner()
  m.conf.storeMinerApiData = true
  m.protocolHandler = {
    transformCommand: (cmd) => cmd,
    getStatusParam: (cmd) => (cmd === 'edevs' ? 'edevs' : null),
    requestRead: async (cmd, params) => ({ Code: 131, cmd, param: params.param }),
    requestWrite: async (cmd, params, json) => (json ? { Code: 131, cmd, params } : null),
    parseResponse: (res) => res
  }
  const read = await m._requestReadEndpoint('edevs')
  t.is(read.param, 'edevs')
  t.is(m.apiRes.edevs.cmd, 'edevs')

  const write = await m._requestWriteEndpoint('reboot', { respbefore: 'true' }, true)
  t.is(write.cmd, 'reboot')
  t.is(await m._requestWriteEndpoint('reboot', {}, false), null)
})

test('miner: _requestWriteFirmwareEndpoint refreshes a missing token', async (t) => {
  const m = buildMiner()
  let info
  m.protocolHandler = {
    getTokenInfo: () => info,
    refreshToken: async () => { info = { sign: 'sig', key: 'k' } },
    transformCommand: (cmd) => cmd
  }
  m.getVersion = async () => ({ platform: 'CV' })
  let passed
  m._requestUpdateMiner = async (...args) => {
    passed = args
    return OK
  }
  t.alike(await m._requestWriteFirmwareEndpoint('/tmp/fw.bin'), OK)
  t.is(passed[3], 'cv')
  t.ok(passed[0].includes('"enc"'))
})

test('miner: _requestUpdateMiner uploads firmware after the miner is ready', async (t) => {
  const key = 'fw-key'
  const file = path.join(os.tmpdir(), `wm-fw-${process.pid}.bin`)
  fs.writeFileSync(file, Buffer.alloc(64, 1))
  t.teardown(() => fs.rmSync(file, { force: true }))

  const server = await listen((socket) => {
    socket.once('data', () => {
      socket.write(encrypted({ Code: 131, Msg: 'ready' }, key))
      socket.once('data', () => {
        socket.write(encrypted({ Code: 131, Msg: 'updated' }, key))
      })
    })
  })
  t.teardown(() => closeServer(server))

  const m = buildMiner({ port: server.address().port })
  const res = await m._requestUpdateMiner(encrypted({ cmd: 'update_firmware' }, key), file, key, 'cv')
  t.is(res.Msg, 'updated')
})

test('miner: _requestUpdateMiner rejects a bad reply, a bad file, and a refused connection', async (t) => {
  const key = 'fw-key'
  const badJson = await listen((socket) => {
    socket.once('data', () => socket.write('not-json'))
  })
  t.teardown(() => closeServer(badJson))
  const m1 = buildMiner({ port: badJson.address().port })
  await t.exception.all(() => m1._requestUpdateMiner('{}', '/no/such/file', key, 'cv'), /JSON/)

  const badFile = await listen((socket) => {
    socket.once('data', () => socket.write(encrypted({ Code: 131, Msg: 'ready' }, key)))
  })
  t.teardown(() => closeServer(badFile))
  const m2 = buildMiner({ port: badFile.address().port })
  await t.exception(() => m2._requestUpdateMiner('{}', path.join(os.tmpdir(), 'missing-fw.bin'), key, 'cv'))

  const closed = await listen(() => {})
  const port = closed.address().port
  await closeServer(closed)
  const m3 = buildMiner({ port })
  await t.exception(() => m3._requestUpdateMiner('{}', '/no/such/file', key, 'cv'), /ECONNREFUSED/)
})

test('miner: setPools writes, skips an unchanged config, and reports write errors', async (t) => {
  const changed = buildMiner()
  changed.getPools = async () => [{ url: 'stratum+tcp://old', user: 'old', worker_password: 'x' }]
  let rebooted = false
  changed.reboot = () => { rebooted = true }
  let written
  changed._requestWriteEndpoint = async (cmd, params) => {
    written = { cmd, params }
    return OK
  }
  const res = await changed.setPools([
    { url: 'stratum+tcp://new', worker_name: 'w', worker_password: 'p' }
  ], false)
  t.is(res.success, true)
  t.ok(rebooted)
  t.is(written.cmd, 'update_pools')
  t.is(written.params.pool1, 'stratum+tcp://new')
  t.is(written.params.worker1, 'w')
  t.is(written.params.pool2, '')

  const same = buildMiner()
  same.getPools = async () => [
    { url: 'stratum+tcp://a', user: 'w.t', worker_password: 'p' },
    { url: '', user: '', worker_password: '' },
    { url: '', user: '', worker_password: '' }
  ]
  same.reboot = () => t.fail('should not reboot identical pools')
  const skipped = await same.setPools([
    { url: 'stratum+tcp://a', worker_name: 'w', worker_password: 'p' }
  ], true)
  t.is(skipped.success, true)
  t.is(skipped.message, 'Pools are same, skipping')

  const failing = buildMiner()
  failing.getPools = async () => []
  failing._requestWriteEndpoint = async () => { throw new Error('write failed') }
  const err = await failing.setPools([
    { url: 'stratum+tcp://a', worker_name: 'w', worker_password: 'p' }
  ], false)
  t.is(err.success, false)
  t.is(err.error_msg, 'write failed')
})

test('miner: prePowerOn polls until the miner reports complete', async (t) => {
  const m = buildMiner()
  let n = 0
  m._requestWriteEndpoint = async () => {
    n++
    if (n === 1) throw new Error('not yet')
    return { Code: 131, Msg: { complete: 'true' } }
  }
  const res = await m.prePowerOn()
  t.is(res.success, true)
  t.is(n, 2)
})

test('miner: write helpers return the error message when the call fails', async (t) => {
  const fail = async () => { throw new Error('nope') }

  const zone = buildMiner()
  zone._requestWriteEndpoint = fail
  t.is((await zone.setZone('UTC', 'UTC')).error_msg, 'nope')

  const pct = buildMiner()
  pct._requestWriteEndpoint = fail
  t.is((await pct.setPowerPct(80)).error_msg, 'nope')

  const mode = buildMiner()
  mode._requestWriteEndpoint = async (cmd) => {
    if (cmd === 'power_on') throw new Error('power')
    return OK
  }
  t.is((await mode.setPowerMode('low')).success, true)

  const led = buildMiner()
  led._requestWriteEndpoint = fail
  t.is((await led.setLED(false)).error_msg, 'nope')

  const netInfo = buildMiner()
  netInfo._requestWriteEndpoint = fail
  t.is((await netInfo.setNetworkInformation({ dhcp: true })).error_msg, 'nope')

  const other = buildMiner()
  t.is(other.validateWriteAction('setLED', true), 1)
})

test('miner: setLED true turns the leds off again when the timer fires', async (t) => {
  const m = buildMiner()
  const calls = []
  m._requestWriteEndpoint = async (cmd, params) => {
    calls.push(params)
    return OK
  }
  const orig = global.setTimeout
  global.setTimeout = (fn) => {
    fn()
    return 0
  }
  try {
    t.is((await m.setLED(true)).success, true)
  } finally {
    global.setTimeout = orig
  }
  t.is(calls[0].color, 'red')
  t.is(calls[2].param, 'auto')
})

test('miner: getDevicesInfo maps a populated devdetails response', async (t) => {
  const m = buildMiner()
  m._requestReadEndpoint = async () => ({
    DEVDETAILS: [{ DEVDETAILS: 0, Name: 'board', ID: 1, Driver: 'uart', Kernel: 'k', Model: 'M56' }]
  })
  const info = await m.getDevicesInfo()
  t.is(info[0].name, 'board')
  t.is(info[0].model, 'M56')
})

test('miner: _getV3ChipTemps reads a length-prefixed edevs frame', async (t) => {
  const payload = { code: 0, msg: { edevs: [{ slot: 1, 'chip-temp-max': 70 }] } }
  const frame = frameV3(payload)
  const server = await listen((socket) => {
    socket.once('data', () => {
      socket.write(frame.subarray(0, 2))
      setImmediate(() => socket.write(frame.subarray(2)))
    })
  })
  t.teardown(() => closeServer(server))

  const m = buildMiner({ port: 1, timeout: 200 })
  m.conf.v3ApiPort = server.address().port
  const edevs = await m._getV3ChipTemps()
  t.is(edevs[0].slot, 1)
  t.is(edevs[0]['chip-temp-max'], 70)
})

test('miner: _getV3ChipTemps returns null, and rejects bad, huge, or timed out replies', async (t) => {
  const empty = await listen((socket) => {
    socket.once('data', () => socket.write(frameV3({ code: 0, msg: {} })))
  })
  t.teardown(() => closeServer(empty))
  const mEmpty = buildMiner({ timeout: 200 })
  mEmpty.conf.v3ApiPort = empty.address().port
  t.is(await mEmpty._getV3ChipTemps(), null)

  const broken = await listen((socket) => {
    socket.once('data', () => {
      const body = Buffer.from('{')
      const frame = Buffer.alloc(4 + body.length)
      frame.writeUInt32LE(body.length, 0)
      body.copy(frame, 4)
      socket.write(frame)
    })
  })
  t.teardown(() => closeServer(broken))
  const mBroken = buildMiner({ timeout: 200 })
  mBroken.conf.v3ApiPort = broken.address().port
  await t.exception.all(() => mBroken._getV3ChipTemps(), /JSON/)

  const huge = await listen((socket) => {
    socket.once('data', () => {
      const header = Buffer.alloc(4)
      header.writeUInt32LE(5 * 1024 * 1024, 0)
      socket.write(header)
    })
  })
  t.teardown(() => closeServer(huge))
  const mHuge = buildMiner({ timeout: 200 })
  mHuge.conf.v3ApiPort = huge.address().port
  await t.exception(() => mHuge._getV3ChipTemps(), /ERR_V3_EDEVS_RESPONSE_TOO_LARGE/)

  const silent = await listen(() => {})
  t.teardown(() => closeServer(silent))
  const mSilent = buildMiner({ timeout: 30 })
  mSilent.conf.v3ApiPort = silent.address().port
  await t.exception(() => mSilent._getV3ChipTemps(), /ERR_V3_EDEVS_TIMEOUT/)

  const refused = buildMiner({ address: '127.0.0.1', timeout: 200 })
  refused.conf.v3ApiPort = 1
  await t.exception(() => refused._getV3ChipTemps())
})

test('miner: _isTransientDownloadError and _buildDownloadLogsCmd', (t) => {
  const m = buildMiner()
  t.ok(m._isTransientDownloadError(new Error('ERR_DOWNLOAD_LOGS_INCOMPLETE: x')))
  t.ok(m._isTransientDownloadError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })))
  t.absent(m._isTransientDownloadError(new Error('ERR_DOWNLOAD_LOGS_EMPTY')))

  m.protocolHandler = {
    transformCommand: (cmd) => cmd,
    getTokenInfo: () => ({ sign: 'sig', key: 'k' })
  }
  const v2 = m._buildDownloadLogsCmd()
  t.is(v2.decryptionKey, 'k')
  t.ok(v2.encCmd.includes('"enc":1'))

  m.apiVersion = API_VERSIONS.V3
  m.protocolHandler.generateTokenInfo = () => ({ token: 'tok', key: 'k3', ts: 123 })
  const v3 = m._buildDownloadLogsCmd()
  t.is(v3.decryptionKey, 'k3')
  t.ok(v3.encCmd.includes('"enc":1'))
})

test('miner: _requestDownloadLogs retries a dead token and a dropped connection', async (t) => {
  const m = buildMiner()
  let info
  m.protocolHandler = {
    transformCommand: (cmd) => cmd,
    getTokenInfo: () => info,
    clearToken: () => { info = undefined },
    refreshToken: async () => { info = { sign: 'sig', key: 'k' } }
  }
  let n = 0
  m._socketDownloadLogs = async () => {
    n++
    if (n === 1) {
      const err = new Error('expired')
      err.responseCode = RESPONSE_CODES_V2.TOKEN_EXPIRED
      throw err
    }
    if (n === 2) {
      const err = new Error('ERR_DOWNLOAD_LOGS_CONNECT_FAILED: reset')
      err.code = 'ECONNRESET'
      throw err
    }
    return { logFileLen: 1, logBuffer: Buffer.from('z') }
  }
  const res = await m._requestDownloadLogs()
  t.is(res.logBuffer.toString(), 'z')
  t.is(n, 3)

  const fatal = buildMiner()
  fatal.protocolHandler = {
    transformCommand: (cmd) => cmd,
    getTokenInfo: () => ({ sign: 's', key: 'k' })
  }
  fatal._socketDownloadLogs = async () => { throw new Error('ERR_DOWNLOAD_LOGS_EMPTY') }
  await t.exception(() => fatal._requestDownloadLogs(), /ERR_DOWNLOAD_LOGS_EMPTY/)
})

test('miner: _socketDownloadLogs reads a header plus the binary log', async (t) => {
  const header = Buffer.from('\n ' + JSON.stringify({ Code: 131, Msg: { logfilelen: '4', note: 'a\\b' } }))
  const payload = Buffer.from('LOG!')
  const server = await listen((socket) => {
    socket.once('data', () => {
      socket.write(header.subarray(0, 8))
      setImmediate(() => socket.end(Buffer.concat([header.subarray(8), payload])))
    })
  })
  t.teardown(() => closeServer(server))

  const m = buildMiner({ port: server.address().port })
  m.conf.downloadLogsTimeoutMs = 1000
  m.protocolHandler = { isResponseOK: (res) => res?.Code === 131 }
  const res = await m._socketDownloadLogs('{}', 'k')
  t.is(res.logFileLen, 4)
  t.is(res.logBuffer.toString(), 'LOG!')
})

test('miner: _socketDownloadLogs rejects miner errors, empty logs, and short transfers', async (t) => {
  async function once (write, message) {
    const server = await listen((socket) => {
      socket.once('data', () => write(socket))
    })
    t.teardown(() => closeServer(server))
    const m = buildMiner({ port: server.address().port })
    m.conf.downloadLogsTimeoutMs = 300
    m.protocolHandler = { isResponseOK: (res) => res?.Code === 131 }
    await t.exception(() => m._socketDownloadLogs('{}', 'k'), message)
  }

  await once((socket) => {
    socket.end(JSON.stringify({ Code: 135, Msg: {} }))
  }, /ERR_DOWNLOAD_LOGS_FAILED: Code 135/)

  await once((socket) => {
    socket.end(JSON.stringify({ Code: 131, Msg: { logfilelen: '0' } }))
  }, /ERR_DOWNLOAD_LOGS_EMPTY/)

  await once((socket) => {
    socket.end('not json')
  }, /ERR_DOWNLOAD_LOGS_PARSE_FAILED/)

  await once((socket) => {
    socket.end(JSON.stringify({ Code: 131, Msg: { logfilelen: '100' } }) + 'xx')
  }, /ERR_DOWNLOAD_LOGS_INCOMPLETE/)

  const huge = await listen((socket) => {
    socket.once('data', () => socket.write('{' + ' '.repeat(70 * 1024)))
  })
  t.teardown(() => closeServer(huge))
  const mHuge = buildMiner({ port: huge.address().port })
  mHuge.conf.downloadLogsTimeoutMs = 1000
  mHuge.protocolHandler = { isResponseOK: () => true }
  await t.exception(() => mHuge._socketDownloadLogs('{}', 'k'), /ERR_DOWNLOAD_LOGS_PARSE_FAILED/)

  const closed = await listen(() => {})
  const port = closed.address().port
  await closeServer(closed)
  const refused = buildMiner({ port })
  refused.conf.downloadLogsTimeoutMs = 300
  refused.protocolHandler = { isResponseOK: () => true }
  await t.exception(() => refused._socketDownloadLogs('{}', 'k'), /ERR_DOWNLOAD_LOGS_CONNECT_FAILED/)
})

test('miner: downloadLogs publishes the buffer and keeps a metadata file', async (t) => {
  const m = buildMiner()
  m._requestDownloadLogs = async () => ({ logBuffer: Buffer.from('hello log') })
  m._getLogCoreManager = () => ({
    serveLog: async (buf, id) => ({ coreKey: 'ck', discoveryKey: 'dk', byteLength: buf.length, minerId: id })
  })
  const logsDir = path.join(process.cwd(), 'logs')
  const existed = fs.existsSync(logsDir)
  const before = existed ? new Set(fs.readdirSync(logsDir)) : new Set()

  const res = await m.downloadLogs()
  t.is(res.success, true)
  t.ok(res.data.fileName.endsWith('.log'))
  t.is(res.data.minerId, 't')

  const created = fs.readdirSync(logsDir).filter((name) => !before.has(name))
  t.ok(created.length >= 1)
  for (const name of created) fs.unlinkSync(path.join(logsDir, name))
  if (!existed && fs.readdirSync(logsDir).length === 0) fs.rmdirSync(logsDir)

  const circular = {}
  circular.self = circular
  m._saveResponseFile(circular)

  m._getLogCoreManager = () => null
  t.is((await m.downloadLogs()).success, false)
  t.ok(/ERR_LOG_CORE_MANAGER_NOT_READY/.test((await m.downloadLogs()).error_msg))

  m._requestDownloadLogs = async () => { throw new Error('transfer failed') }
  t.is((await m.downloadLogs()).error_msg, 'transfer failed')
})
