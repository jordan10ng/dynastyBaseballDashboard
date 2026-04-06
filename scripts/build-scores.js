const fs   = require('fs');
const path = require('path');

const BASE         = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH = path.join(BASE, 'players.json');
const HOTSHEET_PATH = path.join(BASE, 'model/hot-sheet.json');
const REGR_PATH    = path.join(BASE, 'model/regression.json');
const NORMS_PATH   = path.join(BASE, 'model/norms.json');
const ELAST_PATH   = path.join(BASE, 'model/age-elasticity.json');
const HISTORY_DIR  = path.join(BASE, 'history');

const regression  = JSON.parse(fs.readFileSync(REGR_PATH, 'utf8'));
const players     = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const norms       = JSON.parse(fs.readFileSync(NORMS_PATH, 'utf8'));
// elasticity file no longer used — age handled via sample weighting

// ── Load history ──────────────────────────────────────────────────────────
const VALID_YEARS = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026]);
const CURRENT_YEAR = new Date().getFullYear();
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

// Tool definitions
const TOOL_STATS = {
  hit:     { type: 'hitter',  stats: ['k_pct','bb_pct'] },
  power:   { type: 'hitter',  stats: ['iso'] },
  speed:   { type: 'hitter',  stats: ['sb_rate'] },
  stuff:   { type: 'pitcher', stats: ['k_pct'] },
  control: { type: 'pitcher', stats: ['bb_pct'] },
};

// Composite weights derived from fantasy value correlation
const COMPOSITE_WEIGHTS = {
  hitter:  { hit: 0.42, power: 0.47, speed: 0.11 },
  pitcher: { stuff: 0.70, control: 0.30 },
};

// Shrinkage: sample at which confidence = 50%
const SHRINK_K = { hitter: 200, pitcher: 80 };

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

// Additive age bonus: points per year young-for-level, applied after prediction
// Speed (sb_rate) is exempt — age doesn't predict stolen base translation
const AGE_BONUS_C = { hitter: 3.0, pitcher: 2.0 };
const SPEED_STATS = new Set(['sb_rate']);

function getNorm(level, year) {
  for (let y = year; y >= year - 3; y--) {
    const entry = norms[`${level}|${y}`];
    if (entry) return entry;
  }
  return null;
}

// ── Rookie eligibility ────────────────────────────────────────────────────
function isRookieEligible(mlbamId, isPitcher) {
  const seasons = history[String(mlbamId)] || [];
  const mlb = seasons.filter(s => s.level === 'MLB');
  if (isPitcher) {
    const ip = mlb.reduce((sum, s) => sum + ipToFloat(s.ip), 0);
    return ip < 50;
  } else {
    const ab = mlb.reduce((sum, s) => sum + (s.ab || 0), 0);
    return ab < 130;
  }
}

// ── Score a single tool ───────────────────────────────────────────────────
// Returns score plus raw weighted sums needed for hot sheet:
// wSum/wTot = full career weighted sum/weight
// cySum/cyTot = current year only weighted sum/weight
function scoreTool(mlbamId, player, tool, isPitcher) {
  const { stats: statKeys } = TOOL_STATS[tool];
  const model = regression.models?.[tool];
  if (!model) return { score: null, wSum: 0, wTot: 0, cySum: 0, cyTot: 0, sample: 0 };

  const seasons = (history[String(mlbamId)] || [])
    .filter(s => MILB_LEVELS.has(s.level) && VALID_YEARS.has(s.year) && s.team);

  let wSum = 0.0, wTot = 0.0, totalSample = 0.0;
  let cySum = 0.0, cyTot = 0.0;
  let ageWSum = 0.0, ageWTot = 0.0; // for PA-weighted ageDiff

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
      const pa = sample;
      raw.k_pct   = (s.so || 0) / pa;
      raw.bb_pct  = (s.bb || 0) / pa;
      raw.iso     = (parseFloat(s.slg) || 0) - (parseFloat(s.avg) || 0);
      const tob   = (s.h || 0) + (s.bb || 0) + (s.hbp || 0);
      raw.sb_rate = tob > 0 ? (s.sb || 0) / tob : 0;
    } else {
      const bf    = s.bf || 0;
      raw.k_pct   = bf > 0 ? (s.so || 0) / bf : null;
      raw.bb_pct  = bf > 0 ? (s.bb || 0) / bf : null;
    }

    const isCurrentYear = year === CURRENT_YEAR;

    // Accumulate PA-weighted ageDiff for additive age bonus (speed tool exempt)
    if (!SPEED_STATS.has(statKeys[0])) {
      ageWSum += ageDiff * sample;
      ageWTot += sample;
    }

    for (const stat of statKeys) {
      const levelModel = model?.[level]?.[stat];
      if (!levelModel) continue;
      const v = raw[stat];
      if (v == null) continue;
      const sn = n[stat];
      if (!sn || sn.stdev === 0) continue;

      let z = (v - sn.mean) / sn.stdev;
      if ((!isPitcher && stat === 'k_pct') || (isPitcher && stat === 'bb_pct')) z = -z;

      const pred         = levelModel.slope * z + levelModel.intercept;
      const recencyDecay = Math.pow(0.75, CURRENT_YEAR - year);
      const weight       = levelModel.corr * sample * recencyDecay;

      wSum += pred * weight;
      wTot += weight;
      if (isCurrentYear) { cySum += pred * weight; cyTot += weight; }
    }
    totalSample += sample;
  }

  if (wTot === 0) return { score: null, wSum: 0, wTot: 0, cySum: 0, cyTot: 0, sample: totalSample, wtdAgeDiff: 0 };
  const wtdAgeDiff = ageWTot > 0 ? ageWSum / ageWTot : 0;
  return { score: wSum / wTot, wSum, wTot, cySum, cyTot, sample: totalSample, wtdAgeDiff };
}

