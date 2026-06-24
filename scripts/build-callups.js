// Call-Ups detector — finds players who reached a NEW (career-first) level this
// season, dated by their first game at that level, within the last 30 days.
//
// Design: cheap candidate prefilter from season-aggregate history (no network),
// then targeted MLB+MiLB game-log fetch only for candidates to get the call-up
// DATE and the stat line at the new level.
//
// Rehab / IL-return exclusion is automatic: a call-up requires reaching a level
// strictly ABOVE the player's career-max-so-far, so a return to an already-played
// level (high->low->high) or an established vet's level never qualifies.
//
// Output: data/model/call-ups.json  { generatedAt, bats:[...], arms:[...] }

const fs   = require('fs')
const path = require('path')
const os   = require('os')

const BASE         = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const PLAYERS_PATH = path.join(BASE, 'players.json')
const HISTORY_DIR  = path.join(BASE, 'history')
const OUT_PATH     = path.join(BASE, 'model/call-ups.json')

const CURRENT_YEAR = new Date().getFullYear()
const CUTOFF_DAYS  = 30

// Canonicalize raw level labels (history + game-log sport abbreviations) to a
// single vocabulary, then to an ordinal rank.
function canonLevel(l, year) {
  if (!l) return null
  if (l === 'MLB') return 'MLB'
  if (l === 'AAA') return 'AAA'
  if (l === 'AA')  return 'AA'
  if (l === 'A+' || l === 'High A' || l === 'High-A') return 'High-A'
  if (l === 'A'  || l === 'Single-A') return 'Single-A'
  if (l === 'A-') return 'Single-A'
  if (l === 'ROK' || l === 'Rookie Advanced' || l === 'Rk' || l === 'R' ||
      l === 'CPX' || l === 'Complex' || l === 'ACL' || l === 'FCL' || l === 'Rookie')
    return (year && year < 2021) ? 'Rookie' : 'Complex'
  if (l === 'DSL') return 'DSL'
  return null
}
const LEVEL_RANK = { DSL: 0, Rookie: 1, Complex: 1, 'Single-A': 2, 'High-A': 3, AA: 4, AAA: 5, MLB: 6 }
function rankOf(canon) { return canon != null && canon in LEVEL_RANK ? LEVEL_RANK[canon] : null }

