'use strict'

const { getDefaultConf, testExecutor } = require('miningos-tpl-wrk-miner/tests/miner.test')
const Miner = require('../workers/lib/miner')
const TcpFacility = require('svc-facs-tcp')
const srv = require('../mock/server')
const crypto = require('crypto')

let mockServer
const conf = getDefaultConf()
if (!conf.settings.live) {
  conf.settings.host = '127.0.0.1'
  conf.settings.password = crypto.randomBytes(5).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 5)
  mockServer = srv.createServer({ host: conf.settings.host, port: conf.settings.port, type: 'M56s', serial: '1234567890', password: conf.settings.password })
}

const miner = new Miner({
  timeout: 1000,
  socketer: {
    readStrategy: TcpFacility.TCP_READ_STRATEGY.ON_END,
    rpc: (opts) => {
      return new TcpFacility().getRPC(opts)
    }
  },
  address: conf.settings.host,
  port: conf.settings.port,
  password: conf.settings.password,
  id: '001'
})

conf.cleanup = async () => {
  try {
    await miner.close()
  } catch (e) {
    // Ignore errors during cleanup
  }
  try {
    mockServer.exit()
  } catch (e) {
    // Ignore errors during cleanup
  }
}

const execute = async () => {
  try {
    await testExecutor(miner, conf)
  } finally {
    // Ensure cleanup is called
    if (conf.cleanup) {
      await conf.cleanup()
    }
    // Give time for connections to close
    await new Promise(resolve => setTimeout(resolve, 2000))
    process.exit(0)
  }
}

execute().catch(err => {
  console.error(err)
  process.exit(1)
})
