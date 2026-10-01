// AFL fantasy league stats — standalone, never touches players.json / history / model files.
// Pulls Arizona Fall League (sportId 17, leagueId 119) season totals league-wide → data/afl-stats-YYYY.json
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const SEASON = new Date().getFullYear()
const OUT_PATH = path.join(BASE, `afl-stats-${SEASON}.json`)
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

async function pull(group, fields) {
  const url = `https://statsapi.mlb.com/api/v1/stats?stats=season&group=${group}&sportId=${AFL_SPORT_ID}&leagueId=${AFL_LEAGUE_ID}&season=${SEASON}&playerPool=ALL&limit=2000`
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

async function main() {
  const [hitting, pitching] = await Promise.all([pull('hitting', HIT_FIELDS), pull('pitching', PIT_FIELDS)])
  const out = { season: SEASON, syncedAt: new Date().toISOString(), hitting, pitching }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n')
  console.log(`AFL ${SEASON}: ${Object.keys(hitting).length} hitters, ${Object.keys(pitching).length} pitchers → ${OUT_PATH}`)
}

main().catch(e => { console.error('AFL sync failed:', e.message); process.exit(1) })
