// Nightly, cheap, in-memory only (no network): flags players who need a manual
// Statcast backfill -- i.e. players NOT yet in statcast-totals.json who already
// have MLB-level game logs on record (so the day-cursor sync, which only fans
// rows out to players present in players.json at the time each day was processed,
// never saw their earlier games). A true rookie debut has no MLB history yet, so
// nothing to flag -- the nightly day-cursor sync picks their games up naturally.
// Writes data/statcast-backfill-queue.json for a human (or scripts/backfill-
// statcast-candidates.js) to act on -- this script never fetches Statcast itself.
const fs = require('fs')
const path = require('path')
const os = require('os')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const PLAYERS_PATH = path.join(BASE, 'players.json')
const TOTALS_PATH = path.join(BASE, 'statcast-totals.json')
const HISTORY_DIR = path.join(BASE, 'history')
const QUEUE_PATH = path.join(BASE, 'statcast-backfill-queue.json')
const STATCAST_ERA_START = 2015

function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'))
  const arr = Array.isArray(players) ? players : Object.values(players)

  const totals = fs.existsSync(TOTALS_PATH) ? JSON.parse(fs.readFileSync(TOTALS_PATH, 'utf8')) : {}
  const alreadyTracked = new Set(Object.keys(totals))

  const hasMlbHistory = new Set()
  for (const file of fs.readdirSync(HISTORY_DIR)) {
    const m = file.match(/^(\d{4})(?:\.\d+)?\.json$/)
    if (!m || parseInt(m[1]) < STATCAST_ERA_START) continue
    const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8'))
    for (const [mlbamId, rows] of Object.entries(data)) {
      if (Array.isArray(rows) && rows.some(r => r.level === 'MLB')) hasMlbHistory.add(mlbamId)
    }
  }

  const candidates = []
  for (const p of arr) {
    if (!p.mlbam_id) continue
    if (alreadyTracked.has(p.mlbam_id)) continue
    if (!hasMlbHistory.has(p.mlbam_id)) continue // true rookie debut -- nothing missing, day-cursor covers it
    candidates.push({ mlbam_id: p.mlbam_id, name: p.name, team: p.team, positions: p.positions })
  }

  fs.writeFileSync(QUEUE_PATH, JSON.stringify(candidates, null, 2))
  console.log(`Statcast backfill queue: ${candidates.length} candidate(s) need a manual backfill (run scripts/backfill-statcast-candidates.js).`)
  if (candidates.length) console.log(candidates.map(c => `  ${c.name} (${c.mlbam_id})`).join('\n'))
}

main()
