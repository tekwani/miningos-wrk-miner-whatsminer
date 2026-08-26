'use strict'

const libAlerts = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/alerts')
const libUtils = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/utils')
const { STATUS } = require('@tetherto/miningos-tpl-wrk-miner/workers/lib/constants')

const MIN_10_MS = 10 * 60 * 1000
const MIN_30_MS = 30 * 60 * 1000

// target power (W) derived from nominal efficiency (W/THs) * target hashrate (THs)
const targetPowerW = (snap) => {
  const nominalEff = snap.stats.nominal_efficiency_w_ths
  const targetMhs = snap.stats.hashrate_mhs?.target
  if (!nominalEff || !targetMhs) return 0
  return nominalEff * (targetMhs / 1e6)
}

const isMining = (snap) => {
  return libUtils.isValidSnap(snap) && !libUtils.isOffline(snap) && snap.stats.status === STATUS.MINING
}

libAlerts.specs.miner = {
  ...libAlerts.specs.miner_default,
  pcb_temp_warning: {
    valid: (ctx, snap) => {
      return libUtils.isValidSnap(snap) && !libUtils.isOffline(snap) && ctx.conf.pcb_temp_warning
    },
    probe: (ctx, snap) => {
      const a = (
        (snap.config.power_mode === 'low' && snap.stats.temperature_c?.pcb?.some((t) => t.current > ctx.conf.pcb_temp_warning.lowTemp)) ||
        (snap.config.power_mode === 'high' && snap.stats.temperature_c?.pcb?.some((t) => t.current > ctx.conf.pcb_temp_warning.highTemp)) ||
        (snap.config.power_mode === 'normal' && snap.stats.temperature_c?.pcb?.some((t) => t.current > ctx.conf.pcb_temp_warning.normalTemp))
      )
      return a || false
    }
  },
  chip_temp_warning: {
    valid: (ctx, snap) => {
      return libUtils.isValidSnap(snap) && !libUtils.isOffline(snap) && ctx.conf.chip_temp_warning
    },
    probe: (ctx, snap) => {
      const a = (
        (snap.config.power_mode === 'low' && snap.stats.temperature_c?.chips?.some((t) => t.avg > ctx.conf.chip_temp_warning.lowTemp)) ||
        (snap.config.power_mode === 'high' && snap.stats.temperature_c?.chips?.some((t) => t.avg > ctx.conf.chip_temp_warning.highTemp)) ||
        (snap.config.power_mode === 'normal' && snap.stats.temperature_c?.chips?.some((t) => t.avg > ctx.conf.chip_temp_warning.normalTemp))
      )
      return a || false
    }
  },
  low_power_warning: {
    valid: (ctx, snap) => {
      return isMining(snap) && ctx.conf.low_power_warning &&
        snap.stats.uptime_ms > MIN_10_MS && targetPowerW(snap) > 0
    },
    probe: (ctx, snap) => {
      const threshold = targetPowerW(snap) * (ctx.conf.low_power_warning.lowPower / 100)
      return snap.stats.power_w < threshold
    }
  },
  low_hashrate_warning: {
    valid: (ctx, snap) => {
      return isMining(snap) && ctx.conf.low_hashrate_warning &&
        snap.stats.uptime_ms > MIN_30_MS && snap.stats.hashrate_mhs?.target > 0
    },
    probe: (ctx, snap) => {
      const threshold = snap.stats.hashrate_mhs.target * (ctx.conf.low_hashrate_warning.lowHash / 100)
      return snap.stats.hashrate_mhs.avg < threshold
    }
  },
  high_efficiency_warning: {
    valid: (ctx, snap) => {
      return isMining(snap) && ctx.conf.high_efficiency_warning &&
        snap.stats.uptime_ms > MIN_30_MS && snap.stats.nominal_efficiency_w_ths > 0
    },
    probe: (ctx, snap) => {
      const threshold = snap.stats.nominal_efficiency_w_ths * (ctx.conf.high_efficiency_warning.highEfficiency / 100)
      return snap.stats.efficiency_w_ths > threshold
    }
  },
  'custom.high_board_temp.warning': {
    valid: (ctx, snap) => {
      const configuredParams = ctx.configuredParams['custom.high_board_temp.warning']
      const enabled = configuredParams?.enabled

      return enabled && libUtils.isValidSnap(snap)
    },
    probe: (ctx, snap) => {
      const configuredParams = ctx.configuredParams['custom.high_board_temp.warning']
      const threshold = configuredParams.maxTempC
      return snap.stats.temperature_c?.pcb?.some((t) => t.current > threshold)
    }
  },
  'custom.high_board_temp.critical': {
    valid: (ctx, snap) => {
      const configuredParams = ctx.configuredParams['custom.high_board_temp.critical']
      const enabled = configuredParams?.enabled

      return enabled && libUtils.isValidSnap(snap)
    },
    probe: (ctx, snap) => {
      const configuredParams = ctx.configuredParams['custom.high_board_temp.critical']
      const threshold = configuredParams.maxTempC
      return snap.stats.temperature_c?.pcb?.some((t) => t.current > threshold)
    }
  }
}

module.exports = libAlerts
