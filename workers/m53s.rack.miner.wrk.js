'use strict'

const WrkMinerRack = require('./lib/worker-base.js')

class WrkMinerRackM53s extends WrkMinerRack {
  getThingType () {
    return super.getThingType() + '-m53s'
  }
}

module.exports = WrkMinerRackM53s
