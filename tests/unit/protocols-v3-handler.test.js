'use strict'

const test = require('brittle')
const WMApiV3 = require('../../workers/lib/protocols/wm-api-v3')
const { API_VERSIONS, COMMAND_MAP_V3 } = require('../../workers/lib/protocols/constants')

// Mock RPC for testing
const createMockRpc = (responses) => {
  let callIndex = 0
  return {
    request: async (cmd) => {
      const response = responses[callIndex] || responses[0]
      callIndex++
      return JSON.stringify(response)
    }
  }
}

test('protocols/v3-handler - static VERSION', (t) => {
  t.is(WMApiV3.VERSION, API_VERSIONS.V3, 'VERSION should be 3.0.3')
  t.is(WMApiV3.VERSION, '3.0.3', 'VERSION should match string')
})

test('protocols/v3-handler - static DEFAULT_PORT', (t) => {
  t.is(WMApiV3.DEFAULT_PORT, 4433, 'DEFAULT_PORT should be 4433')
})

test('protocols/v3-handler - constructor', (t) => {
  const handler = new WMApiV3({
    rpc: {},
    password: 'testpass'
  })
  t.ok(handler, 'should create handler')
  t.is(handler.password, 'testpass', 'should set password')
  t.is(handler.token, undefined, 'token should be undefined initially')
})

test('protocols/v3-handler - getAuthCommand', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })
  t.is(handler.getAuthCommand(), 'get.device.info', 'should return get.device.info')
})

test('protocols/v3-handler - transformCommand basic', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  // Test known command mappings
  t.is(handler.transformCommand('get_token'), 'get.device.info', 'get_token should map to get.device.info')
  t.is(handler.transformCommand('get_version'), 'get.version', 'get_version should map correctly')
  // V3 uses get.miner.status with param for summary/pools/edevs
  t.is(handler.transformCommand('summary'), 'get.miner.status', 'summary should map to get.miner.status')
})

test('protocols/v3-handler - transformCommand all mappings', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  for (const [v2Cmd, v3Cmd] of Object.entries(COMMAND_MAP_V3)) {
    t.is(handler.transformCommand(v2Cmd), v3Cmd, `${v2Cmd} should map to ${v3Cmd}`)
  }
})

test('protocols/v3-handler - transformCommand unknown returns unchanged', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  t.is(handler.transformCommand('unknown_cmd'), 'unknown_cmd', 'unknown command should remain unchanged')
  t.is(handler.transformCommand('custom.command'), 'custom.command', 'dot notation should remain unchanged')
})

test('protocols/v3-handler - getStatusParam', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  // V3 uses get.miner.status with param field
  t.is(handler.getStatusParam('summary'), 'summary', 'summary should return summary param')
  t.is(handler.getStatusParam('pools'), 'pools', 'pools should return pools param')
  t.is(handler.getStatusParam('edevs'), 'edevs', 'edevs should return edevs param')
  t.is(handler.getStatusParam('devdetails'), 'devdetails', 'devdetails should return devdetails param')
  t.is(handler.getStatusParam('unknown'), undefined, 'unknown command should return undefined')
})

test('protocols/v3-handler - parseResponse returns unchanged', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  const response = { Code: 131, Msg: { data: 'test' } }
  t.alike(handler.parseResponse(response, 'cmd'), response, 'should return response unchanged')
})

test('protocols/v3-handler - authenticate success with V3 format', async (t) => {
  // V3 response format: {code, when, msg, desc}
  // V3 authenticate() just gets the salt, tokens are generated per-command
  const mockRpc = createMockRpc([{
    code: 0,
    when: Math.floor(Date.now() / 1000),
    msg: {
      salt: '5QAHiKMb',
      time: '0000'
    },
    desc: 'get.device.info'
  }])

  const handler = new WMApiV3({
    rpc: mockRpc,
    password: 'super'
  })

  const result = await handler.authenticate()
  t.ok(result, 'should return result')
  t.ok(result.salt, 'should have salt')
  t.is(result.salt, '5QAHiKMb', 'should have correct salt value')
  t.ok(handler.salt, 'should store salt on handler')
  t.is(handler.salt, '5QAHiKMb', 'should have correct salt stored')
})

test('protocols/v3-handler - authenticate IP limit error (V3 format)', async (t) => {
  // V3: -4 = No permission (IP limit)
  const mockRpc = createMockRpc([{
    code: -4,
    when: Math.floor(Date.now() / 1000),
    msg: 'Too many connections',
    desc: 'get.device.info'
  }])

  const handler = new WMApiV3({
    rpc: mockRpc,
    password: 'super'
  })

  try {
    await handler.authenticate()
    t.fail('should throw error')
  } catch (error) {
    t.is(error.message, 'ERR_TOKEN_FETCH_IP_LIMIT', 'should throw IP limit error')
  }
})

