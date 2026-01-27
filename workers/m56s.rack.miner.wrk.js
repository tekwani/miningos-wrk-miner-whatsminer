'use strict'

const WrkMinerRack = require('./lib/worker-base.js')

class WrkMinerRackM56s extends WrkMinerRack {
  getThingType () {
    return super.getThingType() + '-m56s'
  }
}

module.exports = WrkMinerRackM56s
