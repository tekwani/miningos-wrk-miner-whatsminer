'use strict'

const API_VERSIONS = {
  V2: '2.0.5',
  V3: '3.0.3'
}

const DEFAULT_API_VERSION = API_VERSIONS.V2

const API_DEFAULTS = {
  '2.0.5': {
    port: 4028,
    authCommand: 'get_token'
  },
  '3.0.3': {
    port: 4433,
    authCommand: 'get.device.info'
  }
}

// Command mapping from v2 (underscore) to v3 (dot notation)
// V3 uses get.miner.status with param for summary/pools/edevs
const COMMAND_MAP_V3 = {
  // Authentication
  get_token: 'get.device.info',

  // Read commands
  get_version: 'get.version',
  get_miner_info: 'get.miner.info',
  get_error_code: 'get.error.code',
  get_psu: 'get.psu',

  // Status command
  status: 'get.miner.setting',

  // V3 uses get.miner.status with param instead of separate commands
  summary: 'get.miner.status',
  pools: 'get.miner.status',
  edevs: 'get.miner.status',
  devdetails: 'get.miner.status',

  // Write commands - existing V2->V3 mappings
  update_pools: 'set.miner.pools',
  update_pwd: 'set.miner.passwd',
  update_firmware: 'set.system.update_firmware',
  restart_btminer: 'set.miner.service',
  factory_reset: 'set.system.factory_reset',
  reboot: 'set.system.reboot',
  // V3 uses set.miner.service for power on/off (param: start/stop)
  power_on: 'set.miner.service',
  power_off: 'set.miner.service',
  pre_power_on: 'set.miner.service',
  set_led: 'set.system.led',
  set_hostname: 'set.system.hostname',
  set_zone: 'set.system.timezone',
  set_temp_offset: 'set.fan.temp_offset',
  set_poweroff_cool: 'set.fan.poweroff_cool',
  set_fan_zero_speed: 'set.fan.zero_speed',
  set_target_freq: 'set.miner.target_freq',
  set_low_power: 'set.miner.power_mode',
  set_normal_power: 'set.miner.power_mode',
  set_high_power: 'set.miner.power_mode',
  set_power_pct_v2: 'set.miner.power_percent',
  adjust_power_limit: 'set.miner.power_limit',
  adjust_upfreq_speed: 'set.miner.upfreq_speed',
  enable_btminer_fast_boot: 'set.miner.fastboot',
  disable_btminer_fast_boot: 'set.miner.fastboot',
  enable_web_pools: 'set.miner.web_pools',
  disable_web_pools: 'set.miner.web_pools',
  net_config: 'set.network.config',
  download_logs: 'get.log.download'
}

// V3-only commands (no V2 equivalent)
const V3_ONLY_COMMANDS = {
  // Device
  'get.device.info': true, // Auth command
  'get.device.custom_data': true,
  'set.device.custom_data': true,

  // Fan
  'get.fan.setting': true,
  'set.fan.poweroff_cool': true,
  'set.fan.temp_offset': true,
  'set.fan.zero_speed': true,

  // Log
  'get.log.download': true,
  'set.log.upload': true,

  // Miner
  'get.miner.status': true,
  'get.miner.setting': true,
  'get.miner.history': true,
  'set.miner.cointype': true,
  'set.miner.fast_hash': true,
  'set.miner.fastboot': true,
  'set.miner.heat_mode': true,
  'set.miner.power': true,
  'set.miner.power_limit': true,
  'set.miner.power_mode': true,
  'set.miner.power_percent': true,
  'set.miner.pools': true,
  'set.miner.report': true,
  'set.miner.restore_setting': true,
  'set.miner.service': true,

  // System
  'get.system.setting': true,
  'set.system.factory_reset': true,
  'set.system.hostname': true,
  'set.system.led': true,
  'set.system.reboot': true,
  'set.system.timezone': true
}

// V3 param mapping for get.miner.status command
const V3_STATUS_PARAMS = {
  summary: 'summary',
  pools: 'pools',
  edevs: 'edevs',
  devdetails: 'devdetails'
}

// Reverse mapping from v3 to v2 commands
const COMMAND_MAP_V2 = Object.entries(COMMAND_MAP_V3).reduce((acc, [v2, v3]) => {
  acc[v3] = v2
  return acc
}, {})

// V2 Response codes
const RESPONSE_CODES_V2 = {
  OK: 131,
  TOKEN_EXPIRED: 135,
  IP_LIMIT: 136
}

// V3 Response codes (per API 3.0.3 documentation)
const RESPONSE_CODES_V3 = {
  SUCCESS: 0,
  FAIL: -1,
  INVALID_COMMAND: -2,
  NO_PERMISSION: -4
}

// Legacy alias for backward compatibility
const RESPONSE_CODES = RESPONSE_CODES_V2

module.exports = {
  API_VERSIONS,
  DEFAULT_API_VERSION,
  API_DEFAULTS,
  COMMAND_MAP_V3,
  COMMAND_MAP_V2,
  V3_ONLY_COMMANDS,
  V3_STATUS_PARAMS,
  RESPONSE_CODES,
  RESPONSE_CODES_V2,
  RESPONSE_CODES_V3
}
