// Canonical tool scoring formulas — DO NOT duplicate this logic anywhere.
// Used by:
//   - components/players/PlayerDrawer.tsx (career arc)
//   - scripts/build-scores.js              (MiLB pipeline → model_scores)
//   - scripts/build-mlb-tools.js           (MLB pipeline → mlb-tools.json)
//
// Bucket shape (caller must construct):
//   { year, level, ab, bb, hbp, so, h, xbh, sb, tb, bf, ipOuts }
//     xbh    = doubles + triples + homeRuns (used for singles = h - xbh)
//     tb     = total bases (SLG = tb/ab; ISO = (tb - h)/ab)
//     ipOuts = innings pitched in outs (IP = ipOuts / 3)
//   Pitcher-only buckets may have 0 for ab/h/tb/sb/xbh; hitter-only for bf/ipOuts.
//
// The MiLB scorer returns a RAW weighted prediction. The build pipeline norms it
// against a pool of all prospects (which can only be computed after every player
// has been raw-scored), so we expose raw and the norm/shrink step separately.

const POOL_CENTER   = 95
const POOL_STDEV    = 15
const SHRINK_TOWARD = 88

const MILB_LEVEL_AVG_AGES = {
  ACL: 17.9, FCL: 17.9, DSL: 17.9,
  Complex: 19.9, Rookie: 20.4,
  'Single-A': 21.3, 'High-A': 22.6, AA: 24.0, AAA: 26.4,
}

const MILB_SHRINK_K = { hitter: 200, pitcher: 80 }
const MLB_K = { hit: 150, power: 120, speed: 60, stuff: 20, control: 40 }

// Per-season age slope applied to MiLB scoring. ageDiff = avg_level_age - player_age,
// so younger-than-level → positive contribution, older-than-level → negative.
// Asymmetric: penalty for being over-age (older) is sharper than the boost for being
// under-age (younger). Overrides the regression's learned slope_age (near-zero/noisy
// because the training set has little age variance). MLB scoring does not use age.
const AGE_SLOPE_YOUNG = 1    // applied when player is YOUNGER than level avg
const AGE_SLOPE_OLD   = 1.5  // applied when player is OLDER than level avg

const TOOL_STAT_KEYS = {
  hit:     ['k_pct', 'bb_pct'],
  power:   ['iso'],
  speed:   ['sb_rate'],
  stuff:   ['k_pct'],
  control: ['bb_pct'],
}

const COMPOSITE_WEIGHTS = {
  hitter:  { hit: 0.42, power: 0.47, speed: 0.11 },
  pitcher: { stuff: 0.70, control: 0.30 },
}

function milbStatK(stat, isPit) {
  if (stat === 'k_pct')   return isPit ? 20 : 60
  if (stat === 'bb_pct')  return isPit ? 40 : 120
  if (stat === 'iso')     return 120
  if (stat === 'sb_rate') return 60
  return 60
}

function _bucketSample(b, isPit) {
  if (isPit) return (b.ipOuts || 0) / 3
  return (b.ab || 0) + (b.bb || 0) + (b.hbp || 0)
}

function _computeRate(b, stat, isPit) {
  const pa = (b.ab || 0) + (b.bb || 0) + (b.hbp || 0)
  if (stat === 'iso') {
    return b.ab > 0 ? ((b.tb || 0) - (b.h || 0)) / b.ab : 0
  }
  if (stat === 'sb_rate') {
    const singles    = (b.h || 0) - (b.xbh || 0)
    const stealOpps  = singles + (b.bb || 0) + (b.hbp || 0)
    return stealOpps > 0 ? (b.sb || 0) / stealOpps : 0
  }
  if (stat === 'k_pct') {
    return isPit ? (b.bf > 0 ? (b.so || 0) / b.bf : 0) : (pa > 0 ? (b.so || 0) / pa : 0)
  }
  if (stat === 'bb_pct') {
    return isPit ? (b.bf > 0 ? (b.bb || 0) / b.bf : 0) : (pa > 0 ? (b.bb || 0) / pa : 0)
  }
  return 0
}