test('protocols/v3-handler - authenticate missing salt error', async (t) => {
  const mockRpc = createMockRpc([{
    code: 0,
    when: Math.floor(Date.now() / 1000),
    msg: {
      time: '0000'
      // Missing salt
    },
    desc: 'get.device.info'
  }])

  const handler = new WMApiV3({
    rpc: mockRpc,
    password: 'super'
  })

  try {
    await handler.authenticate()
    t.fail('should throw error')
  } catch (error) {
    t.is(error.message, 'ERR_INVALID_AUTH_RESPONSE', 'should throw invalid auth response error')
  }
})

test('protocols/v3-handler - authenticate fail response', async (t) => {
  // V3: -1 = Fail
  const mockRpc = createMockRpc([{
    code: -1,
    when: Math.floor(Date.now() / 1000),
    msg: 'Auth failed',
    desc: 'get.device.info'
  }])

  const handler = new WMApiV3({
    rpc: mockRpc,
    password: 'super'
  })

  try {
    await handler.authenticate()
    t.fail('should throw error')
  } catch (error) {
    t.is(error.message, 'ERR_AUTH_FAILED_-1', 'should throw auth failed error')
  }
})

test('protocols/v3-handler - requestRead success', async (t) => {
  const mockRpc = createMockRpc([{
    Code: 131,
    Msg: { api_ver: '3.0.3' }
  }])

  const handler = new WMApiV3({
    rpc: mockRpc,
    password: 'super'
  })

  const response = await handler.requestRead('get.version')
  t.ok(response, 'should return response')
  t.is(response.Code, 131, 'should have correct code')
  t.is(response.Msg.api_ver, '3.0.3', 'should have correct data')
})

test('protocols/v3-handler - requestRead with params', async (t) => {
  let capturedCmd
  const mockRpc = {
    request: async (cmd) => {
      capturedCmd = JSON.parse(cmd)
      return JSON.stringify({ Code: 131, Msg: {} })
    }
  }

  const handler = new WMApiV3({
    rpc: mockRpc,
    password: 'super'
  })

  await handler.requestRead('test.cmd', { param1: 'value1' })
  t.is(capturedCmd.cmd, 'test.cmd', 'should include command')
  t.is(capturedCmd.param1, 'value1', 'should include additional params')
})

test('protocols/v3-handler - requestRead error', async (t) => {
  const mockRpc = {
    request: async () => {
      throw new Error('Connection failed')
    }
  }

  const handler = new WMApiV3({
    rpc: mockRpc,
    password: 'super'
  })

  try {
    await handler.requestRead('get.version')
    t.fail('should throw error')
  } catch (error) {
    t.is(error.message, 'ERR_READ_FAILED', 'should throw read failed error')
  }
})

test('protocols/v3-handler - getTokenInfo', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  t.is(handler.getTokenInfo(), undefined, 'should return undefined when no salt')

  handler.salt = '5QAHiKMb'
  t.alike(handler.getTokenInfo(), { salt: '5QAHiKMb' }, 'should return salt info')
})

test('protocols/v3-handler - generateTokenInfo', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  t.is(handler.generateTokenInfo('set.miner.power'), undefined, 'should return undefined when no salt')

  handler.salt = '5QAHiKMb'
  const tokenInfo = handler.generateTokenInfo('set.miner.power')
  t.ok(tokenInfo, 'should return token info')
  t.ok(tokenInfo.token, 'should have token')
  t.is(tokenInfo.token.length, 8, 'token should be 8 characters')
  t.ok(tokenInfo.key, 'should have key')
  t.is(tokenInfo.salt, '5QAHiKMb', 'should have salt')
  t.ok(tokenInfo.ts, 'should have timestamp')
})

test('protocols/v3-handler - clearToken', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  handler.salt = '5QAHiKMb'
  t.ok(handler.salt, 'should have salt')

  handler.clearToken()
  t.is(handler.salt, undefined, 'should clear salt')
})

