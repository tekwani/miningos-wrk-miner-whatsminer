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

test('stats - miner spec carries the status count ops', (t) => {
  const ops = stats.specs.miner.ops

  for (const opName of ['online_or_minor_error_miners_cnt', 'error_miners_cnt']) {
    t.ok(ops[opName], `miner spec should have ${opName}`)
    t.is(ops[opName].op, 'cnt', `${opName} should be a count operation`)
    t.ok(typeof ops[opName].filter === 'function', `${opName} should have a filter`)
  }
})

test('stats - status count ops live only on the miner spec', (t) => {
  // Every whatsminer worker reports the `miner` spec tag, and m63 additionally reports
  // `miner-wm-m63`. Defining the same cnt op on both would count m63 miners twice.
  for (const [specName, spec] of Object.entries(stats.specs)) {
    if (specName === 'miner') continue
    t.absent(
      spec.ops.online_or_minor_error_miners_cnt,
      `${specName} should not redefine online_or_minor_error_miners_cnt`
    )
    t.absent(
      spec.ops.error_miners_cnt,
      `${specName} should not redefine error_miners_cnt`
    )
  }
})

function minerEntry (status, opts = {}) {
  return {
    info: { container: opts.container ?? 'group-4' },
    last: {
      snap: {
        stats: {
          status,
          ...(opts.areAllErrorsMinor === undefined
            ? {}
            : { are_all_errors_minor: opts.areAllErrorsMinor })
        }
      }
    }
  }
}

test('stats - online count includes miners hashing through minor errors', (t) => {
  const onlineFilter = stats.specs.miner.ops.online_or_minor_error_miners_cnt.filter

  t.ok(onlineFilter(minerEntry('mining')), 'mining miner counts as online')
  t.ok(
    onlineFilter(minerEntry('error', { areAllErrorsMinor: true })),
    'miner in error with only minor errors counts as online'
  )
  t.absent(
    onlineFilter(minerEntry('error', { areAllErrorsMinor: false })),
    'miner with a major error does not count as online'
  )
  t.absent(onlineFilter(minerEntry('error')), 'missing flag is treated as a major error')
  t.absent(onlineFilter(minerEntry('offline')), 'offline miner does not count as online')
})

test('stats - error count excludes miners hashing through minor errors', (t) => {
  const errorFilter = stats.specs.miner.ops.error_miners_cnt.filter

  t.ok(
    errorFilter(minerEntry('error', { areAllErrorsMinor: false })),
    'miner with a major error counts as errored'
  )
  t.absent(
    errorFilter(minerEntry('error', { areAllErrorsMinor: true })),
    'miner in error with only minor errors is not counted as errored'
  )
  t.absent(errorFilter(minerEntry('mining')), 'mining miner is not counted as errored')
})

test('stats - every errored miner lands in exactly one bucket', (t) => {
  // The site header sums online + error + offline; a miner falling through every
  // filter silently disappears from the dashboard total.
  const onlineFilter = stats.specs.miner.ops.online_or_minor_error_miners_cnt.filter
  const errorFilter = stats.specs.miner.ops.error_miners_cnt.filter

  for (const areAllErrorsMinor of [true, false]) {
    const entry = minerEntry('error', { areAllErrorsMinor })
    const buckets = [onlineFilter(entry), errorFilter(entry)].filter(Boolean)
    t.is(buckets.length, 1, `are_all_errors_minor=${areAllErrorsMinor} lands in one bucket`)
  }
})

test('stats - miners under maintenance are excluded from the counts', (t) => {
  const onlineFilter = stats.specs.miner.ops.online_or_minor_error_miners_cnt.filter
  const errorFilter = stats.specs.miner.ops.error_miners_cnt.filter

  t.absent(
    onlineFilter(minerEntry('mining', { container: 'maintenance' })),
    'maintenance miner is not counted as online'
  )
  t.absent(
    errorFilter(minerEntry('error', { container: 'maintenance', areAllErrorsMinor: false })),
    'maintenance miner is not counted as errored'
  )
})

function modeEntry (status, mode, opts = {}) {
  return {
    info: { container: opts.container ?? 'group-4' },
    last: {
      snap: {
        config: { power_mode: mode },
        stats: {
          status,
          ...(opts.areAllErrorsMinor === undefined
            ? {}
            : { are_all_errors_minor: opts.areAllErrorsMinor })
        }
      }
    }
  }
}

const GROUPED_OPS = [
  ['per-container', 'error_cnt', 'power_mode_low_cnt', 'power_mode_normal_cnt', 'power_mode_high_cnt'],
  ['per-type', 'error_type_cnt', 'power_mode_low_type_cnt', 'power_mode_normal_type_cnt', 'power_mode_high_type_cnt']
]

test('stats - grouped status ops are present for container and type', (t) => {
  const ops = stats.specs.miner.ops

  for (const [label, ...opNames] of GROUPED_OPS) {
    for (const opName of opNames) {
      t.ok(ops[opName], `${label} spec should have ${opName}`)
      t.is(ops[opName].op, 'group_cnt', `${opName} should be a grouped count`)
      t.ok(typeof ops[opName].group === 'function', `${opName} should have a group function`)
      t.ok(typeof ops[opName].filter === 'function', `${opName} should have a filter`)
    }
  }
})

test('stats - grouped ops key off the right grouping field', (t) => {
  const ops = stats.specs.miner.ops
  const ext = { info: { container: 'group-4' }, type: 'miner-wm-m63spp' }

  t.is(ops.error_cnt.group(null, ext), 'group-4', 'container ops group by info.container')
  t.is(ops.error_type_cnt.group(null, ext), 'miner-wm-m63spp', 'type ops group by type')
})

test('stats - grouped counts put minor-error miners in their power mode bucket', (t) => {
  const ops = stats.specs.miner.ops

  for (const [label, errorOp, , normalOp] of GROUPED_OPS) {
    const minorError = modeEntry('error', 'normal', { areAllErrorsMinor: true })

    t.absent(ops[errorOp].filter(minorError), `${label}: minor error is not an error`)
    t.ok(ops[normalOp].filter(minorError), `${label}: minor error counts in its power mode`)

    const majorError = modeEntry('error', 'normal', { areAllErrorsMinor: false })
    t.ok(ops[errorOp].filter(majorError), `${label}: major error stays an error`)
    t.absent(ops[normalOp].filter(majorError), `${label}: major error is not in a power mode`)

    const mining = modeEntry('mining', 'normal')
    t.ok(ops[normalOp].filter(mining), `${label}: plain mining still counts`)
    t.absent(ops[errorOp].filter(mining), `${label}: plain mining is not an error`)
  }
})

test('stats - grouped counts respect the miner power mode', (t) => {
  const ops = stats.specs.miner.ops
  const lowMinorError = modeEntry('error', 'low', { areAllErrorsMinor: true })

  t.ok(ops.power_mode_low_cnt.filter(lowMinorError), 'low-mode miner lands in the low bucket')
  t.absent(ops.power_mode_normal_cnt.filter(lowMinorError), 'and not in the normal bucket')
  t.absent(ops.power_mode_high_cnt.filter(lowMinorError), 'and not in the high bucket')
})

test('stats - grouped error counts keep excluding maintenance containers', (t) => {
  const ops = stats.specs.miner.ops
  const entry = modeEntry('error', 'normal', { container: 'maintenance', areAllErrorsMinor: false })

  t.absent(ops.error_cnt.filter(entry), 'maintenance miner is not counted per container')
  t.absent(ops.error_type_cnt.filter(entry), 'maintenance miner is not counted per type')
})
