const fs = require('fs'), os = require('os')

const BASE = process.env.DATA_BASE || (os.homedir() + '/Desktop/fantasy-baseball/data')
const HISTORY_DIR = BASE + '/history/'
const OUT_PATH = BASE + '/model/norms.json'

const YEARS = ['2015','2016','2017','2018','2019','2021','2022','2023','2024','2025','2026']
const MIN_PA = 0
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

console.log('Computing norms...')
const norms = {}

for (const [lk, bucket] of Object.entries(levelBuckets)) {
  const [level, year] = lk.split('|')
  norms[lk] = { type: 'level', level, year, ...summarizeBucket(bucket) }
}

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
    type: 'league', level, league, year, confidence,
    differs_from_level: differsBat || differsPitch,
    differs_bat: differsBat, differs_pitch: differsPitch,
    max_z_diff: +maxZDiff.toFixed(3), stat_diffs: statDiffs,
    ...summary
  }
  kept++
}

// Blend current year level norms with prior year based on sample size
// At n=0 -> 100% prior year. At n>=BLEND_FULL_N -> 100% current year.
const CURRENT_NORM_YEAR = new Date().getFullYear()
const BLEND_FULL_N = 400  // n at which current year gets full weight

for (const level of ['DSL','Complex','Rookie','Single-A','High-A','AA','AAA']) {
  const curKey  = `${level}|${CURRENT_NORM_YEAR}`
  const prevKey = `${level}|${CURRENT_NORM_YEAR - 1}`
  const cur  = norms[curKey]
  const prev = norms[prevKey]
  if (!prev) continue  // no prior year to blend with

  const curN = cur ? (cur.hitters?.n || cur.pitchers?.n || 0) : 0
  const blend = Math.min(curN / BLEND_FULL_N, 1.0)  // 0 = all prior, 1 = all current

  const blended = { type: 'level', level, year: String(CURRENT_NORM_YEAR), _blended: true, _blend_weight: +blend.toFixed(3), _cur_n: curN }

  for (const group of ['hitters', 'pitchers']) {
    const pg = prev[group] || {}
    const cg = (cur && cur[group]) || {}
    blended[group] = { n: curN }
    const stats = group === 'hitters'
      ? ['avg','obp','slg','ops','iso','k_pct','bb_pct','sb_rate','xbh_rate']
      : ['era','whip','k_pct','bb_pct','k_bb_pct','baa','ip_per_gs']
    for (const stat of stats) {
      const ps = pg[stat]
      const cs = cg[stat]
      if (!ps) continue  // no prior year stat, skip
      if (!cs || curN === 0) {
        // no current data — use prior year entirely
        blended[group][stat] = ps
      } else {
        // blend mean and stdev
        const mean  = blend * cs.mean  + (1 - blend) * ps.mean
        const stdev = blend * cs.stdev + (1 - blend) * ps.stdev
        blended[group][stat] = { mean: +mean.toFixed(4), stdev: +stdev.toFixed(4), n: curN }
      }
    }
  }
  norms[curKey] = blended
}

fs.mkdirSync(BASE + '/model', { recursive: true })
fs.writeFileSync(OUT_PATH, JSON.stringify(norms, null, 2))

console.log(`\nDone!`)
console.log(`Level norms: ${Object.values(norms).filter(v => v.type === 'level').length}`)
console.log(`League norms kept: ${kept}`)
console.log(`League norms dropped (n < ${MIN_LEAGUE_N}): ${dropped}`)
console.log(`Total norm keys: ${Object.keys(norms).length}`)