test('protocols/v3-handler - _getAPICodeMsg V3 format', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  // V3 response codes
  t.is(handler._getAPICodeMsg({ code: 0 }), 'OK', 'should return OK for V3 code 0')
  t.is(handler._getAPICodeMsg({ code: -1 }), 'ERR_FAIL', 'should return FAIL for V3 code -1')
  t.is(handler._getAPICodeMsg({ code: -2 }), 'ERR_INVALID_CMD', 'should return INVALID_CMD for V3 code -2')
  t.is(handler._getAPICodeMsg({ code: -4 }), 'ERR_NO_PERMISSION', 'should return NO_PERMISSION for V3 code -4')

  // V2 response codes (backward compatibility)
  t.is(handler._getAPICodeMsg({ Code: 14 }), 'ERR_INVALID_CMD', 'should return correct message for V2 14')
  t.is(handler._getAPICodeMsg({ Code: 23 }), 'ERR_JSON_CMD', 'should return correct message for V2 23')
  t.is(handler._getAPICodeMsg({ Code: 45 }), 'ERR_PERMISSION_DENIED', 'should return correct message for V2 45')
  t.is(handler._getAPICodeMsg({ Code: 131 }), 'OK', 'should return correct message for V2 131')
  t.is(handler._getAPICodeMsg({ Code: 135 }), 'ERR_TOKEN_EXPIRED', 'should return correct message for V2 135')
  t.is(handler._getAPICodeMsg({ Code: 136 }), 'ERR_IP_LIMIT', 'should return correct message for V2 136')
  t.is(handler._getAPICodeMsg({ Code: 999 }), 'ERR_UNKNOWN_CODE_999', 'should return unknown for 999')
})

test('protocols/v3-handler - isResponseOK', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  // V3 format
  t.ok(handler.isResponseOK({ code: 0 }), 'should return true for V3 code 0')
  t.not(handler.isResponseOK({ code: -1 }), 'should return false for V3 code -1')
  t.not(handler.isResponseOK({ code: -4 }), 'should return false for V3 code -4')

  // V2 format (backward compatibility)
  t.ok(handler.isResponseOK({ Code: 131 }), 'should return true for V2 Code 131')
  t.not(handler.isResponseOK({ Code: 135 }), 'should return false for V2 Code 135')
  t.not(handler.isResponseOK(null), 'should return false for null')
})

test('protocols/v3-handler - command transformation patterns', (t) => {
  const handler = new WMApiV3({ rpc: {}, password: 'super' })

  // Verify underscore to dot pattern
  const underscoreCommands = [
    'get_token',
    'get_version',
    'get_miner_info',
    'update_pools',
    'power_on',
    'power_off',
    'set_led'
  ]

  for (const cmd of underscoreCommands) {
    const transformed = handler.transformCommand(cmd)
    if (cmd !== 'summary' && cmd !== 'pools' && cmd !== 'edevs' && cmd !== 'devdetails' && cmd !== 'reboot') {
      // Most commands should be transformed to dot notation
      t.ok(
        transformed.includes('.') || transformed === cmd,
        `${cmd} should be transformed or remain unchanged`
      )
    }
  }
})

test('protocols/v3-handler - requestWrite uses username as account', async (t) => {
  const CryptoJS = require('crypto-js')
  const handler = new WMApiV3({ rpc: {}, password: 'p', username: 'operator1' })
  handler.salt = 'somesalt'
  const key = CryptoJS.SHA256('fixed').toString()
  handler._generateToken = () => ({ token: 'tok12345', key })

  let sent
  handler._requestMiner = async (cmd) => {
    sent = cmd
    const resp = JSON.stringify({ code: 0, msg: 'ok' })
    return { enc: CryptoJS.AES.encrypt(resp, CryptoJS.SHA256(key), { mode: CryptoJS.mode.ECB }).toString() }
  }

  const res = await handler.requestWrite('set.miner.power')
  t.is(res.code, 0, 'should return decrypted response')

  const hex2a = require('../../workers/lib/utils/hex2a')
  const decrypted = CryptoJS.AES.decrypt(sent.data, CryptoJS.SHA256(key), { mode: CryptoJS.mode.ECB }).toString()
  const cmdObj = JSON.parse(hex2a(decrypted))
  t.is(cmdObj.account, 'operator1', 'should use username as account')
})

test('protocols/v3-handler - requestWrite defaults account to super', async (t) => {
  const CryptoJS = require('crypto-js')
  const handler = new WMApiV3({ rpc: {}, password: 'p' })
  handler.salt = 'somesalt'
  const key = CryptoJS.SHA256('fixed').toString()
  handler._generateToken = () => ({ token: 'tok12345', key })

  let sent
  handler._requestMiner = async (cmd) => {
    sent = cmd
    const resp = JSON.stringify({ code: 0, msg: 'ok' })
    return { enc: CryptoJS.AES.encrypt(resp, CryptoJS.SHA256(key), { mode: CryptoJS.mode.ECB }).toString() }
  }

  await handler.requestWrite('set.miner.power')

  const hex2a = require('../../workers/lib/utils/hex2a')
  const decrypted = CryptoJS.AES.decrypt(sent.data, CryptoJS.SHA256(key), { mode: CryptoJS.mode.ECB }).toString()
  const cmdObj = JSON.parse(hex2a(decrypted))
  t.is(cmdObj.account, 'super', 'should default account to super')
})
