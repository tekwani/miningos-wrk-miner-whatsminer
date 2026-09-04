'use strict'

const crypto = require('node:crypto')

function sha256 (data) {
  return crypto.createHash('sha256').update(data).digest()
}

function aesEncrypt (plaintext, key) {
  const cipher = crypto.createCipheriv('aes-256-ecb', sha256(key), null)
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64')
}

function aesDecryptHex (ciphertext, key) {
  const decipher = crypto.createDecipheriv('aes-256-ecb', sha256(key), null)
  return Buffer.concat([decipher.update(ciphertext, 'base64'), decipher.final()]).toString('hex')
}

module.exports = {
  sha256,
  aesEncrypt,
  aesDecryptHex
}
