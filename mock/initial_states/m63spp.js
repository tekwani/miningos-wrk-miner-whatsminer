'use strict'
const libUtils = require('../utils')
const { cloneDeep } = require('@bitfinex/lib-js-util-base')

module.exports = function (ctx) {
  const pastHashrates = []
  const state = {
    ...libUtils.createBaseState({ led_mode: 'auto' }),
    summary: libUtils.createSummary(libUtils, true),
    devdetails: libUtils.createDevdetails('M63S_VH30'),
    devs: libUtils.createDevs(
      ctx,
      'H38K07-24010101 BINV02-196804D',
      [97500, 97500, 97500, 97500],
      [535, 535, 544, 547],
      [9, 10, 10, 9],
      true
    ),
    error_code: [],
    miner_info: libUtils.createMinerInfo(ctx, { upfreq_speed: 7 }),
    psu: {
      name: 'P564B',
      hw_version: 'R00010',
      sw_version: '20221024_P00032.20221017_S00030',
      model: 'P564B',
      enable: '0',
      iin: '0',
      vin: '39600',
      pin: '13',
      fan_speed: '0',
      serial_no: '1413C2246300196',
      vendor: '1',
      temp0: '0'
    },
    version: libUtils.createVersion('H38K07-24010101 BINV02-196804D', ctx.apiVersion === 'v3' ? '3.0.3' : '2.0.5'),
    pools: libUtils.createPools()
  }

  const getInitialState = () => {
    const newState = cloneDeep(state)

    libUtils.updateTemperature(newState, true)

    if (state.suspended) {
      newState.summary = libUtils.createSuspendedSummary(true)
      newState.devs.forEach(dev => {
        Object.assign(dev, libUtils.createSuspendedDevs(true))
      })
      newState.psu = libUtils.createPSU(false, ctx.serial, newState.currentTemp)
    } else {
      libUtils.calculatePowerModeHashrate(newState, state, pastHashrates, libUtils, 2, 2)

      const avgHashrate = pastHashrates.reduce((a, b) => a + b, 0) / pastHashrates.length
      libUtils.updateActiveSummary(newState, avgHashrate, libUtils, true)
      libUtils.updateActiveDevs(newState, avgHashrate, libUtils, true)

      newState.psu = libUtils.createPSU(true, '1413C2246300196', newState.currentTemp, newState.summary.Power)

      newState.summary.Accepted = newState.summary.Accepted + parseInt(libUtils.randomNumber(0, 5))
      newState.pools[0].Accepted = newState.summary.Accepted
    }

    Object.assign(state, newState)

    return state
  }

  const initialState = JSON.parse(JSON.stringify(getInitialState()))

  return { state, cleanup: libUtils.cleanup.bind(null, state, initialState) }
}
