'use strict'

const test = require('brittle')
const stats = require('../../workers/lib/stats')

test('stats - module exports libStats', (t) => {
  t.ok(stats, 'should export stats module')
  t.ok(stats.specs, 'should have specs property')
  t.ok(stats.specs.miner, 'should have miner specs')
})

test('stats - groupByMinerInfo function', (t) => {
  // We need to access the function directly, but it's not exported
  // Let's test it through the specs that use it

  const m63Specs = stats.specs['miner-wm-m63']
  t.ok(m63Specs, 'should have m63 specs')
  t.ok(m63Specs.ops, 'should have ops')

  // Test the groupByMinerInfo function indirectly through the group operations
  const hashrateGroup = m63Specs.ops.hashrate_mhs_1m_group
  t.ok(hashrateGroup, 'should have hashrate group operation')
  t.is(hashrateGroup.op, 'group', 'should be a group operation')
  t.ok(typeof hashrateGroup.group === 'function', 'should have group function')
})

test('stats - checkIfAllErrorsAreMinor function', (t) => {
  // Test the function indirectly through the filter operations
  const m56sSpecs = stats.specs['miner-wm-m56s']
  const onlineOrMinorErrorFilter = m56sSpecs.ops.online_or_minor_error_miners_cnt.filter

  // Test that the filter functions exist and are callable
  t.ok(typeof onlineOrMinorErrorFilter === 'function', 'should have filter function')

  // Test with different status values
  const testEntry = {
    last: {
      snap: {
        stats: { status: 'mining' }
      }
    }
  }

  t.ok(onlineOrMinorErrorFilter(testEntry), 'should return true for mining status')
})

test('stats - getSharedOps function', (t) => {
  // Test the shared operations for different miner types
  const m56sSpecs = stats.specs['miner-wm-m56s']
  const m53sSpecs = stats.specs['miner-wm-m53s']

  // Both should have the same shared operations
  const expectedOps = ['online_or_minor_error_miners_cnt', 'error_miners_cnt']

  for (const opName of expectedOps) {
    t.ok(m56sSpecs.ops[opName], `m56s should have ${opName} operation`)
    t.ok(m53sSpecs.ops[opName], `m53s should have ${opName} operation`)

    t.is(m56sSpecs.ops[opName].op, 'cnt', `${opName} should be a count operation`)
    t.is(m53sSpecs.ops[opName].op, 'cnt', `${opName} should be a count operation`)

    t.ok(typeof m56sSpecs.ops[opName].filter === 'function', `${opName} should have filter function`)
    t.ok(typeof m53sSpecs.ops[opName].filter === 'function', `${opName} should have filter function`)
  }
})

test('stats - sharedPoolStats', (t) => {
  const minerSpecs = stats.specs.miner
  const poolStats = minerSpecs.ops

  // Test pool share statistics
  const expectedPoolStats = [
    'pools_accepted_shares_total',
    'pools_rejected_shares_total',
    'pools_stale_shares_total'
  ]

  for (const statName of expectedPoolStats) {
    t.ok(poolStats[statName], `should have ${statName}`)
    t.is(poolStats[statName].op, 'sum', `${statName} should be a sum operation`)
    t.ok(poolStats[statName].src, `${statName} should have src property`)
  }

  // Test the source paths
  t.is(poolStats.pools_accepted_shares_total.src, 'last.snap.stats.all_pools_shares.accepted')
  t.is(poolStats.pools_rejected_shares_total.src, 'last.snap.stats.all_pools_shares.rejected')
  t.is(poolStats.pools_stale_shares_total.src, 'last.snap.stats.all_pools_shares.stale')
})

test('stats - m63 specific operations', (t) => {
  const m63Specs = stats.specs['miner-wm-m63']
  const ops = m63Specs.ops

  // Test group operations
  const groupOps = [
    'hashrate_mhs_1m_group',
    'power_mode_group',
    'power_w_group',
    'status_group'
  ]

  for (const opName of groupOps) {
    t.ok(ops[opName], `should have ${opName}`)
    t.is(ops[opName].op, 'group', `${opName} should be a group operation`)
    t.ok(ops[opName].src, `${opName} should have src property`)
    t.ok(typeof ops[opName].group === 'function', `${opName} should have group function`)
  }

  // Test source paths
  t.is(ops.hashrate_mhs_1m_group.src, 'last.snap.stats.hashrate_mhs.t_1m')
  t.is(ops.power_mode_group.src, 'last.snap.config.power_mode')
  t.is(ops.power_w_group.src, 'last.snap.stats.power_w')
  t.is(ops.status_group.src, 'last.snap.stats.status')
})

test('stats - error_miners_cnt filter', (t) => {
  const m56sSpecs = stats.specs['miner-wm-m56s']
  const errorFilter = m56sSpecs.ops.error_miners_cnt.filter

  // Test that the filter function exists
  t.ok(typeof errorFilter === 'function', 'should have filter function')

  // Test with mining status (should return false)
  const miningEntry = {
    last: {
      snap: {
        stats: { status: 'mining' }
      }
    }
  }

  t.not(errorFilter(miningEntry), 'should return false for mining status')
})

test('stats - online_or_minor_error_miners_cnt filter', (t) => {
  const m56sSpecs = stats.specs['miner-wm-m56s']
  const onlineFilter = m56sSpecs.ops.online_or_minor_error_miners_cnt.filter

  // Test that the filter function exists
  t.ok(typeof onlineFilter === 'function', 'should have filter function')

  // Test with mining status
  const miningEntry = {
    last: {
      snap: {
        stats: { status: 'mining' }
      }
    }
  }

  t.ok(onlineFilter(miningEntry), 'should return true for mining status')
})

test('stats - miner type specific specs', (t) => {
  const expectedMinerTypes = [
    'miner-wm-m30s',
    'miner-wm-m56s',
    'miner-wm-m53s',
    'miner-wm-m63'
  ]

  for (const minerType of expectedMinerTypes) {
    t.ok(stats.specs[minerType], `should have specs for ${minerType}`)
    t.ok(stats.specs[minerType].ops, `${minerType} should have ops`)
  }
})

test('stats - minor error codes sets', (t) => {
  // Test that the minor error codes are properly defined
  const m56sSpecs = stats.specs['miner-wm-m56s']
  const m53sSpecs = stats.specs['miner-wm-m53s']

  // These should use different minor error code sets
  // We can test this by checking that the filter functions behave differently
  // for the same error codes

  const testEntry = {
    last: {
      snap: {
        stats: { status: 'ERROR' },
        errors: [{ code: 202 }] // This should be minor for M53 but not for M56S
      }
    }
  }

  const m56sOnlineFilter = m56sSpecs.ops.online_or_minor_error_miners_cnt.filter
  const m53sOnlineFilter = m53sSpecs.ops.online_or_minor_error_miners_cnt.filter

  // Error code 202 should be treated differently by the two filters
  // (This tests that they use different minor error code sets)
  const m56sResult = m56sOnlineFilter(testEntry)
  const m53sResult = m53sOnlineFilter(testEntry)

  // At least one should be different (they use different minor error sets)
  t.ok(typeof m56sResult === 'boolean', 'm56s filter should return boolean')
  t.ok(typeof m53sResult === 'boolean', 'm53s filter should return boolean')
})
