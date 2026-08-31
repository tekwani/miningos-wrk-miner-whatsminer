'use strict'

const libStats = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/stats')
const {
  STATUS,
  POWER_MODE,
  MAINTENANCE
} = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/constants')
const { getVal, groupBy } = require('@tetherto/miningos-lib-stats/utils')

function groupByMinerInfo (entry, ext) {
  return `${getVal(ext, 'info.container')}-${getVal(ext, 'info.pos')}`
}

function isCounted (entry) {
  return entry?.info?.container !== MAINTENANCE
}

// The miner worker already resolves the model-specific minor error table when it
// builds the snapshot, so the stats layer just reads the flag it left behind.
function isMiningWithMinorErrors (entry) {
  const stats = entry?.last?.snap?.stats
  return stats?.status === STATUS.ERROR && stats?.are_all_errors_minor === true
}

// Overrides the miner_default counts so a miner that keeps hashing through a minor
// error stays in the online bucket instead of being reported as broken. These live on
// the `miner` spec because that is the only spec tag every whatsminer worker reports
// (see worker-base getSpecTags); a per-model spec would run in addition to `miner` and
// count the same miner twice.
const minerStatusOps = {
  online_or_minor_error_miners_cnt: {
    op: 'cnt',
    filter: function (entry) {
      return (
        isCounted(entry) &&
        (entry?.last?.snap?.stats?.status === STATUS.MINING || isMiningWithMinorErrors(entry))
      )
    }
  },
  error_miners_cnt: {
    op: 'cnt',
    filter: function (entry) {
      return (
        isCounted(entry) &&
        entry?.last?.snap?.stats?.status === STATUS.ERROR &&
        !isMiningWithMinorErrors(entry)
      )
    }
  }
}

// The container donut and the by-type breakdown bucket on the same status, so they
// need the same treatment: a miner hashing through a minor error belongs in its power
// mode slice, not in the error slice. Suffix is '' for the per-container ops
// (error_cnt, power_mode_low_cnt) and '_type' for the per-type ops (error_type_cnt,
// power_mode_low_type_cnt).
function statusGroupOps (field, suffix) {
  const group = groupBy(field)

  const ops = {
    [`error${suffix}_cnt`]: {
      op: 'group_cnt',
      group,
      filter: function (entry) {
        return (
          isCounted(entry) &&
          entry?.last?.snap?.stats?.status === STATUS.ERROR &&
          !isMiningWithMinorErrors(entry)
        )
      }
    }
  }

  for (const mode of [POWER_MODE.LOW, POWER_MODE.NORMAL, POWER_MODE.HIGH]) {
    // No maintenance filter here: miner_default's power mode counts do not have one
    // either, and adding it would change what these widgets show beyond this fix.
    ops[`power_mode_${mode}${suffix}_cnt`] = {
      op: 'group_cnt',
      group,
      filter: function (entry) {
        return (
          (entry?.last?.snap?.stats?.status === STATUS.MINING ||
            isMiningWithMinorErrors(entry)) &&
          entry?.last?.snap?.config?.power_mode === mode
        )
      }
    }
  }

  return ops
}

const sharedPoolStats = {
  pools_accepted_shares_total: {
    op: 'sum',
    src: 'last.snap.stats.all_pools_shares.accepted'
  },
  pools_rejected_shares_total: {
    op: 'sum',
    src: 'last.snap.stats.all_pools_shares.rejected'
  },
  pools_stale_shares_total: {
    op: 'sum',
    src: 'last.snap.stats.all_pools_shares.stale'
  }
}

libStats.specs = {
  miner: {
    ops: {
      ...libStats.specs.miner_default.ops,
      ...sharedPoolStats,
      ...minerStatusOps,
      ...statusGroupOps('info.container', ''),
      ...statusGroupOps('type', '_type')
    }
  },
  'miner-wm-m63': {
    ops: {
      hashrate_mhs_1m_group: {
        op: 'group',
        src: 'last.snap.stats.hashrate_mhs.t_1m',
        group: groupByMinerInfo
      },
      power_mode_group: {
        op: 'group',
        src: 'last.snap.config.power_mode',
        group: groupByMinerInfo
      },
      power_w_group: {
        op: 'group',
        src: 'last.snap.stats.power_w',
        group: groupByMinerInfo
      },
      status_group: {
        op: 'group',
        src: 'last.snap.stats.status',
        group: groupByMinerInfo
      }
    }
  }
}

module.exports = libStats
