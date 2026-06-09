'use strict'

const net = require('net')
const fs = require('fs')
const path = require('path')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const debug = require('debug')('mock')
const CryptoJS = require('crypto-js')
const { decryptCommand, encryptResponse } = require('./utils')
const MockControlAgent = require('./mock-control-agent')
const { promiseSleep } = require('@bitfinex/lib-js-util-promise')
const md5 = require('../workers/lib/utils/md5')

const MINER_TYPES = ['m63', 'm56s', 'm53s', 'm30sp', 'm30spp', 'm63spp']
const SALT = '5QAHiKMb'

/**
 * Generates encryption key from password (V2 - MD5 based)
 */
const generateEncryptionKeyV2 = (password) => {
  const key = md5.crypt(password, SALT)
  const arr = key.split('$')
  return arr[arr.length - 1]
}

/**
 * Generates encryption key from password (V3 - SHA256 based)
 */
const generateEncryptionKeyV3 = (password) => {
  // V3 uses SHA256(password + salt)
  return CryptoJS.SHA256(password + SALT).toString()
}

/**
 * Generates encryption key based on API version
 */
const generateEncryptionKey = (password, apiVersion) => {
  if (apiVersion === 'v3') {
    return generateEncryptionKeyV3(password)
  }
  return generateEncryptionKeyV2(password)
}

/**
 * Finds the first existing path from a list of paths
 */
const findExistingPath = (paths) => {
  for (const p of paths) {
    const fullPath = path.resolve(__dirname, p) + '.js'
    if (fs.existsSync(fullPath)) {
      return p
    }
  }
  return null
}

/**
 * Sends an error response to the socket
 */
const sendErrorResponse = async (socket, code, msg, encryptionKey, isEncrypted, delay) => {
  const resp = {
    STATUS: 'E',
    When: +new Date(),
    Code: code,
    Msg: msg,
    Description: ''
  }

  if (delay) await promiseSleep(delay)

  if (isEncrypted) {
    socket.write(JSON.stringify(encryptResponse(resp, encryptionKey)))
  } else {
    socket.write(JSON.stringify(resp))
  }
  socket.destroy()
}

/**
 * Sends a response to the socket
 */
const sendResponse = async (socket, data, encryptionKey, isEncrypted, delay) => {
  if (delay) await promiseSleep(delay)

  if (isEncrypted) {
    socket.write(encryptResponse(data, encryptionKey))
  } else {
    socket.write(JSON.stringify(data))
  }
  socket.destroy()
}

/**
 * Validates token for encrypted commands
 */
const validateToken = (cmd, validTokens, hasPassword) => {
  if (!cmd.token) return false
  if (hasPassword) return true // Accept any non-empty token when password is provided
  return validTokens.has(cmd.token)
}

/**
 * Creates a mock control agent
 */
const createMockControlAgent = (things, mockControlPort) => {
  return new MockControlAgent({
    thgs: things,
    port: mockControlPort
  })
}

if (require.main === module) {
  const argv = yargs(hideBin(process.argv))
    .option('port', { alias: 'p', type: 'number', description: 'port to run on', default: 4028 })
    .option('host', { alias: 'h', type: 'string', description: 'host to run on', default: '127.0.0.1' })
    .option('type', { description: 'miner type', type: 'string' })
    .option('serial', { description: 'serial number', type: 'string', default: 'HHM38S98302B24K40073' })
    .option('mockControlPort', { description: 'mock control port port', type: 'number' })
    .option('delay', { description: 'delay in ms', type: 'number', default: 0 })
    .option('bulk', { description: 'bulk file', type: 'string' })
    .option('error', { description: 'send errored response', type: 'boolean', default: false })
    .option('minerpoolMockPort', { type: 'number', description: 'minerpool mock port', default: 8000 })
    .option('minerpoolMockHost', { type: 'string', description: 'minerpool mock host', default: '127.0.0.1' })
    .option('apiVersion', { description: 'API version (v2 or v3)', type: 'string', default: 'v2' })
    .parse()

  const things = argv.bulk ? JSON.parse(fs.readFileSync(argv.bulk)) : [argv]
  const agent = createMockControlAgent(things, argv.mockControlPort)
  agent.init(runServer)
} else {
  module.exports = {
    createServer ({ port, host, type, serial, password, apiVersion }) {
      return runServer({ port, host, type, serial, password, apiVersion })
    }
  }
}

