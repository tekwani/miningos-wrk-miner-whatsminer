'use strict'

const WrkMinerRack = require('./lib/worker-base.js')

class WrkMinerRackM30sp extends WrkMinerRack {
  getThingType () {
    return super.getThingType() + '-m30sp'
  }
}

module.exports = WrkMinerRackM30sp
