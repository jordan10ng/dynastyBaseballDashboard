const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { scoreMilbToolRaw, scoreMilbTool, blendCareer, starterFactor } = require('../lib/score-tools');

const BASE          = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH  = path.join(BASE, 'players.json');
const HOTSHEET_PATH = path.join(BASE, 'model/hot-sheet.json');
const REGR_PATH     = path.join(BASE, 'model/regression.json');
const NORMS_PATH    = path.join(BASE, 'model/norms.json');
const HISTORY_DIR   = path.join(BASE, 'history');

const regression  = JSON.parse(fs.readFileSync(REGR_PATH, 'utf8'));
const players     = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const norms       = JSON.parse(fs.readFileSync(NORMS_PATH, 'utf8'));
const MLB_TOOLS_PATH = path.join(BASE, 'model/mlb-tools.json');
const mlbTools    = fs.existsSync(MLB_TOOLS_PATH) ? JSON.parse(fs.readFileSync(MLB_TOOLS_PATH, 'utf8')) : {};

// Peak3 (best rolling 3-yr MLB window) + worthy-career calibration — additive display
// stats only. Never touch model_scores.overall or dynasty_score. Both optional: script
// degrades gracefully (fields just omitted) if these haven't been built yet.
const PEAK_REGR_PATH   = path.join(BASE, 'model/peak-regression.json');
const PEAK_TOOLS_PATH  = path.join(BASE, 'model/peak-tools.json');
const WORTHY_CALIB_PATH = path.join(BASE, 'model/worthy-calibration.json');
const peakRegression = fs.existsSync(PEAK_REGR_PATH) ? JSON.parse(fs.readFileSync(PEAK_REGR_PATH, 'utf8')) : null;
const peakTools      = fs.existsSync(PEAK_TOOLS_PATH) ? JSON.parse(fs.readFileSync(PEAK_TOOLS_PATH, 'utf8')) : {};
const worthyCalib    = fs.existsSync(WORTHY_CALIB_PATH) ? JSON.parse(fs.readFileSync(WORTHY_CALIB_PATH, 'utf8')) : null;

// Fantasy-stat peak3 projections (AVG/OBP/SLG/OPS/HR-rate/3B-rate/RBI-rate/R-rate/2B-rate
// for hitters, WHIP/BAA/ERA/K-BB% for pitchers) — prospects only, never computed for
// graduated players (they have real stats, a projection would be pointless). Additive,
// lives under career_blend.fantasy_peak3, never read by ranking.
const FANTASY_PEAK_PATH = path.join(BASE, 'model/fantasy-peak-regression.json');
const fantasyPeakRegression = fs.existsSync(FANTASY_PEAK_PATH) ? JSON.parse(fs.readFileSync(FANTASY_PEAK_PATH, 'utf8')) : null;

const VALID_YEARS   = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026]);
const CURRENT_YEAR  = new Date().getFullYear();

const POOL_CENTER   = 95;
const POOL_STDEV    = 15;
const SHRINK_TOWARD = 88;

const history = {};
const histFiles = fs.readdirSync(HISTORY_DIR).filter(f => /^\d{4}\.json$/.test(f));
console.log(`Loading ${histFiles.length} history files...`);
for (const file of histFiles) {
  const year = parseInt(file);
  if (!VALID_YEARS.has(year)) continue;
  const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8'));
  for (const [mlbamId, seasons] of Object.entries(data)) {
    if (!history[mlbamId]) history[mlbamId] = [];
    for (const s of seasons) history[mlbamId].push({ ...s, year });
  }
}
console.log(`  History loaded for ${Object.keys(history).length} players`);

const AVG_AGES = {
  'AAA': 26.4, 'AA': 24.0, 'High-A': 22.6, 'Single-A': 21.3,
  'Complex': 19.9, 'DSL': 17.9, 'Rookie': 20.4,
};
const MILB_LEVELS = new Set(Object.keys(AVG_AGES));

// Canonicalize raw history level labels to the labels the regression/norms use.
// History emits 'ROK' for complex/rookie ball; the model is trained on 'Complex'/'Rookie'.
function canonLevel(l, year) {
  if (l === 'A') return 'Single-A';
  if (l === 'A+' || l === 'High A') return 'High-A';
  if (l === 'ROK' || l === 'Rookie Advanced') return (year && year >= 2021) ? 'Complex' : 'Rookie';
  if (l === 'CPX') return 'Complex';
  return l;
}

function isTwoWayPositions(positions) {
  const pos = (positions || '').split(',').map(s => s.trim());
  const hasArm = pos.some(p => p === 'SP' || p === 'RP');
  const hasBat = pos.some(p => p !== 'SP' && p !== 'RP' && p !== 'P');
  return { hasArm, hasBat, isTwoWay: hasArm && hasBat };
}

const TOOL_STATS = {
  hit:     { type: 'hitter',  stats: ['k_pct','bb_pct'] },
  power:   { type: 'hitter',  stats: ['iso'] },
  speed:   { type: 'hitter',  stats: ['sb_rate'] },
  stuff:   { type: 'pitcher', stats: ['k_pct'] },
  control: { type: 'pitcher', stats: ['bb_pct'] },
};

const COMPOSITE_WEIGHTS = {
  hitter:  { hit: 0.42, power: 0.47, speed: 0.11 },
  pitcher: { stuff: 0.70, control: 0.30 },
};

const SHRINK_K = { hitter: 200, pitcher: 80 };
const STAT_SHRINK_K = {
  k_pct_hitter: 60, bb_pct_hitter: 120, iso: 120, sb_rate: 60,
  k_pct_pitcher: 20, bb_pct_pitcher: 40,
};
function statShrinkK(stat, isPitcher) {
  if (stat === 'k_pct') return isPitcher ? STAT_SHRINK_K.k_pct_pitcher : STAT_SHRINK_K.k_pct_hitter;
  if (stat === 'bb_pct') return isPitcher ? STAT_SHRINK_K.bb_pct_pitcher : STAT_SHRINK_K.bb_pct_hitter;
  return STAT_SHRINK_K[stat] ?? (isPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter);
}

