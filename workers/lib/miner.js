'use strict'

const BaseMiner = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/base')
const async = require('async')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const CryptoJS = require('crypto-js')
const hex2a = require('./utils/hex2a')
const readFirmware = require('./utils/firmware')
const { getErrorMsg } = require('./utils')
const {
  MINOR_ERROR_CODES_M56S_M30_SET,
  MINOR_ERROR_CODES_M53_SET,
  MINER_COOLING_TYPE_MAP
} = require('./constants')
const { STATUS, POWER_MODE } = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/constants')
const { ApiHandlerFactory, API_VERSIONS } = require('./protocols')

function isResOK (res) {
  return res?.Code === 131
}

class WhatsminerMiner extends BaseMiner {
  constructor ({ socketer, apiVersion, getLogCoreManager, ...opts }) {
    super(opts)
    this._getLogCoreManager = getLogCoreManager || (() => null)

    this.rpc = socketer.rpc({
      tcpOpts: {
        host: this.opts.address,
        port: this.opts.port,
        encoding: 'utf-8'
      },
      readStrategy: socketer.readStrategy,
      json: false,
      timeout: this.opts.timeout,
      delay: this.conf.delay || 50
    })

    this.apiVersion = apiVersion || null
    this.protocolHandler = null
    this._cachedPrevHashrate = null
    this.cachedShares = { accepted: 0, rejected: 0, stale: 0 }
  }

  /**
   * Initializes the miner with API version detection if not provided
   */
  async init () {
    if (!this.apiVersion) {
      this.apiVersion = await this._detectApiVersion()
    }

    this.protocolHandler = ApiHandlerFactory.create(this.apiVersion, {
      rpc: this.rpc,
      password: this.opts.password,
      debugError: this.debugError.bind(this)
    })
  }

  /**
   * Detects the API version by attempting to connect on known ports/commands
   * @returns {Promise<string>}
   */
  async _detectApiVersion () {
    if (this.opts.port === 4433) {
      return API_VERSIONS.V3
    }
    if (this.opts.port === 4028) {
      return API_VERSIONS.V2
    }

    const detectors = [
      { version: API_VERSIONS.V2, cmd: 'get_token' },
      { version: API_VERSIONS.V3, cmd: 'get.device.info' }
    ]

    for (const { version, cmd } of detectors) {
      try {
        const res = await this._execCommand(cmd)
        if (res && !res.error && res.Msg) {
          return version
        }
      } catch (e) {
        this.debugError(`Version detection failed for ${version}:`, e.message)
      }
    }

    // Default to V2 if detection fails
    this.debugError('API version detection failed, defaulting to V2')
    return API_VERSIONS.V2
  }

  /**
   * Executes a command for version detection
   * @param {string} command
   * @returns {Promise<Object>}
   */
  async _execCommand (command) {
    const cmd = { cmd: command }
    const response = await this.rpc.request(JSON.stringify(cmd))
    return JSON.parse(response)
  }

  async close () {
    await this.rpc.stop()
  }

  async _getToken () {
    return this.protocolHandler.authenticate()
  }

  async _refreshToken () {
    try {
      await this.protocolHandler.refreshToken()
    } catch (e) {
      this.debugError('_refreshToken error', e)
      throw e
    }
  }

  /**
   * Gets the current token info from the protocol handler
   * @returns {{token: string, sign: string, key: string}|undefined}
   */
  get token () {
    return this.protocolHandler?.getTokenInfo()
  }

  /**
   * Sets/clears the token (for backwards compatibility)
   */
  set token (value) {
    if (value === undefined && this.protocolHandler) {
      this.protocolHandler.clearToken()
    }
  }

  async _requestMiner (command, json = true) {
    const response = await this.rpc.request(JSON.stringify(command))
    this.updateLastSeen()
    return json ? JSON.parse(response) : response
  }

  async _requestUpdateMiner (command, file, key, platform) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket()

      socket.connect(this.opts.port, this.opts.address, () => {
        socket.write(command)
      })

