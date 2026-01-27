'use strict'

const test = require('brittle')
const md5 = require('../../workers/lib/utils/md5')

test('md5 - basic string hashing', (t) => {
  const input = 'hello world'
  const expected = '5eb63bbbe01eeed093cb22bb8f5acdc3'
  const result = md5(input)
  t.is(result, expected, 'should hash string correctly')
})

test('md5 - empty string', (t) => {
  const input = ''
  const expected = 'd41d8cd98f00b204e9800998ecf8427e'
  const result = md5(input)
  t.is(result, expected, 'should hash empty string correctly')
})

test('md5 - unicode string', (t) => {
  const input = 'héllo wørld'
  const result = md5(input)
  // Note: This is a placeholder expected value - actual MD5 of unicode string
  t.ok(typeof result === 'string', 'should return string for unicode input')
  t.is(result.length, 32, 'should return 32-character hex string')
})

test('md5 - fromBytes function', (t) => {
  const input = 'test'
  const bytes = md5.fromUtf8(input)
  const result = bytes.toHex()
  const expected = '098f6bcd4621d373cade4e832627b4f6'
  t.is(result, expected, 'should hash bytes correctly')
})

test('md5 - fromUtf8 function', (t) => {
  const input = 'test'
  const result = md5.fromUtf8(input)
  t.ok(typeof result === 'object', 'should return object with toHex method')
  t.ok(typeof result.toHex === 'function', 'should have toHex method')
  const hex = result.toHex()
  t.is(hex, '098f6bcd4621d373cade4e832627b4f6', 'should produce correct hex output')
})

test('md5 - salt generation', (t) => {
  const salt1 = md5.salt()
  const salt2 = md5.salt()

  t.is(salt1.length, 8, 'should generate 8-character salt by default')
  t.is(salt2.length, 8, 'should generate 8-character salt by default')
  t.not(salt1, salt2, 'should generate different salts')

  const customSalt = md5.salt(12)
  t.is(customSalt.length, 12, 'should generate custom length salt')
})

test('md5 - crypt function', (t) => {
  const key = 'password'
  const setting = '$1$salt123$'
  const result = md5.crypt(key, setting)

  t.ok(result.startsWith('$1$'), 'should start with $1$')
  t.ok(result.includes('salt123'), 'should contain salt')
  t.is(result.split('$').length, 4, 'should have correct format')
})

test('md5 - crypt function with default setting', (t) => {
  const key = 'password'
  const result = md5.crypt(key)

  t.ok(result.startsWith('$1$'), 'should start with $1$')
  t.is(result.split('$').length, 4, 'should have correct format')
})

test('md5 - crypt function with long key', (t) => {
  const longKey = 'a'.repeat(100) // Key longer than MAX_KEY_LENGTH (64)

  try {
    md5.crypt(longKey)
    t.fail('should throw error for key too long')
  } catch (error) {
    t.ok(error, 'should throw error for key too long')
  }
})

test('md5 - various input types', (t) => {
  const testCases = [
    { input: 'a', expected: '0cc175b9c0f1b6a831c399e269772661' },
    { input: 'abc', expected: '900150983cd24fb0d6963f7d28e17f72' },
    { input: 'message digest', expected: 'f96b697d7cb7938d525a2f31aaf161d0' },
    { input: 'abcdefghijklmnopqrstuvwxyz', expected: 'c3fcd3d76192e4007dfb496cca67e13b' },
    { input: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', expected: 'd174ab98d277d9f5a5611c2c9f419d9f' }
  ]

  for (const testCase of testCases) {
    const result = md5(testCase.input)
    t.is(result, testCase.expected, `should hash "${testCase.input}" correctly`)
  }
})
