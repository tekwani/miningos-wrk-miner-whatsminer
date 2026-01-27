# minefarm-miner-whatsminer

Class for interacting with MicroBT Whatsminer miners.

## Setup

1. Install the package using npm
```
npm install --save https://github.com/PearTree-to/minefarm-miner-whatsminer
```

## Quickstart

```js
const WhatsminerMiner = require('minefarm-miner-whatsminer');

async function work() {
    // Create a new instance
    const miner = new WhatsminerMiner('0', 'Miner1', '192.168.10.20', 4028, 'admin');

    // Read the version
    const version = await miner.getVersion();
    console.log(version);
    // {
    //     chip: 'H36K07-22110702 BINV02-196804B',
    //     platform: 'H616',
    //     whatsminer: {
    //         api: '2.0.5',
    //         firmware: '20221125.16.REL'
    //     }
    // }
}

// Run it
work();
```

## Functions
- [minefarm-miner-whatsminer](#minefarm-miner-whatsminer)
  - [`constructor(minerId, minerName, host, port, adminPassword, eventTiming)` -\> `WhatsminerMiner`](#constructorminerid-minername-host-port-adminpassword-eventtiming---whatsminerminer)
    - [Parameters](#parameters)
  - [`getVersion()` -\> `Object`](#getversion---object)
    - [Returns](#returns)
  - [`getStats()` -\> `Object`](#getstats---object)
    - [Returns](#returns-1)
  - [`getPools()` -\> `Object`](#getpools---object)
    - [Returns](#returns-2)
  - [`getDevices()` -\> `Object`](#getdevices---object)
    - [Returns](#returns-3)
  - [`getDeviceDetails()` -\> `Object`](#getdevicedetails---object)
    - [Returns](#returns-4)
  - [`getPSUInformation()` -\> `Object`](#getpsuinformation---object)
    - [Returns](#returns-5)
  - [`getErrors()` -\> `Object`](#geterrorcode---object)
    - [Returns](#returns-6)
  - [`restartMinerSoftware()` -\> `Boolean`](#restartminersoftware---boolean)
  - [`setPools(pools)` -\> `Boolean`](#setpoolspools---boolean)
    - [Parameters](#parameters-1)
  - [`factoryReset()` -\> `Boolean`](#factoryreset---boolean)
  - [`updateAdminPassword(new_password)` -\> `Boolean`](#updateadminpasswordnew_password---boolean)
    - [Parameters](#parameters-2)
  - [`enableWebPools()` -\> `Boolean`](#enablewebpools---boolean)
  - [`disableWebPools()` -\> `Boolean`](#disablewebpools---boolean)
  - [`reboot()` -\> `Boolean`](#reboot---boolean)
  - [`prePowerOn()` -\> `Boolean`](#prepoweron---boolean)
  - [`suspendMining()` -\> `Boolean`](#suspendmining---boolean)
  - [`resumeMining()` -\> `Boolean`](#resumemining---boolean)
  - [`setPowerMode(mode)` -\> `Boolean`](#setpowermodemode---boolean)
    - [Parameters](#parameters-3)
  - [`setFrequency(percent)` -\> `Boolean`](#setfrequencypercent---boolean)
    - [Parameters](#parameters-4)
  - [`enableFastBoot()` -\> `Boolean`](#enablefastboot---boolean)
  - [`disableFastBoot()` -\> `Boolean`](#disablefastboot---boolean)
  - [`setPowerLimit(power)` -\> `Boolean`](#setpowerlimitpower---boolean)
    - [Parameters](#parameters-5)
  - [`setUpfreqSpeed(speed)` -\> `Boolean`](#setupfreqspeedspeed---boolean)
    - [Parameters](#parameters-6)
  - [`setLEDControl(mode, color, period, duration, start)` -\> `Boolean`](#setledcontrolmode-color-period-duration-start---boolean)
    - [Parameters](#parameters-7)

## `constructor(minerId, minerName, host, port, adminPassword, eventTiming)` -> `WhatsminerMiner`
Creates a new `WhatsminerMiner` instance.

### Parameters
| Param  | Type | Description | Default |
| -- | -- | -- | -- |
| minerId | `string` | ID of the miner (for identification purposes). | |
| minerName | `string` | Name of the miner (for identification purposes). | |
| host | `string` | IP address of the miner | |
| port | `Number` | Port of the API to connect to | `4028` |
| adminPassword | `string` | Admin password of the miner | `admin`
| eventTiming | `Number` | Intervals to emit data in milliseconds | `5000` |

## `getVersion()` -> `Object`
Get the API and software version information of the miner.

### Returns
| Key | Type | Description |
| -- | -- | -- |
| whatsminer.api | `string` | API version |
| whatsminer.firmware | `string` | Firmware version of the control board |
| chip | `string` | Chip used in the board |
| platform | `string` | Board platform |

## `getStats()` -> `Object`
Get the API and software version information of the miner.

### Returns
| Key | Type | Description |
| -- | -- | -- |
| elapsed | `Number` | Elapsed time |
| mhs_av | `Number` | Average hashrate |
| mhs_5s | `Number` | Average hashrate over 5s |
| mhs_1m | `Number` | Average hashrate over 1m |
| mhs_5m | `Number` | Average hashrate over 5m |
| mhs_15m | `Number` | Average hashrate over 15m |
| hs_rt | `Number` | Realtime hashrate |
| accepted | `Number` | Accepted blocks |
| rejected | `Number` | Rejected blocks |
| total_mh | `Number` | Total hashes |
| temperature | `Number` | Temperature of the miner |
| freq_avg | `Number` | Average frequency in MHz |
| fan_speed_in | `Number` | Intake fan speed |
| fan_speed_out | `Number` | Output fan speed |
| power | `Number` | Power consumed in Watts |
| power_rate | `Number` | TBD |
| pool_rejected | `Number` | Rejected blocks by pool |
| pool_stale | `Number` | Stale blocks by pool |
| uptime | `Number` | Uptime |
| hash_stable | `Boolean` | Hashrate stability |
| hash_stable_cost_seconds | `Number` | TBD |
| hash_deviation | `Number` | TBD |
| target_freq | `Number` | TBD |
| target_mhs | `Number` | TBD |
| env_temp | `Number` | Temperature of the environment |
| power_mode | `string` | Power mode |
| factory_ghs | `Number` | TBD |
| power_limit | `Number` | Power limit |
| chip_temp_min | `Number` | Minimum Chip Temperature |
| chip_temp_max | `Number` | Maximum Chip Temperature |
| chip_temp_avg | `Number` | Average Chip Temperature |
| debug | `string` | Status of debug (enabled/disabled) |
| btminer_fast_boot | `string` | TBD |

## `getPools()` -> `Object`
Get infomation about the pools set for the miners. Returns an array of `Pool` object data.

### Returns
| Key | Type | Description |
| -- | -- | -- |
| index | `Number` | Index of the pool |
| url | `string` | URl of the pool |
| status | `string` | Status of the pool |
| priority | `Number` | Priority of the pool |
| quota | `Number` | TBD |
| getworks | `Number` | TBD |
| accepted | `Number` | Blocks accepted by the pool |
| rejected | `Number` | Blocks rejected by the pool |
| works | `Number` | Number of work done for the pool |
| discarded | `Number` | Discarded blocks |
| stale | `Number` | Stale blocks |
| get_failures | `Number` | TBD |
| remote_failures | `Number` | TBD |
| user | `string` | Worker username |
| last_share_time | `Number` | TBD |
| stratum_active | `string` | TBD |
| stratum_difficulty | `Number` | TBD |
| pool_rejected | `Number` | TBD |
| pool_stale | `Number` | TBD |
| bad_work | `Number` | TBD |
| current_block_height | `Number` | TBD |
| current_block_version | `Number` | TBD |

## `getDevices()` -> `Object`
Get infomation about the boards connected to the control board.

### Returns
| Key | Type | Description |
| -- | -- | -- |
| index | `Number` | Index of the ASIC |
| slot | `Number` | Slot |
| enabled | `string` | TBD |
| status | `string` | TBD |
| temperature | `Number` | TBD |
| chip_frequency | `Number` | TBD |
| mhs_av | `Number` | TBD |
| mhs_5s | `Number` | TBD |
| mhs_1m | `Number` | TBD |
| mhs_5m | `Number` | TBD |
| mhs_15m | `Number` | TBD |
| hs_rt | `Number` | TBD |
| factory_ghs | `Number` | TBD |
| upfreq_complete | `Number` | TBD |
| effective_chips | `Number` | TBD |
| pcb_sn | `string` | TBD |
| chip_data | `string` | TBD |
| chip_temp_min | `Number` | Minimum Chip Temperature |
| chip_temp_max | `Number` | Maximum Chip Temperature |
| chip_temp_avg | `Number` | Average Chip Temperature |
| chip_vol_diff | `Number` | TBD |

## `getDeviceDetails()` -> `Object`
Get version information about the boards connected to the control board.

### Returns
| Key | Type | Description |
| -- | -- | -- |
| index | `Number` | Index of device |
| name | `string` | Name of device |
| id | `Number` | ID of the device |
| driver | `string` | TBD |
| kernel | `string` | Device kernel |
| model | `string` | Device model |

## `getPSUInformation()` -> `Object`
Get version information about the boards connected to the control board.

### Returns
| Key | Type | Description |
| -- | -- | -- |
| name | `string` | Name of PSU |
| version.hardware | `string` | Hardware version |
| version.software | `string` | Software version |
| model | `string` | PSU Model |
| fanSpeed | `string` | PSU Fan Speed |
| powerInput.current | `string` | Input power current |
| powerInput.voltage | `string` | Input power voltage |
| serialNumber | `string` | PSU Serial Number |
| vendor | `string` | PSU Vendor |

## `getErrors()` -> `Object`
Get the error code currently displayed by the miner.

### Returns
| Key | Type | Description |
| -- | -- | -- |
| errorCode | `string` | Error Code |
| timestamp | `string` | Timestamp of error occurence |

## `restartMinerSoftware()` -> `Boolean`
Restart the mining software. This action resumes mining.

## `setPools(pools)` -> `Boolean`
Sets pool information of the miner. Accepts `pools` which is an array of objects with the following parameters.

### Parameters
| Param  | Type | Description |
| -- | -- | -- |
| url | `string` | Pool URL |
| worker_name | `string` | Worker Username |
| worker_password | `string` | Worker Password |

## `factoryReset()` -> `Boolean`
Resets the miner to factory settings.
> WARNING: Running this function will reset the admin password and disable the API om the miner.

## `updateAdminPassword(new_password)` -> `Boolean`
Updates the admin password of the miner.

### Parameters
| Param  | Type | Description |
| -- | -- | -- |
| new_password | `string` | New admin password to be set |

## `enableWebPools()` -> `Boolean`
Allows configuration of pools on web pages with immediate effect.

## `disableWebPools()` -> `Boolean`
Turn off the configure pools feature on the web page with immediate effect.

## `reboot()` -> `Boolean`
Reboot the miner. Mining will be resumed once started.

## `prePowerOn()` -> `Boolean`
The miner can be preheated by `prePowerOn` before `resumeMining`, so that the machine can quickly enter the full power state when resumed.

## `suspendMining()` -> `Boolean`
Suspends mining actions of the miner. It will move into suspended state.

## `resumeMining()` -> `Boolean`
Resumes suspended mining actions. Miner will start mining.

## `setPowerMode(mode)` -> `Boolean`
Sets the power mode of the miner.

### Parameters
| Param  | Type | Description |
| -- | -- | -- |
| mode | `string` | Can be `low`, `normal` or `high`. |

## `setFrequency(percent)` -> `Boolean`
Set a new target mining frequency, which adjusts a certain percentage based on the mining frequency in normal power mode (a percentage of `0` means no adjustment).

### Parameters
| Param  | Type | Description |
| -- | -- | -- |
| percent | `string` | Can be integer values between `-100` and `100` |

## `enableFastBoot()` -> `Boolean`
After setting, the next restart of the miner takes effect.

## `disableFastBoot()` -> `Boolean`
After setting, the next restart of the miner takes effect.

## `setPowerLimit(power)` -> `Boolean`
Set the power limit of the control board. Setting a power value of `99999` will reset the power limit.

### Parameters
| Param  | Type | Description |
| -- | -- | -- |
| power | `string` | Power value in Watts |

## `setUpfreqSpeed(speed)` -> `Boolean`
Sets the UpFrequency speed. A higher value resolves to a quicker increase in the chip frequency.

### Parameters
| Param  | Type | Description |
| -- | -- | -- |
| speed | `string` | Can be integer values between `0` and `100` |

## `setLEDControl(mode, color, period, duration, start)` -> `Boolean`
Control the LED operation.

### Parameters
| Param  | Type | Description |
| -- | -- | -- |
| mode | `string` | Can be `manual` or `auto` |
| color | `string` | LED to control. (`red` or `green`) |
| period | `Number` | Period of flash in ms |
| duration | `Number` | Duration in ms |
| start | `Number` | Start delay in ms |
