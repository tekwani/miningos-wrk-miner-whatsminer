'use strict'

const test = require('brittle')
const { randomBytes } = require('node:crypto')
const LogCoreManager = require('../../workers/lib/log-core-manager')

const CHUNK_SIZE = 64 * 1024

// ─────────────────────────────────────────────────────────────────────────────
// Fake builders
// ─────────────────────────────────────────────────────────────────────────────

function makeDiscovery () {
  let destroyed = false
  return {
    flushed: async () => {},
    destroy: async () => { destroyed = true },
    get _destroyed () { return destroyed }
  }
}

function makeCore () {
  const key = randomBytes(32)
  const discoveryKey = randomBytes(32)
  const appended = []
  let closed = false
  let cleared = false

  return {
    key,
    discoveryKey,
    get length () { return appended.length },
    ready: async () => {},
    append: async (chunk) => { appended.push(Buffer.from(chunk)) },
    clear: async () => { cleared = true },
    close: async () => { closed = true },
    replicate: () => {},
    _appended: appended,
    get _closed () { return closed },
    get _cleared () { return cleared }
  }
}

function makeSwarm () {
  const _listeners = {}
  const joined = []

  return {
    joined,
    on (event, fn) {
      _listeners[event] = _listeners[event] || []
      _listeners[event].push(fn)
    },
    join (discoveryKey, opts) {
      joined.push({ discoveryKey, opts })
      return makeDiscovery()
    },
    emit (event, ...args) {
      for (const fn of (_listeners[event] || [])) fn(...args)
    },
    listenerCount (event) {
      return (_listeners[event] || []).length
    }
  }
}

function makeStoreFac () {
  const cores = []
  return {
    cores,
    getCore (opts) {
      const c = makeCore()
      cores.push({ opts, core: c })
      return c
    }
  }
}

function makeNetFac (existingSwarm = null) {
  let _swarm = existingSwarm
  return {
    get swarm () { return _swarm },
    startSwarm: async () => { _swarm = makeSwarm() }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────────────

test('LogCoreManager - constructor stores facilities', (t) => {
  const netFac = makeNetFac()
  const storeFac = makeStoreFac()

  const mgr = new LogCoreManager({ netFac, storeFac })

  t.ok(mgr._netFac === netFac, 'should store netFac reference')
  t.ok(mgr._storeFac === storeFac, 'should store storeFac reference')
  t.pass()
})

test('LogCoreManager - constructor defaults ttlMs to 1 hour', (t) => {
  const mgr = new LogCoreManager({ netFac: makeNetFac(), storeFac: makeStoreFac() })
  t.is(mgr._ttlMs, 60 * 60 * 1000, 'default ttlMs should be 1 hour')
  t.pass()
})

test('LogCoreManager - constructor accepts custom ttlMs', (t) => {
  const mgr = new LogCoreManager({ netFac: makeNetFac(), storeFac: makeStoreFac(), ttlMs: 5000 })
  t.is(mgr._ttlMs, 5000, 'should use provided ttlMs')
  t.pass()
})

test('LogCoreManager - constructor initialises empty cores map', (t) => {
  const mgr = new LogCoreManager({ netFac: makeNetFac(), storeFac: makeStoreFac() })
  t.ok(mgr._cores instanceof Map, 'should be a Map')
  t.is(mgr._cores.size, 0, 'should start empty')
  t.is(mgr._swarmReady, false, 'swarmReady should start false')
  t.pass()
})

// ─────────────────────────────────────────────────────────────────────────────
// _ensureSwarm
// ─────────────────────────────────────────────────────────────────────────────

test('LogCoreManager - _ensureSwarm calls startSwarm when swarm is null', async (t) => {
  let startCalls = 0
  const swarm = makeSwarm()
  const netFac = {
    get swarm () { return startCalls > 0 ? swarm : null },
    startSwarm: async () => { startCalls++ }
  }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })
  await mgr._ensureSwarm()

  t.is(startCalls, 1, 'should call startSwarm exactly once')
  t.ok(mgr._swarmReady, 'should set swarmReady to true')
  t.pass()
})

test('LogCoreManager - _ensureSwarm skips startSwarm when swarm already exists', async (t) => {
  let startCalls = 0
  const swarm = makeSwarm()
  const netFac = {
    get swarm () { return swarm },
    startSwarm: async () => { startCalls++ }
  }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })
  await mgr._ensureSwarm()

  t.is(startCalls, 0, 'should not call startSwarm when swarm exists')
  t.pass()
})

