'use strict'

const test = require('brittle')
const fs = require('fs')
const path = require('path')
const readFirmware = require('../../workers/lib/utils/firmware')

// Helper function to create a mock firmware file
function createMockFirmwareFile (filePath, options = {}) {
  const {
    packageCount = 1,
    dataSize = 1024,
    chipType = 'H36K07',
    platform = 'H616',
    packageOffset = 0,
    packageSize = 512
  } = options

  // Calculate proper header size based on the actual constants
  const PI_SIZE = 16
  const MAX_PACKAGE_COUNT = 64
  const PACKAGE_INFO_SIZE = PI_SIZE * 2 + 4 + 4 + PI_SIZE * 4
  const IMAGE_HEADER_SIZE = 6 * 4 + MAX_PACKAGE_COUNT * PACKAGE_INFO_SIZE + 4 * 32 + 4

  const buffer = Buffer.alloc(IMAGE_HEADER_SIZE + dataSize)

  // Write header
  buffer.writeUInt32LE(0x12345678, 0) // magic
  buffer.writeUInt32LE(0x00000001, 4) // version
  buffer.writeUInt32LE(0x00000000, 8) // reserved
  buffer.writeUInt32LE(0x00000000, 12) // reserved
  buffer.writeUInt32LE(dataSize, 16) // data size
  buffer.writeUInt32LE(packageCount, 20) // package count

  // Write package info
  if (packageCount > 0) {
    const packageInfoOffset = 6 * 4

    // Chip type (16 bytes)
    buffer.write(chipType, packageInfoOffset, Math.min(chipType.length, 16), 'utf8')

    // Platform (16 bytes)
    buffer.write(platform, packageInfoOffset + 16, Math.min(platform.length, 16), 'utf8')

    // Offset (4 bytes)
    buffer.writeUInt32LE(packageOffset, packageInfoOffset + 32)

    // Size (4 bytes)
    buffer.writeUInt32LE(packageSize, packageInfoOffset + 36)
  }

  // Write some dummy data
  const dataStart = IMAGE_HEADER_SIZE + packageOffset
  const dataEnd = Math.min(dataStart + packageSize, buffer.length)
  for (let i = dataStart; i < dataEnd; i++) {
    buffer[i] = i % 256
  }

  fs.writeFileSync(filePath, buffer)
  return buffer
}

