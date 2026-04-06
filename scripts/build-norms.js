const fs = require('fs'), os = require('os')

const HISTORY_DIR = os.homedir() + '/Desktop/fantasy-baseball/data/history/'
const OUT_PATH = os.homedir() + '/Desktop/fantasy-baseball/data/model/norms.json'

const YEARS = ['2015','2016','2017','2018','2019','2021','2022','2023','2024','2025','2026']
const MIN_PA = 50
const MIN_IP = 20
const MIN_LEAGUE_N = 50
const CONFIDENCE_CAP = 200
const DIFF_THRESHOLD = 0.15

function calcHitterStats(line) {
  const pa = line.pa || 0
  const h = line.h || 0
  const bb = line.bb || 0
  const hbp = line.hbp || 0
  const so = line.so || 0
  const sb = line.sb || 0
  const ab = line.ab || 0
  const doubles = line.doubles || 0
  const triples = line.triples || 0
  const hr = line.hr || 0
  const onBase = h + bb + hbp
  const tb = h + doubles + triples * 2 + hr * 3
  return {
    avg:     ab > 0 ? h / ab : null,
    obp:     pa > 0 ? onBase / pa : null,
    slg:     ab > 0 ? tb / ab : null,
    ops:     ab > 0 && pa > 0 ? (onBase / pa) + (tb / ab) : null,
    iso:     ab > 0 ? (tb - h) / ab : null,
    k_pct:   pa > 0 ? so / pa : null,
    bb_pct:  pa > 0 ? bb / pa : null,
    sb_rate: onBase > 0 ? sb / onBase : null,
    xbh_rate: ab > 0 ? (doubles + triples + hr) / ab : null,
    xbh_rate: ab > 0 ? (doubles + triples + hr) / ab : null,
  }
}

function calcPitcherStats(line) {
  const ip = parseFloat(line.ip) || 0
  const gs = line.gs || 0
  const k = line.k || line.so || 0
  const bb = line.bb_allowed || line.bb || 0
  const h = line.h || 0
  const er = line.er || 0
  const bf = Math.round(ip * 4.3)
  return {
    era:      ip > 0 ? (er / ip) * 9 : null,
    whip:     ip > 0 ? (bb + h) / ip : null,
    k_pct:    bf > 0 ? k / bf : null,
    bb_pct:   bf > 0 ? bb / bf : null,
    k_bb_pct: bf > 0 ? (k - bb) / bf : null,
    baa:      (bf - bb) > 0 ? h / (bf - bb) : null,
    ip_per_gs: gs > 0 ? ip / gs : null,
  }
}

function makeBucket() { return { hitters: [], pitchers: [] } }

function statSummary(values) {
  const clean = values.filter(v => v != null && isFinite(v))
  if (clean.length < 2) return null
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length
  const variance = clean.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (clean.length - 1)
  return { mean: +mean.toFixed(4), stdev: +Math.sqrt(variance).toFixed(4), n: clean.length }
}

function summarizeBucket(bucket) {
  const hStats = ['avg','obp','slg','ops','iso','k_pct','bb_pct','sb_rate','xbh_rate']
  const pStats = ['era','whip','k_pct','bb_pct','k_bb_pct','baa','ip_per_gs']
  const hitters = {}
  let hN = 0
  for (const stat of hStats) {
    const s = statSummary(bucket.hitters.map(r => r[stat]))
    if (s) { hitters[stat] = s; hN = Math.max(hN, s.n) }
  }
  const pitchers = {}
  let pN = 0
  for (const stat of pStats) {
    const s = statSummary(bucket.pitchers.map(r => r[stat]))
    if (s) { pitchers[stat] = s; pN = Math.max(pN, s.n) }
  }
  return { hitters: { n: hN, ...hitters }, pitchers: { n: pN, ...pitchers } }
}

// --- Accumulate ---
const levelBuckets = {}
const leagueBuckets = {}

console.log('Reading history files...')
for (const year of YEARS) {
  const path = HISTORY_DIR + year + '.json'
  if (!fs.existsSync(path)) continue
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'))
  let lines = 0
  for (const playerLines of Object.values(data)) {
    for (const line of playerLines) {
      const lev = line.level || 'unknown'
      if (lev === 'unknown') continue
      const isHitter = line.type === 'hitting'
      const isPitcher = line.type === 'pitching'
      const pa = line.pa || 0
      const ip = parseFloat(line.ip) || 0
      const hOk = isHitter && pa >= MIN_PA
      const pOk = isPitcher && ip >= MIN_IP
      if (!hOk && !pOk) continue

      const lk = `${lev}|${year}`
      if (!levelBuckets[lk]) levelBuckets[lk] = makeBucket()
      const league = line.league || 'unknown'
      const lgk = `${lev}|${league}|${year}`
      if (!leagueBuckets[lgk]) leagueBuckets[lgk] = makeBucket()

      if (hOk) {
        const s = calcHitterStats(line)
        levelBuckets[lk].hitters.push(s)
        leagueBuckets[lgk].hitters.push(s)
      }
      if (pOk) {
        const s = calcPitcherStats(line)
        levelBuckets[lk].pitchers.push(s)
        leagueBuckets[lgk].pitchers.push(s)
      }
      lines++
    }
  }
  console.log(`  ${year}: ${lines} qualifying lines`)
}

