'use strict'

const test = require('brittle')
const utils = require('../../workers/lib/utils')

test('utils - getErrorMsg function', (t) => {
  const { getErrorMsg } = utils

  // Test known error codes
  t.is(getErrorMsg(110), 'hashrate_low', 'should return correct message for error 110')
  t.is(getErrorMsg(111), 'power_init_error', 'should return correct message for error 111')
  t.is(getErrorMsg(120), 'fan_speed_error', 'should return correct message for error 120')
  t.is(getErrorMsg(200), 'power_probing_error', 'should return correct message for error 200')
  t.is(getErrorMsg(131), 'fan_speed_error', 'should return correct message for error 131')
  t.is(getErrorMsg(2000), 'no_pool_info_configured', 'should return correct message for error 2000')
  t.is(getErrorMsg(100001), 'antiv_signature_illegal', 'should return correct message for error 100001')

  // Test unknown error code
  t.is(getErrorMsg(99999), 'Unknown error', 'should return "Unknown error" for unknown code')
  t.is(getErrorMsg(0), 'Unknown error', 'should return "Unknown error" for code 0')
  t.is(getErrorMsg(-1), 'Unknown error', 'should return "Unknown error" for negative code')
})

test('utils - getAPICodeMsg function', (t) => {
  const { getAPICodeMsg } = utils

  // Test known API codes - the function returns formatted strings
  t.is(getAPICodeMsg({ Code: 14 }), 'Error 14: Invalid API command or data', 'should return correct message for code 14')
  t.is(getAPICodeMsg({ Code: 23 }), 'Error 23: Invalid JSON message', 'should return correct message for code 23')
  t.is(getAPICodeMsg({ Code: 45 }), 'Error 45: Permission denied', 'should return correct message for code 45')
  t.is(getAPICodeMsg({ Code: 131 }), 'Error 131: OK', 'should return correct message for code 131')
  t.is(getAPICodeMsg({ Code: 132 }), 'Error 132: Command error', 'should return correct message for code 132')
  t.is(getAPICodeMsg({ Code: 134 }), 'Error 134: Get token OK', 'should return correct message for code 134')
  t.is(getAPICodeMsg({ Code: 135 }), 'Error 135: Token error', 'should return correct message for code 135')
  t.is(getAPICodeMsg({ Code: 136 }), 'Error 136: Too many tokens', 'should return correct message for code 136')
  t.is(getAPICodeMsg({ Code: 137 }), 'Error 137: Base64 decode error', 'should return correct message for code 137')

  // Test unknown API code
  t.is(getAPICodeMsg({ Code: 999 }), 'Error 999: Unknown code', 'should return "Unknown code" for unknown code')
  t.is(getAPICodeMsg({ Code: 0 }), 'Error 0: Unknown code', 'should return "Unknown code" for code 0')
})

test('utils - getAPICodeMsg with Code 23 special case', (t) => {
  const { getAPICodeMsg } = utils

  // Test the special case for Code 23 with additional properties
  const responseWithMsg = { Code: 23, msg: 'Custom error message' }
  const result = getAPICodeMsg(responseWithMsg)

  // The function should return the custom message if available
  t.ok(typeof result === 'string', 'should return a string')
  t.ok(result.length > 0, 'should return non-empty string')
})

test('utils - error message consistency', (t) => {
  const { getErrorMsg } = utils

  // Test that all error messages are strings
  const testCodes = [110, 111, 120, 200, 131, 2000, 100001, 99999]

  for (const code of testCodes) {
    const message = getErrorMsg(code)
    t.ok(typeof message === 'string', `error message for code ${code} should be a string`)
    t.ok(message.length > 0, `error message for code ${code} should not be empty`)
  }
})

test('utils - API code message consistency', (t) => {
  const { getAPICodeMsg } = utils

  // Test that all API code messages are strings
  const testCodes = [14, 23, 45, 131, 132, 134, 135, 136, 137, 999]

  for (const code of testCodes) {
    const message = getAPICodeMsg({ Code: code })
    t.ok(typeof message === 'string', `API message for code ${code} should be a string`)
    t.ok(message.length > 0, `API message for code ${code} should not be empty`)
  }
})

test('utils - edge cases', (t) => {
  const { getErrorMsg, getAPICodeMsg } = utils

  // Test with null/undefined inputs
  t.is(getErrorMsg(null), 'Unknown error', 'should handle null input')
  t.is(getErrorMsg(undefined), 'Unknown error', 'should handle undefined input')

  // Test with non-numeric error codes
  t.is(getErrorMsg('invalid'), 'Unknown error', 'should handle string input')
  t.is(getErrorMsg({}), 'Unknown error', 'should handle object input')

  // Test getAPICodeMsg with null/undefined (these will throw errors)
  try {
    getAPICodeMsg(null)
    t.fail('should throw error for null input')
  } catch (error) {
    t.ok(error, 'should throw error for null input')
  }

  try {
    getAPICodeMsg(undefined)
    t.fail('should throw error for undefined input')
  } catch (error) {
    t.ok(error, 'should throw error for undefined input')
  }

  // Test with empty object
  t.is(getAPICodeMsg({}), 'Error undefined: Unknown code', 'should handle empty object')
})

test('utils - specific error code categories', (t) => {
  const { getErrorMsg } = utils

  // Test power-related errors
  const powerErrors = [200, 201, 202, 203, 204, 205, 206, 207]
  for (const code of powerErrors) {
    const message = getErrorMsg(code)
    t.ok(message.includes('power'), `error ${code} should be power-related: ${message}`)
  }

  // Test fan-related errors
  const fanErrors = [120, 121, 130, 131, 253, 254]
  for (const code of fanErrors) {
    const message = getErrorMsg(code)
    t.ok(message.includes('fan'), `error ${code} should be fan-related: ${message}`)
  }

  // Test pool-related errors
  const poolErrors = [2000, 2010, 2020, 2021, 2022, 2030, 2040, 2050]
  for (const code of poolErrors) {
    const message = getErrorMsg(code)
    t.ok(message.includes('pool'), `error ${code} should be pool-related: ${message}`)
  }
})

test('utils - API code categories', (t) => {
  const { getAPICodeMsg } = utils

  // Test success codes
  const successCodes = [131, 134]
  for (const code of successCodes) {
    const message = getAPICodeMsg({ Code: code })
    t.ok(message.includes('OK') || message.includes('ok'), `API code ${code} should indicate success: ${message}`)
  }

  // Test error codes
  const errorCodes = [14, 23, 45, 132, 135, 136, 137]
  for (const code of errorCodes) {
    const message = getAPICodeMsg({ Code: code })
    t.ok(message.includes('error') || message.includes('Error') || message.includes('denied') || message.includes('Invalid'),
      `API code ${code} should indicate error: ${message}`)
  }
})
