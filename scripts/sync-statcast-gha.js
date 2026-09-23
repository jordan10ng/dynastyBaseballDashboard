// Nightly incremental Statcast sync: pulls each day since the last run, league-wide
// (one request per day, not per player), and fans rows out to tracked players.
// A handful of requests total, never thousands -- this is what makes it safe to run
// inside the shared job timeout instead of blowing it.
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
const CONCURRENCY = 3

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

  const out = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : {}
  const cursor = fs.existsSync(CURSOR_PATH) ? JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8')).lastDay : START_DATE

  // Through yesterday (UTC) only -- today is incomplete (or unplayed at the 1am PT run), and
  // the cursor must never claim a day whose games haven't all landed.
  const days = allDays(addDays(cursor, 1), TODAY)
  if (!days.length) { console.log(`Already synced through ${cursor}, nothing to do.`); return }
  console.log(`Syncing ${days.length} day(s): ${days[0]} through ${days[days.length - 1]}`)

  let done = 0, errors = 0, totalRows = 0

  async function fetchDay(day) {
    try {
      const csv = await fetchCSV(dayUrl(day), 2, 15000)
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

  let lastGoodDay = cursor
  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const chunk = days.slice(i, i + CONCURRENCY)
    const before = errors
    await Promise.all(chunk.map(fetchDay))
    // only advance the cursor past days that actually succeeded, and only contiguously --
    // a failed day blocks the cursor there so it's retried tomorrow rather than skipped.
    if (errors === before) lastGoodDay = chunk[chunk.length - 1]
    else break
  }

  for (const id in out) {
    if (!out[id]._meta) out[id]._meta = {}
    out[id]._meta.hasArm = playerIndex[id]?.hasArm ?? out[id]._meta.hasArm ?? false
    out[id]._meta.hasBat = playerIndex[id]?.hasBat ?? out[id]._meta.hasBat ?? false
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out))
  fs.writeFileSync(CURSOR_PATH, JSON.stringify({ lastDay: lastGoodDay }))
  console.log(`Done. ${done}/${days.length} days attempted, ${totalRows} rows, ${errors} errors. Cursor now at ${lastGoodDay}.`)
}

main()
