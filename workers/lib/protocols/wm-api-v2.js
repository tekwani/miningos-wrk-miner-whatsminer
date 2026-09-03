'use strict'

const WMApiBase = require('./wm-api-base')
const md5 = require('../utils/md5')
const hex2a = require('../utils/hex2a')
const { aesEncrypt, aesDecryptHex } = require('../utils/crypto')
const { API_VERSIONS, API_DEFAULTS, RESPONSE_CODES } = require('./constants')

/**
 * Protocol handler for Whatsminer API v2.0.5
 * Uses token-based authentication with MD5 crypt and AES-256 ECB encryption
 */
class WMApiV2 extends WMApiBase {
  constructor (opts) {
    super(opts)
    this.token = undefined
  }

  static get VERSION () {
    return API_VERSIONS.V2
  }

  static get DEFAULT_PORT () {
    return API_DEFAULTS[API_VERSIONS.V2].port
  }

  getAuthCommand () {
    return API_DEFAULTS[API_VERSIONS.V2].authCommand
  }

  async authenticate () {
    const res = await this.requestRead(this.getAuthCommand())

    // Check error code for firmware v#20230911.12
    if (res?.Code === RESPONSE_CODES.IP_LIMIT) {
      throw new Error('ERR_TOKEN_FETCH_IP_LIMIT')
    }

    const key = md5.crypt(this.password, res.Msg.salt)
    const arr = key.split('$')
    const sign = md5.crypt(arr[arr.length - 1] + res.Msg.time, res.Msg.newsalt)
    const tmp = sign.split('$')
    const token = `${res.Msg.time},${res.Msg.newsalt},` + tmp[tmp.length - 1]

    this.token = {
      token,
      sign: tmp[tmp.length - 1],
      key: arr[arr.length - 1]
    }

    return this.token
  }

  async refreshToken () {
    try {
      this.token = await this.authenticate()
    } catch (e) {
      this.debugError('_refreshToken error', e)
      throw e
    }
  }

  async requestRead (command, params = {}) {
    const cmd = {
      cmd: command,
      ...params
    }
    this.debugError(`Sending command ${JSON.stringify(cmd)}`)
    try {
      const res = await this._requestMiner(cmd)
      this.debugError(`Received response ${JSON.stringify(res)}`)
      return res
    } catch (error) {
      this.debugError(error)
      throw new Error('ERR_READ_FAILED')
    }
  }

  async requestWrite (command, params = {}, json = true) {
    let retry = 0
    let err = null

    while (retry < 3) {
      try {
        if (this.token === undefined) {
          await this.refreshToken()
        }
        const { sign, key } = this.token
        const cmd = JSON.stringify({
          token: sign,
          cmd: command,
          ...params
        })
        this.debugError(`Sending command ${cmd}`)
        const data = aesEncrypt(cmd, key)
        const encCmd = {
          enc: 1,
          data
        }

        const res = await this._requestMiner(encCmd, json)

        // Cases when we only need to write to miner and there is no response, e.g: reboot
        if (res.length === 0) {
          return null
        }
        if (!res.enc) {
          this.debugError(`Received response ${JSON.stringify(res)}`)
          throw new Error(this._getAPICodeMsg(res))
        }

        const decrypted = aesDecryptHex(res.enc, key)
        const response = JSON.parse(hex2a(decrypted))
        if (response.Code === RESPONSE_CODES.TOKEN_EXPIRED) {
          // Retry with fresh token
          this.token = undefined
          retry++
          continue
        }
        this.debugError(`Received response ${JSON.stringify(response)}`)
        return response
      } catch (e) {
        err = e
        this.token = undefined
        retry++
      }
    }

    if (err) {
      this.debugError('write_err', err)
      throw err
    }
    return null
  }

  async _requestMiner (command, json = true) {
    const response = await this.rpc.request(JSON.stringify(command))
    return json ? JSON.parse(response) : response
  }

  _getAPICodeMsg (res) {
    const codeMessages = {
      14: 'ERR_INVALID_CMD',
      23: 'ERR_JSON_CMD',
      45: 'ERR_PERMISSION_DENIED',
      131: 'OK',
      135: 'ERR_TOKEN_EXPIRED',
      136: 'ERR_IP_LIMIT'
    }
    return codeMessages[res?.Code] || `ERR_UNKNOWN_CODE_${res?.Code}`
  }

  transformCommand (command) {
    // V2 handler uses commands as-is (underscore format)
    return command
  }

  /**
   * V2 doesn't use status params - return null
   */
  getStatusParam (command) {
    return null
  }

  parseResponse (response, originalCommand) {
    if (!response || response.Code !== 131) {
      return response
    }

    const commandKeyMap = {
      summary: 'SUMMARY',
      pools: 'POOLS',
      edevs: 'DEVS',
      devdetails: 'DEVDETAILS',
      get_miner_info: 'Msg',
      get_version: 'Msg'
    }

    const key = commandKeyMap[originalCommand]
    if (key && response.Msg) {
      if (key === 'Msg') {
        return response
      }
      return {
        ...response,
        [key]: Array.isArray(response.Msg) ? response.Msg : [response.Msg]
      }
    }

    return response
  }

  /**
   * Get the current token info (for external use like firmware updates)
   * @returns {{token: string, sign: string, key: string}|undefined}
   */
  getTokenInfo () {
    return this.token
  }

  /**
   * Clear the current token
   */
  clearToken () {
    this.token = undefined
  }
}

module.exports = WMApiV2
