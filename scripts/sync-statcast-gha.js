// Nightly incremental Statcast sync: adds only new games since each player's
// lastSyncDate onto data/statcast-totals.json. Never re-fetches or re-stores
// full history, never stores raw pitch rows -- purely additive on top of the
// one-time backfill (scripts/backfill-statcast.js).
const fs = require('fs')
const path = require('path')
const os = require('os')
const { fetchCSV, parseStatcastCSV, reduceRows, mergeTreeInto, isTwoWayPositions, savantUrl } = require('../lib/statcast-reduce')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const PLAYERS_PATH = path.join(BASE, 'players.json')
const OUT_PATH = path.join(BASE, 'statcast-totals.json')
const START_DATE = '2015-01-01'
const TODAY = new Date().toISOString().slice(0, 10)
const CONCURRENCY = 5
const SAVE_EVERY = 100

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function pullOne(mlbamId, playerType, dateGt) {
  const csv = await fetchCSV(savantUrl(playerType, mlbamId, dateGt, TODAY))
  const rows = parseStatcastCSV(csv)
  return reduceRows(rows, playerType === 'pitcher')
}

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'))
  const arr = Array.isArray(players) ? players : Object.values(players)
  const candidates = arr.filter(p => p.mlbam_id)

  const out = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : {}

  let done = 0, updated = 0, errors = 0
  let idx = 0

  async function worker() {
    while (idx < candidates.length) {
      const p = candidates[idx++]
      const mlbamId = p.mlbam_id
      const { hasArm, hasBat } = isTwoWayPositions(p.positions)
      const existing = out[mlbamId]
      // game_date_gt is exclusive, so a player synced through TODAY already has
      // nothing new to add -- gt uses their lastSyncDate, or the full-career
      // start date for a player who was never backfilled (e.g. newly added).
      const dateGt = existing?._meta?.lastSyncDate || START_DATE
      if (dateGt >= TODAY) { done++; continue }
      try {
        if (hasBat) {
          const add = await pullOne(mlbamId, 'batter', dateGt)
          if (!existing?.bat) { if (!out[mlbamId]) out[mlbamId] = {}; out[mlbamId].bat = add }
          else mergeTreeInto(existing.bat, add, false)
          await sleep(200)
        }
        if (hasArm) {
          const add = await pullOne(mlbamId, 'pitcher', dateGt)
          if (!existing?.pitch) { if (!out[mlbamId]) out[mlbamId] = {}; out[mlbamId].pitch = add }
          else mergeTreeInto(existing.pitch, add, true)
          await sleep(200)
        }
        if (!out[mlbamId]._meta) out[mlbamId]._meta = {}
        out[mlbamId]._meta.hasArm = hasArm
        out[mlbamId]._meta.hasBat = hasBat
        out[mlbamId]._meta.lastSyncDate = TODAY
        updated++
      } catch (e) {
        errors++
        console.error(`  ${p.name} (${mlbamId}): ${e.message}`)
      }
      done++
      if (done % SAVE_EVERY === 0) {
        fs.writeFileSync(OUT_PATH, JSON.stringify(out))
        console.log(`  ${done}/${candidates.length} (updated=${updated} errors=${errors})`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  fs.writeFileSync(OUT_PATH, JSON.stringify(out))
  console.log(`Done. ${done} checked, ${updated} updated, ${errors} errors. Wrote ${OUT_PATH}`)
}

main()
