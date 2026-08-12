/**
 * build-comp-pool.js
 * Prospect-only "pro comp" — ceiling (90th pct) and floor (25th pct) real-player comps.
 *
 * Comp pool = graduated players' REAL career MLB tool grades (career_blend.hit/power/speed
 * or .stuff/.control) — not a reconstructed "what they looked like as a prospect"
 * projection. A prospect's own career_blend tool grades are already the model's
 * MLB-translated projection (regression.json's targets are mlb-tools.json's real grades),
 * so comparing that projection directly against graduated players' real grades is
 * apples-to-apples by construction. No point predicting a graduated player's past when we
 * already know what they became.
 *
 * Similarity: weighted Euclidean distance on tool grades (same weights as the overall
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

const BASE         = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH = path.join(BASE, 'players.json');

const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));

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
// Ceiling vector blends raw (unshrunk, upside) with current (shrunk, expected) tool
// grades rather than using raw alone — pure raw ran too hot. Still upside-leaning, just
// not maxed out. Tune this if ceilings still read high/low after the next check.
const CEILING_RAW_WEIGHT = 0.65;

function blendVec(rawVec, shrunkVec, rawWeight) {
  const out = {};
  for (const tool of Object.keys(shrunkVec)) {
    const r = rawVec[tool], s = shrunkVec[tool];
    out[tool] = (r == null || s == null) ? (r ?? s) : r * rawWeight + s * (1 - rawWeight);
  }
  return out;
}

function distance(weights, a, b) {
  let sumSq = 0;
  for (const [tool, w] of Object.entries(weights)) {
    if (a[tool] == null || b[tool] == null) return Infinity;
    sumSq += w * (a[tool] - b[tool]) ** 2;
  }
  return Math.sqrt(sumSq);
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

// ── Build comp pools from graduated players' real career_blend grades ──────────────────
const hitterPool = [];
const spPool = [];
const rpPool = [];

for (const [id, p] of Object.entries(players)) {
  const cb = p.career_blend;
  if (!cb || !((cb._mlbSample || 0) > 0)) continue; // graduated (real MLB tool grade) only
  const positions = parsePositions(p.positions);
  if (cb.type === 'hitter') {
    if (cb.hit == null || cb.power == null || cb.speed == null) continue;
    hitterPool.push({ id, name: p.name, positions, hit: cb.hit, power: cb.power, speed: cb.speed, peak3: cb.peak3, overall: cb.overall });
  } else if (cb.type === 'pitcher') {
    if (cb.stuff == null || cb.control == null) continue;
    const entry = { id, name: p.name, positions, stuff: cb.stuff, control: cb.control, peak3: cb.peak3, overall: cb.overall };
    (cb.role === 'RP' ? rpPool : spPool).push(entry);
  }
}

function nearestNeighbors(candidateVec, pool, weights) {
  return pool
    .map(p => ({ ...p, dist: distance(weights, candidateVec, p) }))
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
function pickCeiling(ceilingVec, pool, weights) {
  const provenPeak = pool.filter(p => p.peak3 != null && p.overall != null && p.peak3 > p.overall);
  const neighbors = nearestNeighbors(ceilingVec, provenPeak, weights);
  const byPeak3 = neighbors.filter(p => p.peak3 != null).sort((a, b) => a.peak3 - b.peak3);
  const target = percentileValue(byPeak3.map(p => p.peak3), CEILING_PCT);
  const pick = target != null ? closestTo(byPeak3, 'peak3', target) : null;
  return pick ? { name: pick.name, peak3: pick.peak3 } : null;
}
function pickFloor(shrunkVec, pool, weights) {
  const neighbors = nearestNeighbors(shrunkVec, pool, weights);
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
    const eligiblePool = hitterPool.filter(c => positionCompatible(prospectPositions, c.positions));
    const rawVec = { hit: cb._raw?.hit ?? cb.hit, power: cb._raw?.power ?? cb.power, speed: cb._raw?.speed ?? cb.speed };
    const shrunkVec = { hit: cb.hit, power: cb.power, speed: cb.speed };
    ceiling = pickCeiling(blendVec(rawVec, shrunkVec, CEILING_RAW_WEIGHT), eligiblePool, COMPOSITE_WEIGHTS.hitter);
    floor   = pickFloor(shrunkVec, eligiblePool, COMPOSITE_WEIGHTS.hitter);
  } else if (cb.type === 'pitcher' && cb.stuff != null && cb.control != null) {
    const pool = cb.role === 'RP' ? rpPool : spPool;
    const rawVec = { stuff: cb._raw?.stuff ?? cb.stuff, control: cb._raw?.control ?? cb.control };
    const shrunkVec = { stuff: cb.stuff, control: cb.control };
    ceiling = pickCeiling(blendVec(rawVec, shrunkVec, CEILING_RAW_WEIGHT), pool, COMPOSITE_WEIGHTS.pitcher);
    floor   = pickFloor(shrunkVec, pool, COMPOSITE_WEIGHTS.pitcher);
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
console.log(`Comp pool: ${hitterPool.length} hitters, ${spPool.length} SP, ${rpPool.length} RP`);
console.log(`Tagged ${tagged} prospects with ceiling/floor comps`);
