'use strict'

const zlib = require('node:zlib')

const GZIP_MAGIC = [0x1f, 0x8b]
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

const GZIP_INFLATE_INPUT_LIMIT = 4096

// A POSIX tar header is 512 bytes and carries 'ustar' at offset 257
const TAR_HEADER_LENGTH = 512
const TAR_MAGIC = 'ustar'
const TAR_MAGIC_OFFSET = 257

const TEXT_FORMAT = { extension: 'log', contentType: 'text/plain; charset=utf-8' }
const GZIP_FORMAT = { extension: 'gz', contentType: 'application/gzip' }
const TAR_GZ_FORMAT = { extension: 'tar.gz', contentType: 'application/gzip' }
const ZIP_FORMAT = { extension: 'zip', contentType: 'application/zip' }

function hasMagic (buffer, magic) {
  return buffer.length >= magic.length && magic.every((byte, index) => buffer[index] === byte)
}

function isGzippedTar (buffer) {
  let inflated
  try {
    inflated = zlib.gunzipSync(buffer.subarray(0, GZIP_INFLATE_INPUT_LIMIT), {
      finishFlush: zlib.constants.Z_SYNC_FLUSH
    })
  } catch {
    return false
  }
  if (inflated.length < TAR_HEADER_LENGTH) return false

  return inflated.toString('latin1', TAR_MAGIC_OFFSET, TAR_MAGIC_OFFSET + TAR_MAGIC.length) === TAR_MAGIC
}

/**
 * Format implied by the payload's leading bytes. The download_logs wire protocol
 * only reports a byte length, so magic bytes are the only source of the format.
 * Falls back to plain text and never claims tar without having seen a tar header.
 *
 * @param {Buffer} logBuffer
 * @returns {{ extension: string, contentType: string }}
 */
function detectLogFormat (logBuffer) {
  if (!logBuffer || !logBuffer.length) return TEXT_FORMAT

  if (hasMagic(logBuffer, GZIP_MAGIC)) {
    return isGzippedTar(logBuffer) ? TAR_GZ_FORMAT : GZIP_FORMAT
  }

  if (hasMagic(logBuffer, ZIP_MAGIC)) return ZIP_FORMAT

  return TEXT_FORMAT
}

module.exports = { detectLogFormat }