test('readFirmware - simple firmware file without packages', (t) => {
  const tempFile = path.join(__dirname, 'temp_simple_firmware.bin')

  try {
    // Create a simple firmware file (no packages) - needs to be large enough to avoid header parsing
    const data = Buffer.from('test firmware data'.repeat(100)) // Make it large enough
    fs.writeFileSync(tempFile, data)

    const result = readFirmware('H36K07', tempFile)

    t.ok(result, 'should return result')
    t.ok(result.content, 'should have content')
    t.is(result.size, data.length, 'should have correct size')
    t.is(result.content.toString(), data.toString(), 'should have correct content')
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})

test('readFirmware - firmware file with matching chip type', (t) => {
  const tempFile = path.join(__dirname, 'temp_package_firmware.bin')

  try {
    createMockFirmwareFile(tempFile, {
      packageCount: 1,
      chipType: 'H36K07',
      platform: 'H616',
      packageOffset: 0,
      packageSize: 256
    })

    const result = readFirmware('H36K07', tempFile)

    t.ok(result, 'should return result')
    t.ok(result.content, 'should have content')
    t.is(result.size, 256, 'should have correct package size')
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})

test('readFirmware - firmware file with non-matching chip type', (t) => {
  const tempFile = path.join(__dirname, 'temp_wrong_chip_firmware.bin')

  try {
    createMockFirmwareFile(tempFile, {
      packageCount: 1,
      chipType: 'H36K08', // Different chip type
      platform: 'H616',
      packageOffset: 0,
      packageSize: 256
    })

    const result = readFirmware('H36K07', tempFile)

    t.is(result, null, 'should return null for non-matching chip type')
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})

test('readFirmware - firmware file with multiple packages', (t) => {
  const tempFile = path.join(__dirname, 'temp_multi_package_firmware.bin')

  try {
    // Create firmware with multiple packages
    const IMAGE_HEADER_SIZE = 6 * 4 + 64 * (16 * 2 + 4 + 4 + 16 * 4) + 4 * 32 + 4
    const dataSize = 2048
    const buffer = Buffer.alloc(IMAGE_HEADER_SIZE + dataSize)

    // Write header
    buffer.writeUInt32LE(0x12345678, 0) // magic
    buffer.writeUInt32LE(0x00000001, 4) // version
    buffer.writeUInt32LE(0x00000000, 8) // reserved
    buffer.writeUInt32LE(0x00000000, 12) // reserved
    buffer.writeUInt32LE(dataSize, 16) // data size
    buffer.writeUInt32LE(2, 20) // package count

    // Write first package info
    const packageInfoOffset = 6 * 4
    const packageInfoSize = 16 * 2 + 4 + 4 + 16 * 4

    // First package - H36K07
    buffer.write('H36K07', packageInfoOffset, 6, 'utf8')
    buffer.write('H616', packageInfoOffset + 16, 4, 'utf8')
    buffer.writeUInt32LE(0, packageInfoOffset + 32) // offset
    buffer.writeUInt32LE(512, packageInfoOffset + 36) // size

    // Second package - H36K08
    buffer.write('H36K08', packageInfoOffset + packageInfoSize, 6, 'utf8')
    buffer.write('H616', packageInfoOffset + packageInfoSize + 16, 4, 'utf8')
    buffer.writeUInt32LE(512, packageInfoOffset + packageInfoSize + 32) // offset
    buffer.writeUInt32LE(512, packageInfoOffset + packageInfoSize + 36) // size

    // Write dummy data
    for (let i = IMAGE_HEADER_SIZE; i < buffer.length; i++) {
      buffer[i] = i % 256
    }

    fs.writeFileSync(tempFile, buffer)

    const result = readFirmware('H36K07', tempFile)

    t.ok(result, 'should return result for matching chip type')
    t.is(result.size, 512, 'should have correct size for first package')
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})

test('readFirmware - file with too many packages', (t) => {
  const tempFile = path.join(__dirname, 'temp_too_many_packages.bin')

  try {
    // Create firmware with too many packages (more than MAX_PACKAGE_COUNT = 64)
    const IMAGE_HEADER_SIZE = 6 * 4 + 64 * (16 * 2 + 4 + 4 + 16 * 4) + 4 * 32 + 4
    const dataSize = 1024
    const buffer = Buffer.alloc(IMAGE_HEADER_SIZE + dataSize)

    // Write header with package count > 64
    buffer.writeUInt32LE(0x12345678, 0) // magic
    buffer.writeUInt32LE(0x00000001, 4) // version
    buffer.writeUInt32LE(0x00000000, 8) // reserved
    buffer.writeUInt32LE(0x00000000, 12) // reserved
    buffer.writeUInt32LE(dataSize, 16) // data size
    buffer.writeUInt32LE(100, 20) // package count > 64

    fs.writeFileSync(tempFile, buffer)

    const result = readFirmware('H36K07', tempFile)

    // Should fall back to simple file reading
    t.ok(result, 'should return result')
    t.is(result.size, buffer.length, 'should have correct size')
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})

test('readFirmware - file with invalid data size', (t) => {
  const tempFile = path.join(__dirname, 'temp_invalid_data_size.bin')

  try {
    // Create firmware with data size larger than file size
    const IMAGE_HEADER_SIZE = 6 * 4 + 64 * (16 * 2 + 4 + 4 + 16 * 4) + 4 * 32 + 4
    const buffer = Buffer.alloc(IMAGE_HEADER_SIZE + 100) // Small file

    // Write header with data size larger than file
    buffer.writeUInt32LE(0x12345678, 0) // magic
    buffer.writeUInt32LE(0x00000001, 4) // version
    buffer.writeUInt32LE(0x00000000, 8) // reserved
    buffer.writeUInt32LE(0x00000000, 12) // reserved
    buffer.writeUInt32LE(10000, 16) // data size > file size
    buffer.writeUInt32LE(1, 20) // package count

    fs.writeFileSync(tempFile, buffer)

    const result = readFirmware('H36K07', tempFile)

    // Should fall back to simple file reading
    t.ok(result, 'should return result')
    t.is(result.size, buffer.length, 'should have correct size')
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})

test('readFirmware - non-existent file', (t) => {
  const nonExistentFile = path.join(__dirname, 'non_existent_file.bin')

  try {
    readFirmware('H36K07', nonExistentFile)
    t.fail('should throw error for non-existent file')
  } catch (error) {
    t.ok(error, 'should throw error for non-existent file')
  }
})

test('readFirmware - empty file', (t) => {
  const tempFile = path.join(__dirname, 'temp_empty_firmware.bin')

  try {
    fs.writeFileSync(tempFile, Buffer.alloc(0))

    try {
      readFirmware('H36K07', tempFile)
      t.fail('should throw error for empty file')
    } catch (error) {
      t.ok(error, 'should throw error for empty file')
    }
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile)
    }
  }
})
