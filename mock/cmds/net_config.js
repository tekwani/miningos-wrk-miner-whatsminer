'use strict'

const { proxyState, createSuccessResponse, createErrorResponse, validateArgs } = require('../utils')

const args = [[
  'param'
], [
  'ip',
  'mask',
  'gate',
  'dns',
  'host'
]]

module.exports = proxyState(function (ctx, state, req) {
  if (validateArgs(args, req)) {
    if (req.param === 'dhcp') {
      state.miner_info.ip = ctx.host
      state.miner_info.proto = 'dhcp'
    } else if (req.param === 'static') {
      state.miner_info.ip = req.ip
      state.miner_info.mask = req.mask
      state.miner_info.gate = req.gate
      state.miner_info.dns = req.dns
      state.miner_info.host = req.host
      state.miner_info.proto = 'static'
    } else {
      return createErrorResponse()
    }
    return createSuccessResponse()
  } else {
    return createErrorResponse()
  }
})