test('LogCoreManager - _ensureSwarm registers connection handler exactly once', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })

  await mgr._ensureSwarm()
  await mgr._ensureSwarm()
  await mgr._ensureSwarm()

  t.is(swarm.listenerCount('connection'), 1, 'should register connection listener only once')
  t.pass()
})

// ─────────────────────────────────────────────────────────────────────────────
// serveLog — metadata
// ─────────────────────────────────────────────────────────────────────────────

test('LogCoreManager - serveLog returns correct metadata shape', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac(), ttlMs: 5000 })
  const logBuffer = Buffer.from('hello miner log')

  const meta = await mgr.serveLog(logBuffer, 'miner-001')

  t.is(typeof meta.coreKey, 'string', 'coreKey should be a string')
  t.is(meta.coreKey.length, 64, 'coreKey should be 64-char hex')
  t.is(typeof meta.discoveryKey, 'string', 'discoveryKey should be a string')
  t.is(meta.discoveryKey.length, 64, 'discoveryKey should be 64-char hex')
  t.is(meta.byteLength, logBuffer.length, 'byteLength should match input length')
  t.is(meta.minerId, 'miner-001', 'should return provided minerId')
  t.ok(meta.expiresAt > Date.now(), 'expiresAt should be in the future')
  t.ok(meta.expiresAt <= Date.now() + 6000, 'expiresAt should be within ttlMs range')
  t.pass()
})

test('LogCoreManager - serveLog registers core in internal map', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })
  const meta = await mgr.serveLog(Buffer.from('log data'), 'miner-001')

  t.is(mgr._cores.size, 1, 'should have one entry in cores map')
  t.ok(mgr._cores.has(meta.coreKey), 'should key the entry by coreKey hex')
  t.pass()
})

test('LogCoreManager - serveLog multiple calls produce distinct cores', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })

  const meta1 = await mgr.serveLog(Buffer.from('log1'), 'miner-001')
  const meta2 = await mgr.serveLog(Buffer.from('log2'), 'miner-002')

  t.not(meta1.coreKey, meta2.coreKey, 'each serveLog call should produce a unique coreKey')
  t.is(mgr._cores.size, 2, 'should track both cores independently')
  t.pass()
})

// ─────────────────────────────────────────────────────────────────────────────
// serveLog — chunking
// ─────────────────────────────────────────────────────────────────────────────

test('LogCoreManager - serveLog splits data into 64KB chunks', async (t) => {
  const swarm = makeSwarm()
  const storeFac = makeStoreFac()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac })

  // 2.5 chunks worth of data
  const logBuffer = Buffer.alloc(Math.floor(CHUNK_SIZE * 2.5), 0xaa)
  await mgr.serveLog(logBuffer, 'miner-001')

  const { core } = storeFac.cores[0]
  t.is(core._appended.length, 3, 'should write 3 chunks for 2.5x CHUNK_SIZE input')
  t.is(core._appended[0].length, CHUNK_SIZE, 'first chunk should be full CHUNK_SIZE')
  t.is(core._appended[1].length, CHUNK_SIZE, 'second chunk should be full CHUNK_SIZE')
  t.ok(core._appended[2].length < CHUNK_SIZE, 'last chunk should be smaller than CHUNK_SIZE')

  const totalBytes = core._appended.reduce((sum, c) => sum + c.length, 0)
  t.is(totalBytes, logBuffer.length, 'total appended bytes should equal input length')
  t.pass()
})

test('LogCoreManager - serveLog handles data smaller than one chunk', async (t) => {
  const swarm = makeSwarm()
  const storeFac = makeStoreFac()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac })
  const logBuffer = Buffer.from('tiny log')

  await mgr.serveLog(logBuffer, 'miner-001')

  const { core } = storeFac.cores[0]
  t.is(core._appended.length, 1, 'should write exactly one chunk for small input')
  t.is(core._appended[0].length, logBuffer.length, 'chunk length should match input')
  t.pass()
})

// ─────────────────────────────────────────────────────────────────────────────
// serveLog — swarm announcement
// ─────────────────────────────────────────────────────────────────────────────

test('LogCoreManager - serveLog joins swarm as server only', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })
  await mgr.serveLog(Buffer.from('log'), 'miner-001')

  t.is(swarm.joined.length, 1, 'should join exactly one DHT topic')
  t.alike(swarm.joined[0].opts, { server: true, client: false }, 'should join as server only')
  t.pass()
})

// ─────────────────────────────────────────────────────────────────────────────
// connection handler — replication
// ─────────────────────────────────────────────────────────────────────────────