/**
 * Raw MiLB tool score (pre-norm, pre-shrink).
 *
 * @param {Array}  buckets - canonical bucket array
 * @param {string} toolName - hit|power|speed|stuff|control
 * @param {object} opts
 * @param {object} opts.models         - regression.models
 * @param {object} opts.norms          - norms object
 * @param {boolean} opts.isPit
 * @param {number} opts.referenceYear  - anchor for recency decay (current year for build; arc point year for arc)
 * @param {(year:number)=>number|null} [opts.getAge]
 * @param {number} [opts.currentYearForExclusion] - if set, also returns cySum/cyTot for that year
 * @returns {{rawWeighted:number|null,totalSample:number,wSum:number,wTot:number,cySum:number,cyTot:number}}
 */
function scoreMilbToolRaw(buckets, toolName, opts) {
  const { models, norms, isPit, referenceYear, getAge } = opts
  const cyExcl = opts.currentYearForExclusion ?? null
  const toolModels = models?.[toolName]
  if (!toolModels) return { rawWeighted: null, totalSample: 0, wSum: 0, wTot: 0, cySum: 0, cyTot: 0 }

  const statKeys = TOOL_STAT_KEYS[toolName]
  let wSum = 0, wTot = 0, cySum = 0, cyTot = 0, totalSample = 0

  for (const b of buckets) {
    const lvl = b.level
    if (!toolModels[lvl]) continue
    const ne = norms[`${lvl}|${b.year}`] ?? norms[`${lvl}|${b.year - 1}`]
    if (!ne) continue
    const n = isPit ? ne.pitchers : ne.hitters
    if (!n) continue
    const sample = _bucketSample(b, isPit)
    if (!sample) continue

    const refAge   = MILB_LEVEL_AVG_AGES[lvl] ?? 22
    const playerAge = getAge ? getAge(b.year) : null
    const ageDiff  = refAge - (playerAge ?? refAge)
    const recency  = Math.pow(0.75, referenceYear - b.year)
    const isCY     = cyExcl != null && b.year === cyExcl

    for (const stat of statKeys) {
      const lm = toolModels[lvl]?.[stat]
      const sn = n[stat]
      if (!lm || !sn || sn.stdev === 0) continue
      const val = _computeRate(b, stat, isPit)
      let z = (val - sn.mean) / sn.stdev
      if ((!isPit && stat === 'k_pct') || (isPit && stat === 'bb_pct')) z = -z
      // Asymmetric age effect:
      //   YOUNG  (ageDiff > 0): boost scaled by z (no boost when underperforming)
      //   OLD    (ageDiff <= 0): penalty applied regardless of performance
      // perfScale maps z=-1 → 0 (no boost), z=0 → 0.5, z>=+1 → 1.0 (full boost)
      let ageContrib
      if (ageDiff > 0) {
        const perfScale = Math.min(1, Math.max(0, (z + 1) / 2))
        ageContrib = AGE_SLOPE_YOUNG * ageDiff * perfScale
      } else {
        ageContrib = AGE_SLOPE_OLD * ageDiff
      }
      const pred = lm.slope_z * z + ageContrib + lm.intercept
      const w = lm.corr * (sample / (sample + milbStatK(stat, isPit))) * recency
      wSum += pred * w
      wTot += w
      if (isCY) { cySum += pred * w; cyTot += w }
    }
    totalSample += sample
  }

  return {
    rawWeighted: wTot > 0 ? wSum / wTot : null,
    totalSample, wSum, wTot, cySum, cyTot,
  }
}

/**
 * Norm + shrink a raw MiLB tool score to a player-facing number.
 * @returns {number|null}
 */
function normShrinkMilb(rawWeighted, totalSample, poolEntry, isPit) {
  if (rawWeighted == null || !poolEntry || !poolEntry.stdev) return null
  const normed = POOL_CENTER + ((rawWeighted - poolEntry.mean) / poolEntry.stdev) * POOL_STDEV
  const k = isPit ? MILB_SHRINK_K.pitcher : MILB_SHRINK_K.hitter
  const conf = totalSample / (totalSample + k)
  return Math.round(SHRINK_TOWARD + (normed - SHRINK_TOWARD) * conf)
}

