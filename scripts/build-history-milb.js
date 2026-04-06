const fs = require('fs')
const os = require('os')
const https = require('https')
const { spawn } = require('child_process')

const BASE = os.homedir() + '/Desktop/fantasy-baseball/data'
const HISTORY_DIR = BASE + '/history'
const PROGRESS_FILE = HISTORY_DIR + '/progress-milb.json'
const PLAYERS_FILE = BASE + '/players.json'

if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true })

const caf = spawn('caffeinate', ['-i'], { detached: true, stdio: 'ignore' })
caf.unref()

const SPORT_ID_TO_LEVEL = {
  '11': 'AAA',
  '12': 'AA',
  '13': 'High-A',
  '14': 'Single-A',
  '15': 'Rookie',
  '16': 'Complex',
  '17': 'DSL',
  '23': 'Complex',
  // '21' intentionally omitted — MLB API aggregate/combined totals row, not a real level
}

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
    for (const [mlbamId, lines] of Object.entries(yearBuckets[year])) {
      if (!existing[mlbamId]) existing[mlbamId] = []
      // On re-run: strip old MiLB lines, keep MLB lines
      existing[mlbamId] = existing[mlbamId].filter(l => l.level === 'MLB')
      existing[mlbamId].push(...lines)
    }
    saveJSON(path, existing)
  }
}

async function fetchPlayer(mlbamId) {
  try {
    const data = await get(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=yearByYear&group=hitting,pitching&leagueListId=milb_all`)
    if (!data.stats || data.stats.length === 0) return 0

    let count = 0
    for (const group of data.stats) {
      const type = group.group?.displayName
      if (!group.splits) continue
      for (const split of group.splits) {
        const year = split.season
        if (!year) continue

        const sportId = split.sport?.id ?? null
        // Skip aggregate totals rows
        if (sportId === 21) continue

        const team   = split.team?.abbreviation ?? split.team?.name ?? ''
        const league = split.league?.name ?? ''
        if (!team && !league) continue

        const level = SPORT_ID_TO_LEVEL[String(sportId)] ?? 'MiLB'
        const s = split.stat

        const line = {
          type,
          team,
          league,
          level,
          sportId,
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
          baa:     s.avg,
          k9:      s.strikeoutsPer9Inn,
          bb9:     s.walksPer9Inn,
          h9:      s.hitsPer9Inn,
          hr9:     s.homeRunsPer9,
        }

        if (!yearBuckets[year]) yearBuckets[year] = {}
        if (!yearBuckets[year][mlbamId]) yearBuckets[year][mlbamId] = []
        yearBuckets[year][mlbamId].push(line)
        count++
      }
    }
    return count
  } catch(e) { return -1 }
}

async function main() {
  const players = loadJSON(PLAYERS_FILE, {})
  const progress = loadJSON(PROGRESS_FILE, {})

  const eligible = Object.values(players).filter(p => p.mlbam_id && !progress[p.mlbam_id])
  const alreadyDone = Object.keys(progress).length

  console.log(`Hey human — ${eligible.length} to fetch, ${alreadyDone} already done. Let's go.\n`)

  let done = 0, errors = 0, noData = 0

  for (const player of eligible) {
    const result = await fetchPlayer(player.mlbam_id)
    if (result === -1) errors++
    else if (result === 0) noData++

    progress[player.mlbam_id] = { name: player.name, linesFound: result, ts: Date.now() }
    done++

    if (done === 1) console.log(`Player 1 done — ${player.name} (${result} MiLB stat lines)`)

    if (done > 1 && (done - 1) % 100 === 0) {
      flushAll()
      saveJSON(PROGRESS_FILE, progress)
      console.log(`\n${alreadyDone + done} total done. #${alreadyDone + done}: ${player.name}`)
      console.log(`  errors:${errors}  noData:${noData}`)
      const sample = Object.values(yearBuckets['2023'] || {}).flat().slice(0, 3).map(l => l.level)
      console.log(`  sample 2023 levels: ${sample.join(', ')}`)
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
    console.log(`  ${f} — ${Object.keys(d).length} players`)
  }
}

main().catch(console.error)
