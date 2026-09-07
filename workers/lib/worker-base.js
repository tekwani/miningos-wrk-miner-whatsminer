'use strict'

const WrkRack = require('@tetherto/miningos-tpl-wrk-miner/workers/rack.miner.wrk')
const Miner = require('./miner.js')
const TcpFacility = require('@tetherto/svc-facs-tcp')
const async = require('async')
const LogCoreManager = require('./log-core-manager')
const path = require('path')
const fs = require('fs/promises')

const lWrkFunLogs = require('@tetherto/miningos-tpl-wrk-thing/workers/lib/wrk-fun-logs')
const { groupByMinerInfo } = require('./utils')

const DEFAULT_PORT = 4028
const { DAILY_STAT_KEY, DAILY_POSITION_KEY, DEFAULT_NOMINAL_EFFICIENCY_WTHS } = require('./constants')
const { ApiHandlerFactory } = require('./protocols')

class WrkMinerRack extends WrkRack {
  init () {
    super.init()

    this.setInitFacs([
      ['fac', '@tetherto/svc-facs-tcp', '0', '0', {}, 0]
    ])
  }

  _start (cb) {
    async.series([
      (next) => { super._start(next) },
      (next) => {
        // Facilities are ready after super._start — construct LogCoreManager here
        // so it can receive live net_r0 and store_s0 facility references.
        const logCoreCfg = this.conf?.thing?.miner?.logCoreManager || {}
        this.logCoreManager = new LogCoreManager({
          netFac: this.net_r0,
          storeFac: this.store_s0,
          ttlMs: logCoreCfg.ttlMs
        })

        this._addWhitelistedActions([
          ['setPowerPct', 1],
          ['downloadLogs', 1]
        ])

        next()
      }
    ], cb)
  }

  async _stop (cb) {
    try {
      await this.logCoreManager?.cleanupAll()
    } catch (e) {
      this.debugError('logCoreManager cleanupAll error', e)
    }
    super._stop(cb)
  }

  getThingType () {
    return super.getThingType() + '-wm'
  }

  async buildStats (sk, fireTime) {
    if (sk === DAILY_STAT_KEY) {
      try {
        await this.saveDailyPositionStats(fireTime)
      } catch (e) {
        this.debugError('ERR_DAILY_POSITION_STATS_SAVE', e)
      }
    }

    return super.buildStats(sk, fireTime)
  }

  async saveDailyPositionStats (time) {
    const ts = Math.floor(time.getTime() / 1000) * 1000
    const row = {
      ts,
      status_group: {},
      hashrate_mhs_1m_group: {},
      power_w_group: {},
      power_mode_group: {},
      temperature_c_group: {}
    }

    for (const thg of Object.values(this.mem.things)) {
      if (!thg?.info?.container || !thg.info.pos) continue

      const key = groupByMinerInfo(null, thg)
      const snap = thg.last?.snap
      const stats = snap?.stats

      if (stats?.status !== undefined) row.status_group[key] = stats.status
      if (stats?.hashrate_mhs?.t_1m !== undefined) row.hashrate_mhs_1m_group[key] = stats.hashrate_mhs.t_1m
      if (stats?.power_w !== undefined) row.power_w_group[key] = stats.power_w
      if (snap?.config?.power_mode !== undefined) row.power_mode_group[key] = snap.config.power_mode
      if (stats?.temperature_c) row.temperature_c_group[key] = stats.temperature_c
    }

    await lWrkFunLogs.saveLogData.call(this, `${DAILY_POSITION_KEY}-t-miner`, ts, row, 0, true)
  }

  getThingTags () {
    return ['whatsminer']
  }

  getSpecTags () {
    return ['miner']
  }

  getMinerDefaultPort () {
    return super.getMinerDefaultPort() || DEFAULT_PORT
  }

  _getDefaultPortForVersion (apiVersion) {
    if (apiVersion) {
      return ApiHandlerFactory.getDefaultPort(apiVersion)
    }
    return DEFAULT_PORT
  }

  getNominalEficiencyWThs () {
    return super.getNominalEficiencyWThs(DEFAULT_NOMINAL_EFFICIENCY_WTHS)
  }

  async collectThingSnap (thg) {
    return thg.ctrl.getSnap()
  }

  async registerThingHook0 (thg) {
    await super.registerThingHook0(thg)

    if (!thg.info) {
      thg.info = {}
    }

    if (thg.opts.apiVersion) {
      thg.info.apiVersion = thg.opts.apiVersion
    }
  }

  async updateThingHook0 (thg, thgPrev) {
    await super.updateThingHook0(thg, thgPrev)

    if (thg.opts.apiVersion && thg.opts.apiVersion !== thg.info?.apiVersion) {
      if (!thg.info) {
        thg.info = {}
      }
      thg.info.apiVersion = thg.opts.apiVersion
    }
  }

  async connectThing (thg) {
    const { username, password } = this._getThingCredentials(thg)
    if (!thg.opts.address || !thg.opts.port || !password) {
      return 0
    }

    const apiVersion = thg.opts.apiVersion || thg.info?.apiVersion || null
    const port = thg.opts.port || this._getDefaultPortForVersion(apiVersion)

    const miner = new Miner({
      ...thg.opts,
      username,
      password,
      port,
      apiVersion,
      socketer: {
        readStrategy: TcpFacility.TCP_READ_STRATEGY.ON_END,
        rpc: (opts) => {
          return this.tcp_0.getRPC(opts)
        }
      },
      conf: this.conf.thing.miner || {},
      id: thg.id,
      nominalEfficiencyWThs: this.getNominalEficiencyWThs(),
      type: thg.type,
      getLogCoreManager: () => this.logCoreManager,
      findFirmware: this.getFirmwareById.bind(this)
    })

    await miner.init()

    if (!thg.info) {
      thg.info = {}
    }
    thg.info.apiVersion = miner.apiVersion

    miner.on('error', e => {
      this.debugThingError(thg, e)
    })

    thg.ctrl = miner

    return 1
  }

  async getFirmwareById (id) {
    const firmwares = await this.listFirmwares()
    const firmware = firmwares.find((fw) => fw.id === id)
    if (!firmware) throw new Error('ERR_FIRMWARE_NOT_FOUND')
    const dir = this.conf.thing.dirFirmwares || 'firmwares'
    const filePath = path.join(dir, firmware.file)

    try {
      await fs.access(filePath)
    } catch {
      throw new Error('ERR_FIRMWARE_FILE_NOT_FOUND')
    }

    return filePath
  }
}

module.exports = WrkMinerRack
