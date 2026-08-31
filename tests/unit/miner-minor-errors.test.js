'use strict'

const test = require('brittle')
const WhatsminerMiner = require('../../workers/lib/miner')

// checkIfAllErrorsAreMinor only reads this.opts.type, so it can be exercised on the
// prototype without standing up a miner connection.
function checkIfAllErrorsAreMinor (type, errors) {
  return WhatsminerMiner.prototype.checkIfAllErrorsAreMinor.call({ opts: { type } }, errors)
}

test('miner - m63 and m63spp use the m56s/m30 minor error table', (t) => {
  // 714 network_connection_unstable: a miner keeps hashing through it, so it must not
  // be classed as a major error or the site header stops counting the miner.
  t.ok(checkIfAllErrorsAreMinor('miner-wm-m63', [714]), 'm63 treats 714 as minor')
  t.ok(checkIfAllErrorsAreMinor('miner-wm-m63spp', [714]), 'm63spp treats 714 as minor')
  t.ok(checkIfAllErrorsAreMinor('miner-wm-m63spp', [714, 203]), 'all-minor set stays minor')
  t.absent(checkIfAllErrorsAreMinor('miner-wm-m63spp', [714, 999]), 'one major error wins')
})

test('miner - existing models keep their minor error tables', (t) => {
  t.ok(checkIfAllErrorsAreMinor('miner-wm-m56s', [714]), 'm56s treats 714 as minor')
  t.ok(checkIfAllErrorsAreMinor('miner-wm-m30spp', [714]), 'm30spp treats 714 as minor')
  t.ok(checkIfAllErrorsAreMinor('miner-wm-m53s', [202]), 'm53s uses its own table')
  t.absent(checkIfAllErrorsAreMinor('miner-wm-m53s', [714]), '714 is not minor for m53s')
})

test('miner - unknown model reports errors as major', (t) => {
  t.absent(checkIfAllErrorsAreMinor('miner-wm-x99', [714]), 'unknown model stays major')
  t.absent(checkIfAllErrorsAreMinor(undefined, [714]), 'missing type does not throw')
})
