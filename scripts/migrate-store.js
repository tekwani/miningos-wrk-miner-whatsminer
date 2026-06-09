'use strict'

// migrate-store.js
//
// Copy a legacy whatsminer miner worker's on-disk Hyperbee store into another
// worker's store, RE-KEYING entries under the destination's own corestore
// identity. A raw `cp -r` is wrong for two reasons:
//   1. corestore derives each core's keypair from the store's on-disk seed +
//      core name, so copying the dir would import the source's identities and
//      collide with the dest worker's own P2P/RPC keys.
//   2. source and dest may run different corestore/hypercore on-disk formats
//      (e.g. corestore 6 `cores/`+`primary-key` vs corestore 7 `CORESTORE`+`db/`).
// So we open the SOURCE with ITS OWN stack (read), the DEST with ITS OWN stack
// (write), and copy logical Hyperbee entries between them — the Hyperbee API
// (sub / createReadStream / put) is compatible across versions.
//
// What gets copied (the logical schema is identical across the rename):
//   - MAIN_DB ('main') bee subs: things, meta_logs_00, settings   (verbatim)
//   - every time-log core `${getLogName(logKey)}-${point}` for point 0..cur,
//     for each logKey in meta_logs_00 (snaps, alerts, history, stats)
//
// Usage:
//   node scripts/migrate-store.js --src <legacy store/<rack>-data> \
//                                 --dst <dest   store/<rack>-db> \
//                                 [--dry-run] [--skip-stats]
//
// The hp-svc-facs-store module is loaded from each store's OWN repo (resolved as
// <repoRoot>/node_modules/hp-svc-facs-store, where repoRoot is two levels up
// from the store dir), so each side uses its matching corestore version.
//
// Preconditions:
//   - the DEST worker must be STOPPED (corestore is single-writer per dir)
//   - the DEST store dir must already exist (run the dest worker once first)
//   - the SRC store should be quiesced (source worker not writing)

const fs = require('fs')
const path = require('path')

const { MAIN_DB } = require('@tetherto/miningos-tpl-wrk-thing/workers/lib/constants')
const { getLogName } = require('@tetherto/miningos-tpl-wrk-thing/workers/lib/wrk-fun-logs')

const MAIN_SUBS = ['things', 'meta_logs_00', 'settings']

function parseArgs (argv) {
  const args = { dryRun: false, skipStats: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--src') args.src = argv[++i]
    else if (a === '--dst') args.dst = argv[++i]
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--skip-stats') args.skipStats = true
    else if (a === '-h' || a === '--help') args.help = true
    else throw new Error(`unknown arg: ${a}`)
  }
  return args
}

function usage () {
  console.log('Usage: node scripts/migrate-store.js --src <store/<rack>-data> --dst <store/<rack>-db> [--dry-run] [--skip-stats]')
}

// load the store facility from the repo that owns this store dir, so the right
// corestore version reads/writes the right on-disk format.
function loadFacility (storeDir) {
  const repoRoot = path.resolve(storeDir, '..', '..')
  const modPath = path.join(repoRoot, 'node_modules', '@tetherto/hp-svc-facs-store')
  if (!fs.existsSync(modPath)) {
    throw new Error(`hp-svc-facs-store not found for ${storeDir} (looked in ${modPath})`)
  }
  return require(modPath)
}

// bfx-facs-base lifecycle is callback-style in both repos; wrap for await.
function pStart (fac) { return new Promise((resolve, reject) => fac.start(err => err ? reject(err) : resolve())) }
function pStop (fac) { return new Promise((resolve, reject) => fac.stop(err => err ? reject(err) : resolve())) }

async function openStore (storeDir) {
  const Facility = loadFacility(storeDir)
  const fac = new Facility({}, { ns: 's1', storeDir }, { env: 'production' })
  await pStart(fac)
  return fac
}

async function copySub (srcMain, dstMain, sub, dryRun) {
  let n = 0
  for await (const { key, value } of srcMain.sub(sub).createReadStream()) {
    if (!dryRun) await dstMain.sub(sub).put(key, value)
    n++
  }
  return n
}

