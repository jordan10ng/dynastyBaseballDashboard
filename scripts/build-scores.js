const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BASE          = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH  = path.join(BASE, 'players.json');
const HOTSHEET_PATH = path.join(BASE, 'model/hot-sheet.json');
const REGR_PATH     = path.join(BASE, 'model/regression.json');
const NORMS_PATH    = path.join(BASE, 'model/norms.json');
const ELAST_PATH    = path.join(BASE, 'model/age-elasticity.json');
const HISTORY_DIR   = path.join(BASE, 'history');

const regression  = JSON.parse(fs.readFileSync(REGR_PATH, 'utf8'));
const players     = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const norms       = JSON.parse(fs.readFileSync(NORMS_PATH, 'utf8'));
const elasticity  = JSON.parse(fs.readFileSync(ELAST_PATH, 'utf8'));

const VALID_YEARS   = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026]);
const CURRENT_YEAR  = new Date().getFullYear();

// Pool renorm: center=100 (average prospect = 100), stdev=15
// Shrink toward 88 (prior = below-average MLB)
const POOL_CENTER   = 100;
const POOL_STDEV    = 15;
const SHRINK_TOWARD = 88;
const AGE_CORR_SCALE = 0.2;

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
  'AAA': 26.5, 'AA': 24.5, 'High-A': 23.0, 'Single-A': 21.5,
  'Complex': 19.5, 'DSL': 17.5, 'Rookie': 20.0,
};
const MILB_LEVELS = new Set(Object.keys(AVG_AGES));

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
// Per-stat stabilization points
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
function getAgeZAdj(isPitcher, level, stat, ageDiff) {
  const group = isPitcher ? 'pitchers' : 'hitters';
  const corr = elasticity?.[group]?.[level]?.[stat]?.corr_age_residual ?? 0;
  return corr * ageDiff * AGE_CORR_SCALE;
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

function scoreTool(mlbamId, player, tool, isPitcher) {
  const { stats: statKeys } = TOOL_STATS[tool];
  const model = regression.models?.[tool];
  if (!model) return { score: null, wSum: 0, wTot: 0, cySum: 0, cyTot: 0, sample: 0 };

  const seasons = (history[String(mlbamId)] || [])
    .filter(s => MILB_LEVELS.has(s.level) && VALID_YEARS.has(s.year) && s.team);

  let wSum = 0, wTot = 0, totalSample = 0, cySum = 0, cyTot = 0;

  for (const s of seasons) {
    const { year, level } = s;
    const sample = isPitcher ? ipToFloat(s.ip) : (s.pa || 0);
    if (!sample) continue;

    const normEntry = getNorm(level, year);
    if (!normEntry) continue;
    const n = isPitcher ? normEntry.pitchers : normEntry.hitters;
    if (!n) continue;

    const age     = getAge(player.birthDate, year) ?? AVG_AGES[level];
    const ageDiff = AVG_AGES[level] - age;

    const raw = {};
    if (!isPitcher) {
      raw.k_pct   = (s.so || 0) / sample;
      raw.bb_pct  = (s.bb || 0) / sample;
      raw.iso     = (parseFloat(s.slg) || 0) - (parseFloat(s.avg) || 0);
      const tob   = (s.h || 0) + (s.bb || 0) + (s.hbp || 0);
      raw.sb_rate = tob > 0 ? (s.sb || 0) / tob : 0;
    } else {
      const bf  = s.bf || 0;
      raw.k_pct  = bf > 0 ? (s.so || 0) / bf : null;
      raw.bb_pct = bf > 0 ? (s.bb || 0) / bf : null;
    }

    const isCurrentYear = year === CURRENT_YEAR;

    for (const stat of statKeys) {
      const levelModel = model?.[level]?.[stat];
      if (!levelModel) continue;
      const v = raw[stat];
      if (v == null) continue;
      const sn = n[stat];
      if (!sn || sn.stdev === 0) continue;

      let z = (v - sn.mean) / sn.stdev;
      if ((!isPitcher && stat === 'k_pct') || (isPitcher && stat === 'bb_pct')) z = -z;

      // Age adjustment in z-space, speed exempt
      if (stat !== 'sb_rate') z += getAgeZAdj(isPitcher, level, stat, ageDiff);

      const pred         = levelModel.slope * z + levelModel.intercept;
      const recencyDecay = Math.pow(0.75, CURRENT_YEAR - year);
      const statConf     = sample / (sample + statShrinkK(stat, isPitcher));
      const weight       = levelModel.corr * statConf * recencyDecay;

      wSum += pred * weight;
      wTot += weight;
      if (isCurrentYear) { cySum += pred * weight; cyTot += weight; }
    }
    totalSample += sample;
  }

  if (wTot === 0) return { score: null, wSum: 0, wTot: 0, cySum: 0, cyTot: 0, sample: totalSample };
  return { score: wSum / wTot, wSum, wTot, cySum, cyTot, sample: totalSample };
}

function run() {
  console.log('Scoring prospects...');
  const updatedPlayers = { ...players };
  let scored = 0, notRookie = 0, noData = 0;

  const rawPool = {};

  for (const [id, player] of Object.entries(updatedPlayers)) {
    delete updatedPlayers[id].model_scores;

    const mlbamId = player.mlbam_id;
    if (!mlbamId) continue;

    const isPitcher = (player.positions || '').includes('P');
    if (!isRookieEligible(mlbamId, isPitcher)) { notRookie++; continue; }

    const recentSeasons = (history[String(mlbamId)] || [])
      .filter(s => MILB_LEVELS.has(s.level) && s.year >= CURRENT_YEAR - 3 && s.team);
    if (!recentSeasons.length) { noData++; continue; }

    const toolList = isPitcher ? ['stuff','control'] : ['hit','power','speed'];
    const toolScores  = {};
    const toolWeights = {};
    let totalSample = 0, hasAny = false;

    for (const tool of toolList) {
      const { score, wSum, wTot, cySum, cyTot, sample } = scoreTool(mlbamId, player, tool, isPitcher);
      toolScores[tool]  = score;
      toolWeights[tool] = { wSum, wTot, cySum, cyTot };
      totalSample = Math.max(totalSample, sample);
      if (score != null) hasAny = true;
    }

    if (!hasAny) { noData++; continue; }

    rawPool[id] = { toolScores, toolWeights, totalSample, isPitcher, hasCY: false, cySample: 0 };
  }

  // Pool renorm: center=100, stdev=15 — ranks prospects relative to each other
  const toolVals = {};
  for (const toolList of [['hit','power','speed'],['stuff','control']]) {
    for (const tool of toolList) {
      const vals = Object.values(rawPool)
        .map(r => r.toolScores[tool]).filter(v => v != null && isFinite(v));
      if (!vals.length) continue;
      const mean  = vals.reduce((a,b) => a+b, 0) / vals.length;
      const stdev = Math.sqrt(vals.reduce((a,b) => a+(b-mean)**2, 0) / vals.length) || 1;
      toolVals[tool] = { mean, stdev };
    }
  }

  for (const [id, { toolScores, toolWeights, totalSample, isPitcher }] of Object.entries(rawPool)) {

    const normedTools = {};
    for (const [tool, raw] of Object.entries(toolScores)) {
      if (raw == null || !toolVals[tool]) { normedTools[tool] = null; continue; }
      const { mean, stdev } = toolVals[tool];
      normedTools[tool] = POOL_CENTER + ((raw - mean) / stdev) * POOL_STDEV;
    }

    const weights = isPitcher ? COMPOSITE_WEIGHTS.pitcher : COMPOSITE_WEIGHTS.hitter;
    let wsum = 0, wtot = 0;
    for (const [tool, w] of Object.entries(weights)) {
      if (normedTools[tool] != null) { wsum += normedTools[tool] * w; wtot += w; }
    }
    const normedOverall = wtot > 0 ? wsum / wtot : null;
    const shrunkOverall = shrink(normedOverall, totalSample, isPitcher);

    const shrunkTools = {};
    const rawTools    = {};
    const confTools   = {};
    for (const [tool, normed] of Object.entries(normedTools)) {
      if (normed == null) { shrunkTools[tool] = null; rawTools[tool] = null; confTools[tool] = null; continue; }
      const k    = isPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter;
      const conf = totalSample / (totalSample + k);
      shrunkTools[tool] = Math.round(shrink(normed, totalSample, isPitcher));
      rawTools[tool]    = Math.round(normed);
      confTools[tool]   = Math.round(conf * 100);
    }

    updatedPlayers[id].model_scores = {
      ...shrunkTools,
      overall: shrunkOverall != null ? Math.round(shrunkOverall) : null,
      _raw:        rawTools,
      _confidence: confTools,
      _sample:     Math.round(totalSample),
    };
    scored++;

    // ex-CY delta for hot sheet
    {
      let wsumEx = 0, wtotEx = 0, allToolsNoHistory = true, hasCY = false, cySample = 0;
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
      const exCYOverall    = exCYOverallRaw != null ? Math.round(shrink(exCYOverallRaw, totalSample, isPitcher)) : null;
      rawPool[id].hasCY             = hasCY;
      rawPool[id].cySample          = cySample;
      rawPool[id].exCYOverall       = exCYOverall;
      rawPool[id].allToolsNoHistory = allToolsNoHistory;
    }
  }

  const MIN_OVERALL = 95, MIN_RISER_DELTA = 1;
  const risers = [];

  for (const [id, pool] of Object.entries(rawPool)) {
    const player = updatedPlayers[id];
    const ms = player.model_scores;
    if (!ms?.overall || ms.overall < MIN_OVERALL) continue;
    if (!pool.hasCY || pool.allToolsNoHistory || pool.exCYOverall == null) continue;
    const delta = ms.overall - pool.exCYOverall;
    if (delta < MIN_RISER_DELTA) continue;
    risers.push({
      id, name: player.name, rank: player.rank, positions: player.positions,
      isPit: pool.isPitcher, overall: ms.overall,
      sample: ms._sample, confidence: ms._confidence,
      delta, prevOverall: pool.exCYOverall,
    });
  }

  risers.sort((a, b) => b.delta - a.delta || b.overall - a.overall);
  const hotBats = risers.filter(r => !r.isPit).slice(0, 20);
  const hotArms = risers.filter(r =>  r.isPit).slice(0, 20);

  fs.writeFileSync(HOTSHEET_PATH, JSON.stringify({ bats: hotBats, arms: hotArms, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`Hot sheet written: ${hotBats.length} bats, ${hotArms.length} arms`);

  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(updatedPlayers, null, 2));

  console.log(`\n--- RESULTS ---`);
  console.log(`  Scored:            ${scored}`);
  console.log(`  Not rookie elig:   ${notRookie}`);
  console.log(`  No MiLB data:      ${noData}`);
}

run();
