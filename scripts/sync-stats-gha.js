const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const PLAYERS_PATH = path.join(BASE, 'players.json')
const CURRENT_SEASON = new Date().getFullYear()
const HISTORY_PATH = path.join(BASE, `history/${CURRENT_SEASON}.json`)

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch(e) { reject(new Error('JSON parse failed: ' + url)) }
      })
    }).on('error', reject)
  })
}

function fmt3(n) {
  return n.toFixed(3).replace(/^0\./, '.')
}

const LEVEL_ORDER = ['AAA','AA','High-A','Single-A','ROK','DSL']

const SPORT_ID_TO_LEVEL = { 1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'Single-A', 15: 'ROK', 16: 'DSL', 17: 'ROK', 19: 'ROK' };
function sportAbbrToLevel(sport) {
  if (!sport) return 'Other';
  if (sport.id && SPORT_ID_TO_LEVEL[sport.id]) return SPORT_ID_TO_LEVEL[sport.id];
  const abbr = sport.abbreviation || '';
  if (abbr === 'AAA') return 'AAA';
  if (abbr === 'AA') return 'AA';
  if (abbr === 'A+' || abbr === 'HiA') return 'High-A';
  if (abbr === 'A' || abbr === 'LoA' || abbr === 'A(Short)') return 'Single-A';
  if (abbr === 'ROK' || abbr === 'Rk') return 'ROK';
  return 'Other';
}

function splitsToRow(splits, group, isMLB) {
  // Sum raw counts across splits
  const t = group === 'pitching' ? {
    gamesPlayed:0, gamesStarted:0, wins:0, losses:0, saves:0, holds:0, blownSaves:0,
    earnedRuns:0, atBats:0, baseOnBalls:0, strikeOuts:0, hitByPitch:0, hits:0, battersFaced:0,
    airOuts:0, groundOuts:0, doubles:0, triples:0, homeRuns:0, runs:0, stolenBases:0,
    caughtStealing:0, totalBases:0,
  } : {
    gamesPlayed:0, atBats:0, plateAppearances:0, hits:0, doubles:0, triples:0,
    homeRuns:0, rbi:0, runs:0, stolenBases:0, caughtStealing:0, baseOnBalls:0,
    strikeOuts:0, hitByPitch:0, totalBases:0, intentionalWalks:0, airOuts:0, groundOuts:0,
  }

  let totalOuts = 0

  for (const s of splits) {
    for (const k of Object.keys(t)) {
      t[k] += s[k] ?? 0
    }
    if (group === 'pitching' && s.inningsPitched) {
      const parts = String(s.inningsPitched).split('.')
      totalOuts += parseInt(parts[0]) * 3 + parseInt(parts[1] ?? '0')
    }
  }

  const level = isMLB ? 'MLB' : (() => {
    const levels = splits.map(s => sportAbbrToLevel(s.sport))
    for (const lv of LEVEL_ORDER) {
      if (levels.includes(lv)) return lv
    }
    const sid = splits[0]?.sport?.id ?? 0
    return SPORT_ID_TO_LEVEL[sid] ?? 'MiLB'
  })()

  const team = splits[0]?.team?.name ?? ''
  const sportId = isMLB ? 1 : (splits[0]?.sport?.id ?? 0)

  if (group === 'pitching') {
    const ip = `${Math.floor(totalOuts / 3)}.${totalOuts % 3}`
    const era = totalOuts ? (t.earnedRuns * 27 / totalOuts).toFixed(2) : null
    const whip = totalOuts ? ((t.hits + t.baseOnBalls) / (totalOuts / 3)).toFixed(2) : null
    const baa = t.atBats ? fmt3(t.hits / t.atBats) : null
    const row = {
      type: 'pitching', team, league: '', level, sportId,
      g: t.gamesPlayed, gs: t.gamesStarted, w: t.wins, l: t.losses,
      sv: t.saves, hld: t.holds, bs: t.blownSaves,
      ip, er: t.earnedRuns, bf: t.battersFaced,
      bb: t.baseOnBalls, so: t.strikeOuts, hbp: t.hitByPitch,
      h: t.hits, ab: t.atBats, go: t.groundOuts, ao: t.airOuts,
      era, whip, baa,
    }
    // single-team pitching seasons have obp/slg against
    if (splits.length === 1) {
      row.oObp = splits[0].stat?.obp ?? null
      row.oSlg = splits[0].stat?.slg ?? null
    }
    return row
  } else {
    const avg = t.atBats ? fmt3(t.hits / t.atBats) : null
    const obp = t.plateAppearances ? fmt3((t.hits + t.baseOnBalls + t.hitByPitch) / t.plateAppearances) : null
    const slg = t.atBats ? fmt3(t.totalBases / t.atBats) : null
    const ops = obp && slg ? fmt3(parseFloat('0'+obp) + parseFloat('0'+slg)) : null
    return {
      type: 'hitting', team, league: '', level, sportId,
      g: t.gamesPlayed, ab: t.atBats, pa: t.plateAppearances,
      h: t.hits, doubles: t.doubles, triples: t.triples, hr: t.homeRuns,
      rbi: t.rbi, r: t.runs, sb: t.stolenBases, cs: t.caughtStealing,
      bb: t.baseOnBalls, so: t.strikeOuts, hbp: t.hitByPitch,
      tb: t.totalBases, ibb: t.intentionalWalks,
      go: t.groundOuts, ao: t.airOuts,
      avg, obp, slg, ops,
    }
  }
}