// --- Build norms ---
console.log('Computing norms...')
const norms = {}

// Level norms (includes MLB)
for (const [lk, bucket] of Object.entries(levelBuckets)) {
  const [level, year] = lk.split('|')
  norms[lk] = { type: 'level', level, year, ...summarizeBucket(bucket) }
}

// League norms — include all with n >= MIN_LEAGUE_N, store diff as metadata
let kept = 0, dropped = 0
for (const [lgk, bucket] of Object.entries(leagueBuckets)) {
  const parts = lgk.split('|')
  const level = parts[0], league = parts[1], year = parts[2]
  if (league === 'unknown') continue

  const summary = summarizeBucket(bucket)
  const hN = summary.hitters.n || 0
  const pN = summary.pitchers.n || 0
  if (hN < MIN_LEAGUE_N && pN < MIN_LEAGUE_N) { dropped++; continue }

  const confidence = +(Math.min(Math.max(hN, pN), CONFIDENCE_CAP) / CONFIDENCE_CAP).toFixed(3)

  // Compute diffs vs level norm — stored as metadata, not used as gate
  const levelNorm = norms[`${level}|${year}`]
  let maxZDiff = 0
  let differsBat = false, differsPitch = false
  const statDiffs = {}

  if (levelNorm) {
    for (const stat of ['ops','avg','k_pct']) {
      const ln = levelNorm.hitters[stat]
      const lg = summary.hitters[stat]
      if (ln && lg && ln.stdev > 0) {
        const z = +Math.abs((lg.mean - ln.mean) / ln.stdev).toFixed(3)
        statDiffs[`bat_${stat}`] = z
        if (z > maxZDiff) maxZDiff = z
        if (z >= DIFF_THRESHOLD) differsBat = true
      }
    }
    for (const stat of ['era','whip','k_pct']) {
      const ln = levelNorm.pitchers[stat]
      const lg = summary.pitchers[stat]
      if (ln && lg && ln.stdev > 0) {
        const z = +Math.abs((lg.mean - ln.mean) / ln.stdev).toFixed(3)
        statDiffs[`pitch_${stat}`] = z
        if (z > maxZDiff) maxZDiff = z
        if (z >= DIFF_THRESHOLD) differsPitch = true
      }
    }
  }

  norms[`${level}|${league}|${year}`] = {
    type: 'league',
    level,
    league,
    year,
    confidence,
    differs_from_level: differsBat || differsPitch,
    differs_bat: differsBat,
    differs_pitch: differsPitch,
    max_z_diff: +maxZDiff.toFixed(3),
    stat_diffs: statDiffs,
    ...summary
  }
  kept++
}

fs.mkdirSync(os.homedir() + '/Desktop/fantasy-baseball/data/model', { recursive: true })
fs.writeFileSync(OUT_PATH, JSON.stringify(norms, null, 2))

console.log(`\nDone!`)
console.log(`Level norms: ${Object.values(norms).filter(v => v.type === 'level').length}`)
console.log(`League norms kept: ${kept}`)
console.log(`League norms dropped (n < ${MIN_LEAGUE_N}): ${dropped}`)
console.log(`Total norm keys: ${Object.keys(norms).length}`)

console.log('\n=== Sanity Check: AA|2023 hitters ===')
const aa23 = norms['AA|2023']
if (aa23) {
  console.log('n:', aa23.hitters.n)
  for (const [stat, s] of Object.entries(aa23.hitters)) {
    if (typeof s === 'object') console.log(` ${stat}: mean=${s.mean} stdev=${s.stdev} n=${s.n}`)
  }
}

console.log('\n=== League norms 2023 (sorted by confidence) ===')
Object.entries(norms)
  .filter(([k, v]) => v.type === 'league' && v.year === '2023')
  .sort((a, b) => b[1].confidence - a[1].confidence)
  .forEach(([k, v]) => console.log(` ${k.padEnd(45)} conf:${v.confidence} differs:${v.differs_from_level} maxZ:${v.max_z_diff}`))
