'use strict'

const { createSuccessResponse, createErrorResponse, validateArgs } = require('../utils')

const args = [[
  'percent'
]]

module.exports = function (ctx, req) {
  if (validateArgs(args, req)) {
    return createSuccessResponse()
  } else {
    return createErrorResponse()
  }
}
