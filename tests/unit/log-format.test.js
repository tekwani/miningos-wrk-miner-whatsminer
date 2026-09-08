'use strict'

const test = require('brittle')
const zlib = require('zlib')
const { detectLogFormat } = require('../../workers/lib/log-format')
const { buildTarGzArchive } = require('../../mock/utils')

test('detectLogFormat - plain text is a .log', (t) => {
  const format = detectLogFormat(Buffer.from('[INFO] Miner started successfully\n'))
  t.is(format.extension, 'log')
  t.is(format.contentType, 'text/plain; charset=utf-8')
})

test('detectLogFormat - gzipped tar is a .tar.gz', (t) => {
  const format = detectLogFormat(buildTarGzArchive('miner.log', 'log content'))
  t.is(format.extension, 'tar.gz')
  t.is(format.contentType, 'application/gzip')
})

test('detectLogFormat - large gzipped tar is detected from the head alone', (t) => {
  const payload = buildTarGzArchive('miner.log', Buffer.alloc(4 * 1024 * 1024, 0x41))
  const format = detectLogFormat(payload)
  t.is(format.extension, 'tar.gz')
})

test('detectLogFormat - bare gzip (no tar inside) is a .gz', (t) => {
  const format = detectLogFormat(zlib.gzipSync(Buffer.from('just some gzipped text')))
  t.is(format.extension, 'gz')
  t.is(format.contentType, 'application/gzip')
})

test('detectLogFormat - zip is a .zip', (t) => {
  const format = detectLogFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))
  t.is(format.extension, 'zip')
  t.is(format.contentType, 'application/zip')
})

test('detectLogFormat - gzip magic with garbage body falls back to .gz', (t) => {
  const format = detectLogFormat(Buffer.from([0x1f, 0x8b, 0xff, 0xff, 0xff]))
  t.is(format.extension, 'gz')
})

test('detectLogFormat - empty and missing buffers fall back to text', (t) => {
  t.is(detectLogFormat(Buffer.alloc(0)).extension, 'log')
  t.is(detectLogFormat(null).extension, 'log')
})

test('detectLogFormat - single byte payload is text', (t) => {
  t.is(detectLogFormat(Buffer.from('a')).extension, 'log')
})
