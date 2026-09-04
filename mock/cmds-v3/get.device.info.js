'use strict'

const { sha256 } = require('../../workers/lib/utils/crypto')
const { createSuccessResponse } = require('../utils')

/**
 * V3 API get.device.info command handler
 * This is the authentication command for API v3.0.3
 *
 * V3 uses SHA256-based token (first 8 chars of base64):
 * token = SHA256(password + salt).substring(0, 8)
 *
 * Returns V2-compatible response format for simplicity
 */
module.exports = function (ctx, state) {
  // max active tokens reached
  if (state.activeTokens >= 16) {
    state.activeTokens = 0
    return { STATUS: 'E', When: +new Date(), Code: 136, Msg: 'Too many connections', Description: '' }
  }

  state.activeTokens++

  const salt = '5QAHiKMb'
  const time = Math.floor(Date.now() / 1000).toString()

  // V3: Generate SHA256-based token that miner will generate
  // token = first 8 chars of base64(SHA256(password + salt))
  if (ctx.password && ctx.validTokens) {
    const tokenHash = sha256(ctx.password + salt)
    const tokenBase64 = tokenHash.toString('base64')
    const tokenSign = tokenBase64.substring(0, 8)
    ctx.validTokens.add(tokenSign)
  }

  // Return V2-compatible response with auth data
  return createSuccessResponse({
    salt,
    time,
    // Device info
    model: state.version?.chip || 'WM30SP',
    serial: ctx.serial,
    mac: 'CA:7A:0A:00:02:23'
  })
}
