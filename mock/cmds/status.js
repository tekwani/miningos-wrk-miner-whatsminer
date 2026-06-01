'use strict'

const { createSuccessResponse } = require('../utils')

module.exports = function (ctx, state) {
  const summary = state.summary || {}

  return createSuccessResponse({
    mineroff: state.suspended ? 'true' : 'false',
    mineroff_reason: state.suspended ? 'user' : '',
    mineroff_time: state.suspended ? new Date().toISOString() : '',
    FirmwareVersion: state.version?.fw_ver || '20230714.15.Rel',
    power_mode: state.suspended ? 'sleep' : (summary['Power Mode'] || 'Normal').toLowerCase(),
    power_limit_set: summary['Power Limit'] ? summary['Power Limit'].toString() : '',
    power_pct: state.power_pct !== undefined ? state.power_pct.toString() : '100',
    hash_percent: '0',
    fast_mining: 'false',
    fast_hash: 'false',
    liquid_temp: 0
  })
}