function ipToFloat(ip) {
  const parts = String(ip || 0).split('.');
  return parseInt(parts[0] || 0) + (parseInt(parts[1] || 0)) / 3;
}
function getAge(dob, year) {
  if (!dob) return null;
  try {
    const d = new Date(dob);
    let age = year - d.getFullYear();
    if (d.getMonth() > 6 || (d.getMonth() === 6 && d.getDate() > 1)) age--;
    return age;
  } catch { return null; }
}
function getNorm(level, year) {
  for (let y = year; y >= year - 3; y--) {
    const entry = norms[`${level}|${y}`];
    if (entry) return entry;
  }
  return null;
}
function isRookieEligible(mlbamId, isPitcher) {
  const seasons = history[String(mlbamId)] || [];
  const mlb = seasons.filter(s => s.level === 'MLB');
  if (isPitcher) return mlb.reduce((sum, s) => sum + ipToFloat(s.ip), 0) < 50;
  return mlb.reduce((sum, s) => sum + (s.ab || 0), 0) < 130;
}
function shrink(score, sample, isPitcher) {
  if (score == null) return null;
  const k = isPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter;
  const conf = sample / (sample + k);
  return SHRINK_TOWARD + (score - SHRINK_TOWARD) * conf;
}


// Canonical scoreTool — delegates to shared lib. Same signature and return shape as legacy.
// `score` is the raw weighted prediction (pre-norm); pool-norming happens later in run().
function scoreTool(mlbamId, player, tool, isPitcher) {
  if (!regression.models?.[tool]) return { score: null, wSum: 0, wTot: 0, cySum: 0, cyTot: 0, sample: 0 };
  const expectedType = isPitcher ? 'pitching' : 'hitting';
  const seasons = (history[String(mlbamId)] || [])
    .filter(s => MILB_LEVELS.has(canonLevel(s.level, s.year)) && VALID_YEARS.has(s.year) && s.team && s.type === expectedType);
  const buckets = seasons.map(s => {
    const ipParts = String(s.ip || '0').split('.');
    const ipOuts  = (parseInt(ipParts[0] || '0') * 3) + parseInt(ipParts[1] || '0');
    return {
      year: s.year, level: canonLevel(s.level, s.year),
      ab:  s.ab  || 0, bb: s.bb || 0, hbp: s.hbp || 0,
      so:  s.so  || 0, h:  s.h  || 0,
      xbh: (s.doubles || 0) + (s.triples || 0) + (s.hr || 0),
      sb:  s.sb  || 0,
      tb:  s.tb  || Math.round((parseFloat(s.slg || '0') || 0) * (s.ab || 0)),
      bf:  s.bf  || 0,
      ipOuts,
    };
  });
  const r = scoreMilbToolRaw(buckets, tool, {
    models: regression.models, norms,
    isPit: isPitcher,
    referenceYear: CURRENT_YEAR,
    getAge: (yr) => getAge(player.birthDate, yr),
    currentYearForExclusion: CURRENT_YEAR,
  });
  return { score: r.rawWeighted, wSum: r.wSum, wTot: r.wTot, cySum: r.cySum, cyTot: r.cyTot, sample: r.totalSample };
}

// Same shape as scoreTool but scores against peak-regression.json's models (fit on best
// rolling 3-yr MLB window instead of career average). Same predictor stats — testing
// found peak needs no different feature set, just a separate fit (noisier outcome).
function scoreToolPeak(mlbamId, player, tool, isPitcher) {
  if (!peakRegression?.models?.[tool]) return { score: null, sample: 0 };
  const expectedType = isPitcher ? 'pitching' : 'hitting';
  const seasons = (history[String(mlbamId)] || [])
    .filter(s => MILB_LEVELS.has(canonLevel(s.level, s.year)) && VALID_YEARS.has(s.year) && s.team && s.type === expectedType);
  const buckets = seasons.map(s => {
    const ipParts = String(s.ip || '0').split('.');
    const ipOuts  = (parseInt(ipParts[0] || '0') * 3) + parseInt(ipParts[1] || '0');
    return {
      year: s.year, level: canonLevel(s.level, s.year),
      ab:  s.ab  || 0, bb: s.bb || 0, hbp: s.hbp || 0,
      so:  s.so  || 0, h:  s.h  || 0,
      xbh: (s.doubles || 0) + (s.triples || 0) + (s.hr || 0),
      sb:  s.sb  || 0,
      tb:  s.tb  || Math.round((parseFloat(s.slg || '0') || 0) * (s.ab || 0)),
      bf:  s.bf  || 0,
      ipOuts,
    };
  });
  const r = scoreMilbToolRaw(buckets, tool, {
    models: peakRegression.models, norms,
    isPit: isPitcher,
    referenceYear: CURRENT_YEAR,
    getAge: (yr) => getAge(player.birthDate, yr),
    currentYearForExclusion: CURRENT_YEAR,
  });
  return { score: r.rawWeighted, sample: r.totalSample };
}

