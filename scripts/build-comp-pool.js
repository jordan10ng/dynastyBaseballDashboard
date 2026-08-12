/**
 * build-comp-pool.js
 * Prospect-only "pro comp" — ceiling (90th pct) and floor (25th pct) real-player comps.
 *
 * Comp pool = graduated players' REAL peak (best rolling 3yr window, peak-tools.json) tool
 * grades — not a reconstructed "what they looked like as a prospect" projection, and not
 * their career-average either (a long career's average can sit well below what a player
 * actually proved at their best, misleadingly pulling them into a similarity match their
 * peak was never actually close to). A prospect's own tool grades are already the model's
 * MLB-translated projection (regression.json's targets are mlb-tools.json's real grades),
 * so comparing that projection directly against graduated players' real grades is
 * apples-to-apples by construction. No point predicting a graduated player's past when we
 * already know what they became.
 *
 * Similarity: weighted Euclidean distance on peak tool grades (same weights as the overall
 * composite), same role (hitter / SP / RP — pitcher role already persisted on career_blend
 * by build-scores.js). From the K nearest neighbors, pick whichever real comp's realized
 * outcome sits closest to the pool's 90th percentile (ceiling, by peak3) and 25th
 * percentile (floor, by career overall) — not the single best/worst, to avoid one outlier
 * career dominating every comp for a given profile.
 *
 * Two-way players are skipped — too rare a pool for either side to comp meaningfully.
 * Additive display only — never read by dynasty_score/model-rank/blend-rank.
 * Must run after build-scores.js (needs its career_blend output).
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BASE           = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH   = path.join(BASE, 'players.json');
const PEAK_TOOLS_PATH = path.join(BASE, 'model/peak-tools.json');

const players   = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const peakTools = fs.existsSync(PEAK_TOOLS_PATH) ? JSON.parse(fs.readFileSync(PEAK_TOOLS_PATH, 'utf8')) : {};

const COMPOSITE_WEIGHTS = {
  hitter:  { hit: 0.42, power: 0.47, speed: 0.11 },
  pitcher: { stuff: 0.70, control: 0.30 },
};
// K=30 let the percentile pick reach into barely-qualifying neighbors — outcome-value
// proximity has zero regard for distance rank within the pool, so a candidate 26th-closest
// of 30 (dist 9.08) could beat out the single tightest tool match (dist 4.80, nearly
// identical peak3) just because its own peak3 landed a hair closer to the target value
// (Jesus Made -> Miguel Vargas instead of Luis Matos, the real case that surfaced this).
// K=15 keeps "similar" meaning similar; ties in outcome still break toward the closer
// tool match via the distance-sorted input to closestTo()'s stable-sort-preserved order.
const K            = 15;
const CEILING_PCT  = 0.90;
const FLOOR_PCT    = 0.25;
// mlb-tools.json/peak-tools.json's own qualifying floor (100 PA / 50 IP) is just "has any
// real grade at all" -- nowhere near enough sample to trust as a comp's whole story. Packy
// Naughton (60 IP, a cup of coffee) surfaced as a comp off that bare minimum. Roughly a
// half-season+ before a real player's real career counts as a legitimate comp candidate.
const MIN_COMP_SAMPLE = { hitter: 300, pitcher: 100 };
// Ceiling vector blends raw (unshrunk, upside) with current (shrunk, expected) tool
// grades rather than using raw alone — pure raw ran too hot. Still upside-leaning, just
// not maxed out. Tune this if ceilings still read high/low after the next check.
const CEILING_RAW_WEIGHT = 0.65;
// Same overfitting lesson, pool side: a real player's peak (best-ever 3yr window) is
// itself a small, noisy sample -- using it 100% pure let a merely-good career with one
// fluky great stretch outrank a real, sustained star as a match, diluting who counts as
// "elite enough" for a top prospect's ceiling. Blending back toward career-average tempers
// that the same way CEILING_RAW_WEIGHT tempers the prospect's own raw projection.
//
// Ceiling and floor use different weights, not the same blend both directions -- ceiling
// asks "who could this become at their best" (peak-informed, stays high); floor asks "who
// does this resemble in sustained, typical production" (should lean on career-average, not
// peak). Sharing one weight let a real player's peak alone pull them into an elite
// prospect's floor neighborhood even when their actual career-average profile looked
// nothing like that prospect (Justin Verlander showing up as a floor comp on the strength
// of his real ace-level peak, despite a diluted-by-longevity career average that a true
// floor story should be judged on).
const CEILING_POOL_PEAK_WEIGHT = 0.5;
const FLOOR_POOL_PEAK_WEIGHT   = 0.2;
// Floor-pool eligibility also excludes anyone whose own peak3 sits well above their own
// overall -- mirrors the ceiling pool's peak3>overall requirement, inverted: a player who
// had a genuinely big peak was never a "floor" story, no matter how a long decline phase
// dragged their career average down (Verlander: peak3=127, overall=111, gap=16 -- his
// career average is a real number, just not a fair floor comp for what the gap represents).
const FLOOR_EXCLUDE_GAP = 15;
// Soft handedness preference — added to distance on mismatch, not a pool filter. Sized so
// a genuinely better tool match still wins ("accept non-matches when much better"), but
// nudges a close tie toward the same-handed comp. Pitchers weighted higher than hitters:
// arm side changes real outcomes more (batter unfamiliarity with the rarer hand, role/
// usage patterns) than bat side does. Switch-hitters aren't "compatible with either side"
// — their aggregate line already carries a built-in platoon advantage a same-handed
// player doesn't get, so S only matches S (plain equality already gives this for free —
// no special-case needed beyond comparing the field).
const HANDEDNESS_PENALTY = { hitter: 3, pitcher: 5 };

function blendVec(rawVec, shrunkVec, rawWeight) {
  const out = {};
  for (const tool of Object.keys(shrunkVec)) {
    const r = rawVec[tool], s = shrunkVec[tool];
    out[tool] = (r == null || s == null) ? (r ?? s) : r * rawWeight + s * (1 - rawWeight);
  }
  return out;
}

function distance(weights, a, b, handKey, handPenalty) {
  let sumSq = 0;
  for (const [tool, w] of Object.entries(weights)) {
    if (a[tool] == null || b[tool] == null) return Infinity;
    sumSq += w * (a[tool] - b[tool]) ** 2;
  }
  let d = Math.sqrt(sumSq);
  if (handKey && handPenalty && a[handKey] && b[handKey] && a[handKey] !== b[handKey]) d += handPenalty;
  return d;
}

function percentileValue(sortedVals, pct) {
  if (!sortedVals.length) return null;
  const idx = Math.min(sortedVals.length - 1, Math.max(0, Math.round(pct * (sortedVals.length - 1))));
  return sortedVals[idx];
}

function closestTo(list, key, target) {
  return list.reduce((best, p) => Math.abs(p[key] - target) < Math.abs(best[key] - target) ? p : best);
}

// Defensive-spectrum compatibility: a prospect's listed position(s) may only comp against
// real players who played that position or one further DOWN the spectrum from it — a
// shaky-glove SS might profile as a 2B/3B/CF; a 2B/3B/CF prospect never comps to an
// SS-only career (they'd already be playing SS if they had the actions). Directional, not
// symmetric. Positions not covered by an explicit rule default to matching only themselves.
// UT/DH are treated as equivalent "no defensive commitment" tags, bridging with 1B only.
const POSITION_DOWN = {
  SS:  ['SS', '2B', '3B'],
  CF:  ['CF', 'LF', 'RF'],
  '3B': ['3B', '1B'],
  LF:  ['LF', 'RF', '1B'],
  RF:  ['RF', 'LF', '1B'],
  C:   ['C', '1B'],
  '1B': ['1B', 'UT', 'DH'],
  UT:  ['UT', 'DH', '1B'],
  DH:  ['DH', 'UT', '1B'],
};
// INF/OF are generic catch-all tags many multi-eligible players carry alongside their
// specific position(s) — they carry no defensive-spectrum information on their own. Left
// unfiltered, the POSITION_DOWN fallback (unmapped position -> matches only itself) made
// any two players who both happened to carry "INF" match regardless of specific position,
// completely bypassing the spectrum (how Bryce Harper [1B,INF] matched Arjun Nimmala
// [SS,INF] despite 1B not being SS-compatible). Stripped before compatibility checks.
const GENERIC_POSITION_TAGS = new Set(['INF', 'OF']);
function parsePositions(str) {
  return (str || '').split(',').map(s => s.trim()).filter(p => p && !GENERIC_POSITION_TAGS.has(p));
}
function allowedTargets(positions) {
  const set = new Set();
  for (const pos of positions) for (const t of (POSITION_DOWN[pos] || [pos])) set.add(t);
  return set;
}
function positionCompatible(prospectPositions, candidatePositions) {
  if (!prospectPositions.length || !candidatePositions.length) return true; // no data -> don't filter
  const allowed = allowedTargets(prospectPositions);
  return candidatePositions.some(p => allowed.has(p));
}

// ── Build comp pools from graduated players' REAL PEAK tool grades ─────────────────────
// Similarity uses each real player's best rolling-3yr-window tool grades (peak-tools.json)
// instead of their career-average (career_blend.hit/power/speed) — a long career's average
// can be dragged well below what the player actually proved at their best (Justin
// Verlander: career stuff/control 111/112, diluted by a 12-season sample, vs. his real
// 2018-19 peak of 130/119 -- ACE-caliber). Matching prospects against the diluted average
// let modest projections pull in a comp whose peak was nothing like them (Verlander showing
// up as a FLOOR comp for an unremarkable prospect, purely because his career-long average
// happened to look modest -- not because his talent ever was). Peak-tools.json's raw
// hit/power/speed (or stuff/control) are already on the same real-MLB-average-centered
// scale as career_blend's, same to_plus(z) formula, no extra pool-norming needed (unlike
// the prospect-side _raw, which is a MiLB-regression prediction on a different scale).
// peak3/overall stay as the outcome-target metrics (unchanged) — only the similarity basis
// moves from career-average to peak.
function poolBlend(peakVal, currentVal, peakWeight) {
  if (peakVal == null) return currentVal;
  if (currentVal == null) return peakVal;
  return peakVal * peakWeight + currentVal * (1 - peakWeight);
}

// excludeGap: floor-only. Skips any candidate whose own peak3 sits more than excludeGap
// above their own overall -- see FLOOR_EXCLUDE_GAP comment above.
function buildPools(peakWeight, excludeGap) {
  const hitterPool = [], spPool = [], rpPool = [];
  for (const [id, p] of Object.entries(players)) {
    const cb = p.career_blend;
    if (!cb || !((cb._mlbSample || 0) > 0)) continue; // graduated (real MLB tool grade) only
    if (excludeGap != null && cb.peak3 != null && cb.overall != null && (cb.peak3 - cb.overall) > excludeGap) continue;
    const positions = parsePositions(p.positions);
    const pt = p.mlbam_id ? peakTools[String(p.mlbam_id)] : null;
    if (cb.type === 'hitter') {
      if ((cb._mlbSample || 0) < MIN_COMP_SAMPLE.hitter) continue;
      const hit = poolBlend(pt?.hit, cb.hit, peakWeight), power = poolBlend(pt?.power, cb.power, peakWeight), speed = poolBlend(pt?.speed, cb.speed, peakWeight);
      if (hit == null || power == null || speed == null) continue;
      hitterPool.push({ id, name: p.name, positions, bats: p.bats ?? null, hit, power, speed, peak3: cb.peak3, overall: cb.overall });
    } else if (cb.type === 'pitcher') {
      if ((cb._mlbSample || 0) < MIN_COMP_SAMPLE.pitcher) continue;
      const stuff = poolBlend(pt?.stuff, cb.stuff, peakWeight), control = poolBlend(pt?.control, cb.control, peakWeight);
      if (stuff == null || control == null) continue;
      const entry = { id, name: p.name, positions, throws: p.throws ?? null, stuff, control, peak3: cb.peak3, overall: cb.overall };
      (cb.role === 'RP' ? rpPool : spPool).push(entry);
    }
  }
  return { hitterPool, spPool, rpPool };
}

const ceilingPools = buildPools(CEILING_POOL_PEAK_WEIGHT, null);
const floorPools   = buildPools(FLOOR_POOL_PEAK_WEIGHT, FLOOR_EXCLUDE_GAP);

function nearestNeighbors(candidateVec, pool, weights, handKey, handPenalty) {
  return pool
    .map(p => ({ ...p, dist: distance(weights, candidateVec, p, handKey, handPenalty) }))
    .filter(p => isFinite(p.dist))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, K);
}

// Ceiling uses a blend of the prospect's RAW (unshrunk, "▲ Raw (ceiling)" on the drawer)
// and current (shrunk, expected) tool grades — CEILING_RAW_WEIGHT toward raw — so the
// ceiling comp leans upside without maxing out on the least-confident number. Pure raw
// alone ran too hot. Floor uses the regular shrunk grades (the model's actual best-guess
// translation) against the same real-outcome pool. The pool side (real graduated players)
// has no raw/shrunk split to swap — their career happened, it's the one number — only the
// prospect's own vector changes between calls.
//
// Ceiling pool is further restricted to peak3 > overall — a genuine demonstrated peak
// above the player's own baseline, not just a tool-similar name. Without this, a bouncy
// AAA/MLB player whose `overall` is still propped up by a hopeful recent MiLB projection
// (large _sample alongside a real MLB one) can have peak3 BELOW their own overall — their
// career never validated the grade with an actual peak, so they're a floor story wearing
// a ceiling label (surfaced by Luis Matos/Evan Carter showing up for Jesus Made).
function pickCeiling(ceilingVec, pool, weights, handKey, handPenalty) {
  const provenPeak = pool.filter(p => p.peak3 != null && p.overall != null && p.peak3 > p.overall);
  const neighbors = nearestNeighbors(ceilingVec, provenPeak, weights, handKey, handPenalty);
  const byPeak3 = neighbors.filter(p => p.peak3 != null).sort((a, b) => a.peak3 - b.peak3);
  const target = percentileValue(byPeak3.map(p => p.peak3), CEILING_PCT);
  const pick = target != null ? closestTo(byPeak3, 'peak3', target) : null;
  return pick ? { name: pick.name, peak3: pick.peak3 } : null;
}
function pickFloor(shrunkVec, pool, weights, handKey, handPenalty) {
  const neighbors = nearestNeighbors(shrunkVec, pool, weights, handKey, handPenalty);
  const byOverall = neighbors.filter(p => p.overall != null).sort((a, b) => a.overall - b.overall);
  const target = percentileValue(byOverall.map(p => p.overall), FLOOR_PCT);
  const pick = target != null ? closestTo(byOverall, 'overall', target) : null;
  return pick ? { name: pick.name, overall: pick.overall } : null;
}

// ── Tag prospects only ──────────────────────────────────────────────────────────────────
let tagged = 0;
for (const p of Object.values(players)) {
  const cb = p.career_blend;
  if (!cb) continue;
  const graduated = (cb._mlbSample || 0) > 0;
  if (graduated) continue;

  let ceiling = null, floor = null;
  if (cb.type === 'hitter' && cb.hit != null && cb.power != null && cb.speed != null) {
    const prospectPositions = parsePositions(p.positions);
    const eligibleCeilingPool = ceilingPools.hitterPool.filter(c => positionCompatible(prospectPositions, c.positions));
    const eligibleFloorPool   = floorPools.hitterPool.filter(c => positionCompatible(prospectPositions, c.positions));
    const rawVec = { hit: cb._raw?.hit ?? cb.hit, power: cb._raw?.power ?? cb.power, speed: cb._raw?.speed ?? cb.speed };
    const shrunkVec = { hit: cb.hit, power: cb.power, speed: cb.speed };
    const bats = p.bats ?? null;
    ceiling = pickCeiling({ ...blendVec(rawVec, shrunkVec, CEILING_RAW_WEIGHT), bats }, eligibleCeilingPool, COMPOSITE_WEIGHTS.hitter, 'bats', HANDEDNESS_PENALTY.hitter);
    floor   = pickFloor({ ...shrunkVec, bats }, eligibleFloorPool, COMPOSITE_WEIGHTS.hitter, 'bats', HANDEDNESS_PENALTY.hitter);
  } else if (cb.type === 'pitcher' && cb.stuff != null && cb.control != null) {
    const ceilingPool = cb.role === 'RP' ? ceilingPools.rpPool : ceilingPools.spPool;
    const floorPool   = cb.role === 'RP' ? floorPools.rpPool   : floorPools.spPool;
    const rawVec = { stuff: cb._raw?.stuff ?? cb.stuff, control: cb._raw?.control ?? cb.control };
    const shrunkVec = { stuff: cb.stuff, control: cb.control };
    const throws = p.throws ?? null;
    ceiling = pickCeiling({ ...blendVec(rawVec, shrunkVec, CEILING_RAW_WEIGHT), throws }, ceilingPool, COMPOSITE_WEIGHTS.pitcher, 'throws', HANDEDNESS_PENALTY.pitcher);
    floor   = pickFloor({ ...shrunkVec, throws }, floorPool, COMPOSITE_WEIGHTS.pitcher, 'throws', HANDEDNESS_PENALTY.pitcher);
  }
  if (ceiling || floor) {
    p.career_blend = {
      ...cb,
      ...(ceiling ? { comp_ceiling: ceiling } : {}),
      ...(floor   ? { comp_floor: floor } : {}),
    };
    tagged++;
  }
}

fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2));
console.log(`Ceiling pool: ${ceilingPools.hitterPool.length} hitters, ${ceilingPools.spPool.length} SP, ${ceilingPools.rpPool.length} RP`);
console.log(`Floor pool:   ${floorPools.hitterPool.length} hitters, ${floorPools.spPool.length} SP, ${floorPools.rpPool.length} RP`);
console.log(`Tagged ${tagged} prospects with ceiling/floor comps`);
