'use strict'

const test = require('brittle')
const hex2a = require('../../workers/lib/utils/hex2a')

test('hex2a - basic hex to ascii conversion', (t) => {
  const input = '48656c6c6f'
  const expected = 'Hello'
  const result = hex2a(input)
  t.is(result, expected, 'should convert hex to ascii correctly')
})

test('hex2a - empty string', (t) => {
  const input = ''
  const expected = ''
  const result = hex2a(input)
  t.is(result, expected, 'should handle empty string')
})

test('hex2a - single character', (t) => {
  const input = '48'
  const expected = 'H'
  const result = hex2a(input)
  t.is(result, expected, 'should convert single hex pair')
})

test('hex2a - with null bytes (should be skipped)', (t) => {
  const input = '48000065'
  const expected = 'He'
  const result = hex2a(input)
  t.is(result, expected, 'should skip null bytes (00)')
})

test('hex2a - mixed case hex', (t) => {
  const input = '48656C6C6F'
  const expected = 'Hello'
  const result = hex2a(input)
  t.is(result, expected, 'should handle uppercase hex')
})

test('hex2a - numbers and symbols', (t) => {
  const input = '3132332e2c21'
  const expected = '123.,!'
  const result = hex2a(input)
  t.is(result, expected, 'should convert numbers and symbols')
})

test('hex2a - odd length input', (t) => {
  const input = '48656c6c6f5'
  const result = hex2a(input)
  // The function should handle odd length by ignoring the last incomplete pair
  t.ok(typeof result === 'string', 'should return a string')
  t.ok(result.startsWith('Hello'), 'should start with Hello')
})

test('hex2a - only null bytes', (t) => {
  const input = '00000000'
  const expected = ''
  const result = hex2a(input)
  t.is(result, expected, 'should return empty string for all null bytes')
})

test('hex2a - mixed null and non-null bytes', (t) => {
  const input = '00480065006c006c006f00'
  const expected = 'Hello'
  const result = hex2a(input)
  t.is(result, expected, 'should handle mixed null and non-null bytes')
})

test('hex2a - special characters', (t) => {
  const input = '20090a0d'
  const expected = ' \t\n\r'
  const result = hex2a(input)
  t.is(result, expected, 'should handle special whitespace characters')
})

test('hex2a - invalid hex characters', (t) => {
  const input = '48GG65'
  const result = hex2a(input)
  // Should not throw, but may produce unexpected results
  t.ok(typeof result === 'string', 'should not throw on invalid hex')
})

test('hex2a - very long string', (t) => {
  const longHex = '48'.repeat(1000) // 1000 'H' characters
  const expected = 'H'.repeat(1000)
  const result = hex2a(longHex)
  t.is(result, expected, 'should handle very long hex strings')
})
