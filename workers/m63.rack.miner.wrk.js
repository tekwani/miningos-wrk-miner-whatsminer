'use strict'

const WrkMinerRack = require('./lib/worker-base.js')
const async = require('async')

class WrkMinerRackM63 extends WrkMinerRack {
  getThingType () {
    return super.getThingType() + '-m63'
  }

  getSpecTags () {
    return super.getSpecTags().concat([this.getThingType()])
  }

  _start (cb) {
    async.series([
      (next) => { super._start(next) },
      (next) => {
        this._addWhitelistedActions([
          ['setUpfreqSpeed', 2]
        ])

        next()
      }
    ], cb)
  }
}

module.exports = WrkMinerRackM63