function runServer (argv, ops = {}) {
  const apiVersion = argv.apiVersion || 'v2'
  const defaultPassword = apiVersion === 'v3' ? 'super' : 'admin'

  const CTX = {
    host: argv.host,
    port: argv.port,
    type: argv.type,
    serial: argv.serial,
    delay: argv.delay,
    error: argv.error,
    minerpoolMockPort: argv.minerpoolMockPort,
    minerpoolMockHost: argv.minerpoolMockHost,
    password: argv.password || defaultPassword,
    apiVersion
  }

  const STATE = {}
  const validTokens = new Set()
  const encryptionKey = generateEncryptionKey(CTX.password, CTX.apiVersion)

  // Add validTokens to CTX so commands can add tokens
  CTX.validTokens = validTokens
  CTX.encryptionKey = encryptionKey

  if (!MINER_TYPES.includes(CTX.type?.toLowerCase())) {
    throw Error('ERR_UNSUPPORTED')
  }

  // Load initial state (model-specific takes priority over default)
  const statePaths = [`./initial_states/${CTX.type.toLowerCase()}`, './initial_states/default']
  const statePath = findExistingPath(statePaths)

  if (!statePath) {
    throw Error('ERR_INVALID_STATE')
  }

  try {
    debug(new Date(), `Loading initial state from ${statePath}`)
    Object.assign(STATE, require(statePath)(CTX))
  } catch (e) {
    throw Error('ERR_INVALID_STATE')
  }

  const processCmd = async (socket, chunk, socketCtx) => {
    const req = JSON.parse(chunk.toString())
    const id = req.ctx?.mockControl?.generateId()
    const isEncrypted = req.enc === 1
    let cmd

    // Handle encrypted commands
    if (isEncrypted) {
      try {
        cmd = decryptCommand(req, encryptionKey)
      } catch (e) {
        return sendErrorResponse(socket, 23, 'json cmd err', encryptionKey, true, CTX.delay)
      }

      if (!cmd) {
        return sendErrorResponse(socket, 135, 'check token err', encryptionKey, true, CTX.delay)
      }

      // Validate token
      if (!validateToken(cmd, validTokens, !!CTX.password)) {
        return sendErrorResponse(socket, 135, 'check token err', encryptionKey, true, CTX.delay)
      }

      // Store token for future validation
      if (cmd.token) {
        validTokens.add(cmd.token)
      }
    } else {
      cmd = req
    }

    // Find and execute command
    const command = cmd.cmd || cmd.command || null

    // Build command paths based on API version
    // For V3, first try cmds-v3/, then fall back to cmds/ (with underscore conversion)
    let cmdPaths
    if (CTX.apiVersion === 'v3') {
      // Try V3 specific commands first, then fall back to V2 commands
      const v2Command = command.replace(/\./g, '_') // Convert dot notation to underscore for fallback
      cmdPaths = [
        `./cmds-v3/${command}`,
        `./cmds-v3/${CTX.type}/${command}`,
        `./cmds/${v2Command}`,
        `./cmds/${CTX.type}/${v2Command}`
      ]
    } else {
      cmdPaths = [`./cmds/${command}`, `./cmds/${CTX.type}/${command}`]
    }
    const cmdPath = findExistingPath(cmdPaths)

    if (!cmdPath) {
      return sendErrorResponse(socket, 14, 'invalid cmd', encryptionKey, isEncrypted, CTX.delay)
    }

    try {
      const res = require(cmdPath)(CTX, STATE.state, cmd, id)

      // If null, do nothing (reboot)
      if (res === null) {
        return
      }

      // Handle two-phase responses (e.g., download_logs)
      // The command handler attaches _binaryPayload for data that should be
      // sent as raw bytes after the JSON response (matching real hardware behavior)
      if (res._binaryPayload) {
        const binaryData = res._binaryPayload
        delete res._binaryPayload

        if (CTX.delay) await promiseSleep(CTX.delay)

        if (isEncrypted) {
          socket.write(encryptResponse(res, encryptionKey))
        } else {
          socket.write(JSON.stringify(res))
        }

        await promiseSleep(10)
        socket.write(binaryData)
        socket.destroy()
        return
      }

      // Firmware transfer: respond with "ready" and keep socket open to receive binary data
      if (res.__firmwareReady) {
        const readyResp = { STATUS: 'S', When: +new Date(), Code: 131, Msg: 'ready', Description: '' }
        if (isEncrypted) {
          socket.write(encryptResponse(readyResp, encryptionKey))
        } else {
          socket.write(JSON.stringify(readyResp))
        }
        socketCtx.firmwareMode = true
        socketCtx.isEncrypted = isEncrypted
        return
      }

      await sendResponse(socket, res, encryptionKey, isEncrypted, CTX.delay)
    } catch (e) {
      debug(new Date(), cmd, e)
      await sendErrorResponse(socket, 14, 'invalid cmd', encryptionKey, isEncrypted, CTX.delay)
    }
  }

  const server = new net.Server()

  server.listen(argv.port, argv.host, function () {
    debug(new Date(), `Server listening for connection requests on socket ${argv.host}:${argv.port}`)
  })

  server.on('close', STATE.cleanup)
  server.on('connection', function (socket) {
    debug(new Date(), 'Connection from ' + socket.remoteAddress + ':' + socket.remotePort)

    const socketCtx = { firmwareMode: false, isEncrypted: false, buffer: Buffer.alloc(0), expectedSize: null }

    socket.on('data', async function (chunk) {
      if (socketCtx.firmwareMode) {
        socketCtx.buffer = Buffer.concat([socketCtx.buffer, chunk])

        if (socketCtx.expectedSize === null && socketCtx.buffer.length >= 4) {
          socketCtx.expectedSize = socketCtx.buffer.readInt32LE(0)
          socketCtx.buffer = socketCtx.buffer.subarray(4)
        }

        if (socketCtx.expectedSize !== null && socketCtx.buffer.length >= socketCtx.expectedSize) {
          socketCtx.firmwareMode = false
          const resp = { STATUS: 'S', When: +new Date(), Code: 131, Msg: 'Updated', Description: '' }
          await sendResponse(socket, resp, encryptionKey, socketCtx.isEncrypted, CTX.delay)
        }
        return
      }

      await processCmd(socket, chunk, socketCtx)
    })
  })

  return {
    state: STATE.state,
    exit: () => {
      server.close()
    },
    start: () => {
      // if server isn't started
      if (!server.listening) {
        server.listen(argv.port, argv.host, () => {
          debug(`Server listening on socket ${argv.host}:${argv.port}`)
        })
      }
    },
    stop: () => {
      // if server is started
      if (server.listening) {
        server.close()
      }
    },
    reset: () => {
      return STATE.cleanup()
    }
  }
}
