# Whatsminer Firmware Update

This module provides functions to read firmware data from binary files. It is designed to handle a specific firmware file format with an image header and package information.

## Introduction
The `firmware.js` module is designed to extract firmware data from a binary file in a specific format. It parses the image header and extracts package information to locate the firmware data corresponding to a specific chip type. If the provided chip type matches any of the package information, the module returns the firmware content and size for that chip.

## Usage
```js
const readFirmware = require('firmware');

const chipType = 'h616'; 
const firmwarePath = 'path/to/firmware.bin';

const firmwareData = readFirmware(chipType, firmwarePath);

if (firmwareData) {
  console.log(`Firmware content for ${chipType}:`, firmwareData.content);
  console.log(`Firmware size: ${firmwareData.size} bytes`);
} else {
  console.log(`Firmware data not found for ${chipType}`);
}
```

## Functions
### `readFirmware(chip, fw)`
This function reads the firmware data for the specified chip type from the provided firmware file.

- Parameters:
  - `chip` (string): The chip type for which firmware data is requested.
  - `fw` (string): The path to the firmware binary file.
- Returns:
  - If the firmware data for the specified chip type is found in the firmware file, the function returns an object with the following properties:
    - `content` (Buffer): The firmware content as a Buffer.
    - `size` (number): The size of the firmware content in bytes.
  - If the firmware data for the specified chip type is not found, the function returns `null`.
