'use strict'

const test = require('brittle')
const alerts = require('../../workers/lib/alerts')

test('alerts - module exports libAlerts', (t) => {
  t.ok(alerts, 'should export alerts module')
  t.ok(alerts.specs, 'should have specs property')
  t.ok(alerts.specs.miner, 'should have miner specs')
})

test('alerts - miner specs structure', (t) => {
  const { specs } = alerts
  const minerSpecs = specs.miner

  t.ok(minerSpecs, 'should have miner specs')
  t.ok(typeof minerSpecs === 'object', 'should be an object')

  // Test that it has the expected alert types
  t.ok(minerSpecs.pcb_temp_warning, 'should have pcb_temp_warning alert')
  t.ok(minerSpecs.chip_temp_warning, 'should have chip_temp_warning alert')
})

test('alerts - pcb_temp_warning alert structure', (t) => {
  const pcbTempWarning = alerts.specs.miner.pcb_temp_warning

  t.ok(pcbTempWarning, 'should exist')
  t.ok(typeof pcbTempWarning.valid === 'function', 'should have valid function')
  t.ok(typeof pcbTempWarning.probe === 'function', 'should have probe function')
})

test('alerts - chip_temp_warning alert structure', (t) => {
  const chipTempWarning = alerts.specs.miner.chip_temp_warning

  t.ok(chipTempWarning, 'should exist')
  t.ok(typeof chipTempWarning.valid === 'function', 'should have valid function')
  t.ok(typeof chipTempWarning.probe === 'function', 'should have probe function')
})

test('alerts - pcb_temp_warning valid function', (t) => {
  const pcbTempWarning = alerts.specs.miner.pcb_temp_warning
  const mockLibUtils = {
    isValidSnap: (snap) => snap?.stats,
    isOffline: (snap) => snap?.stats?.status === 'offline'
  }

  // Mock the libUtils functions
  const originalLibUtils = require('miningos-tpl-wrk-miner/workers/lib/utils')
  require('miningos-tpl-wrk-miner/workers/lib/utils').isValidSnap = mockLibUtils.isValidSnap
  require('miningos-tpl-wrk-miner/workers/lib/utils').isOffline = mockLibUtils.isOffline

  const ctx = { conf: { pcb_temp_warning: { lowTemp: 60, normalTemp: 70, highTemp: 80 } } }

  // Test with valid snap and online status
  const validSnap = { stats: { status: 'mining' } }
  t.ok(pcbTempWarning.valid(ctx, validSnap), 'should return true for valid snap and online status')

  // Test with invalid snap
  t.not(pcbTempWarning.valid(ctx, null), 'should return false for invalid snap')
  t.not(pcbTempWarning.valid(ctx, {}), 'should return false for snap without stats')

  // Test with offline status
  const offlineSnap = { stats: { status: 'offline' } }
  t.not(pcbTempWarning.valid(ctx, offlineSnap), 'should return false for offline snap')

  // Test without pcb_temp_warning config
  const ctxNoConfig = { conf: {} }
  t.not(pcbTempWarning.valid(ctxNoConfig, validSnap), 'should return false when config is missing')

  // Restore original functions
  require('miningos-tpl-wrk-miner/workers/lib/utils').isValidSnap = originalLibUtils.isValidSnap
  require('miningos-tpl-wrk-miner/workers/lib/utils').isOffline = originalLibUtils.isOffline
})

test('alerts - chip_temp_warning valid function', (t) => {
  const chipTempWarning = alerts.specs.miner.chip_temp_warning
  const mockLibUtils = {
    isValidSnap: (snap) => snap?.stats,
    isOffline: (snap) => snap?.stats?.status === 'offline'
  }

  // Mock the libUtils functions
  const originalLibUtils = require('miningos-tpl-wrk-miner/workers/lib/utils')
  require('miningos-tpl-wrk-miner/workers/lib/utils').isValidSnap = mockLibUtils.isValidSnap
  require('miningos-tpl-wrk-miner/workers/lib/utils').isOffline = mockLibUtils.isOffline

  const ctx = { conf: { chip_temp_warning: { lowTemp: 60, normalTemp: 70, highTemp: 80 } } }

  // Test with valid snap and online status
  const validSnap = { stats: { status: 'mining' } }
  t.ok(chipTempWarning.valid(ctx, validSnap), 'should return true for valid snap and online status')

  // Test with invalid snap
  t.not(chipTempWarning.valid(ctx, null), 'should return false for invalid snap')
  t.not(chipTempWarning.valid(ctx, {}), 'should return false for snap without stats')

  // Test with offline status
  const offlineSnap = { stats: { status: 'offline' } }
  t.not(chipTempWarning.valid(ctx, offlineSnap), 'should return false for offline snap')

  // Test without chip_temp_warning config
  const ctxNoConfig = { conf: {} }
  t.not(chipTempWarning.valid(ctxNoConfig, validSnap), 'should return false when config is missing')

  // Restore original functions
  require('miningos-tpl-wrk-miner/workers/lib/utils').isValidSnap = originalLibUtils.isValidSnap
  require('miningos-tpl-wrk-miner/workers/lib/utils').isOffline = originalLibUtils.isOffline
})

