const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { scoreMilbToolRaw, scoreMilbTool, blendCareer } = require('../lib/score-tools');

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
      }
    }


    const isPitcher = hasArm && !hasBat; // pure pitcher flag for pool/shrinkage
    // graduated = no side is rookie-eligible (used to exclude from prospect pool + risers)
    const graduated = sidesEligible.length > 0 && sidesEligible.every(s => s.graduated);
    rawPool[id] = {
      toolScores, toolWeights,
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

  for (const [id, { toolScores, toolWeights, totalSample, pitchSample, hitSample, isPitcher, isTwoWay, hasArm, hasBat }] of Object.entries(rawPool)) {

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
    // Canonical career-grade blend — single source of truth for row + drawer tile + model-rank.
    updatedPlayers[id].career_blend = blendCareer(
      updatedPlayers[id].model_scores,
      mlbTools[String(updatedPlayers[id].mlbam_id)] ?? null,
      { ipg: careerIPG }
    );
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
    updatedPlayers[id].career_blend = blendCareer(null, mlbEntry, { ipg: careerIPG });
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