      socket.on('data', (data) => {
        const decoded = JSON.parse(data)
        const decrypted = CryptoJS.AES.decrypt(decoded.enc, CryptoJS.SHA256(key), { mode: CryptoJS.mode.ECB }).toString()
        const resp = JSON.parse(hex2a(decrypted))
        if (isResOK(resp) && resp.Msg === 'ready') {
          const fw = readFirmware(platform, file)
          if (fw === null) reject(Error('ERR_INVALID_FIRMWARE'))
          const fileSizeInBytes = Buffer.alloc(4)
          fileSizeInBytes.writeInt32LE(fw.size, 0)
          socket.write(fileSizeInBytes, () => {
            socket.write(fw.content)
          })
        } else if (isResOK(resp)) {
          socket.destroy()
          resolve(resp)
        }
      })

      socket.on('error', (error) => { reject(error) })

      socket.on('close', () => {})
    })
  }

  async _requestReadEndpoint (command, additionalParams = {}) {
    const cmd = this.protocolHandler.transformCommand(command)
    const params = { ...additionalParams }
    if (this.protocolHandler.getStatusParam) {
      const statusParam = this.protocolHandler.getStatusParam(command)
      if (statusParam) {
        params.param = statusParam
      }
    }

    const res = await this.protocolHandler.requestRead(cmd, params)
    this.updateLastSeen()
    return this.protocolHandler.parseResponse(res, command)
  }

  async _requestWriteEndpoint (command, additionalParams = {}, json = true) {
    const cmd = this.protocolHandler.transformCommand(command)
    const res = await this.protocolHandler.requestWrite(cmd, additionalParams, json)
    this.updateLastSeen()
    return res ? this.protocolHandler.parseResponse(res, command) : null
  }

  async _requestWriteFirmwareEndpoint (filename) {
    // Ensure we have a valid token
    if (!this.token) {
      await this._refreshToken()
    }
    const tokenInfo = this.protocolHandler.getTokenInfo()
    const { sign, key } = tokenInfo
    const firmwareCmd = this.protocolHandler.transformCommand('update_firmware')
    const cmd = JSON.stringify({
      token: sign,
      cmd: firmwareCmd
    })
    const data = CryptoJS.AES.encrypt(cmd, CryptoJS.SHA256(key), { mode: CryptoJS.mode.ECB }).toString()
    const encCmd = JSON.stringify({
      enc: 1,
      data
    })

    const version = await this.getVersion()

    const res = await this._requestUpdateMiner(encCmd, filename, key, version.platform.toLowerCase())
    return res
  }

  async _requestDownloadLogs () {
    const TOKEN_EXPIRED_CODE = 135
    const MAX_ATTEMPTS = 2

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (!this.token) {
        await this._refreshToken()
      }

      const downloadCmd = this.protocolHandler.transformCommand('download_logs')
      let encCmd, decryptionKey

      if (this.apiVersion === API_VERSIONS.V3) {
        const tokenInfo = this.protocolHandler.generateTokenInfo(downloadCmd)
        const { token, key } = tokenInfo
        const ts = Math.floor(Date.now() / 1000)
        const cmd = JSON.stringify({ cmd: downloadCmd, ts, token, account: 'super' })
        const data = CryptoJS.AES.encrypt(cmd, CryptoJS.SHA256(key), { mode: CryptoJS.mode.ECB }).toString()
        encCmd = JSON.stringify({ enc: 1, data })
        decryptionKey = key
      } else {
        const tokenInfo = this.protocolHandler.getTokenInfo()
        const { sign, key } = tokenInfo
        const cmd = JSON.stringify({ token: sign, cmd: downloadCmd })
        const data = CryptoJS.AES.encrypt(cmd, CryptoJS.SHA256(key), { mode: CryptoJS.mode.ECB }).toString()
        encCmd = JSON.stringify({ enc: 1, data })
        decryptionKey = key
      }

      try {
        return await this._socketDownloadLogs(encCmd, decryptionKey)
      } catch (err) {
        // V2 tokens expire mid-session; clear and retry once with a fresh token.
        // V3 generates per-command tokens so expiry cannot occur there.
        if (err.responseCode === TOKEN_EXPIRED_CODE && attempt === 0 && this.apiVersion !== API_VERSIONS.V3) {
          this.token = undefined
          continue
        }
        throw err
      }
    }
  }

  _socketDownloadLogs (encCmd, decryptionKey) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket()
      let phase = 'text'
      let logFileLen = 0
      const chunks = []
      let receivedLen = 0

      socket.connect(this.opts.port, this.opts.address, () => {
        socket.write(encCmd)
      })

      socket.on('data', (data) => {
        if (phase === 'text') {
          let resp
          try {
            const decoded = JSON.parse(data.toString())
            if (decoded.enc) {
              const decrypted = CryptoJS.AES.decrypt(decoded.enc, CryptoJS.SHA256(decryptionKey), { mode: CryptoJS.mode.ECB }).toString()
              resp = JSON.parse(hex2a(decrypted))
            } else {
              resp = decoded
            }
          } catch (e) {
            socket.destroy()
            reject(new Error('ERR_DOWNLOAD_LOGS_PARSE_FAILED'))
            return
          }

          const isOk = this.protocolHandler.isResponseOK(resp)
          if (!isOk) {
            socket.destroy()
            const code = resp.Code || resp.code
            const err = new Error(`ERR_DOWNLOAD_LOGS_FAILED: Code ${code}`)
            err.responseCode = code
            reject(err)
            return
          }

          const msg = resp.Msg || resp.msg || {}
          logFileLen = parseInt(msg.logfilelen || msg.logsize || '0')
          if (!logFileLen || logFileLen <= 0) {
            socket.destroy()
            reject(new Error('ERR_DOWNLOAD_LOGS_EMPTY'))
            return
          }
          phase = 'binary'
        } else {
          chunks.push(data)
          receivedLen += data.length
          if (receivedLen >= logFileLen) {
            socket.destroy()
            const logBuffer = Buffer.concat(chunks, logFileLen)
            resolve({ logFileLen, logBuffer })
          }
        }
      })

      socket.on('end', () => {
        if (phase === 'binary' && chunks.length > 0) {
          const logBuffer = Buffer.concat(chunks)
          resolve({ logFileLen: logBuffer.length, logBuffer })
        }
      })

      socket.on('error', (error) => { reject(error) })

      socket.setTimeout(60000, () => {
        socket.destroy()
        reject(new Error('ERR_DOWNLOAD_LOGS_TIMEOUT'))
      })
    })
  }

  async downloadLogs () {
    try {
      const result = await this._requestDownloadLogs()
      const { logBuffer } = result

      // Serve the raw binary via Hypercore/Hyperswarm (data plane).
      // Only tiny metadata is returned through HRPC (signal plane).
      const logCoreManager = this._getLogCoreManager()
      if (!logCoreManager) throw new Error('ERR_LOG_CORE_MANAGER_NOT_READY')
      const meta = await logCoreManager.serveLog(logBuffer, this.opts.id)

      // Also write a local debug file (metadata only, not raw bytes)
      this._saveResponseFile(meta)

      return { success: true, data: meta }
    } catch (e) {
      this.debugError('downloadLogs error', e)
      return { success: false, error_msg: e.message }
    }
  }

  _saveResponseFile (meta) {
    try {
      const logsDir = path.join(process.cwd(), 'logs')
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true })
      }
      const fileName = `download-logs-${this.opts.id || this.opts.address}-${Date.now()}.txt`
      fs.writeFileSync(
        path.join(logsDir, fileName),
        JSON.stringify(meta, null, 2)
      )
    } catch (fileErr) {
      this.debugError('downloadLogs failed to save response file', fileErr)
    }
  }

  validateWriteAction (...params) {
    const [action, ...args] = params

    if (action === 'setPowerMode') {
      const [mode] = args
      if (!['low', 'normal', 'high', 'sleep'].includes(mode)) {
        throw new Error('ERR_SET_POWER_MODE_INVALID')
      }
      return 1
    }

    if (action === 'downloadLogs') {
      return 1
    }

    return super.validateWriteAction(...params)
  }

  async getVersion () {
    const res = await this._requestReadEndpoint('get_version')

    return {
      chip: res.Msg.chip,
      platform: res.Msg.platform,
      whatsminer: {
        api: res.Msg.api_ver,
        firmware: res.Msg.fw_ver
      },
      apiVersion: this.apiVersion
    }
  }

  async getMinerStatus () {
    const res = await this._requestReadEndpoint('status')

    if (!res?.Msg || typeof res.Msg !== 'object') {
      return null
    }

    const msg = res.Msg
    const liquidTemp = parseFloat(msg.liquid_temp)
    const powerPct = parseFloat(msg.power_pct)
    return {
      mineroff: msg.mineroff === 'true',
      mineroff_reason: msg.mineroff_reason || '',
      mineroff_time: msg.mineroff_time || '',
      firmware_version: msg.FirmwareVersion || '',
      power_mode: msg.power_mode || '',
      power_limit_set: msg.power_limit_set || '',
      hash_percent: msg.hash_percent || '0',
      fast_mining: msg.fast_mining === 'true',
      fast_hash: msg.fast_hash === 'true',
      liquid_temp: !isNaN(liquidTemp) ? liquidTemp : 0,
      power_pct: !isNaN(powerPct) ? powerPct : 100
    }
  }

  async getMinerStats () {
    const res = await this._requestReadEndpoint('summary')

    if (!res?.SUMMARY?.[0]) {
      const errorMsg = res?.Msg || 'Unknown error'
      const errorCode = res?.Code || 0
      throw new Error(`ERR_MINER_STATS_FAILED: ${errorMsg} (Code: ${errorCode})`)
    }

    const summary = res.SUMMARY[0]
    const processedStats = {
      elapsed: summary.Elapsed,
      mhs_av: summary['MHS av'],
      mhs_5s: summary['MHS 5s'],
      mhs_1m: summary['MHS 1m'],
      mhs_5m: summary['MHS 5m'],
      mhs_15m: summary['MHS 15m'],
      prev_mhs: this._cachedPrevHashrate,
      hs_rt: summary['HS RT'],
      accepted: summary.Accepted,
      rejected: summary.Rejected,
      total_mh: summary['Total MH'],
      temperature: summary.Temperature,
      freq_avg: summary.freq_avg,
      fan_speed_in: summary['Fan Speed In'],
      fan_speed_out: summary['Fan Speed Out'],
      power: summary.Power,
      power_rate: summary['Power Rate'],
      pool_rejected: summary['Pool Rejected%'],
      pool_stale: summary['Pool Stale%'],
      uptime: summary.Uptime,
      hash_stable: summary['Hash Stable'],
      hash_stable_cost_seconds: summary['Hash Stable Cost Seconds'],
      hash_deviation: summary['Hash Deviation%'],
      target_freq: summary['Target Freq'],
      target_mhs: summary['Target MHS'],
      env_temp: summary['Env Temp'],
      power_mode: summary['Power Mode'],
      factory_ghs: summary['Factory GHS'],
      power_limit: summary['Power Limit'],
      chip_temp_min: summary['Chip Temp Min'],
      chip_temp_max: summary['Chip Temp Max'],
      chip_temp_avg: summary['Chip Temp Avg'],
      debug: summary.Debug,
      btminer_fast_boot: summary['Btminer Fast Boot']
    }

    this._cachedPrevHashrate = processedStats.mhs_5m

    return processedStats
  }

  async getPools () {
    const res = await this._requestReadEndpoint('pools')

    return res?.POOLS
      ? res.POOLS.map(pool => ({
        index: pool.POOL,
        url: pool.URL,
        status: pool.Status,
        priority: pool.Priority,
        quota: pool.Quota,
        getworks: pool.Getworks,
        accepted: pool.Accepted,
        rejected: pool.Rejected,
        stale: pool.Stale,
        works: pool.Works,
        discarded: pool.Discarded,
        get_failures: pool['Get Failures'],
        remote_failures: pool['Remote Failures'],
        user: pool.User,
        last_share_time: pool['Last Share Time'],
        stratum_active: pool['Stratum Active'],
        stratum_difficulty: pool['Stratum Difficulty'],
        pool_rejected: pool['Pool Rejected%'],
        pool_stale: pool['Pool Stale%'],
        bad_work: pool['Bad Work'],
        current_block_height: pool['Current Block Height'],
        current_block_version: pool['Current Block Version']
      }))
      : []
  }

  async restartMinerSoftware () {
    try {
      const res = await this._requestWriteEndpoint('restart_btminer')
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setPools (pools, appendId = true) {
    let oldPools = await this.getPools()

    oldPools = oldPools.map((pool) => ({
      ...pool,
      username: pool.user
    }))

    while (oldPools.length < 3) {
      oldPools.push({
        url: '',
        username: '',
        worker_password: ''
      })
    }

    pools = this._prepPools(pools, appendId, oldPools)

    if (pools === false) {
      this.debugError('Pools are same, skipping')
      return { success: true, message: 'Pools are same, skipping' }
    }

    const poolsData = {
      pool1: pools[0].url,
      worker1: pools[0].worker_name,
      passwd1: pools[0].worker_password,
      pool2: pools[1].url,
      worker2: pools[1].worker_name,
      passwd2: pools[1].worker_password,
      pool3: pools[2].url,
      worker3: pools[2].worker_name,
      passwd3: pools[2].worker_password
    }

    try {
      const res = await this._requestWriteEndpoint('update_pools', poolsData)
      this.reboot()

      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async factoryReset () {
    try {
      const res = await this._requestWriteEndpoint('factory_reset')
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async updateAdminPassword (newPassword) {
    try {
      const res = await this._requestWriteEndpoint('update_pwd', {
        old: this.opts.password,
        new: newPassword
      })
      this.opts.password = newPassword
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async enableWebPools () {
    try {
      const res = await this._requestWriteEndpoint('enable_web_pools')
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async disableWebPools () {
    try {
      const res = await this._requestWriteEndpoint('disable_web_pools')
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setHostname (hostname) {
    try {
      const res = await this._requestWriteEndpoint('set_hostname', { hostname })
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  reboot () {
    this._requestWriteEndpoint('reboot', { respbefore: 'true' }, false).catch(e => this.debugError('reboot_err', e))
    return { success: true }
  }

  async prePowerOn () {
    let res = await this._requestWriteEndpoint('pre_power_on').catch(e => this.debugError('pre_power_on_err', e))
    while (res?.Msg?.complete !== 'true') {
      await new Promise(r => setTimeout(r), 200)
      res = await this._requestWriteEndpoint('pre_power_on').catch(e => this.debugError('pre_power_on_err', e))
    }
    return { success: isResOK(res) }
  }

  async setTempOffset (offset) {
    // UNTESTED
    try {
      const res = await this._requestWriteEndpoint('set_temp_offset', { temp_offset: offset })
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setPowerOffCool (state) {
    // UNTESTED
    try {
      const res = await this._requestWriteEndpoint('set_poweroff_cool', { poweroff_cool: state ? '1' : '0' })
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setFanZeroSpeed (state) {
    // UNTESTED
    try {
      const res = await this._requestWriteEndpoint('set_fan_zero_speed', { fan_zero_speed: state ? '1' : '0' })
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setZone (timezone, zoneName) {
    try {
      await this._requestWriteEndpoint('set_zone', { timezone, zonename: zoneName })
      return { success: true }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  suspendMining () {
    this._requestWriteEndpoint('power_off', { respbefore: 'true' }).catch(e => this.debugError('suspend_err', e))
    return { success: true }
  }

  async resumeMining () {
    try {
      const res = await this._requestWriteEndpoint('power_on')
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setPowerMode (mode) {
    if (['low', 'normal', 'high'].indexOf(mode) > -1) {
      try {
        if (isResOK(await this._requestWriteEndpoint('power_on'))) {
          // no resp, will timeout
          this._requestWriteEndpoint(`set_${mode}_power`).catch(e => this.debugError('set_powermode_err', e))
        }
      } catch (e) {
        this.debugError('set_powermode_err', e)
      }
      return { success: true }
    } else if (mode === POWER_MODE.SLEEP) {
      return this.suspendMining()
    } else {
      throw new Error('ERR_INVALID_MODE')
    }
  }

  async setFrequency (percent) {
    try {
      const res = await this._requestWriteEndpoint('set_target_freq', { percent })
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async enableFastBoot () {
    try {
      const res = await this._requestWriteEndpoint('enable_btminer_fast_boot')
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async disableFastBoot () {
    try {
      const res = await this._requestWriteEndpoint('disable_btminer_fast_boot')
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setPowerLimit (power) {
    try {
      const res = await this._requestWriteEndpoint('adjust_power_limit', { power_limit: power.toString() })
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setUpfreqSpeed (speed) {
    try {
      const res = await this._requestWriteEndpoint('adjust_upfreq_speed', { upfreq_speed: speed.toString() })
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setPowerPct (pct) {
    try {
      const minerType = this.opts.type.split('-').pop()

      const liquidCooledTypes = [...MINER_COOLING_TYPE_MAP.HYDRO, ...MINER_COOLING_TYPE_MAP.IMMERSION]

      if (Number(pct) > 200) {
        return { success: false, error_msg: 'ERR_POWER_PCT_NOT_SUPPORTED: Power percentage of higher than 200% is not supported' }
      }

      if (Number(pct) > 100 && !liquidCooledTypes.includes(minerType)) {
        return { success: false, error_msg: 'ERR_POWER_PCT_NOT_SUPPORTED: Power percentage of higher than 100% is only supported for liquid-cooled miners' }
      }

      const res = await this._requestWriteEndpoint('set_power_pct_v2', { percent: pct.toString() })
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async setLED (enabled) {
    if (typeof enabled !== 'boolean') throw new Error('ERR_INVALID_ARG_TYPE')
    try {
      if (enabled) {
        const res = await this._requestWriteEndpoint('set_led', {
          color: 'red',
          period: 200,
          duration: 100,
          start: 0
        })
        const res2 = await this._requestWriteEndpoint('set_led', {
          color: 'green',
          period: 200,
          duration: 100,
          start: 0
        })
        setTimeout(() => {
          this.setLED(false)
        }, 2 * 60 * 1000)
        return { success: isResOK(res) && isResOK(res2) }
      } else {
        const res = await this._requestWriteEndpoint('set_led', { param: 'auto' })
        return { success: isResOK(res) }
      }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async getDevices () {
    const res = await this._requestReadEndpoint('edevs')

    return res?.DEVS?.map(device => ({
      index: device.ASC,
      slot: device.Slot,
      enabled: device.Enabled,
      status: device.Status,
      temperature: device.Temperature,
      chip_frequency: device['Chip Frequency'],
      mhs_av: device['MHS av'],
      mhs_5s: device['MHS 5s'],
      mhs_1m: device['MHS 1m'],
      mhs_5m: device['MHS 5m'],
      mhs_15m: device['MHS 15m'],
      hs_rt: device['HS RT'],
      factory_ghs: device['Factory GHS'],
      upfreq_complete: device['Upfreq Complete'],
      effective_chips: device['Effective Chips'],
      pcb_sn: device['PCB SN'],
      chip_data: device['Chip Data'],
      chip_temp_min: device['Chip Temp Min'],
      chip_temp_max: device['Chip Temp Max'],
      chip_temp_avg: device['Chip Temp Avg'],
      chip_vol_diff: device.chip_vol_diff
    }))
  }

  async getDevicesInfo () {
    const res = await this._requestReadEndpoint('devdetails')

    return res?.DEVDETAILS?.map(device => ({
      index: device.DEVDETAILS,
      name: device.Name,
      id: device.ID,
      driver: device.Driver,
      kernel: device.Kernel,
      model: device.Model
    }))
  }

  async getPSUInformation () {
    const res = await this._requestReadEndpoint('get_psu')

    return {
      name: res.Msg.name,
      version: {
        hardware: res.Msg.hw_version,
        software: res.Msg.sw_version
      },
      model: res.Msg.model,
      fanSpeed: res.Msg.fan_speed,
      powerInput: {
        current: res.Msg.iin,
        voltage: res.Msg.vin
      },
      serialNumber: res.Msg.serial_no,
      vendor: res.Msg.vender
    }
  }

  async searchFirmwareById (id) {
    if (!this.opts?.findFirmware) throw new Error('ERR_FIRMWARE_LOOKUP_NOT_AVAILABLE')
    return await this.opts.findFirmware(id)
  }

  async updateFirmware (firmwareId) {
    try {
      const firmware = await this.searchFirmwareById(firmwareId)
      const res = await this._requestWriteFirmwareEndpoint(firmware)
      return { data: res }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async getErrors () {
    const res = await this._requestReadEndpoint('get_error_code')

    return res?.Msg?.error_code?.map(data => {
      const code = Object.keys(data)[0]

      return {
        name: getErrorMsg(code),
        message: `Error code ${code}`,
        code
      }
    })
  }

  async setNetworkInformation (network) {
    try {
      const res = await this._requestWriteEndpoint('net_config',
        network.dhcp === true
          ? {
              param: 'dhcp'
            }
          : {
              ip: network.network.ip,
              mask: network.network.mask,
              gate: network.network.gateway,
              dns: network.dns.join(' '),
              host: ''
            }
      )
      return { success: isResOK(res) }
    } catch (e) {
      this.debugError(e)
      return { success: false, error_msg: e.message }
    }
  }

  async getMinerInfo () {
    const res = await this._requestReadEndpoint('get_miner_info')
    return res?.Msg
  }

  checkIfAllErrorsAreMinor (errors) {
    const minerType = this.opts.type
    if (minerType.includes('m56s') || minerType.includes('m30')) {
      return errors.every(error => MINOR_ERROR_CODES_M56S_M30_SET.has(error))
    } else if (minerType.includes('m53')) {
      return errors.every(error => MINOR_ERROR_CODES_M53_SET.has(error))
    }
    return false
  }

  async _prepSnap () {
    const data = await async.parallelLimit({
      stats: this.getMinerStats.bind(this),
      pools: this.getPools.bind(this),
      devices: this.getDevices.bind(this),
      errors: this.getErrors.bind(this),
      miner_info: this.getMinerInfo.bind(this),
      version: this.getVersion.bind(this),
      miner_status: this.getMinerStatus.bind(this)
    }, 3)

    this._handleErrorUpdates(data.errors)

    const isErrored = data.errors.length > 0

    return {
      stats: {
        status: this._getStatus(isErrored, data.stats),
        errors: isErrored ? data.errors : undefined,
        are_all_errors_minor: data?.errors?.length ? this.checkIfAllErrorsAreMinor(data.errors) : false,
        power_w: this._calcPowerW(data.stats),
        efficiency_w_ths: this._calcEfficiency(data.stats),
        nominal_efficiency_w_ths: this.opts.nominalEfficiencyWThs || 0,
        pool_status: data.pools.map((pool) => ({
          pool: pool.url,
          accepted: parseInt(pool.accepted),
          rejected: parseInt(pool.rejected),
          stale: parseInt(pool.stale)
        })),
        all_pools_shares: this._calcNewShares(data.pools),
        uptime_ms: parseFloat(data.stats.elapsed) * 1000,
        hashrate_mhs: this._calcHashrates(data.stats),
        frequency_mhz: {
          avg: Math.floor(parseFloat(data.stats.freq_avg) * 100) / 100,
          target: parseFloat(data.stats.target_freq),
          chips: data.devices.map((device, index) => ({
            index,
            current: Math.floor(parseFloat(device.chip_frequency) * 100) / 100
          }))
        },
        temperature_c: {
          ambient: Math.floor(parseFloat(data.stats.env_temp) * 100) / 100,
          max: Math.floor(Math.max(...data.devices.map((device) => parseFloat(device.chip_temp_max))) * 100) / 100,
          avg: this._calcAvgTemp(data.devices),
          chips: data.devices.map((device, index) => ({
            index,
            max: Math.floor(parseFloat(device.chip_temp_max) * 100) / 100,
            min: Math.floor(parseFloat(device.chip_temp_min) * 100) / 100,
            avg: Math.floor(parseFloat(device.chip_temp_avg) * 100) / 100
          })),
          pcb: data.devices.map((device, index) => ({
            index,
            current: Math.floor(parseFloat(device.temperature) * 100) / 100
          }))
        },
        miner_specific: {
          upfreq_speed: data.miner_info.upfreq_speed ? parseFloat(data.miner_info.upfreq_speed) : undefined,
          fast_mining: data.miner_status?.fast_mining || false,
          fast_hash: data.miner_status?.fast_hash || false,
          hash_percent: data.miner_status?.hash_percent || '0',
          liquid_temp: data.miner_status?.liquid_temp || 0,
          power_pct: data.miner_status?.power_pct || 100
        }
      },
      config: {
        network_config: {
          mode: data.miner_info.proto,
          ip_address: data.miner_info.ip,
          dns: data.miner_info.dns.split(' '),
          ip_gw: data.miner_info.gateway,
          ip_netmask: data.miner_info.netmask
        },
        pool_config: data.pools.map((pool) => ({
          url: pool.url,
          username: pool.user
        })),
        power_mode: data.miner_status?.power_mode || this._getPowerMode(data.stats),
        suspended: data.miner_status ? data.miner_status.mineroff : this._isSuspended(data.stats),
        led_status: data.miner_info.ledstat !== 'auto',
        firmware_ver: data.version.whatsminer.firmware,
        api_version: this.apiVersion
      }
    }
  }

  _getStatus (isErrored, stats) {
    if (isErrored) return STATUS.ERROR
    const currentHashrate = parseFloat(stats.mhs_av) || 0
    return currentHashrate > 0 ? STATUS.MINING : STATUS.SLEEPING
  }

  _isSuspended (stats) {
    return parseFloat(stats.mhs_av) === 0
  }

  _calcPowerW (stats) {
    return Math.floor(parseFloat(stats.power) * 100) / 100
  }

  _calcAvgTemp (devices) {
    return Math.floor(devices.reduce((acc, device) =>
      acc + parseFloat(device.chip_temp_avg), 0) / devices.length * 100) / 100
  }

  _getPowerMode (stats) {
    if (parseFloat(stats.mhs_av) === 0) return POWER_MODE.SLEEP
    return stats.power_mode?.toLowerCase()
  }

  _calcEfficiency (stats) {
    return Math.floor(parseFloat(stats.power_rate) * 100) / 100
  }

  _calcHashrates (stats) {
    return {
      avg: Math.floor(parseFloat(stats.mhs_av) * 100) / 100,
      t_5s: Math.floor(parseFloat(stats.mhs_5s) * 100) / 100,
      t_1m: Math.floor(parseFloat(stats.mhs_1m) * 100) / 100,
      t_5m: Math.floor(parseFloat(stats.mhs_5m) * 100) / 100,
      t_15m: Math.floor(parseFloat(stats.mhs_15m) * 100) / 100
    }
  }
}

module.exports = WhatsminerMiner