// Copy one time-log core (a single rotation point), preserving binary keys and
// JSON value buffers byte-for-byte. The dest core is created lazily so we never
// leave empty cores behind for points that hold no entries.
async function copyLogPoint (srcFac, dstFac, coreName, dryRun) {
  const srcLog = await srcFac.getBee({ name: coreName }, { keyEncoding: 'binary' })
  await srcLog.ready()

  let dstLog = null
  let entries = 0
  try {
    for await (const { key, value } of srcLog.createReadStream()) {
      if (!dryRun) {
        if (!dstLog) {
          dstLog = await dstFac.getBee({ name: coreName }, { keyEncoding: 'binary' })
          await dstLog.ready()
        }
        await dstLog.put(key, value)
      }
      entries++
    }
  } catch (err) {
    console.warn(`[migrate-store] WARN reading ${coreName}: ${err.message} (skipped)`)
  } finally {
    await srcLog.close()
    if (dstLog) await dstLog.close()
  }
  return entries
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { usage(); return }
  if (!args.src || !args.dst) { usage(); process.exitCode = 1; return }

  const src = path.resolve(args.src)
  const dst = path.resolve(args.dst)

  if (!fs.existsSync(src)) throw new Error(`source store dir not found: ${src}`)
  if (!fs.existsSync(dst)) throw new Error(`dest store dir not found (run the dest worker once first): ${dst}`)
  if (src === dst) throw new Error('--src and --dst must differ')

  console.log(`[migrate-store] src = ${src}`)
  console.log(`[migrate-store] dst = ${dst}`)
  console.log(`[migrate-store] mode = ${args.dryRun ? 'DRY-RUN (no writes)' : 'WRITE'}${args.skipStats ? ', skip-stats' : ''}`)

  const srcFac = await openStore(src)
  const dstFac = await openStore(dst)

  const counts = { things: 0, meta_logs_00: 0, settings: 0, logKeys: 0, logPoints: 0, logEntries: 0, skippedStatLogs: 0 }

  try {
    const srcMain = await srcFac.getBee({ name: MAIN_DB }, { keyEncoding: 'utf-8' })
    const dstMain = await dstFac.getBee({ name: MAIN_DB }, { keyEncoding: 'utf-8' })
    await srcMain.ready()
    await dstMain.ready()

    // 1) copy MAIN_DB subs verbatim. meta_logs_00 carries each log's `cur`, so
    //    after this the dest worker can resolve the same set of log points.
    for (const sub of MAIN_SUBS) {
      counts[sub] = await copySub(srcMain, dstMain, sub, args.dryRun)
    }
    console.log(`[migrate-store] main subs: things=${counts.things} meta_logs_00=${counts.meta_logs_00} settings=${counts.settings}`)

    // 2) copy every time-log core, walking rotation points 0..cur per logKey.
    for await (const { key: logKey, value } of srcMain.sub('meta_logs_00').createReadStream()) {
      if (args.skipStats && logKey.startsWith('stat-')) { counts.skippedStatLogs++; continue }
      const { cur } = JSON.parse(value.toString())
      counts.logKeys++
      for (let point = 0; point <= cur; point++) {
        const entries = await copyLogPoint(srcFac, dstFac, `${getLogName(logKey)}-${point}`, args.dryRun)
        if (entries > 0) { counts.logPoints++; counts.logEntries += entries }
      }
    }
    console.log(`[migrate-store] logs: keys=${counts.logKeys} points=${counts.logPoints} entries=${counts.logEntries}${args.skipStats ? ` skippedStatLogs=${counts.skippedStatLogs}` : ''}`)

    await srcMain.close()
    await dstMain.close()
  } finally {
    await pStop(srcFac)
    await pStop(dstFac)
  }

  console.log(`[migrate-store] DONE${args.dryRun ? ' (dry-run, nothing written)' : ''}`)
}

main().catch(err => { console.error('[migrate-store] FAILED:', err); process.exit(1) })
