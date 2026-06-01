'use strict'

const { randomBytes } = require('node:crypto')

const DEFAULT_TTL_MS = 60 * 60 * 1000 // 1 hour
const CHUNK_SIZE = 64 * 1024 // 64 KB per Hypercore block

/**
 * Manages temporary Hypercores that serve miner log files over Hyperswarm P2P.
 *
 * Uses the hp-svc-facs-net facility (net_r0) for Hyperswarm and the
 * hp-svc-facs-store facility (store_s0) for Hypercore/Corestore storage.
 * No direct hypercore or hyperswarm require needed.
 *
 * Signal plane: wrk-miner returns { coreKey, byteLength, expiresAt } via HRPC (~234 bytes).
 * Data plane:   app-node connects via Hyperswarm and downloads blocks directly.
 *
 * One shared connection handler on net_r0.swarm replicates all active log cores on every
 * connection; Hypercore's capability-based protocol ensures only matching cores transfer data.
 */
class LogCoreManager {
  constructor ({ netFac, storeFac, ttlMs } = {}) {
    this._netFac = netFac
    this._storeFac = storeFac
    this._ttlMs = ttlMs || DEFAULT_TTL_MS
    // coreKeyHex -> { core, discovery, timerId }
    this._cores = new Map()
    this._swarmReady = false
  }

  /**
   * Ensure the swarm is started and our (one-time) connection handler is registered.
   * Guards against double-init if replica code already called net_r0.startSwarm().
   */
  async _ensureSwarm () {
    if (!this._netFac.swarm) {
      await this._netFac.startSwarm()
    }

    if (this._swarmReady) return
    this._swarmReady = true

    // Replicate all active log-transfer cores on every inbound connection.
    // Hypercore's capability-based protocol ensures only the cores whose public key
    // the peer knows will exchange any data — no information leaks to unknown peers.
    // Replica uses a separate Corestore session (store_s1) on its own connection pool
    // (different DHT topic), so in practice this handler and the replica handler fire
    // on distinct sockets.
    this._netFac.swarm.on('connection', (socket) => {
      for (const [, entry] of this._cores) {
        entry.core.replicate(socket)
      }
    })
  }

  /**
   * Write logBuffer into a Corestore-managed Hypercore, announce it on Hyperswarm,
   * and return the metadata the caller sends back via HRPC.
   *
   * @param {Buffer} logBuffer  Raw binary log data from the physical miner
   * @param {string} minerId    Thing ID of the miner
   * @returns {Promise<{coreKey, discoveryKey, byteLength, minerId, expiresAt}>}
   */
  async serveLog (logBuffer, minerId) {
    await this._ensureSwarm()

    // Named cores get a deterministic key from the Corestore primary key + name.
    // A fresh random suffix ensures each call produces a distinct core.
    const id = randomBytes(8).toString('hex')
    const core = this._storeFac.getCore({ name: 'log-xfer-' + id })
    await core.ready()

    // Append in 64 KB chunks — optimal Hypercore block size
    let offset = 0
    while (offset < logBuffer.length) {
      await core.append(logBuffer.subarray(offset, Math.min(offset + CHUNK_SIZE, logBuffer.length)))
      offset += CHUNK_SIZE
    }

    const coreKeyHex = core.key.toString('hex')
    const discoveryKeyHex = core.discoveryKey.toString('hex')
    const expiresAt = Date.now() + this._ttlMs

    // Announce on the DHT so the app-node reader can find this worker
    const discovery = this._netFac.swarm.join(core.discoveryKey, { server: true, client: false })
    await discovery.flushed()

    // Auto-cleanup after TTL. unref() so a pending timer does not prevent process exit.
    const timerId = setTimeout(() => {
      this.cleanup(coreKeyHex).catch(() => {})
    }, this._ttlMs).unref()

    this._cores.set(coreKeyHex, { core, discovery, timerId })

    return {
      coreKey: coreKeyHex,
      discoveryKey: discoveryKeyHex,
      byteLength: logBuffer.length,
      minerId,
      expiresAt
    }
  }

  /**
   * Stop serving a specific core and free its block storage.
   * @param {string} coreKeyHex
   */
  async cleanup (coreKeyHex) {
    const entry = this._cores.get(coreKeyHex)
    if (!entry) return

    clearTimeout(entry.timerId)
    this._cores.delete(coreKeyHex)

    try { await entry.discovery.destroy() } catch {}
    try {
      // Clear all blocks to free Corestore storage, then close the session
      if (entry.core.length > 0) await entry.core.clear(0, entry.core.length)
      await entry.core.close()
    } catch {}
  }

  /**
   * Cleanup all active cores. Call on worker shutdown.
   * Does NOT destroy the swarm — the net_r0 facility owns that lifecycle.
   */
  async cleanupAll () {
    const keys = [...this._cores.keys()]
    await Promise.all(keys.map(k => this.cleanup(k)))
  }
}

module.exports = LogCoreManager