/**
 * Convenience: raw + norm/shrink in one call. Requires opts.poolStats[toolName].
 */
function scoreMilbTool(buckets, toolName, opts) {
  const raw = scoreMilbToolRaw(buckets, toolName, opts)
  const score = opts.poolStats
    ? normShrinkMilb(raw.rawWeighted, raw.totalSample, opts.poolStats[toolName], opts.isPit)
    : null
  return { ...raw, score }
}

/**
 * Score an MLB tool from per-season cumulative buckets.
 * Applies recency decay and global-confidence shrinkage toward 100.
 *
 * @param {Array}  seasons - canonical bucket array (level field unused)
 * @param {string} toolName
 * @param {object} opts
 * @param {object} opts.norms
 * @param {boolean} opts.isPit
 * @param {number} opts.referenceYear
 * @returns {{score:number|null,totalSample:number}}
 */
function scoreMlbTool(seasons, toolName, opts) {
  const { norms, isPit, referenceYear } = opts
  let wSum = 0, wTot = 0, totalSample = 0

  for (const s of seasons) {
    const ne = norms[`MLB|${s.year}`] ?? norms[`MLB|${s.year - 1}`]
    if (!ne) continue
    const n = isPit ? ne.pitchers : ne.hitters
    if (!n) continue
    const sample = _bucketSample(s, isPit)
    if (!sample) continue

    const recency = Math.pow(0.75, referenceYear - s.year)
    const conf    = sample / (sample + (MLB_K[toolName] ?? 100))
    const w       = conf * recency
    let z = 0

    if (toolName === 'hit') {
      const pa = (s.ab || 0) + (s.bb || 0) + (s.hbp || 0)
      const avg   = s.ab > 0 ? (s.h || 0) / s.ab : 0
      const kPct  = pa > 0 ? (s.so || 0) / pa : 0
      const bbPct = pa > 0 ? (s.bb || 0) / pa : 0
      const zA = n.avg    ? (avg   - n.avg.mean)    / n.avg.stdev    : 0
      const zK = n.k_pct  ? -((kPct - n.k_pct.mean) / n.k_pct.stdev) : 0
      const zB = n.bb_pct ? (bbPct - n.bb_pct.mean) / n.bb_pct.stdev : 0
      z = (zA + zK + zB) / 3
    } else if (toolName === 'power') {
      const iso = s.ab > 0 ? ((s.tb || 0) - (s.h || 0)) / s.ab : 0
      z = n.iso ? (iso - n.iso.mean) / n.iso.stdev : 0
    } else if (toolName === 'speed') {
      const singles   = (s.h || 0) - (s.xbh || 0)
      const stealOpps = singles + (s.bb || 0) + (s.hbp || 0)
      const sbRate    = stealOpps > 0 ? (s.sb || 0) / stealOpps : 0
      z = n.sb_rate ? (sbRate - n.sb_rate.mean) / n.sb_rate.stdev : 0
    } else if (toolName === 'stuff') {
      const kPct = s.bf > 0 ? (s.so || 0) / s.bf : 0
      z = n.k_pct ? (kPct - n.k_pct.mean) / n.k_pct.stdev : 0
    } else { // control
      const bbPct = s.bf > 0 ? (s.bb || 0) / s.bf : 0
      z = n.bb_pct ? -((bbPct - n.bb_pct.mean) / n.bb_pct.stdev) : 0
    }

    wSum += z * w
    wTot += w
    totalSample += sample
  }

  if (wTot === 0 || !totalSample) return { score: null, totalSample: 0 }
  const globalConf = totalSample / (totalSample + (MLB_K[toolName] ?? 100))
  return {
    score: Math.round(100 + (wSum / wTot) * 15 * globalConf),
    totalSample,
  }
}

// ─── Career blend ─────────────────────────────────────────────────────────
// Single canonical PA/IP-weighted blend of pure MiLB tools (from build-scores.js
// → player.model_scores) and pure MLB tools (from build-mlb-tools.js → mlb-tools.json).
// USED EVERYWHERE: pipeline (player.career_blend), player row, drawer tile, arc.
// If you're tempted to do a blend by hand, use this instead.

