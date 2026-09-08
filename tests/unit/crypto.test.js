'use strict'

const test = require('brittle')
const hex2a = require('../../workers/lib/utils/hex2a')
const { sha256, aesEncrypt, aesDecryptHex } = require('../../workers/lib/utils/crypto')

test('crypto - sha256 hex', (t) => {
  t.is(
    sha256('hello').toString('hex'),
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    'should hash to known SHA256 hex'
  )
})

test('crypto - sha256 base64', (t) => {
  t.is(
    sha256('hello').toString('base64'),
    'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=',
    'should hash to known SHA256 base64'
  )
})

test('crypto - aes encrypt/decrypt roundtrip', (t) => {
  const key = 'secret-key'
  const plaintext = JSON.stringify({ cmd: 'get_token', token: 'abc' })
  const encrypted = aesEncrypt(plaintext, key)
  const decrypted = hex2a(aesDecryptHex(encrypted, key))
  t.is(decrypted, plaintext, 'should decrypt back to original plaintext')
})

test('crypto - aes decrypt of known ciphertext', (t) => {
  const key = 'fixed'
  const plaintext = '{"code":0,"msg":"ok"}'
  const encrypted = aesEncrypt(plaintext, key)
  t.ok(typeof encrypted === 'string' && encrypted.length > 0, 'should return base64 ciphertext')
  t.is(JSON.parse(hex2a(aesDecryptHex(encrypted, key))).code, 0, 'should parse decrypted JSON')
})

const { aesEncryptZeroPad } = require('../../mock/utils')

test('crypto - decrypts zero-padded responses (2026 REL2 firmware)', (t) => {
  const key = 'j8hdt2YiO9SNFfDizt5EL.'
  const plaintext = '{"STATUS":"S","When":1788861546,"Code":131,"Msg":{"logfilelen":"2464934"},"Description":""}'
  const decrypted = hex2a(aesDecryptHex(aesEncryptZeroPad(plaintext, key), key))
  t.is(decrypted, plaintext, 'should strip the zero padding')
  t.is(JSON.parse(decrypted).Code, 131, 'should parse as clean JSON')
})

test('crypto - decrypts an unpadded exact-block-multiple response', (t) => {
  const key = 'some-key'
  const plaintext = 'x'.repeat(48)
  const decrypted = hex2a(aesDecryptHex(aesEncryptZeroPad(plaintext, key), key))
  t.is(decrypted, plaintext, 'should pass through when no padding was added')
})

test('crypto - PKCS#7 responses still decrypt after the zero-pad fallback', (t) => {
  const key = 'secret-key'
  const plaintext = JSON.stringify({ STATUS: 'S', Code: 131 })
  t.is(hex2a(aesDecryptHex(aesEncrypt(plaintext, key), key)), plaintext)
})

test('crypto - non-block-aligned garbage still throws', (t) => {
  t.exception(() => aesDecryptHex(Buffer.from('abc').toString('base64'), 'k'), 'should reject invalid ciphertext')
})
