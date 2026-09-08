'use strict'

const test = require('brittle')
const Miner = require('../../workers/lib/miner')
const TcpFacility = require('@tetherto/svc-facs-tcp')
const srv = require('../../mock/server')

const HOST = '127.0.0.1'
const PASSWORD = 'admin'
const LOG_SUFFIX = '--- End of Log ---\n'

let nextPort = 14060

// Boots a mock miner (with optional download-logs fault injection) and a Miner instance
async function setup (t, { dlFault = null, dlLogSizeBytes = null, dlPayloadFormat = null, minerConf = {}, getLogCoreManager } = {}) {
  const port = nextPort++
  const mock = srv.createServer({
    host: HOST,
    port,
    type: 'M56s',
    serial: 'TESTDL01',
    password: PASSWORD,
    apiVersion: 'v2',
    dlFault,
    dlLogSizeBytes,
    dlPayloadFormat
  })

  const miner = new Miner({
    timeout: 5000,
    socketer: {
      readStrategy: TcpFacility.TCP_READ_STRATEGY.ON_END,
      rpc: (opts) => new TcpFacility().getRPC(opts)
    },
    address: HOST,
    port,
    password: PASSWORD,
    id: 'test-dl',
    apiVersion: '2.0.5',
    conf: minerConf,
    getLogCoreManager
  })
  await miner.init()

  t.teardown(async () => {
    await miner.close().catch(() => {})
    mock.exit()
  })

  return { mock, miner }
}

function assertFullLog (t, result) {
  t.ok(result, 'should resolve with a result')
  t.ok(Buffer.isBuffer(result.logBuffer), 'should return a Buffer')
  t.is(result.logBuffer.length, result.logFileLen, 'buffer length should match header logfilelen')
  t.ok(result.logBuffer.toString().endsWith(LOG_SUFFIX), 'log content should be complete (not truncated)')
}

test('downloadLogs - happy path (small payload)', async (t) => {
  const { miner } = await setup(t)
  const result = await miner._requestDownloadLogs()
  assertFullLog(t, result)
})

test('downloadLogs - large payload spanning many TCP segments (1 MB)', async (t) => {
  const { miner } = await setup(t, { dlLogSizeBytes: 1024 * 1024 })
  const result = await miner._requestDownloadLogs()
  assertFullLog(t, result)
  t.is(result.logFileLen, 1024 * 1024, 'should receive the full 1 MB')
})

test('downloadLogs - JSON header and binary coalesced into one TCP segment', async (t) => {
  const { miner } = await setup(t, { dlFault: 'coalesce' })
  const result = await miner._requestDownloadLogs()
  assertFullLog(t, result)
})

test('downloadLogs - JSON header split across TCP segments', async (t) => {
  const { miner } = await setup(t, { dlFault: 'split-json' })
  const result = await miner._requestDownloadLogs()
  assertFullLog(t, result)
})

test('downloadLogs - slow binary delivery (chunked with pauses) still completes', async (t) => {
  const { miner } = await setup(t, { dlFault: 'slow' })
  const result = await miner._requestDownloadLogs()
  assertFullLog(t, result)
})

test('downloadLogs - transient truncation recovers via retry', async (t) => {
  const { miner } = await setup(t, { dlFault: 'truncate-once' })
  const result = await miner._requestDownloadLogs()
  assertFullLog(t, result)
})

test('downloadLogs - persistent truncation surfaces a distinct error (no silent partial data)', async (t) => {
  const { miner } = await setup(t, { dlFault: 'truncate' })
  await t.exception(
    () => miner._requestDownloadLogs(),
    /ERR_DOWNLOAD_LOGS_INCOMPLETE/,
    'should reject with ERR_DOWNLOAD_LOGS_INCOMPLETE instead of resolving truncated data'
  )
})

test('downloadLogs - empty log returns ERR_DOWNLOAD_LOGS_EMPTY', async (t) => {
  const { miner } = await setup(t, { dlFault: 'empty' })
  await t.exception(
    () => miner._requestDownloadLogs(),
    /ERR_DOWNLOAD_LOGS_EMPTY/,
    'should reject with ERR_DOWNLOAD_LOGS_EMPTY'
  )
})

test('downloadLogs - malformed header returns ERR_DOWNLOAD_LOGS_PARSE_FAILED', async (t) => {
  const { miner } = await setup(t, { dlFault: 'malformed' })
  await t.exception(
    () => miner._requestDownloadLogs(),
    /ERR_DOWNLOAD_LOGS_PARSE_FAILED/,
    'should reject with ERR_DOWNLOAD_LOGS_PARSE_FAILED'
  )
})

test('downloadLogs - stalled binary phase times out with ERR_DOWNLOAD_LOGS_TIMEOUT', async (t) => {
  const { miner } = await setup(t, {
    dlFault: 'stall',
    minerConf: { downloadLogsTimeoutMs: 500 }
  })
  await t.exception(
    () => miner._requestDownloadLogs(),
    /ERR_DOWNLOAD_LOGS_TIMEOUT/,
    'should reject with ERR_DOWNLOAD_LOGS_TIMEOUT'
  )
})

test('downloadLogs - repeated downloads on the same miner are deterministic', async (t) => {
  const { miner } = await setup(t)
  for (let i = 0; i < 10; i++) {
    const result = await miner._requestDownloadLogs()
    assertFullLog(t, result)
  }
})

function fakeLogCoreManager () {
  const served = []
  return {
    served,
    serveLog: async (logBuffer, minerId) => {
      served.push(logBuffer)
      return {
        coreKey: 'a'.repeat(64),
        discoveryKey: 'b'.repeat(64),
        byteLength: logBuffer.length,
        minerId,
        expiresAt: Date.now() + 60000
      }
    }
  }
}

test('downloadLogs - action result declares .log/text for a plain-text payload', async (t) => {
  const manager = fakeLogCoreManager()
  const { miner } = await setup(t, { getLogCoreManager: () => manager })
  miner._saveResponseFile = () => {}

  const res = await miner.downloadLogs()
  t.is(res.success, true)
  t.ok(/^miner-log-test-dl-\d+\.log$/.test(res.data.fileName), `fileName should be miner-log-<id>-<ts>.log, got ${res.data.fileName}`)
  t.is(res.data.contentType, 'text/plain; charset=utf-8')
  t.is(res.data.byteLength, manager.served[0].length)
  t.ok(manager.served[0].toString().endsWith(LOG_SUFFIX), 'served payload should be untouched')
})

test('downloadLogs - action result declares .tar.gz/gzip for an archive payload', async (t) => {
  const manager = fakeLogCoreManager()
  const { miner } = await setup(t, { dlPayloadFormat: 'tar.gz', getLogCoreManager: () => manager })
  miner._saveResponseFile = () => {}

  const res = await miner.downloadLogs()
  t.is(res.success, true)
  t.ok(/^miner-log-test-dl-\d+\.tar\.gz$/.test(res.data.fileName), `fileName should be miner-log-<id>-<ts>.tar.gz, got ${res.data.fileName}`)
  t.is(res.data.contentType, 'application/gzip')
  t.is(manager.served[0][0], 0x1f, 'served payload should still be the raw gzip bytes')
  t.is(manager.served[0][1], 0x8b, 'served payload should still be the raw gzip bytes')
  t.is(res.data.byteLength, manager.served[0].length)
})