test('alerts - pcb_temp_warning probe function', (t) => {
  const pcbTempWarning = alerts.specs.miner.pcb_temp_warning

  const ctx = {
    conf: {
      pcb_temp_warning: {
        lowTemp: 60,
        normalTemp: 70,
        highTemp: 80
      }
    }
  }

  // Test low power mode with high temperature
  const lowPowerSnap = {
    config: { power_mode: 'low' },
    stats: {
      temperature_c: {
        pcb: [{ current: 65 }] // Above lowTemp threshold
      }
    }
  }
  t.ok(pcbTempWarning.probe(ctx, lowPowerSnap), 'should trigger for low power mode with high temp')

  // Test normal power mode with high temperature
  const normalPowerSnap = {
    config: { power_mode: 'normal' },
    stats: {
      temperature_c: {
        pcb: [{ current: 75 }] // Above normalTemp threshold
      }
    }
  }
  t.ok(pcbTempWarning.probe(ctx, normalPowerSnap), 'should trigger for normal power mode with high temp')

  // Test high power mode with high temperature
  const highPowerSnap = {
    config: { power_mode: 'high' },
    stats: {
      temperature_c: {
        pcb: [{ current: 85 }] // Above highTemp threshold
      }
    }
  }
  t.ok(pcbTempWarning.probe(ctx, highPowerSnap), 'should trigger for high power mode with high temp')

  // Test with temperature below threshold
  const lowTempSnap = {
    config: { power_mode: 'normal' },
    stats: {
      temperature_c: {
        pcb: [{ current: 50 }] // Below normalTemp threshold
      }
    }
  }
  t.not(pcbTempWarning.probe(ctx, lowTempSnap), 'should not trigger for temperature below threshold')

  // Test with no temperature data
  const noTempSnap = {
    config: { power_mode: 'normal' },
    stats: {}
  }
  t.not(pcbTempWarning.probe(ctx, noTempSnap), 'should not trigger when no temperature data')
})

test('alerts - chip_temp_warning probe function', (t) => {
  const chipTempWarning = alerts.specs.miner.chip_temp_warning

  const ctx = {
    conf: {
      chip_temp_warning: {
        lowTemp: 60,
        normalTemp: 70,
        highTemp: 80
      }
    }
  }

  // Test low power mode with high temperature
  const lowPowerSnap = {
    config: { power_mode: 'low' },
    stats: {
      temperature_c: {
        chips: [{ avg: 65 }] // Above lowTemp threshold
      }
    }
  }
  t.ok(chipTempWarning.probe(ctx, lowPowerSnap), 'should trigger for low power mode with high chip temp')

  // Test normal power mode with high temperature
  const normalPowerSnap = {
    config: { power_mode: 'normal' },
    stats: {
      temperature_c: {
        chips: [{ avg: 75 }] // Above normalTemp threshold
      }
    }
  }
  t.ok(chipTempWarning.probe(ctx, normalPowerSnap), 'should trigger for normal power mode with high chip temp')

  // Test high power mode with high temperature
  const highPowerSnap = {
    config: { power_mode: 'high' },
    stats: {
      temperature_c: {
        chips: [{ avg: 85 }] // Above highTemp threshold
      }
    }
  }
  t.ok(chipTempWarning.probe(ctx, highPowerSnap), 'should trigger for high power mode with high chip temp')

  // Test with temperature below threshold
  const lowTempSnap = {
    config: { power_mode: 'normal' },
    stats: {
      temperature_c: {
        chips: [{ avg: 50 }] // Below normalTemp threshold
      }
    }
  }
  t.not(chipTempWarning.probe(ctx, lowTempSnap), 'should not trigger for temperature below threshold')

  // Test with no temperature data
  const noTempSnap = {
    config: { power_mode: 'normal' },
    stats: {}
  }
  t.not(chipTempWarning.probe(ctx, noTempSnap), 'should not trigger when no temperature data')
})

test('alerts - probe functions handle multiple temperature readings', (t) => {
  const pcbTempWarning = alerts.specs.miner.pcb_temp_warning
  const chipTempWarning = alerts.specs.miner.chip_temp_warning

  const ctx = {
    conf: {
      pcb_temp_warning: { normalTemp: 70 },
      chip_temp_warning: { normalTemp: 70 }
    }
  }

  // Test with multiple PCB temperatures - one above threshold
  const multiPcbSnap = {
    config: { power_mode: 'normal' },
    stats: {
      temperature_c: {
        pcb: [
          { current: 50 }, // Below threshold
          { current: 75 } // Above threshold
        ]
      }
    }
  }
  t.ok(pcbTempWarning.probe(ctx, multiPcbSnap), 'should trigger when any PCB temp is above threshold')

  // Test with multiple chip temperatures - one above threshold
  const multiChipSnap = {
    config: { power_mode: 'normal' },
    stats: {
      temperature_c: {
        chips: [
          { avg: 50 }, // Below threshold
          { avg: 75 } // Above threshold
        ]
      }
    }
  }
  t.ok(chipTempWarning.probe(ctx, multiChipSnap), 'should trigger when any chip temp is above threshold')
})
