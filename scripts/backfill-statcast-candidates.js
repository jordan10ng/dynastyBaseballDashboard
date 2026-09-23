// Manual, on-demand only (NOT run by the nightly GHA job): backfills full Statcast
// history for the small list of players flagged by scripts/flag-statcast-backfill.js
// -- players with pre-existing MLB history that the day-cursor sync never covered
// for them (added to players.json after those days already passed). Per-player
// fetching is fine here because the queue is expected to be a handful of players,
// not thousands -- that volume is exactly what broke the nightly job before.
// Usage: node scripts/backfill-statcast-candidates.js
const fs = require('fs')
const path = require('path')
const os = require('os')
const { fetchCSV, parseStatcastCSV, emptyBucket, addRowToBucket, isTwoWayPositions } = require('../lib/statcast-reduce')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const TOTALS_PATH = path.join(BASE, 'statcast-totals.json')
const QUEUE_PATH = path.join(BASE, 'statcast-backfill-queue.json')
const START_DATE = '2015-01-01'
const TODAY = new Date().toISOString().slice(0, 10)

function savantUrl(playerType, mlbamId) {
  return `https://baseballsavant.mlb.com/statcast_search/csv?player_type=${playerType}&player_id=${mlbamId}&game_date_gt=${START_DATE}&game_date_lt=${TODAY}&type=details`
}

// Same shape as applyDayRows in lib/statcast-reduce.js, just fed one player's own
// rows instead of a whole day's league-wide rows.
function reduceForPlayer(rows, splitByPitchType) {
  const out = {}
  for (const row of rows) {
    const season = row.game_year, gt = row.game_type
    if (!season || !gt || !row.pitch_type) continue
    if (!out[season]) out[season] = {}
    if (splitByPitchType) {
      if (!out[season][gt]) out[season][gt] = {}
      if (!out[season][gt][row.pitch_type]) out[season][gt][row.pitch_type] = emptyBucket()
      addRowToBucket(out[season][gt][row.pitch_type], row)
    } else {
      if (!out[season][gt]) out[season][gt] = emptyBucket()
      addRowToBucket(out[season][gt], row)
    }
  }
  return out
}

async function main() {
  if (!fs.existsSync(QUEUE_PATH)) { console.log('No queue file -- run scripts/flag-statcast-backfill.js first.'); return }
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'))
  if (!queue.length) { console.log('Queue is empty, nothing to backfill.'); return }

  const out = fs.existsSync(TOTALS_PATH) ? JSON.parse(fs.readFileSync(TOTALS_PATH, 'utf8')) : {}
  const remaining = []

  for (const p of queue) {
    const { hasArm, hasBat } = isTwoWayPositions(p.positions)
    console.log(`Backfilling ${p.name} (${p.mlbam_id})...`)
    try {
      const entry = { _meta: { hasArm, hasBat } }
      if (hasBat) entry.bat = reduceForPlayer(parseStatcastCSV(await fetchCSV(savantUrl('batter', p.mlbam_id))), false)
      if (hasArm) entry.pitch = reduceForPlayer(parseStatcastCSV(await fetchCSV(savantUrl('pitcher', p.mlbam_id))), true)
      out[p.mlbam_id] = entry
      const seasons = (entry.bat ? Object.keys(entry.bat).length : 0) + (entry.pitch ? Object.keys(entry.pitch).length : 0)
      console.log(`  done -- ${seasons} season(s) of data`)
    } catch (e) {
      console.error(`  failed: ${e.message} -- left in queue for next run`)
      remaining.push(p)
    }
  }

  fs.writeFileSync(TOTALS_PATH, JSON.stringify(out))
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(remaining, null, 2))
  console.log(`Done. ${queue.length - remaining.length}/${queue.length} backfilled, ${remaining.length} left in queue.`)
}

main()
