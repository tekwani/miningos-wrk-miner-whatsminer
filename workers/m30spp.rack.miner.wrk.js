'use strict'

const WrkMinerRack = require('./lib/worker-base.js')

class WrkMinerRackM30spp extends WrkMinerRack {
  getThingType () {
    return super.getThingType() + '-m30spp'
  }
}

module.exports = WrkMinerRackM30spp
