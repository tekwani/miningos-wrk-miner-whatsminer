'use strict'

module.exports = (v) => {
  v.setLED.stages[1].wait = 500
  v.setPowerModeLow.stages[1].wait = 2000
  v.setPowerModeNormal.stages[1].wait = 2000
  v.setPowerModeHigh.stages[1].wait = 2000
}