test('LogCoreManager - connection handler replicates all active cores', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })
  await mgr.serveLog(Buffer.from('log1'), 'miner-001')
  await mgr.serveLog(Buffer.from('log2'), 'miner-002')

  const replicateCalls = []
  for (const [, entry] of mgr._cores) {
    entry.core.replicate = (socket) => replicateCalls.push(socket)
  }

  const fakeSocket = {}
  swarm.emit('connection', fakeSocket)

  t.is(replicateCalls.length, 2, 'should call replicate on every active core')
  t.ok(replicateCalls.every(s => s === fakeSocket), 'should pass the inbound socket to replicate')
  t.pass()
})

test('LogCoreManager - connection handler does not replicate cleaned-up cores', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })
  const meta1 = await mgr.serveLog(Buffer.from('log1'), 'miner-001')
  await mgr.serveLog(Buffer.from('log2'), 'miner-002')

  await mgr.cleanup(meta1.coreKey)

  const replicateCalls = []
  for (const [, entry] of mgr._cores) {
    entry.core.replicate = (socket) => replicateCalls.push(socket)
  }

  swarm.emit('connection', {})

  t.is(replicateCalls.length, 1, 'should only replicate the remaining active core')
  t.pass()
})

// ─────────────────────────────────────────────────────────────────────────────
// cleanup
// ─────────────────────────────────────────────────────────────────────────────

test('LogCoreManager - cleanup removes core from map', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })
  const meta = await mgr.serveLog(Buffer.from('log'), 'miner-001')

  t.is(mgr._cores.size, 1, 'precondition: one core before cleanup')
  await mgr.cleanup(meta.coreKey)
  t.is(mgr._cores.size, 0, 'should be empty after cleanup')
  t.pass()
})

test('LogCoreManager - cleanup destroys discovery and closes core', async (t) => {
  let discoveryDestroyed = false
  let coreClosed = false
  let coreCleared = false

  const discovery = {
    flushed: async () => {},
    destroy: async () => { discoveryDestroyed = true }
  }
  const swarm = {
    on: () => {},
    join: () => discovery
  }
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  // Use a core whose length will be > 0 after appending
  const storeFac = {
    getCore () {
      const c = makeCore()
      c.close = async () => { coreClosed = true }
      c.clear = async () => { coreCleared = true }
      return c
    }
  }

  const mgr = new LogCoreManager({ netFac, storeFac })
  const meta = await mgr.serveLog(Buffer.from('some data'), 'miner-001')
  await mgr.cleanup(meta.coreKey)

  t.ok(discoveryDestroyed, 'should destroy the DHT discovery')
  t.ok(coreClosed, 'should close the core session')
  t.ok(coreCleared, 'should clear core blocks to free storage')
  t.pass()
})

test('LogCoreManager - cleanup is a no-op for unknown coreKey', async (t) => {
  const mgr = new LogCoreManager({ netFac: makeNetFac(makeSwarm()), storeFac: makeStoreFac() })

  // Should not throw
  await mgr.cleanup('0000000000000000000000000000000000000000000000000000000000000000')
  t.pass()
})

// ─────────────────────────────────────────────────────────────────────────────
// cleanupAll
// ─────────────────────────────────────────────────────────────────────────────

test('LogCoreManager - cleanupAll removes all active cores', async (t) => {
  const swarm = makeSwarm()
  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }

  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })
  await mgr.serveLog(Buffer.from('log1'), 'miner-001')
  await mgr.serveLog(Buffer.from('log2'), 'miner-002')
  await mgr.serveLog(Buffer.from('log3'), 'miner-003')

  t.is(mgr._cores.size, 3, 'precondition: 3 cores before cleanupAll')
  await mgr.cleanupAll()
  t.is(mgr._cores.size, 0, 'should have no cores after cleanupAll')
  t.pass()
})

test('LogCoreManager - cleanupAll does not destroy the swarm', async (t) => {
  let swarmDestroyed = false
  const swarm = makeSwarm()
  swarm.destroy = async () => { swarmDestroyed = true }

  const netFac = { get swarm () { return swarm }, startSwarm: async () => {} }
  const mgr = new LogCoreManager({ netFac, storeFac: makeStoreFac() })

  await mgr.serveLog(Buffer.from('log'), 'miner-001')
  await mgr.cleanupAll()

  t.not(swarmDestroyed, true, 'swarm is owned by net_r0 facility — must not be destroyed')
  t.pass()
})

test('LogCoreManager - cleanupAll on empty manager does not throw', async (t) => {
  const mgr = new LogCoreManager({ netFac: makeNetFac(makeSwarm()), storeFac: makeStoreFac() })

  await mgr.cleanupAll()
  t.is(mgr._cores.size, 0, 'should remain empty')
  t.pass()
})