function isPitcherPos(positions) {
  return (positions || '').split(',').map(s => s.trim()).some(p => p === 'SP' || p === 'RP' || p === 'P')
}
function isHitterPos(positions) {
  return (positions || '').split(',').map(s => s.trim()).some(p => p && p !== 'SP' && p !== 'RP' && p !== 'P')
}
function ipOutsFromStr(ip) {
  const parts = String(ip || '0').split('.')
  return (parseInt(parts[0] || '0') * 3) + parseInt(parts[1] || '0')
}
function fmtIP(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

// ── Load all history, build per-player career-max rank (prior years) + 2026 levels ──
const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'))
const histFiles = fs.readdirSync(HISTORY_DIR).filter(f => /^\d{4}\.json$/.test(f))

// careerMax[mlbamId] = highest level rank in any year < CURRENT_YEAR
// cyLevels[mlbamId]  = Set of level ranks played in CURRENT_YEAR (per type)
const careerMax = {}
const cyMaxRank = {}
for (const file of histFiles) {
  const year = parseInt(file)
  const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8'))
  for (const [mid, seasons] of Object.entries(data)) {
    for (const s of seasons) {
      const r = rankOf(canonLevel(s.level, year))
      if (r == null) continue
      if (year < CURRENT_YEAR) careerMax[mid] = Math.max(careerMax[mid] ?? -1, r)
      else if (year === CURRENT_YEAR) cyMaxRank[mid] = Math.max(cyMaxRank[mid] ?? -1, r)
    }
  }
}

// Candidate = reached a CY level strictly above career-max (a never-before level).
const byMlbam = {}
for (const [id, p] of Object.entries(players)) {
  if (p.mlbam_id && p.rank != null) byMlbam[String(p.mlbam_id)] = { id, ...p }
}
const candidates = Object.keys(byMlbam).filter(mid => {
  const cm = careerMax[mid] ?? -1
  const cy = cyMaxRank[mid]
  return cy != null && cm >= 0 && cy > cm   // cm>=0 → has prior baseline (skip pure pro debuts)
})
console.log(`Candidates (reached new career level in ${CURRENT_YEAR}): ${candidates.length}`)

// ── Game-log fetch (regular season, MLB + MiLB), per group ──
async function fetchCYGameLogs(mlbamId, group) {
  const base = `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&season=${CURRENT_YEAR}&group=${group}&gameType=R`
  const flatten = d => d?.stats?.[0]?.splits ?? []
  try {
    const [mlbRes, milbRes] = await Promise.all([
      fetch(base).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(base + '&leagueListId=milb_all').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ])
    const seen = new Set()
    return [...flatten(mlbRes), ...flatten(milbRes)].filter(s => {
      const key = String(s.game?.gamePk ?? ((s.date || '') + '|' + (s.opponent?.id || '')))
      if (seen.has(key)) return false
      seen.add(key); return true
    }).map(s => ({
      date: s.date?.slice(0, 10),
      level: /Dominican Summer/i.test(s.league?.name ?? '')
        ? 'DSL'
        : canonLevel(s.sport?.abbreviation ?? s.team?.sport?.abbreviation ?? null, CURRENT_YEAR),
      stat: s.stat || {},
    })).filter(g => g.date && g.level).sort((a, b) => a.date.localeCompare(b.date))
  } catch { return [] }
}

// Detect the latest career-new-level call-up from a chronological game list.
function detectCallup(games, careerMaxRank) {
  let runningMax = careerMaxRank   // baseline is the career ceiling
  let latest = null
  for (const g of games) {
    const r = rankOf(g.level)
    if (r == null) continue
    if (runningMax >= 0 && r > runningMax) {
      latest = { date: g.date, toLevel: g.level, toRank: r, fromRank: runningMax }
    }
    if (r > runningMax) runningMax = r
  }
  return latest
}

function statLineArms(games) {
  let g = 0, outs = 0, er = 0, so = 0, bb = 0, bf = 0, w = 0, l = 0
  for (const x of games) {
    const s = x.stat
    g++
    outs += ipOutsFromStr(s.inningsPitched)
    er += s.earnedRuns || 0; so += s.strikeOuts || 0; bb += s.baseOnBalls || 0
    bf += s.battersFaced || ((s.atBats || 0) + (s.baseOnBalls || 0) + (s.hitByPitch || 0))
    w += s.wins || 0; l += s.losses || 0
  }
  const ip = outs / 3
  const era = ip > 0 ? (er * 9 / ip).toFixed(2) : null
  const kPct = bf > 0 ? (so / bf * 100).toFixed(1) + '%' : null
  const bbPct = bf > 0 ? (bb / bf * 100).toFixed(1) + '%' : null
  return [`${g} G`, `${w}-${l}`, `${fmtIP(outs)} IP`, era && `${era} ERA`, kPct && `${kPct} K%`, bbPct && `${bbPct} BB%`].filter(Boolean).join(' · ')
}
function statLineBats(games) {
  let g = 0, pa = 0, ab = 0, h = 0, tb = 0, bb = 0, hbp = 0, so = 0, hr = 0, sb = 0
  for (const x of games) {
    const s = x.stat
    g++
    pa += s.plateAppearances || 0; ab += s.atBats || 0; h += s.hits || 0
    tb += s.totalBases || 0; bb += s.baseOnBalls || 0; hbp += s.hitByPitch || 0
    so += s.strikeOuts || 0; hr += s.homeRuns || 0; sb += s.stolenBases || 0
  }
  const obpDen = ab + bb + hbp
  const obp = obpDen > 0 ? (h + bb + hbp) / obpDen : 0
  const slg = ab > 0 ? tb / ab : 0
  const ops = (obp + slg).toFixed(3).replace(/^0/, '')
  const kPct = pa > 0 ? (so / pa * 100).toFixed(1) + '%' : null
  const bbPct = pa > 0 ? (bb / pa * 100).toFixed(1) + '%' : null
  return [`${g} G`, `${ops} OPS`, kPct && `${kPct} K%`, bbPct && `${bbPct} BB%`, `${hr} HR`, `${sb} SB`].filter(Boolean).join(' · ')
}

async function run() {
  const today = new Date(); today.setHours(23, 59, 59, 999)
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - CUTOFF_DAYS); cutoff.setHours(0, 0, 0, 0)

  const bats = [], arms = []
  let processed = 0

  // Limited concurrency to be polite to the stats API.
  const POOL = 8
  for (let i = 0; i < candidates.length; i += POOL) {
    const slice = candidates.slice(i, i + POOL)
    await Promise.all(slice.map(async mid => {
      const p = byMlbam[mid]
      const cm = careerMax[mid] ?? -1
      const sides = []
      if (isPitcherPos(p.positions)) sides.push('pitching')
      if (isHitterPos(p.positions))  sides.push('hitting')
      if (!sides.length) sides.push('hitting')

      for (const group of sides) {
        const games = await fetchCYGameLogs(mid, group)
        if (!games.length) continue
        const cu = detectCallup(games, cm)
        if (!cu) continue
        if (new Date(cu.date) < cutoff) continue
        const atLevel = games.filter(g => rankOf(g.level) === cu.toRank && g.date >= cu.date)
        if (!atLevel.length) continue
        const isPit = group === 'pitching'
        const daysAgo = Math.round((today - new Date(cu.date)) / 86400000)
        const row = {
          id: p.id, mlbam_id: mid, name: p.name, positions: p.positions, rank: p.rank,
          isPit, isTwoWay: isPitcherPos(p.positions) && isHitterPos(p.positions),
          fromLevel: cu.fromRank >= 0
            ? Object.keys(LEVEL_RANK).find(k => LEVEL_RANK[k] === cu.fromRank) ?? null : null,
          toLevel: cu.toLevel, toRank: cu.toRank,
          callupDate: cu.date, daysAgo,
          statLine: isPit ? statLineArms(atLevel) : statLineBats(atLevel),
        }
        ;(isPit ? arms : bats).push(row)
      }
      processed++
    }))
    if (processed && processed % 40 === 0) console.log(`  ${processed}/${candidates.length} processed...`)
  }

  const byDateDesc = (a, b) => b.callupDate.localeCompare(a.callupDate) || (a.rank ?? 1e9) - (b.rank ?? 1e9)
  bats.sort(byDateDesc); arms.sort(byDateDesc)

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), bats, arms }, null, 2))
  console.log(`Call-ups written: ${bats.length} bats, ${arms.length} arms (last ${CUTOFF_DAYS} days)`)
}

run()
