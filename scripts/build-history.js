const fs = require('fs')
const os = require('os')
const https = require('https')
const { spawn } = require('child_process')

const BASE = os.homedir() + '/Desktop/fantasy-baseball/data'
const HISTORY_DIR = BASE + '/history'
const PROGRESS_FILE = HISTORY_DIR + '/progress.json'
const PLAYERS_FILE = BASE + '/players.json'

if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true })

const caf = spawn('caffeinate', ['-i'], { detached: true, stdio: 'ignore' })
caf.unref()

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch(e) { reject(new Error('JSON parse failed')) }
      })
    }).on('error', reject)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function loadJSON(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf-8')) }
  catch(e) { return fallback }
}

function saveJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data), 'utf-8')
}

const yearBuckets = {}

function flushAll() {
  for (const year of Object.keys(yearBuckets)) {
    const path = HISTORY_DIR + '/' + year + '.json'
    const existing = loadJSON(path, {})
    saveJSON(path, Object.assign(existing, yearBuckets[year]))
  }
}

async function fetchPlayer(mlbamId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=yearByYear&group=hitting,pitching&sportIds=1,11,12,13,14,15,16`
  try {
    const data = await get(url)
    if (!data.stats || data.stats.length === 0) return 0
    const yearsSeen = new Set()
    for (const group of data.stats) {
      const type = group.group?.displayName
      if (!group.splits) continue
      for (const split of group.splits) {
        const year = split.season
        if (!year) continue
        // Skip sportId=21 aggregate rows
        if (split.sport?.id === 21) continue
        yearsSeen.add(year)
        const s = split.stat
        const line = {
          type,
          team:   split.team?.abbreviation ?? split.team?.name ?? '',
          league: split.league?.abbreviation ?? '',
          level:  split.sport?.abbreviation ?? split.sport?.name ?? '',
          sportId: split.sport?.id ?? null,
          // Counting — shared
          g:       s.gamesPlayed,
          ab:      s.atBats,
          pa:      s.plateAppearances,
          h:       s.hits,
          doubles: s.doubles,
          triples: s.triples,
          hr:      s.homeRuns,
          r:       s.runs,
          rbi:     s.rbi,
          bb:      s.baseOnBalls,
          ibb:     s.intentionalWalks,
          so:      s.strikeOuts,
          hbp:     s.hitByPitch,
          sb:      s.stolenBases,
          cs:      s.caughtStealing,
          tb:      s.totalBases,
          gidp:    s.groundIntoDoublePlay,
          go:      s.groundOuts,
          ao:      s.airOuts,
          // Rate — shared
          avg: s.avg,
          obp: s.obp,
          slg: s.slg,
          ops: s.ops,
          // Pitching only
          w:       s.wins,
          l:       s.losses,
          gs:      s.gamesStarted,
          gf:      s.gamesFinished,
          cg:      s.completeGames,
          sho:     s.shutouts,
          sv:      s.saves,
          hld:     s.holds,
          bs:      s.blownSaves,
          ip:      s.inningsPitched,
          er:      s.earnedRuns,
          bf:      s.battersFaced,
          pitches: s.numberOfPitches,
          strikes: s.strikes,
          era:     s.era,
          whip:    s.whip,
          baa:     s.avg,     // opponent avg — s.avg on pitching rows is BAA
          // Derived rate — pitching
          k9:      s.strikeoutsPer9Inn,
          bb9:     s.walksPer9Inn,
          h9:      s.hitsPer9Inn,
          hr9:     s.homeRunsPer9,
        }
        if (!yearBuckets[year]) yearBuckets[year] = {}
        if (!yearBuckets[year][mlbamId]) yearBuckets[year][mlbamId] = []
        yearBuckets[year][mlbamId].push(line)
      }
    }
    return yearsSeen.size
  } catch(e) { return -1 }
}

async function main() {
  const players = loadJSON(PLAYERS_FILE, {})
  const progress = loadJSON(PROGRESS_FILE, {})
  const eligible = Object.values(players).filter(p => p.mlbam_id && !progress[p.mlbam_id])
  const alreadyDone = Object.keys(progress).length

  console.log(`Hey human — ${eligible.length} players to fetch, ${alreadyDone} already done. Let's go.\n`)

  let done = 0, errors = 0, noData = 0

  for (const player of eligible) {
    const result = await fetchPlayer(player.mlbam_id)
    if (result === -1) errors++
    else if (result === 0) noData++

    progress[player.mlbam_id] = { name: player.name, yearsFound: result, ts: Date.now() }
    done++

    if (done === 1) console.log(`Player 1 done — ${player.name}`)

    if (done > 1 && (done - 1) % 100 === 0) {
      flushAll()
      saveJSON(PROGRESS_FILE, progress)
      const yearCounts = Object.entries(yearBuckets)
        .map(([y, d]) => `${y}:${Object.keys(d).length}`).sort().join('  ')
      console.log(`\n${alreadyDone + done} total done. #${alreadyDone + done}: ${player.name}`)
      console.log(`  errors:${errors}  noData:${noData}`)
      console.log(`  years so far: ${yearCounts}`)
    }

    await sleep(120)
  }

  flushAll()
  saveJSON(PROGRESS_FILE, progress)

  console.log('\nAll done!')
  console.log(`Fetched:${done}  Errors:${errors}  NoData:${noData}`)
  console.log('\nYear summary:')
  const yearFiles = fs.readdirSync(HISTORY_DIR).filter(f => f.match(/^\d{4}\.json$/)).sort()
  for (const f of yearFiles) {
    const d = loadJSON(HISTORY_DIR + '/' + f, {})
    const count = Object.keys(d).length
    if (count === 0) { fs.unlinkSync(HISTORY_DIR + '/' + f); console.log(`  ${f} — empty, deleted`) }
    else console.log(`  ${f} — ${count} players`)
  }
}

main().catch(console.error)