// Hitter-only: sample-weighted xbh_rate z at AAA specifically. Testing found this is the
// one candidate stat that adds real incremental lift for the worthy-career calibration
// (AAA-specific — didn't replicate at AA or below). 0 = league-average default when the
// player has no AAA sample (most prospects haven't reached AAA yet).
function xbhRateZAaa(mlbamId) {
  const seasons = (history[String(mlbamId)] || [])
    .filter(s => s.level === 'AAA' && VALID_YEARS.has(s.year) && s.team && s.type === 'hitting');
  let zsum = 0, wsum = 0;
  for (const s of seasons) {
    const pa = s.pa || 0;
    if (pa < 30) continue;
    const n = norms[`AAA|${s.year}`]?.hitters?.xbh_rate;
    if (!n || n.stdev === 0) continue;
    const xbhRate = ((s.doubles || 0) + (s.triples || 0) + (s.hr || 0)) / pa;
    const z = (xbhRate - n.mean) / n.stdev;
    zsum += z * pa; wsum += pa;
  }
  return wsum > 0 ? zsum / wsum : 0;
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// Actual (realized) peak/worthy composite for graduated players, from peak-tools.json.
// Returns the two sides separately (not pre-blended) so the caller can apply the
// starter/workhorse factor to the pitch side before blending — see peakComposite().
function peakActualComposite(pt) {
  if (!pt) return { pitchOverall: null, hitOverall: null };
  const hasPitch = pt.stuff != null && pt.control != null;
  const hasHit   = pt.hit != null && pt.power != null && pt.speed != null;
  const pitchOverall = hasPitch ? (pt.stuff * COMPOSITE_WEIGHTS.pitcher.stuff + pt.control * COMPOSITE_WEIGHTS.pitcher.control) : null;
  const hitOverall   = hasHit   ? (pt.hit * COMPOSITE_WEIGHTS.hitter.hit + pt.power * COMPOSITE_WEIGHTS.hitter.power + pt.speed * COMPOSITE_WEIGHTS.hitter.speed) : null;
  return { pitchOverall, hitOverall };
}
// Blends pitch/hit sides into the final peak3 number, applying the SAME starter/workhorse
// factor career overall gets (lib/score-tools.js's starterFactor) to the pitch side before
// blending — matches _applyStarter()'s two-way logic. Without this, a reliever's peak3 (an
// unshrunk, unadjusted best-3yr tool grade) can read far higher than their career overall
// (which does get the workhorse penalty), which is exactly the inconsistency a reliever
// like Paul Sewald (peak3 130, overall 93) exposed.
function peakComposite(pitchOverall, hitOverall, careerIPG) {
  const sf = starterFactor(careerIPG);
  const adjPitch = pitchOverall != null ? pitchOverall * sf : null;
  if (adjPitch != null && hitOverall != null) return Math.round((adjPitch + hitOverall) / 2);
  if (adjPitch != null) return Math.round(adjPitch);
  if (hitOverall != null) return Math.round(hitOverall);
  return null;
}
function peakActualWorthy(pt) {
  if (!pt) return null;
  const vals = [pt._worthy, pt._worthy_pitch].filter(v => v != null);
  if (!vals.length) return null;
  return vals.includes(1) ? 1 : 0;
}

// ── Fantasy-stat peak3 projections (prospects only) ─────────────────────────────────
// Generic scorer for fantasy-peak-regression.json's {predictors, models} shape. Mirrors
// build-fantasy-peak.py's extract()/fit_stat() exactly — same predictor kinds, same
// per-level weighted-z + age_diff + corr-weighted cross-level aggregation.
function fpExtract(kind, s, ...args) {
  if (kind === 'direct') {
    const v = s[args[0]];
    return (v !== null && v !== undefined && v !== '') ? parseFloat(v) : null;
  }
  if (kind === 'ratio') {
    const [field, den] = args;
    const d = s[den] || 0;
    return d > 0 ? (s[field] || 0) / d : null;
  }
  if (kind === 'sb_rate') {
    const h = s.h || 0, bb = s.bb || 0, hbp = s.hbp || 0;
    const doubles = s.doubles || 0, triples = s.triples || 0, hr = s.hr || 0;
    const opp = (h - doubles - triples - hr) + bb + hbp;
    return opp > 0 ? (s.sb || 0) / opp : null;
  }
  if (kind === 'iso') {
    const ab = s.ab || 0;
    if (ab <= 0) return null;
    return parseFloat(s.slg || 0) - (s.h || 0) / ab;
  }
  if (kind === 'xbh') {
    const d = s[args[0]] || 0;
    if (d <= 0) return null;
    return ((s.doubles || 0) + (s.triples || 0) + (s.hr || 0)) / d;
  }
  return null;
}

const FP_ADHOC_CACHE = {};
function fpAdhocNorm(pred, isPit) {
  const key = JSON.stringify(pred);
  if (FP_ADHOC_CACHE[key]) return FP_ADHOC_CACHE[key];
  const ttype = isPit ? 'pitching' : 'hitting';
  const buckets = {};
  for (const seasons of Object.values(history)) {
    for (const s of seasons) {
      if (!MILB_LEVELS.has(canonLevel(s.level, s.year)) || !VALID_YEARS.has(s.year) || !s.team) continue;
      if (s.type !== ttype) continue;
      const samp = isPit ? ipToFloat(s.ip) : (s.pa || 0);
      if (samp < (isPit ? 15 : 30)) continue;
      const v = fpExtract(pred[0], s, ...pred.slice(1));
      if (v == null) continue;
      const k = `${canonLevel(s.level, s.year)}|${s.year}`;
      (buckets[k] = buckets[k] || []).push([v, samp]);
    }
  }
  const norm = {};
  for (const [k, pairs] of Object.entries(buckets)) {
    if (pairs.length < 20) continue;
    const w = pairs.reduce((a,p) => a+p[1], 0);
    const mean = pairs.reduce((a,p) => a+p[0]*p[1], 0) / w;
    const varr = pairs.reduce((a,p) => a+p[1]*(p[0]-mean)**2, 0) / w;
    norm[k] = { mean, stdev: Math.max(Math.sqrt(varr), 1e-9) };
  }
  FP_ADHOC_CACHE[key] = norm;
  return norm;
}
function fpNorm(pred, level, year) {
  const [kind, a1, a2] = pred;
  if (kind === 'direct' && ['obp','slg','ops'].includes(a1)) return norms[`${level}|${year}`]?.hitters?.[a1];
  if (kind === 'direct' && ['era','whip','baa'].includes(a1)) return norms[`${level}|${year}`]?.pitchers?.[a1];
  if (kind === 'ratio' && a1 === 'so' && a2 === 'bf') return norms[`${level}|${year}`]?.pitchers?.k_pct;
  if (kind === 'ratio' && a1 === 'bb' && a2 === 'bf') return norms[`${level}|${year}`]?.pitchers?.bb_pct;
  if (kind === 'ratio' && a1 === 'so' && a2 === 'pa') return norms[`${level}|${year}`]?.hitters?.k_pct;
  if (kind === 'ratio' && a1 === 'bb' && a2 === 'pa') return norms[`${level}|${year}`]?.hitters?.bb_pct;
  if (kind === 'iso') return norms[`${level}|${year}`]?.hitters?.iso;
  if (kind === 'xbh' && a1 === 'pa') return norms[`${level}|${year}`]?.hitters?.xbh_rate;
  const isPit = kind === 'kbb' || (kind === 'ratio' && a2 === 'bf');
  return fpAdhocNorm(pred, isPit)[`${level}|${year}`];
}

function scoreFantasyStatDirect(mlbamId, player, statCfg) {
  const isPit = statCfg.is_pitcher;
  const expectedType = isPit ? 'pitching' : 'hitting';
  const seasons = (history[String(mlbamId)] || [])
    .filter(s => MILB_LEVELS.has(canonLevel(s.level, s.year)) && VALID_YEARS.has(s.year) && s.team && s.type === expectedType);
  const acc = {};
  for (const s of seasons) {
    const level = canonLevel(s.level, s.year);
    const samp = isPit ? ipToFloat(s.ip) : (s.pa || 0);
    if (samp < (isPit ? 15 : 30)) continue;
    const zs = [];
    let ok = true;
    for (const pred of statCfg.predictors) {
      const n = fpNorm(pred, level, s.year);
      if (!n || !n.stdev) { ok = false; break; }
      const v = fpExtract(pred[0], s, ...pred.slice(1));
      if (v == null) { ok = false; break; }
      zs.push((v - n.mean) / n.stdev);
    }
    if (!ok) continue;
    const age = getAge(player.birthDate, s.year) ?? AVG_AGES[level];
    const ageDiff = AVG_AGES[level] - age;
    if (!acc[level]) acc[level] = { z: statCfg.predictors.map(() => 0), w: 0, age: 0 };
    const a = acc[level];
    zs.forEach((z, i) => a.z[i] += z*samp);
    a.w += samp; a.age += ageDiff*samp;
  }
  let wsumAll = 0, wtotAll = 0;
  for (const [level, a] of Object.entries(acc)) {
    if (a.w <= 0) continue;
    const model = statCfg.models[level];
    if (!model) continue;
    const ageAvg = a.age/a.w;
    const x = a.z.map(z => z/a.w).concat([ageAvg, ageAvg**2, 1]);
    const pred = model.coef.reduce((sum, c, i) => sum + c*x[i], 0);
    const weight = model.corr * a.w;
    wsumAll += pred*weight; wtotAll += weight;
  }
  return wtotAll > 0 ? wsumAll/wtotAll : null;
}

function scoreFantasyStat(mlbamId, player, statCfg, normedPeak) {
  if (statCfg.method === 'tool_cal') {
    if (!statCfg.coef || !normedPeak) return null;
    const x = statCfg.tools.map(t => normedPeak[t]);
    if (x.some(v => v == null)) return null;
    return statCfg.coef.reduce((sum, c, i) => sum + c*(i < x.length ? x[i] : 1), 0);
  }
  if (statCfg.method === 'hybrid') {
    if (!statCfg.blend_coef || !normedPeak) return null;
    const directPred = scoreFantasyStatDirect(mlbamId, player, statCfg);
    if (directPred == null) return null;
    const toolVals = statCfg.tools.map(t => normedPeak[t]);
    if (toolVals.some(v => v == null)) return null;
    const x = [directPred, ...toolVals];
    return statCfg.blend_coef.reduce((sum, c, i) => sum + c*(i < x.length ? x[i] : 1), 0);
  }
  return scoreFantasyStatDirect(mlbamId, player, statCfg);
}

const FANTASY_HIT_STATS = ['avg','obp','slg','ops','hr_rate','3b_rate','rbi_rate','r_rate','2b_rate','k_pct_hit','bb_pct_hit','iso','xbh_pct','sb_rate'];
const FANTASY_PIT_STATS = ['whip','baa','era','k_bb_pct','k_pct_pit','bb_pct_pit','hr_rate_pit'];
// Beyond the physical zero floor: a handful of fringe-pool prospects still extrapolate to
// below-replacement-level lines (e.g. .063 AVG) that no tracked prospect would actually
// project to. Rare (~1-7 players per stat out of ~3500) but obviously wrong when it hits —
// floor at "worst regular," not "impossible."
const FANTASY_FLOORS = { avg: 0.150, obp: 0.200, ops: 0.400 };

// slg/ops are 'derived' (composed from other already-computed stats, not their own fit —
// see build-fantasy-peak.py's DERIVED_CONFIG). Resolved as a post-step so component order
// in FANTASY_HIT_STATS doesn't matter; DERIVED_ORDER matters here since OPS composes SLG.
const DERIVED_ORDER = ['slg', 'ops'];

function computeFantasyPeak3(mlbamId, player, hasBat, hasArm, normedPeak) {
  if (!fantasyPeakRegression) return null;
  const out = {};
  if (hasBat) for (const stat of FANTASY_HIT_STATS) {
    const cfg = fantasyPeakRegression[stat];
    if (!cfg || cfg.method === 'derived') continue;
    const v = scoreFantasyStat(mlbamId, player, cfg, normedPeak);
    // None of these 21 stats can be physically negative — clamp linear-extrapolation
    // artifacts (mainly from tool_cal/hybrid on fringe-pool prospects) rather than show a
    // negative AVG/HR-rate/ISO in the drawer. A few stats also get a "worst regular"
    // floor above zero — see FANTASY_FLOORS.
    if (v != null) out[stat] = Math.max(FANTASY_FLOORS[stat] ?? 0, v);
  }
  if (hasArm) for (const stat of FANTASY_PIT_STATS) {
    const cfg = fantasyPeakRegression[stat];
    if (!cfg || cfg.method === 'derived') continue;
    const v = scoreFantasyStat(mlbamId, player, cfg, normedPeak);
    if (v != null) out[stat] = Math.max(FANTASY_FLOORS[stat] ?? 0, v);
  }
  if (hasBat) for (const stat of DERIVED_ORDER) {
    const cfg = fantasyPeakRegression[stat];
    if (!cfg || cfg.method !== 'derived') continue;
    let total = 0, ok = true;
    for (const [comp, sign] of cfg.formula) {
      if (out[comp] == null) { ok = false; break; }
      total += sign * out[comp];
    }
    if (ok) out[stat] = Math.max(FANTASY_FLOORS[stat] ?? 0, total);
  }
  return Object.keys(out).length ? out : null;
}

async function run() {
  console.log('Scoring prospects...');
  const updatedPlayers = { ...players };
  let scored = 0, notRookie = 0, noData = 0;

  const rawPool = {};

  for (const [id, player] of Object.entries(updatedPlayers)) {
    delete updatedPlayers[id].model_scores;
    delete updatedPlayers[id].career_blend;

    const mlbamId = player.mlbam_id;
    if (!mlbamId) continue;

    const { hasArm, hasBat, isTwoWay } = isTwoWayPositions(player.positions);

    // For two-way: score both sides regardless of rookie eligibility on each side
    // For pure players: original logic unchanged
    const sidesEligible = [];
    if (isTwoWay) {
      // Score both sides; eligibility checked per side but we always attempt both
      const pitchElig = isRookieEligible(mlbamId, true);
      const hitElig   = isRookieEligible(mlbamId, false);
      if (pitchElig) sidesEligible.push({ isPitcher: true,  exposed: true });
      else           sidesEligible.push({ isPitcher: true,  exposed: true, graduated: true });
      if (hitElig)   sidesEligible.push({ isPitcher: false, exposed: true });
      else           sidesEligible.push({ isPitcher: false, exposed: true, graduated: true });
    } else {
      const isPitcher = hasArm;
      const elig = isRookieEligible(mlbamId, isPitcher);
      if (!elig) notRookie++;
      // Score everyone — rookie eligibility only gates pool membership + riser hot sheet.
      sidesEligible.push({ isPitcher, exposed: true, graduated: !elig });
    }

    const recentSeasons = (history[String(mlbamId)] || [])
      .filter(s => MILB_LEVELS.has(canonLevel(s.level, s.year)) && s.year >= CURRENT_YEAR - 3 && s.team);
    if (!recentSeasons.length) { noData++; continue; }

    const toolScores  = {};
    const toolWeights = {};
    const peakToolScores = {};
    let pitchSample = 0, hitSample = 0, hasAny = false;

    for (const { isPitcher } of sidesEligible) {
      const toolList = isPitcher ? ['stuff','control'] : ['hit','power','speed'];
      for (const tool of toolList) {
        const { score, wSum, wTot, cySum, cyTot, sample } = scoreTool(mlbamId, player, tool, isPitcher);
        toolScores[tool]  = score;
        toolWeights[tool] = { wSum, wTot, cySum, cyTot };
        if (isPitcher) pitchSample = Math.max(pitchSample, sample);
        else           hitSample   = Math.max(hitSample, sample);
        if (score != null) hasAny = true;

        if (peakRegression) peakToolScores[tool] = scoreToolPeak(mlbamId, player, tool, isPitcher).score;
      }
    }


    const isPitcher = hasArm && !hasBat; // pure pitcher flag for pool/shrinkage
    // graduated = no side is rookie-eligible (used to exclude from prospect pool + risers)
    const graduated = sidesEligible.length > 0 && sidesEligible.every(s => s.graduated);
    rawPool[id] = {
      toolScores, toolWeights, peakToolScores,
      totalSample: Math.max(pitchSample, hitSample),
      pitchSample, hitSample,
      isPitcher, isTwoWay, hasArm, hasBat,
      graduated,
      hasCY: false, cySample: 0
    };
  }

  const toolVals = {};
  for (const tool of ['hit','power','speed','stuff','control']) {
    const vals = Object.values(rawPool)
      .filter(r => !r.graduated)
      .map(r => r.toolScores[tool]).filter(v => v != null && isFinite(v));
    if (!vals.length) continue;
    const mean  = vals.reduce((a,b) => a+b, 0) / vals.length;
    const stdev = Math.sqrt(vals.reduce((a,b) => a+(b-mean)**2, 0) / vals.length) || 1;
    toolVals[tool] = { mean, stdev };
  }
  fs.writeFileSync(path.join(BASE, 'model/pool-stats.json'), JSON.stringify(toolVals, null, 2));
  console.log('Pool stats written:', Object.keys(toolVals).map(t => `${t}:${toolVals[t].mean.toFixed(2)}±${toolVals[t].stdev.toFixed(2)}`).join(', '));

  for (const [id, { toolScores, toolWeights, peakToolScores, totalSample, pitchSample, hitSample, isPitcher, isTwoWay, hasArm, hasBat, graduated }] of Object.entries(rawPool)) {

    const normedTools = {};
    for (const [tool, raw] of Object.entries(toolScores)) {
      if (raw == null || !toolVals[tool]) { normedTools[tool] = null; continue; }
      const { mean, stdev } = toolVals[tool];
      normedTools[tool] = POOL_CENTER + ((raw - mean) / stdev) * POOL_STDEV;
    }

    // Compute per-side overall
    function sideOverall(wts, sampleForShrink, sideIsPitcher) {
      let wsum = 0, wtot = 0;
      for (const [tool, w] of Object.entries(wts)) {
        if (normedTools[tool] != null) { wsum += normedTools[tool] * w; wtot += w; }
      }
      const normed = wtot > 0 ? wsum / wtot : null;
      return shrink(normed, sampleForShrink, sideIsPitcher);
    }

    let pitchOverall = null, hitOverall = null;
    if (hasArm) pitchOverall = sideOverall(COMPOSITE_WEIGHTS.pitcher, pitchSample || totalSample, true);
    if (hasBat)  hitOverall  = sideOverall(COMPOSITE_WEIGHTS.hitter,  hitSample  || totalSample, false);

    // Blended overall: sample-weighted across position-eligible sides
    let blendedOverall = null;
    if (isTwoWay) {
      const parts = [pitchOverall, hitOverall].filter(v => v != null);
      blendedOverall = parts.length ? parts.reduce((a,b) => a+b, 0) / parts.length : null;
    } else {
      blendedOverall = hasArm ? pitchOverall : hitOverall;
    }

    const shrunkTools = {};
    const rawTools    = {};
    const confTools   = {};
    for (const [tool, normed] of Object.entries(normedTools)) {
      if (normed == null) { shrunkTools[tool] = null; rawTools[tool] = null; confTools[tool] = null; continue; }
      const toolIsPitcher = ['stuff','control'].includes(tool);
      const sampleForTool = toolIsPitcher ? (pitchSample || totalSample) : (hitSample || totalSample);
      const toolDef = TOOL_STATS[tool];
      const statKs = toolDef ? toolDef.stats.map(s => statShrinkK(s, toolIsPitcher)) : [toolIsPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter];
      const avgK = statKs.reduce((a,b) => a+b, 0) / statKs.length;
      const conf = sampleForTool / (sampleForTool + avgK);
      shrunkTools[tool] = Math.round(shrink(normed, sampleForTool, toolIsPitcher));
      rawTools[tool]    = Math.round(normed);
      confTools[tool]   = Math.round(conf * 100);
    }

    updatedPlayers[id].model_scores = {
      ...shrunkTools,
      ...(hasArm ? { pitch_overall: pitchOverall != null ? Math.round(pitchOverall) : null } : {}),
      ...(hasBat  ? { hit_overall:  hitOverall   != null ? Math.round(hitOverall)   : null } : {}),
      overall: blendedOverall != null ? Math.round(blendedOverall) : null,
      _raw:        rawTools,
      _confidence: confTools,
      _sample:     Math.round(totalSample),
    };
    // Career IP/G across all pitching seasons (used for starter-vs-RP workhorse factor).
    // null for pure hitters — blendCareer ignores it for non-pitchers.
    let careerIPG = null;
    if (hasArm) {
      const allPit = (history[String(updatedPlayers[id].mlbam_id)] || [])
        .filter(s => s.type === 'pitching');
      let totalIP = 0, totalG = 0;
      for (const s of allPit) { totalIP += ipToFloat(s.ip); totalG += s.g || 0; }
      if (totalG > 0) careerIPG = totalIP / totalG;
    }
    // ── Peak3 (best rolling 3-yr MLB window) + worthy-career probability ──────────────
    // Additive only — never read by dynasty_score/model-rank/blend-rank. Prefer the
    // realized peak-tools.json value for graduated players, fall back to the MiLB
    // projection (peak-regression.json) otherwise. worthy_pct is a projected probability
    // (prospects only, from the calibration fit); graduated+debut-gated players get the
    // realized worthy_actual fact instead — no point projecting an outcome already known.
    //
    // Normed against toolVals (the CAREER pool), not a separate peak pool. Peak-regression's
    // raw scores run hot across the whole population (best-3yr always >= career-avg), so a
    // peak-specific pool baseline would itself run hot — normalizing against it cancels that
    // signal back out and can invert the intuitive relationship (peak3 < overall for a player
    // whose peak raw stats are strictly better on every tool). Sharing the career pool keeps
    // peak3 on the same scale as overall, so "better raw peak on every tool" reliably means
    // "higher peak3."
    let peak3 = null, worthyPct = null, worthyActual = null, fantasyPeak3 = null;
    if (peakRegression) {
      const normedPeak = {};
      for (const [tool, raw] of Object.entries(peakToolScores)) {
        if (raw == null || !toolVals[tool]) { normedPeak[tool] = null; continue; }
        const { mean, stdev } = toolVals[tool];
        normedPeak[tool] = POOL_CENTER + ((raw - mean) / stdev) * POOL_STDEV;
      }
      function peakSideOverall(wts, sampleForShrink, sideIsPitcher) {
        let wsum = 0, wtot = 0;
        for (const [tool, w] of Object.entries(wts)) {
          if (normedPeak[tool] != null) { wsum += normedPeak[tool] * w; wtot += w; }
        }
        const normed = wtot > 0 ? wsum / wtot : null;
        return shrink(normed, sampleForShrink, sideIsPitcher);
      }
      let peakPitch = null, peakHit = null;
      if (hasArm) peakPitch = peakSideOverall(COMPOSITE_WEIGHTS.pitcher, pitchSample || totalSample, true);
      if (hasBat) peakHit   = peakSideOverall(COMPOSITE_WEIGHTS.hitter,  hitSample  || totalSample, false);
      // Starter/workhorse factor — same one career overall gets (careerIPG computed just
      // above) — applied to the pitch side before blending, so a reliever's peak3 doesn't
      // read far above their career overall the way an unadjusted grade would.
      const peakPitchAdj = peakPitch != null ? peakPitch * starterFactor(careerIPG) : null;
      let peakProjected = null;
      if (isTwoWay) {
        const parts = [peakPitchAdj, peakHit].filter(v => v != null);
        peakProjected = parts.length ? parts.reduce((a,b) => a+b, 0) / parts.length : null;
      } else {
        peakProjected = hasArm ? peakPitchAdj : peakHit;
      }

      const pt = peakTools[String(updatedPlayers[id].mlbam_id)];
      if (graduated) {
        const { pitchOverall, hitOverall } = peakActualComposite(pt);
        peak3 = peakComposite(pitchOverall, hitOverall, careerIPG);
      }
      if (peak3 == null) peak3 = peakProjected != null ? Math.round(peakProjected) : null;

      if (graduated) {
        worthyActual = peakActualWorthy(pt);
      } else if (worthyCalib && !isTwoWay) {
        const w = isPitcher ? COMPOSITE_WEIGHTS.pitcher : COMPOSITE_WEIGHTS.hitter;
        let num = 0, den = 0;
        for (const [tool, wt] of Object.entries(w)) {
          const v = toolScores[tool];
          if (v == null) continue;
          num += v * wt; den += wt;
        }
        const rawPredicted = den > 0 ? num / den : null;
        if (rawPredicted != null) {
          if (isPitcher && worthyCalib.pitcher) {
            const logit = worthyCalib.pitcher.intercept + worthyCalib.pitcher.coef_overall * rawPredicted;
            worthyPct = Math.round(sigmoid(logit) * 100);
          } else if (!isPitcher && worthyCalib.hitter) {
            const xbhZ = xbhRateZAaa(updatedPlayers[id].mlbam_id);
            const logit = worthyCalib.hitter.intercept + worthyCalib.hitter.coef_overall * rawPredicted + worthyCalib.hitter.coef_xbh_aaa * xbhZ;
            worthyPct = Math.round(sigmoid(logit) * 100);
          }
        }
      }

      // Fantasy-stat peak3 projections — prospects only (per the graduated flag already
      // computed above). Graduated players have real stats; a projection would be noise.
      // normedPeak (pool-normed peak tool grades, same scale as peak3 itself) is passed
      // through for the tool_cal stats — see scoreFantasyStat.
      fantasyPeak3 = !graduated
        ? computeFantasyPeak3(updatedPlayers[id].mlbam_id, updatedPlayers[id], hasBat, hasArm, normedPeak)
        : null;
    }

    // Canonical career-grade blend — single source of truth for row + drawer tile + model-rank.
    updatedPlayers[id].career_blend = {
      ...blendCareer(
        updatedPlayers[id].model_scores,
        mlbTools[String(updatedPlayers[id].mlbam_id)] ?? null,
        { ipg: careerIPG }
      ),
      ...(peak3 != null ? { peak3 } : {}),
      ...(worthyPct != null ? { worthy_pct: worthyPct } : {}),
      ...(worthyActual != null ? { worthy_actual: worthyActual } : {}),
      ...(fantasyPeak3 != null ? { fantasy_peak3: fantasyPeak3 } : {}),
    };
    scored++;

    {
      let wsumEx = 0, wtotEx = 0, allToolsNoHistory = true, hasCY = false, cySample = 0;
      const weights = isPitcher ? COMPOSITE_WEIGHTS.pitcher : COMPOSITE_WEIGHTS.hitter;
      for (const [tool, w] of Object.entries(weights)) {
        const tw = toolWeights[tool];
        if (!tw || !toolVals[tool]) continue;
        if (tw.cyTot > 0) { hasCY = true; cySample = Math.max(cySample, tw.cyTot); }
        const { mean, stdev } = toolVals[tool];
        const wTotEx = tw.wTot - tw.cyTot;
        const wSumEx = tw.wSum - tw.cySum;
        if (wTotEx > 0) {
          allToolsNoHistory = false;
          const normedEx = POOL_CENTER + ((wSumEx / wTotEx) - mean) / stdev * POOL_STDEV;
          wsumEx += normedEx * w;
          wtotEx += w;
        } else {
          wsumEx += POOL_CENTER * w;
          wtotEx += w;
        }
      }
      const exCYOverallRaw = (wtotEx > 0 && !allToolsNoHistory) ? wsumEx / wtotEx : null;
      const exCYOverall    = exCYOverallRaw != null
        ? Math.round(shrink(exCYOverallRaw, totalSample, isPitcher))
        : (hasCY ? SHRINK_TOWARD : null);
      rawPool[id].hasCY             = hasCY;
      rawPool[id].cySample          = cySample;
      rawPool[id].exCYOverall       = exCYOverall;
      rawPool[id].allToolsNoHistory = allToolsNoHistory;
    }
  }

  // Post-pass: backfill career_blend for any player without model_scores who still has
  // an MLB tools entry (typical MLB veteran with no recent MiLB to score).
  for (const [id, player] of Object.entries(updatedPlayers)) {
    if (player.career_blend != null) continue;
    const mlbEntry = player.mlbam_id ? mlbTools[String(player.mlbam_id)] : null;
    if (!mlbEntry) continue;
    let careerIPG = null;
    if (mlbEntry.type === 'pitcher' || mlbEntry.type === 'two-way') {
      const allPit = (history[String(player.mlbam_id)] || []).filter(s => s.type === 'pitching');
      let totalIP = 0, totalG = 0;
      for (const s of allPit) { totalIP += ipToFloat(s.ip); totalG += s.g || 0; }
      if (totalG > 0) careerIPG = totalIP / totalG;
    }
    const pt = player.mlbam_id ? peakTools[String(player.mlbam_id)] : null;
    const { pitchOverall, hitOverall } = peakActualComposite(pt);
    const peak3 = peakComposite(pitchOverall, hitOverall, careerIPG);
    const worthyActual = peakActualWorthy(pt);
    updatedPlayers[id].career_blend = {
      ...blendCareer(null, mlbEntry, { ipg: careerIPG }),
      ...(peak3 != null ? { peak3 } : {}),
      ...(worthyActual != null ? { worthy_actual: worthyActual } : {}),
    };
  }

  const MIN_OVERALL = 95, MIN_RISER_DELTA = 1;
  const risers = [];

  for (const [id, pool] of Object.entries(rawPool)) {
    if (pool.graduated) continue;
    const player = updatedPlayers[id];
    const ms = player.model_scores;
    if (!ms?.overall || ms.overall < MIN_OVERALL) continue;
    if (!pool.hasCY || pool.exCYOverall == null) continue;
    const delta = ms.overall - pool.exCYOverall;
    if (delta < MIN_RISER_DELTA) continue;
    // compute IP/GS from current year MiLB starts
    const cyRows = (history[String(player.mlbam_id)] || [])
      .filter(s => s.year === CURRENT_YEAR && MILB_LEVELS.has(s.level) && s.type === 'pitching');
    const cyIP = cyRows.reduce((sum, s) => sum + ipToFloat(s.ip), 0);
    const cyG = cyRows.reduce((sum, s) => sum + (s.gamesPlayed || s.g || 0), 0);
    const ipPerGs = cyG > 0 ? cyIP / cyG : null;
    risers.push({
      id, name: player.name, rank: player.rank, positions: player.positions,
      isPit: pool.hasArm, isTwoWay: pool.isTwoWay || false, overall: ms.overall,
      sample: ms._sample, confidence: ms._confidence,
      delta, prevOverall: pool.exCYOverall, ipPerGs,
    });
  }

  risers.sort((a, b) => b.delta - a.delta || b.overall - a.overall);
  // Keep full riser pool — windowed slicing happens after delta fetch
  const allBatRisers = risers.filter(r => !r.isPit);
  const allArmRisers = risers.filter(r => r.isPit && (r.ipPerGs ?? 0) >= 3.0);


  // ── Windowed deltas via CY game logs ──────────────────────────────────────
  const regression2  = JSON.parse(fs.readFileSync(REGR_PATH, 'utf8'));
  const poolStats2   = JSON.parse(fs.readFileSync(path.join(BASE, 'model/pool-stats.json'), 'utf8'));

  const WINDOWS = [7, 15, 30, 60, 90]; // days back from today
  const TODAY = new Date();
  TODAY.setHours(23,59,59,999);

  const normLevelBS = canonLevel;

  function ipOutsFromStr(ipStr) {
    const parts = String(ipStr || '0').split('.');
    return (parseInt(parts[0] || '0') * 3) + parseInt(parts[1] || '0');
  }

  function scoreWindowedOverall(preCumBuckets, windowGames, isPit, birthDate, regressionData, normsData, poolStatsData) {
    const models = regressionData.models;
    const toolNames = isPit ? ['stuff','control'] : ['hit','power','speed'];
    const COMPOSITE = isPit ? { stuff:0.70, control:0.30 } : { hit:0.42, power:0.47, speed:0.11 };
    const SHRINK_K2 = isPit ? 80 : 200;
    const POOL_CENTER2 = 95, POOL_STDEV2 = 15, SHRINK_TOWARD2 = 88;
    const ARC_K2 = { k_pct:60, bb_pct:120, iso:120, sb_rate:60, k_pct_pit:20, bb_pct_pit:40 };

    function getAge2(year) {
      if (!birthDate) return AVG_AGES['AA'];
      try {
        const d = new Date(birthDate);
        let age = year - d.getFullYear();
        if (d.getMonth() > 6 || (d.getMonth() === 6 && d.getDate() > 1)) age--;
        return age;
      } catch { return AVG_AGES['AA']; }
    }

    // Build working cumulative state: clone preCum + add window games
    const cum = {};
    for (const [k, v] of Object.entries(preCumBuckets)) cum[k] = { ...v };

    for (const g of windowGames) {
      const lvl = normLevelBS(g.level || '', g.year);
      if (!MILB_LEVELS.has(lvl)) continue;
      const sKey = `${g.year}|${lvl}`;
      if (!cum[sKey]) cum[sKey] = { ab:0, bb:0, hbp:0, so:0, h:0, xbh:0, sb:0, tb:0, bf:0, ipOuts:0, year:g.year, lvl };
      const sc = cum[sKey];
      sc.ab  += g.atBats      || 0;
      sc.bb  += g.baseOnBalls || 0;
      sc.hbp += g.hitByPitch  || 0;
      sc.so  += g.strikeOuts  || 0;
      sc.h   += g.hits        || 0;
      sc.xbh += (g.doubles || 0) + (g.triples || 0) + (g.homeRuns || 0);
      sc.sb  += g.stolenBases || 0;
      sc.tb  += g.totalBases  || 0;
      sc.bf  += g.battersFaced|| 0;
      sc.ipOuts += ipOutsFromStr(g.inningsPitched);
    }

    // Canonical scoreTool2 — delegates to shared lib.
    // Buckets in `cum` use `lvl` (local convention); the shared lib reads `level`.
    const scoreTool2 = (toolName) => {
      const buckets = Object.values(cum).map(b => ({ ...b, level: b.lvl }));
      const { score } = scoreMilbTool(buckets, toolName, {
        models, norms: normsData, poolStats: poolStatsData,
        isPit, referenceYear: new Date().getFullYear(),
        getAge: getAge2,
      });
      return score;
    };

    const toolScores = {};
    for (const t of toolNames) toolScores[t] = scoreTool2(t);
    let overall = null;
    if (isPit && toolScores.stuff!=null && toolScores.control!=null)
      overall = Math.round(toolScores.stuff*0.70 + toolScores.control*0.30);
    else if (!isPit && toolScores.hit!=null && toolScores.power!=null && toolScores.speed!=null)
      overall = Math.round(toolScores.hit*0.42 + toolScores.power*0.47 + toolScores.speed*0.11);
    return overall;
  }

  async function fetchCYGameLogs(mlbamId, isPit) {
    const group = isPit ? 'pitching' : 'hitting';
    const year = new Date().getFullYear();
    const base = `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&season=${year}&group=${group}&gameType=R`;
    const dedup = (splits) => {
      const seen = new Set();
      return splits.filter(s => {
        // Dedup on gamePk (unique per game) so doubleheaders stay distinct while the same
        // game from the MLB + MiLB fetches collapses. date|opponent wrongly merged twin bills.
        const key = String(s.game?.gamePk ?? ((s.date||'')+'|'+(s.opponent?.abbreviation||s.opponent?.id||'')));
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    };
    const flattenLog = (data) => data?.stats?.[0]?.splits ?? [];
    try {
      const [mlbRes, milbRes] = await Promise.all([
        fetch(base).then(r=>r.ok?r.json():{}).catch(()=>({})),
        fetch(base+'&leagueListId=milb_all').then(r=>r.ok?r.json():{}).catch(()=>({})),
      ]);
      return dedup([...flattenLog(mlbRes), ...flattenLog(milbRes)]).map(s => ({
        date: s.date?.slice(0,10),
        year,
        // DSL returns the generic "ROK" abbreviation; pin via league name so normLevelBS
        // doesn't map it to Complex (wrong norms/slopes).
        level: /Dominican Summer/i.test(s.league?.name ?? '')
          ? 'DSL'
          : (s.sport?.abbreviation ?? s.team?.sport?.abbreviation ?? null),
        ...s.stat,
      })).filter(g => g.date).sort((a,b)=>a.date.localeCompare(b.date));
    } catch { return []; }
  }

  async function attachWindowedDeltas(risers) {
    console.log(`Fetching CY game logs for ${risers.length} hot sheet players...`);
    await Promise.all(risers.map(async (riser) => {
      const player = updatedPlayers[riser.id];
      const mlbamId = player?.mlbam_id;
      if (!mlbamId) { riser.deltas = { season: riser.delta }; return; }
      const isPit = riser.isPit && !riser.isTwoWay ? true : riser.isPit;

      // Build pre-CY seasonCum from history (all years < CURRENT_YEAR)
      const preCum = {};
      const playerHistory = (history[String(mlbamId)] || [])
        .filter(s => MILB_LEVELS.has(s.level) && s.year < CURRENT_YEAR && s.team)
        .filter(s => s.type === (isPit ? 'pitching' : 'hitting'));

      for (const s of playerHistory) {
        const sKey = `${s.year}|${s.level}`;
        if (!preCum[sKey]) preCum[sKey] = { ab:0, bb:0, hbp:0, so:0, h:0, xbh:0, sb:0, tb:0, bf:0, ipOuts:0, year:s.year, lvl:s.level };
        const sc = preCum[sKey];
        sc.ab  += s.ab  || 0;
        sc.bb  += s.bb  || 0;
        sc.hbp += s.hbp || 0;
        sc.so  += s.so  || 0;
        sc.h   += s.h   || 0;
        sc.xbh += (s.doubles || 0) + (s.triples || 0) + (s.hr || 0);
        sc.sb  += s.sb  || 0;
        sc.tb  += (s.tb || ((parseFloat(s.slg||'0')||0) * (s.ab||0))) || 0;
        sc.bf  += s.bf  || 0;
        sc.ipOuts += ipOutsFromStr(s.ip);
      }

      const allCYGames = await fetchCYGameLogs(mlbamId, isPit);
      if (!allCYGames.length) { riser.deltas = { season: riser.delta }; return; }

      const cutoff = (days) => {
        const d = new Date(TODAY);
        d.setDate(d.getDate() - days);
        d.setHours(0,0,0,0);
        return d;
      };

      // "Current" snapshot via the SAME windowed pipeline used for the cutoff snapshots
      // below (preCum + all CY games) -- NOT riser.overall, which comes from the main
      // scoring pipeline (scoreMilbToolRaw + pool-norm + shrink()) and isn't on the same
      // scale as scoreWindowedOverall's output. Diffing across two different pipelines
      // produced non-monotonic deltas (e.g. a player's "d30" snapshot scoring higher than
      // their "d15" snapshot). Keeping both ends of every diff on one pipeline fixes that.
      const currentViaWindowed = scoreWindowedOverall(preCum, allCYGames, isPit, player.birthDate, regression2, norms, poolStats2);

      const deltas = { season: riser.delta };
      for (const days of WINDOWS) {
        const since = cutoff(days);
        const windowGames = allCYGames.filter(g => new Date(g.date) >= since);
        if (!windowGames.length) { deltas[`d${days}`] = null; continue; }
        const gamesBeforeCutoff = allCYGames.filter(g => new Date(g.date) < since);
        const asOfCutoffOverall = scoreWindowedOverall(preCum, gamesBeforeCutoff, isPit, player.birthDate, regression2, norms, poolStats2);
        deltas[`d${days}`] = (currentViaWindowed != null && asOfCutoffOverall != null) ? currentViaWindowed - asOfCutoffOverall : null;
      }
      riser.deltas = deltas;
    }));
  }

  const allRisers = [...allBatRisers, ...allArmRisers];
  await attachWindowedDeltas(allRisers);
  // ── End windowed deltas ────────────────────────────────────────────────────

  // Build 6 independent top-20 lists — one per window
  const WINDOW_KEYS = ['season', 'd90', 'd60', 'd30', 'd15', 'd7'];
  function top20(pool, winKey) {
    return pool
      .filter(r => r.deltas?.[winKey] != null && r.deltas[winKey] >= 1)
      .sort((a, b) => (b.deltas[winKey] - a.deltas[winKey]) || b.overall - a.overall)
      .slice(0, 50)
      .map(r => ({ ...r, delta: r.deltas[winKey] }));
  }
  const hotSheet = { generatedAt: new Date().toISOString() };
  for (const wk of WINDOW_KEYS) {
    hotSheet[wk] = {
      bats: top20(allBatRisers, wk),
      arms: top20(allArmRisers, wk),
    };
  }
  fs.writeFileSync(HOTSHEET_PATH, JSON.stringify(hotSheet, null, 2));
  const s = hotSheet.season;
  console.log(`Hot sheet written: ${s.bats.length} bats, ${s.arms.length} arms (season); pool: ${allBatRisers.length} bats, ${allArmRisers.length} arms`);

  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(updatedPlayers, null, 2));

  console.log(`\n--- RESULTS ---`);
  console.log(`  Scored:            ${scored}`);
  console.log(`  Not rookie elig:   ${notRookie}`);
  console.log(`  No MiLB data:      ${noData}`);
}

run();
