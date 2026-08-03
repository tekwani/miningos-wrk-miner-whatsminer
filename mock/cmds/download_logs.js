'use strict'

const { createSuccessResponse } = require('../utils')

/**
 * V2 API download_logs command handler
 * Packages system logs and returns size for streaming
 * Returns a _binaryPayload that the mock server sends after the JSON response
 */
module.exports = function (ctx, state) {
  let mockLogContent = Buffer.from(
    '=== Whatsminer Log Export ===\n' +
    `Serial: ${ctx.serial}\n` +
    `Type: ${ctx.type}\n` +
    `Timestamp: ${new Date().toISOString()}\n` +
    '--- System Log ---\n' +
    '[INFO] Miner started successfully\n' +
    '[INFO] Pool connection established\n' +
    '[INFO] Hashrate stable at target frequency\n' +
    '--- End of Log ---\n'
  )

  // ctx.dlLogSizeBytes lets tests exercise multi-chunk binary transfers
  if (ctx.dlLogSizeBytes && ctx.dlLogSizeBytes > mockLogContent.length) {
    mockLogContent = Buffer.concat([
      Buffer.alloc(ctx.dlLogSizeBytes - mockLogContent.length, 0x41),
      mockLogContent
    ])
  }

  const response = createSuccessResponse({
    logfilelen: mockLogContent.length.toString()
  })

  response._binaryPayload = mockLogContent

  return response
}
