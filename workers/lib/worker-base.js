'use strict'

const WrkRack = require('miningos-tpl-wrk-miner/workers/rack.miner.wrk')
const Miner = require('./miner.js')
const TcpFacility = require('svc-facs-tcp')
const async = require('async')

const DEFAULT_PORT = 4028
const { DEFAULT_NOMINAL_EFFICIENCY_WTHS } = require('./constants')

class WrkMinerRack extends WrkRack {
  init () {
    super.init()

    this.setInitFacs([
      ['fac', 'svc-facs-tcp', '0', '0', {}, 0]
    ])
  }

  _start (cb) {
    async.series([
      (next) => { super._start(next) },
      (next) => {
        this._addWhitelistedActions([
          ['setPowerPct', 1]
        ])

        next()
      }
    ], cb)
  }

  getThingType () {
    return super.getThingType() + '-wm'
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

  getNominalEficiencyWThs () {
    return super.getNominalEficiencyWThs(DEFAULT_NOMINAL_EFFICIENCY_WTHS)
  }

  async collectThingSnap (thg) {
    return thg.ctrl.getSnap()
  }

  async connectThing (thg) {
    if (!thg.opts.address || !thg.opts.port || !thg.opts.password) {
      return 0
    }

    const miner = new Miner({
      ...thg.opts,
      socketer: {
        readStrategy: TcpFacility.TCP_READ_STRATEGY.ON_END,
        rpc: (opts) => {
          return this.tcp_0.getRPC(opts)
        }
      },
      conf: this.conf.thing.miner || {},
      id: thg.id,
      nominalEfficiencyWThs: this.getNominalEficiencyWThs(),
      type: thg.type
    })

    miner.on('error', e => {
      this.debugThingError(thg, e)
    })

    thg.ctrl = miner

    return 1
  }
}

module.exports = WrkMinerRack