function _composite(t, type) {
  if (type === 'two-way') {
    const Hw = COMPOSITE_WEIGHTS.hitter, Pw = COMPOSITE_WEIGHTS.pitcher
    const pitch_overall = t.stuff != null && t.control != null
      ? Math.round(t.stuff * Pw.stuff + t.control * Pw.control) : null
    const hit_overall = t.hit != null && t.power != null && t.speed != null
      ? Math.round(t.hit * Hw.hit + t.power * Hw.power + t.speed * Hw.speed) : null
    const overall = pitch_overall != null && hit_overall != null
      ? Math.round((pitch_overall + hit_overall) / 2)
      : (pitch_overall ?? hit_overall ?? null)
    return { pitch_overall, hit_overall, overall }
  }
  if (type === 'pitcher') {
    const Pw = COMPOSITE_WEIGHTS.pitcher
    const overall = t.stuff != null && t.control != null
      ? Math.round(t.stuff * Pw.stuff + t.control * Pw.control) : null
    return { overall }
  }
  // hitter
  const Hw = COMPOSITE_WEIGHTS.hitter
  const overall = t.hit != null && t.power != null && t.speed != null
    ? Math.round(t.hit * Hw.hit + t.power * Hw.power + t.speed * Hw.speed)
    : (t.hit != null && t.power != null
      ? Math.round((t.hit * Hw.hit + t.power * Hw.power) / (Hw.hit + Hw.power))
      : null)
  return { overall }
}

// Workhorse factor for pitchers, applied to OVERALL only (stuff/control unchanged).
// IP/G measures how much of a starter the pitcher is. SP median ~3.5, RP median ~1.6.
// Pure closer (IP/G≈1) → 0.85 of overall. SP (IP/G≥3.5) → unchanged.
// Tune STARTER_FLOOR / STARTER_CEIL_IPG if needed.
const STARTER_FLOOR    = 0.85
const STARTER_CEIL_IPG = 3.5
function starterFactor(ipg) {
  if (ipg == null) return 1
  const t = Math.min(1, Math.max(0, (ipg - 1) / (STARTER_CEIL_IPG - 1)))
  return STARTER_FLOOR + (1 - STARTER_FLOOR) * t
}

function _inferType(milb, mlb) {
  if (mlb?.type) return mlb.type
  if (milb?.type) return milb.type
  // Fallback: if any pitcher tool present alongside hitter tool → two-way
  const hasPit = (milb?.stuff != null || milb?.control != null || mlb?.stuff != null || mlb?.control != null)
  const hasHit = (milb?.hit != null || milb?.power != null || milb?.speed != null || mlb?.hit != null || mlb?.power != null)
  if (hasPit && hasHit) return 'two-way'
  return hasPit ? 'pitcher' : 'hitter'
}

/**
 * Blend pure MiLB tools and pure MLB tools by sample-weighted average.
 * Either side may be null. Returns a player-facing object with composite overall.
 *
 * Hitter input fields used:  hit, power, speed, _sample (milb) / _pa (mlb)
 * Pitcher input fields used: stuff, control, _sample (milb) / _ip (mlb)
 * Two-way: both sides; mlb side has separate _pa and _ip.
 *
 * @param {object|null} milb - e.g. player.model_scores
 * @param {object|null} mlb  - e.g. mlbToolsMap[mlbamId]
 * @returns {object|null}
 */
// Applies the pitcher workhorse factor (if provided) to overall/pitch_overall only.
// Per-tool stuff/control are not touched.
function _applyStarter(out, type, ipg) {
  if (ipg == null) return out
  if (type !== 'pitcher' && type !== 'two-way') return out
  const sf = starterFactor(ipg)
  if (sf === 1) return out
  if (type === 'pitcher' && out.overall != null) {
    return { ...out, overall: Math.round(out.overall * sf), _starter_factor: sf }
  }
  if (type === 'two-way') {
    const next = { ...out, _starter_factor: sf }
    if (out.pitch_overall != null) next.pitch_overall = Math.round(out.pitch_overall * sf)
    // Recompute overall as avg of (adjusted pitch_overall, unchanged hit_overall)
    if (next.pitch_overall != null && next.hit_overall != null) {
      next.overall = Math.round((next.pitch_overall + next.hit_overall) / 2)
    } else if (next.pitch_overall != null) {
      next.overall = next.pitch_overall
    }
    return next
  }
  return out
}

