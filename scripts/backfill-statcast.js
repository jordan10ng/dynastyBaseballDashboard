// One-time backfill: data/statcast-totals.json
// Pulls Statcast day-by-day, league-wide (2015-present), and fans each day's rows out
// to whichever tracked players (players.json) were involved -- one request per calendar
// day covers every player at once, instead of one request per player (which is what
// made this unreliable on GitHub Actions: 9,558 requests/run vs ~3,000 total, ever).
// Resumable via a day cursor. Usage: node scripts/backfill-statcast.js [--fresh] [--concurrency=N]
const fs = require('fs')
const path = require('path')
const os = require('os')
const { fetchCSV, parseStatcastCSV, dayUrl, addDays, buildPlayerIndex, applyDayRows } = require('../lib/statcast-reduce')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const PLAYERS_PATH = path.join(BASE, 'players.json')
const OUT_PATH = path.join(BASE, 'statcast-totals.json')
const CURSOR_PATH = path.join(BASE, 'statcast-cursor.json')
const START_DATE = '2015-01-01'
const TODAY = new Date().toISOString().slice(0, 10)

const args = process.argv.slice(2)
const FRESH = args.includes('--fresh')
const CONCURRENCY = (() => { const a = args.find(x => x.startsWith('--concurrency=')); return a ? parseInt(a.split('=')[1]) : 4 })()
const SAVE_EVERY = 20

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function allDays(start, endExclusive) {
  const days = []
  for (let d = start; d < endExclusive; d = addDays(d, 1)) days.push(d)
  return days
}

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'))
  const arr = Array.isArray(players) ? players : Object.values(players)
  const playerIndex = buildPlayerIndex(arr)
  console.log(`Tracking ${Object.keys(playerIndex).length} players with mlbam_id`)

  let out = {}
  // Cursor = last day fully applied, so a resume starts the day AFTER it (restarting on it
  // would double-count that day). Ends at yesterday (UTC): today is incomplete.
  let start = START_DATE
  if (!FRESH) {
    if (fs.existsSync(OUT_PATH)) out = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
    if (fs.existsSync(CURSOR_PATH)) start = addDays(JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8')).lastDay, 1)
  }

  const YESTERDAY = addDays(TODAY, -1)
  const days = allDays(start, TODAY)
  console.log(`Backfilling ${days.length} days, from ${start} through ${YESTERDAY}`)

  // Process in ordered chunks (not a free-for-all work pool): the cursor can only safely
  // advance past days that are ALL confirmed done, and under concurrency, days can finish
  // out of order -- chunking keeps "cursor = end of last chunk" a safe resume point.
  let done = 0, errors = 0, totalRows = 0
  const chunksPerSave = Math.max(1, Math.round(SAVE_EVERY / CONCURRENCY))

  async function fetchDay(day) {
    try {
      const csv = await fetchCSV(dayUrl(day))
      const rows = parseStatcastCSV(csv)
      applyDayRows(out, playerIndex, rows)
      totalRows += rows.length
    } catch (e) {
      errors++
      console.error(`  ${day}: ${e.message}`)
    }
    done++
    await sleep(150)
  }

  let chunkNum = 0
  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const chunk = days.slice(i, i + CONCURRENCY)
    await Promise.all(chunk.map(fetchDay))
    chunkNum++
    const chunkEnd = chunk[chunk.length - 1]
    const isLast = i + CONCURRENCY >= days.length
    if (chunkNum % chunksPerSave === 0 || isLast) {
      fs.writeFileSync(OUT_PATH, JSON.stringify(out))
      fs.writeFileSync(CURSOR_PATH, JSON.stringify({ lastDay: chunkEnd }))
      console.log(`  ${done}/${days.length} days, through ${chunkEnd} (rows=${totalRows} errors=${errors})`)
    }
  }

  // stamp every tracked player that ended up with data
  for (const id in out) {
    if (!out[id]._meta) out[id]._meta = {}
    out[id]._meta.hasArm = playerIndex[id]?.hasArm ?? false
    out[id]._meta.hasBat = playerIndex[id]?.hasBat ?? false
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out))
  fs.writeFileSync(CURSOR_PATH, JSON.stringify({ lastDay: YESTERDAY }))
  console.log(`Done. ${done} days processed, ${totalRows} total rows, ${errors} errors, ${Object.keys(out).length} players with data.`)
}

main()
