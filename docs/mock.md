# Mock Server Documentation

This document gives a quickstart for running the mock server

## Running the mock server

The mock server can be run using the following command:

```bash
node mock/server.js --type M56s -p 8080 -h 0.0.0.0 --serial MINERSNO1
```

The `-p, --port` argument is optional and defaults to `4028`

The `-h, --host` argument is optional and defaults to `127.0.0.1`

The `--serial` arguement is optional and defaults to `HHM38S98302B24K40073`

The `--error` flag can be used to make the mock server send errored data

The `--type` argument is required. The following types are supported:
- [x] M53s
- [x] M56s
- [x] M30sp
- [x] M30spp

## Behaviour

Here are a few ways the mock server will behave:
- Doesn't throw error on invalid input when setting, emulating exact beahviour for each input, method will be tedious. So for later, with automation maybe
- Auth implementation in mock is hardcoded. To Implement full auth with 32 keys and IP based limiting
- When mining is suspended, the temperature will drop to a a minimum of 27
- When mining is running, the temperature will increase to a maximum of 85
- Depending on the power mode, the max hashrate and power will be set
- Upfreq is not implemented, as it is not readable by the firmware to confirm the change
- Error codes are not implemented, as there isn't a list of error codes and mappings
