'use strict'

/**
 * Abstract base class defining the protocol interface for Whatsminer API handlers.
 * Implementations must override all methods.
 */
class WMApiBase {
  constructor (opts) {
    if (new.target === WMApiBase) {
      throw new Error('WMApiBase is an abstract class and cannot be instantiated directly')
    }
    this.opts = opts
    this.rpc = opts.rpc
    this.password = opts.password
    this.username = opts.username
    this.debugError = opts.debugError || (() => {})
  }

  /**
   * Returns the API version this handler supports
   * @returns {string}
   */
  static get VERSION () {
    throw new Error('VERSION must be implemented by subclass')
  }

  /**
   * Returns the default port for this API version
   * @returns {number}
   */
  static get DEFAULT_PORT () {
    throw new Error('DEFAULT_PORT must be implemented by subclass')
  }

  /**
   * Authenticates with the miner and returns token information
   * @returns {Promise<{token: string, sign: string, key: string}>}
   */
  async authenticate () {
    throw new Error('authenticate must be implemented by subclass')
  }

  /**
   * Sends a read-only command to the miner (no encryption needed)
   * @param {string} command - The command to send
   * @param {Object} params - Additional parameters
   * @returns {Promise<Object>}
   */
  async requestRead (command, params = {}) {
    throw new Error('requestRead must be implemented by subclass')
  }

  /**
   * Sends a write command to the miner (requires encryption)
   * @param {string} command - The command to send
   * @param {Object} params - Additional parameters
   * @param {boolean} json - Whether to parse response as JSON
   * @returns {Promise<Object|null>}
   */
  async requestWrite (command, params = {}, json = true) {
    throw new Error('requestWrite must be implemented by subclass')
  }

  /**
   * Transforms a command from v2 format to the appropriate format for this handler
   * @param {string} command - The command in v2 format
   * @returns {string}
   */
  transformCommand (command) {
    return command
  }

  /**
   * Parses a response from the miner
   * @param {Object} response - The raw response
   * @param {string} originalCommand - The original command sent
   * @returns {Object}
   */
  parseResponse (response, originalCommand) {
    return response
  }

  /**
   * Gets the authentication command for this API version
   * @returns {string}
   */
  getAuthCommand () {
    throw new Error('getAuthCommand must be implemented by subclass')
  }

  /**
   * Checks if the response indicates success
   * Supports both V2 (Code: 131) and V3 (code: 0) formats
   * @param {Object} response
   * @returns {boolean}
   */
  isResponseOK (response) {
    // V3 format
    if (response?.code !== undefined) {
      return response.code === 0
    }
    // V2 format
    return response?.Code === 131
  }
}

module.exports = WMApiBase
