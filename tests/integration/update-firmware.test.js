'use strict'

const test = require('brittle')
const fs = require('fs')
const path = require('path')
const os = require('os')
const Miner = require('../../workers/lib/miner')
const TcpFacility = require('@tetherto/svc-facs-tcp')
const srv = require('../../mock/server')

const PORT = 14030
const HOST = '127.0.0.1'
const PASSWORD = 'admin'
const SERIAL = 'TESTFW001'
const FIRMWARE_ID = 'fw-001'

let mockServer
let miner
let tmpDir
let firmwareFile

test('updateFirmware - setup', async (t) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-fw-test-'))
  firmwareFile = path.join(tmpDir, 'test-firmware.bin')
  fs.writeFileSync(firmwareFile, Buffer.alloc(1024, 0x55))

  mockServer = srv.createServer({
    host: HOST,
    port: PORT,
    type: 'M56s',
    serial: SERIAL,
    password: PASSWORD,
    apiVersion: 'v2'
  })

  miner = new Miner({
    timeout: 5000,
    socketer: {
      readStrategy: TcpFacility.TCP_READ_STRATEGY.ON_END,
      rpc: (opts) => new TcpFacility().getRPC(opts)
    },
    address: HOST,
    port: PORT,
    password: PASSWORD,
    id: 'test-fw',
    apiVersion: '2.0.5',
    findFirmware: async (id) => {
      if (id === FIRMWARE_ID) return firmwareFile
      throw new Error('ERR_FIRMWARE_NOT_FOUND')
    }
  })

  await miner.init()
  t.ok(miner.protocolHandler, 'should have protocol handler')
})

test('updateFirmware - success', async (t) => {
  const result = await miner.updateFirmware(FIRMWARE_ID)

  t.ok(result, 'should return result')
  t.ok(result.data, 'should have data')
  t.is(result.data.Code, 131, 'should have success code')
  t.is(result.data.Msg, 'Updated', 'should report updated')
})

test('updateFirmware - firmware not found returns error', async (t) => {
  const result = await miner.updateFirmware('unknown-id')

  t.ok(result, 'should return result')
  t.is(result.success, false, 'should indicate failure')
  t.ok(result.error_msg, 'should have error message')
  t.ok(result.error_msg.includes('ERR_FIRMWARE_NOT_FOUND'), 'error should identify firmware not found')
})

test('updateFirmware - cleanup', async (t) => {
  try { await miner.close() } catch (e) {}
  try { mockServer.exit() } catch (e) {}
  try { fs.rmSync(tmpDir, { recursive: true }) } catch (e) {}
  t.ok(true, 'cleanup complete')
})
