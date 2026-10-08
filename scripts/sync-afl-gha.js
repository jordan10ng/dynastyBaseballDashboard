// AFL fantasy league stats — standalone, never touches players.json / history / model files.
// Pulls Arizona Fall League (sportId 17, leagueId 119) season totals league-wide → data/afl-stats-YYYY.json
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
// Optional season arg for one-off backfills (e.g. `node scripts/sync-afl-gha.js 2025`); nightly uses current year
const SEASON = Number(process.argv[2]) || new Date().getFullYear()
const OUT_PATH = path.join(BASE, `afl-stats-${SEASON}.json`)
const DAILY_PATH = path.join(BASE, `afl-daily-${SEASON}.json`)
const AFL_SPORT_ID = 17
const AFL_LEAGUE_ID = 119

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`))
        try { resolve(JSON.parse(data)) }
        catch(e) { reject(new Error('JSON parse failed: ' + url)) }
      })
    }).on('error', reject)
  })
}

const HIT_FIELDS = { G: 'gamesPlayed', PA: 'plateAppearances', AB: 'atBats', H: 'hits', HR: 'homeRuns', TB: 'totalBases', R: 'runs', RBI: 'rbi', BB: 'baseOnBalls', IBB: 'intentionalWalks', HBP: 'hitByPitch', K: 'strikeOuts', SB: 'stolenBases', CS: 'caughtStealing' }
const PIT_FIELDS = { G: 'gamesPlayed', GS: 'gamesStarted', OUTS: 'outs', H: 'hits', ER: 'earnedRuns', BB: 'baseOnBalls', HB: 'hitBatsmen', K: 'strikeOuts', W: 'wins', L: 'losses', SV: 'saves' }

// date (YYYY-MM-DD) → single-day lines via stats=byDateRange; no date → season totals
async function pull(group, fields, date) {
  const range = date ? `stats=byDateRange&startDate=${date}&endDate=${date}` : 'stats=season'
  const url = `https://statsapi.mlb.com/api/v1/stats?${range}&group=${group}&sportId=${AFL_SPORT_ID}&leagueId=${AFL_LEAGUE_ID}&season=${SEASON}&playerPool=ALL&limit=2000`
  const json = await get(url)
  const splits = json.stats?.[0]?.splits ?? []
  const out = {}
  for (const s of splits) {
    const id = s.player?.id
    if (!id) continue
    // Sum across splits in case a player appears for more than one AFL team
    const row = out[id] ?? (out[id] = { name: s.player.fullName, team: s.team?.name ?? null })
    for (const [k, f] of Object.entries(fields)) row[k] = (row[k] ?? 0) + (Number(s.stat?.[f]) || 0)
  }
  return out
}

// Every AFL date with at least one final game. All dates are re-pulled each run so
// skipped nights and stat corrections heal themselves (~2 small calls per date).
async function finalDates() {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=${AFL_SPORT_ID}&leagueId=${AFL_LEAGUE_ID}&startDate=${SEASON}-09-01&endDate=${SEASON}-12-31`
  const json = await get(url)
  return (json.dates ?? []).filter(d => (d.games ?? []).some(g => g.status?.abstractGameState === 'Final')).map(d => d.date)
}

// Single-day lines without name/team (the roster file has those) to keep the file small
async function pullDay(date) {
  const strip = o => Object.fromEntries(Object.entries(o).map(([id, { name, team, ...line }]) => [id, line]))
  const [hitting, pitching] = await Promise.all([pull('hitting', HIT_FIELDS, date), pull('pitching', PIT_FIELDS, date)])
  return { hitting: strip(hitting), pitching: strip(pitching) }
}

async function syncDaily() {
  const dates = await finalDates()
  const days = {}
  for (let i = 0; i < dates.length; i += 4) {
    const batch = dates.slice(i, i + 4)
    const res = await Promise.all(batch.map(pullDay))
    batch.forEach((d, j) => { days[d] = res[j] })
  }
  fs.writeFileSync(DAILY_PATH, JSON.stringify({ season: SEASON, syncedAt: new Date().toISOString(), days }) + '\n')
  console.log(`AFL ${SEASON} daily: ${dates.length} game days → ${DAILY_PATH}`)
}

async function main() {
  const [hitting, pitching] = await Promise.all([pull('hitting', HIT_FIELDS), pull('pitching', PIT_FIELDS)])
  const out = { season: SEASON, syncedAt: new Date().toISOString(), hitting, pitching }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n')
  console.log(`AFL ${SEASON}: ${Object.keys(hitting).length} hitters, ${Object.keys(pitching).length} pitchers → ${OUT_PATH}`)
  await syncDaily()
}

main().catch(e => { console.error('AFL sync failed:', e.message); process.exit(1) })