async function fetchRows(mlbamId, group) {
  try {
    const [mlbData, milbData] = await Promise.all([
      get(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=season&season=${CURRENT_SEASON}&group=${group}`),
      get(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=season&season=${CURRENT_SEASON}&group=${group}&leagueListId=milb_all`),
    ])

    const mlbSplits = (mlbData?.stats?.[0]?.splits ?? []).filter(s => !!s.team)
    const milbSplits = (milbData?.stats?.[0]?.splits ?? []).filter(s => !!s.team && s.sport?.id !== 1)

    const rows = []
    if (mlbSplits.length > 0) rows.push(splitsToRow(mlbSplits.map(s => ({...s.stat, team: s.team, sport: s.sport})), group, true))
    if (milbSplits.length > 0) rows.push(splitsToRow(milbSplits.map(s => ({...s.stat, team: s.team, sport: s.sport})), group, false))
    return rows.length > 0 ? rows : null
  } catch { return null }
}

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'))
  const linked = Object.entries(players).filter(([, p]) => p.mlbam_id)
  console.log(`Syncing stats for ${linked.length} linked players into history/${CURRENT_SEASON}.json...`)

  // Load existing history, preserve non-current-season data if file exists
  let history = {}
  try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) } catch {}

  let synced = 0, noStats = 0, errors = 0
  const CHUNK_SIZE = 10

  for (let i = 0; i < linked.length; i += CHUNK_SIZE) {
    const chunk = linked.slice(i, i + CHUNK_SIZE)

    await Promise.all(chunk.map(async ([, player]) => {
      try {
        const pos = (player.positions || '').split(',').map(s => s.trim())
        const hasArm = pos.some(p => p === 'SP' || p === 'RP' || p === 'P')
        const hasBat = pos.some(p => p !== 'SP' && p !== 'RP' && p !== 'P')
        const groups = (hasArm && hasBat) ? ['pitching','hitting'] : hasArm ? ['pitching'] : ['hitting']
        const allRows = []
        for (const group of groups) {
          const rows = await fetchRows(player.mlbam_id, group)
          if (rows) allRows.push(...rows)
        }
        if (allRows.length > 0) {
          const existing = history[player.mlbam_id] ?? []
          const priorRows = existing.filter(r => r._season && r._season !== CURRENT_SEASON)
          history[player.mlbam_id] = [...priorRows, ...allRows.map(r => ({ ...r, _season: CURRENT_SEASON, _synced: new Date().toISOString() }))]
          synced++
        } else {
          noStats++
        }
      } catch { errors++ }
    }))

    if ((i + CHUNK_SIZE) % 200 === 0 || i + CHUNK_SIZE >= linked.length) {
      fs.writeFileSync(HISTORY_PATH, JSON.stringify(history))
    }

    if (i % 1000 === 0) {
      console.log(`  ${i + chunk.length} / ${linked.length} (synced: ${synced}, noStats: ${noStats}, errors: ${errors})`)
    }
  }

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history))
  console.log(`\nDone. synced:${synced} noStats:${noStats} errors:${errors}`)
}

main().catch(err => { console.error(err); process.exit(1) })
