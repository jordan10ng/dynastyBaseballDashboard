// One-time backfill: data/statcast-totals.json
// Pulls full-career Statcast (2015-present) per player from Baseball Savant,
// reduces to additive per-season/game_type/pitch_type totals (no raw rows stored).
// Resumable: players already present in the output are skipped unless --fresh.
// Usage: node scripts/backfill-statcast.js [--limit=N] [--fresh] [--concurrency=N]
const fs = require('fs')
const path = require('path')
const os = require('os')
const { fetchCSV, parseStatcastCSV, reduceRows, isTwoWayPositions, savantUrl } = require('../lib/statcast-reduce')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const PLAYERS_PATH = path.join(BASE, 'players.json')
const OUT_PATH = path.join(BASE, 'statcast-totals.json')
const START_DATE = '2015-01-01'
const TODAY = new Date().toISOString().slice(0, 10)

const args = process.argv.slice(2)
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1]) : Infinity })()
const FRESH = args.includes('--fresh')
const CONCURRENCY = (() => { const a = args.find(x => x.startsWith('--concurrency=')); return a ? parseInt(a.split('=')[1]) : 3 })()
const SAVE_EVERY = 50

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function pullOne(mlbamId, playerType) {
  const csv = await fetchCSV(savantUrl(playerType, mlbamId, START_DATE, TODAY))
  const rows = parseStatcastCSV(csv)
  return reduceRows(rows, playerType === 'pitcher')
}

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'))
  const arr = Array.isArray(players) ? players : Object.values(players)
  const candidates = arr.filter(p => p.mlbam_id)

  let out = {}
  if (!FRESH && fs.existsSync(OUT_PATH)) out = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))

  const todo = candidates.filter(p => !out[p.mlbam_id]).slice(0, LIMIT)
  console.log(`${candidates.length} candidates, ${todo.length} to backfill (${candidates.length - todo.length} already done)`)

  let done = 0, empty = 0, errors = 0
  let idx = 0

  async function worker() {
    while (idx < todo.length) {
      const p = todo[idx++]
      const mlbamId = p.mlbam_id
      const { hasArm, hasBat } = isTwoWayPositions(p.positions)
      try {
        const entry = { _meta: { lastSyncDate: TODAY, hasArm, hasBat } }
        if (hasBat) { entry.bat = await pullOne(mlbamId, 'batter'); await sleep(200) }
        if (hasArm) { entry.pitch = await pullOne(mlbamId, 'pitcher'); await sleep(200) }
        const hasData = (entry.bat && Object.keys(entry.bat).length) || (entry.pitch && Object.keys(entry.pitch).length)
        out[mlbamId] = entry
        if (!hasData) empty++
      } catch (e) {
        errors++
        console.error(`  ${p.name} (${mlbamId}): ${e.message}`)
      }
      done++
      if (done % SAVE_EVERY === 0) {
        fs.writeFileSync(OUT_PATH, JSON.stringify(out))
        console.log(`  ${done}/${todo.length} (empty=${empty} errors=${errors})`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  fs.writeFileSync(OUT_PATH, JSON.stringify(out))
  console.log(`Done. ${done} processed, ${empty} empty, ${errors} errors. Wrote ${OUT_PATH}`)
}

main()