function blendCareer(milb, mlb, opts) {
  if (!milb && !mlb) return null
  const type = _inferType(milb, mlb)
  const ipg = opts?.ipg ?? null

  // Pure MiLB (no MLB grade)
  if (!mlb) {
    const out = { ...milb, type, _sample: milb._sample ?? 0, _mlbSample: 0 }
    return _applyStarter({ ...out, ..._composite(out, type) }, type, ipg)
  }
  // Pure MLB (no MiLB grade) — typical for graduated MLB veterans w/o prospect score
  if (!milb) {
    const _mlbSample = type === 'pitcher' ? (mlb._ip ?? mlb._bf ?? 0) : (mlb._pa ?? 0)
    const out = { ...mlb, type, _sample: 0, _mlbSample }
    return _applyStarter({ ...out, ..._composite(out, type) }, type, ipg)
  }

  // Both sides — weighted blend
  const blend = (a, b, wA, wB) => {
    if (a == null && b == null) return null
    if (a == null) return b
    if (b == null) return a
    return Math.round(a * wA + b * wB)
  }

  if (type === 'two-way') {
    const pitchSample = mlb._ip ?? 0
    const hitSample = mlb._pa ?? 0
    const milbSample = milb._sample ?? 0
    const pT = pitchSample + milbSample
    const hT = hitSample + milbSample
    const pWa = pT > 0 ? pitchSample / pT : 0, pWb = pT > 0 ? milbSample / pT : 1
    const hWa = hT > 0 ? hitSample / hT : 0, hWb = hT > 0 ? milbSample / hT : 1
    const tools = {
      stuff:   blend(mlb.stuff,   milb.stuff,   pWa, pWb),
      control: blend(mlb.control, milb.control, pWa, pWb),
      hit:     blend(mlb.hit,     milb.hit,     hWa, hWb),
      power:   blend(mlb.power,   milb.power,   hWa, hWb),
      speed:   blend(mlb.speed,   milb.speed,   hWa, hWb),
    }
    const out = {
      ...tools, ..._composite(tools, 'two-way'),
      type: 'two-way',
      _raw: milb._raw, _confidence: milb._confidence,
      _sample: milbSample,
      _mlbSample: Math.max(pitchSample, hitSample),
    }
    return _applyStarter(out, 'two-way', ipg)
  }

  const mlbSample = type === 'pitcher' ? (mlb._ip ?? mlb._bf ?? 0) : (mlb._pa ?? 0)
  const milbSample = milb._sample ?? 0
  const total = mlbSample + milbSample
  const mlbW = total > 0 ? mlbSample / total : 0
  const milbW = total > 0 ? milbSample / total : 1

  const tools = type === 'pitcher'
    ? {
        stuff:   blend(mlb.stuff,   milb.stuff,   mlbW, milbW),
        control: blend(mlb.control, milb.control, mlbW, milbW),
      }
    : {
        hit:   blend(mlb.hit,   milb.hit,   mlbW, milbW),
        power: blend(mlb.power, milb.power, mlbW, milbW),
        speed: blend(mlb.speed, milb.speed, mlbW, milbW),
      }

  const out = {
    ...tools, ..._composite(tools, type),
    type,
    _raw: milb._raw, _confidence: milb._confidence,
    _sample: milbSample, _mlbSample: mlbSample,
  }
  return _applyStarter(out, type, ipg)
}

module.exports = {
  POOL_CENTER, POOL_STDEV, SHRINK_TOWARD, AGE_SLOPE_YOUNG, AGE_SLOPE_OLD,
  STARTER_FLOOR, STARTER_CEIL_IPG, starterFactor,
  MILB_LEVEL_AVG_AGES, MILB_SHRINK_K, MLB_K,
  TOOL_STAT_KEYS, COMPOSITE_WEIGHTS,
  milbStatK,
  scoreMilbToolRaw, normShrinkMilb, scoreMilbTool, scoreMlbTool,
  blendCareer,
}