// ── Apply shrinkage toward 100 ────────────────────────────────────────────
function shrink(score, sample, isPitcher) {
  if (score == null) return null;
  const k = isPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter;
  const confidence = sample / (sample + k);
  return 100 + (score - 100) * confidence;
}

// ── Main ──────────────────────────────────────────────────────────────────
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

    // Must have data within last 3 seasons
    const recentSeasons = (history[String(mlbamId)] || [])
      .filter(s => MILB_LEVELS.has(s.level) && s.year >= CURRENT_YEAR - 3 && s.team);
    if (!recentSeasons.length) { noData++; continue; }

    const toolList = isPitcher ? ['stuff','control'] : ['hit','power','speed'];
    const toolScores = {};
    const toolWeights = {}; // stores wSum/wTot/cySum/cyTot per tool for hot sheet
    let playerWtdAgeDiff = 0;
    let totalSample = 0;
    let hasAny = false;

    for (const tool of toolList) {
      const { score, wSum, wTot, cySum, cyTot, sample, wtdAgeDiff } = scoreTool(mlbamId, player, tool, isPitcher);
      toolScores[tool] = score;
      toolWeights[tool] = { wSum, wTot, cySum, cyTot };
      if (tool !== 'speed') playerWtdAgeDiff = wtdAgeDiff;
      totalSample = Math.max(totalSample, sample);
      if (score != null) hasAny = true;
    }

    if (!hasAny) { noData++; continue; }

    const weights = isPitcher ? COMPOSITE_WEIGHTS.pitcher : COMPOSITE_WEIGHTS.hitter;
    let wsum = 0, wtot = 0;
    for (const [tool, w] of Object.entries(weights)) {
      if (toolScores[tool] != null) { wsum += toolScores[tool] * w; wtot += w; }
    }
    const composite = wtot > 0 ? wsum / wtot : null;

    rawPool[id] = { toolScores, toolWeights, composite, totalSample, isPitcher, wtdAgeDiff: playerWtdAgeDiff };
  }

  // Normalize each tool across prospect pool
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

  for (const [id, { toolScores, composite, totalSample, isPitcher }] of Object.entries(rawPool)) {
    const normedTools = {};
    for (const [tool, raw] of Object.entries(toolScores)) {
      if (raw == null || !toolVals[tool]) { normedTools[tool] = null; continue; }
      const { mean, stdev } = toolVals[tool];
      normedTools[tool] = 100 + ((raw - mean) / stdev) * 15;
    }

    const weights = isPitcher ? COMPOSITE_WEIGHTS.pitcher : COMPOSITE_WEIGHTS.hitter;
    let wsum = 0, wtot = 0;
    for (const [tool, w] of Object.entries(weights)) {
      if (normedTools[tool] != null) { wsum += normedTools[tool] * w; wtot += w; }
    }
    const normedOverallBase = wtot > 0 ? wsum / wtot : null;
    const C = isPitcher ? AGE_BONUS_C.pitcher : AGE_BONUS_C.hitter;
    const ageBonus = (rawPool[id]?.wtdAgeDiff ?? 0) * C;
    const normedOverall = normedOverallBase != null ? normedOverallBase + ageBonus : null;
    const shrunkOverall = shrink(normedOverall, totalSample, isPitcher);

    // Per-tool sample (recompute from history for shrinkage)
    const toolSamples = {};
    for (const tool of Object.keys(normedTools)) {
      const seasons = (history[String(rawPool[id]?.composite != null ? id : id)] || [])
      toolSamples[tool] = totalSample // use totalSample as approximation per tool
    }

    // Per-tool shrunk values and confidence
    const shrunkTools = {};
    const rawTools = {};
    const confTools = {};
    for (const [tool, normed] of Object.entries(normedTools)) {
      if (normed == null) { shrunkTools[tool] = null; rawTools[tool] = null; confTools[tool] = null; continue; }
      const k = isPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter;
      const conf = totalSample / (totalSample + k);
      shrunkTools[tool] = Math.round(100 + (normed - 100) * conf)
      rawTools[tool] = Math.round(normed)
      confTools[tool] = Math.round(conf * 100)
    }

    updatedPlayers[id].model_scores = {
      ...shrunkTools,
      overall: shrunkOverall != null ? Math.round(shrunkOverall) : null,
      _raw: rawTools,
      _confidence: confTools,
      _sample: Math.round(totalSample),
    };
    scored++;
  }

  // ── Hot sheet ─────────────────────────────────────────────────────────────
  // For each player: compute normalized overall WITH current year (= model_scores.overall)
  // vs WITHOUT current year (exclude cySum/cyTot from weighted average then normalize same way)
  // Delta = with - without. Sort by delta descending.
  const hotSheetData = [];
  const MIN_CAREER_PA = 150, MIN_CAREER_IP = 60, MIN_OVERALL = 100;

  for (const [id, { toolWeights, isPitcher }] of Object.entries(rawPool)) {
    const player = updatedPlayers[id];
    const ms = player.model_scores;
    if (!ms?.overall || ms.overall < MIN_OVERALL) continue;
    if (isPitcher && ms._sample < MIN_CAREER_IP) continue;
    if (!isPitcher && ms._sample < MIN_CAREER_PA) continue;

    const weights = isPitcher ? COMPOSITE_WEIGHTS.pitcher : COMPOSITE_WEIGHTS.hitter;

    // Compute normalized overall without current year
    let wsumEx = 0, wtotEx = 0;
    let hasCY = false;

    for (const [tool, w] of Object.entries(weights)) {
      const tw = toolWeights[tool];
      if (!tw || !toolVals[tool]) continue;
      const { mean, stdev } = toolVals[tool];

      // Check if current year contributed anything for this tool
      if (tw.cyTot > 0) hasCY = true;

      // Score without current year: subtract cy contribution from weighted sum
      const wTotEx = tw.wTot - tw.cyTot;
      const wSumEx = tw.wSum - tw.cySum;
      if (wTotEx <= 0) continue;

      const rawEx = wSumEx / wTotEx;
      const normedExBase = 100 + ((rawEx - mean) / stdev) * 15;
      const Chs = isPitcher ? AGE_BONUS_C.pitcher : AGE_BONUS_C.hitter;
      const normedEx = normedExBase + (rawPool[id]?.wtdAgeDiff ?? 0) * Chs;
      wsumEx += normedEx * w;
      wtotEx += w;
    }

    // Must have current year data and a valid without-CY score
    if (!hasCY || wtotEx === 0) continue;

    const overallWithout = Math.round(wsumEx / wtotEx);
    const delta = ms.overall - overallWithout;
    if (delta <= 0) continue;

    hotSheetData.push({
      id, name: player.name, rank: player.rank, positions: player.positions,
      isPit: isPitcher, delta,
      overall: ms.overall, prevOverall: overallWithout,
      sample: ms._sample, confidence: ms._confidence,
    });
  }

  hotSheetData.sort((a, b) => b.delta - a.delta);
  const hotBats = hotSheetData.filter(r => !r.isPit).slice(0, 20);
  const hotArms = hotSheetData.filter(r => r.isPit).slice(0, 20);
  fs.writeFileSync(HOTSHEET_PATH, JSON.stringify({ bats: hotBats, arms: hotArms, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`Hot sheet written: ${hotBats.length} bats, ${hotArms.length} arms`);

  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(updatedPlayers, null, 2));

  console.log(`\n--- RESULTS ---`);
  console.log(`  Scored:            ${scored}`);
  console.log(`  Not rookie elig:   ${notRookie}`);
  console.log(`  No MiLB data:      ${noData}`);

  // Top 50
  const top = Object.values(updatedPlayers)
    .filter(p => p.model_scores?.overall != null)
    .sort((a,b) => b.model_scores.overall - a.model_scores.overall)
    .slice(0, 50);

  console.log(`\n--- TOP 50 BY MODEL SCORE ---`);
  console.log(`  ${'#'.padStart(3)}  ${'RNK'.padStart(5)}  ${'NAME'.padEnd(24)} ${'OVR'.padStart(4)}  ${'CONF'.padStart(5)}  TOOLS`);
  console.log(`  ${'─'.repeat(75)}`);
  top.forEach((p, i) => {
    const s   = p.model_scores;
    const rk  = p.rank ? `#${p.rank}` : 'UR';
    const conf = `${s._confidence}%`;
    const isPit = (p.positions||'').includes('P');
    const tools = isPit
      ? `stuff=${s.stuff??'?'} ctrl=${s.control??'?'}`
      : `hit=${s.hit??'?'} pwr=${s.power??'?'} spd=${s.speed??'?'}`;
    console.log(`  ${String(i+1).padStart(3)}  ${rk.padStart(5)}  ${p.name.padEnd(24)} ${String(s.overall).padStart(4)}  ${conf.padStart(5)}  ${tools}`);
  });
}

run();
