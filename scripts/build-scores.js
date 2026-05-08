const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BASE          = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH  = path.join(BASE, 'players.json');
const HOTSHEET_PATH = path.join(BASE, 'model/hot-sheet.json');
const REGR_PATH     = path.join(BASE, 'model/regression.json');
const NORMS_PATH    = path.join(BASE, 'model/norms.json');
const HISTORY_DIR   = path.join(BASE, 'history');

const regression  = JSON.parse(fs.readFileSync(REGR_PATH, 'utf8'));
const players     = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const norms       = JSON.parse(fs.readFileSync(NORMS_PATH, 'utf8'));

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

function scoreTool(mlbamId, player, tool, isPitcher) {
  const { stats: statKeys } = TOOL_STATS[tool];
  const model = regression.models?.[tool];
  if (!model) return { score: null, wSum: 0, wTot: 0, cySum: 0, cyTot: 0, sample: 0 };

  const expectedType = isPitcher ? 'pitching' : 'hitting';
  const seasons = (history[String(mlbamId)] || [])
    .filter(s => MILB_LEVELS.has(s.level) && VALID_YEARS.has(s.year) && s.team && s.type === expectedType);

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

      const slopeAge = levelModel.slope_age ?? 0;
      const pred     = levelModel.slope_z * z + slopeAge * ageDiff + levelModel.intercept;

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

async function run() {
  console.log('Scoring prospects...');
  const updatedPlayers = { ...players };
  let scored = 0, notRookie = 0, noData = 0;

  const rawPool = {};

  for (const [id, player] of Object.entries(updatedPlayers)) {
    delete updatedPlayers[id].model_scores;

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
      if (!isRookieEligible(mlbamId, isPitcher)) { notRookie++; continue; }
      sidesEligible.push({ isPitcher, exposed: true });
    }

    const recentSeasons = (history[String(mlbamId)] || [])
      .filter(s => MILB_LEVELS.has(s.level) && s.year >= CURRENT_YEAR - 3 && s.team);
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
    rawPool[id] = {
      toolScores, toolWeights,
      totalSample: Math.max(pitchSample, hitSample),
      pitchSample, hitSample,
      isPitcher, isTwoWay, hasArm, hasBat,
      hasCY: false, cySample: 0
    };
  }

  const toolVals = {};
  for (const tool of ['hit','power','speed','stuff','control']) {
    const vals = Object.values(rawPool)
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

  const MIN_OVERALL = 95, MIN_RISER_DELTA = 1;
  const risers = [];

  for (const [id, pool] of Object.entries(rawPool)) {
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

  function normLevelBS(l, year) {
    if (l === 'A') return 'Single-A';
    if (l === 'A+' || l === 'High A') return 'High-A';
    if (l === 'ROK' || l === 'Rookie Advanced') return (year && year >= 2021) ? 'Complex' : 'Rookie';
    if (l === 'CPX') return 'Complex';
    return l;
  }

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
      if (!cum[sKey]) cum[sKey] = { ab:0, bb:0, hbp:0, so:0, h:0, sb:0, tb:0, bf:0, ipOuts:0, year:g.year, lvl };
      const sc = cum[sKey];
      sc.ab  += g.atBats      || 0;
      sc.bb  += g.baseOnBalls || 0;
      sc.hbp += g.hitByPitch  || 0;
      sc.so  += g.strikeOuts  || 0;
      sc.h   += g.hits        || 0;
      sc.sb  += g.stolenBases || 0;
      sc.tb  += g.totalBases  || 0;
      sc.bf  += g.battersFaced|| 0;
      sc.ipOuts += ipOutsFromStr(g.inningsPitched);
    }

    const scoreTool2 = (toolName) => {
      const toolModels = models[toolName];
      if (!toolModels) return null;
      const tv = poolStatsData[toolName];
      if (!tv) return null;
      const statKeys = toolName==='hit'?['k_pct','bb_pct']:toolName==='power'?['iso']:toolName==='speed'?['sb_rate']:toolName==='stuff'?['k_pct']:['bb_pct'];
      let wSum=0, wTot=0, totalSample=0;
      const currentYear = new Date().getFullYear();

      for (const [, st] of Object.entries(cum)) {
        const rl = st.lvl;
        if (!toolModels[rl]) continue;
        const normEntry = normsData[`${rl}|${st.year}`] ?? normsData[`${rl}|${st.year-1}`];
        if (!normEntry) continue;
        const n = isPit ? normEntry.pitchers : normEntry.hitters;
        if (!n) continue;
        const rIp = st.ipOuts / 3, rPa = st.ab + st.bb + st.hbp;
        const rSample = isPit ? rIp : rPa;
        if (!rSample) continue;
        totalSample += rSample;
        const rSlg = st.ab > 0 ? st.tb / st.ab : 0;
        const rAvg = st.ab > 0 ? st.h / st.ab : 0;
        const rAgeDiff = (AVG_AGES[rl] ?? 22) - getAge2(st.year);
        const recency = Math.pow(0.75, currentYear - st.year);
        for (const sn of statKeys) {
          const lm = toolModels[rl]?.[sn];
          const nm = n[sn];
          if (!lm || !nm || nm.stdev === 0) continue;
          let val;
          if (sn==='iso') val = rSlg - rAvg;
          else if (sn==='sb_rate') { const tob=st.h+st.bb+st.hbp; val=tob>0?st.sb/tob:0; }
          else if (sn==='k_pct') val = isPit?(st.bf>0?st.so/st.bf:0):(rPa>0?st.so/rPa:0);
          else val = isPit?(st.bf>0?st.bb/st.bf:0):(rPa>0?st.bb/rPa:0);
          let z = (val - nm.mean) / nm.stdev;
          if ((!isPit && sn==='k_pct') || (isPit && sn==='bb_pct')) z = -z;
          const pred = lm.slope_z*z + (lm.slope_age??0)*rAgeDiff + lm.intercept;
          const kk = isPit?(sn==='k_pct'?'k_pct_pit':'bb_pct_pit'):sn;
          const w = lm.corr * (rSample/(rSample+(ARC_K2[kk]??ARC_K2[sn]??60))) * recency;
          wSum+=pred*w; wTot+=w;
        }
      }
      if (wTot===0) return null;
      const normed = POOL_CENTER2 + ((wSum/wTot) - tv.mean) / tv.stdev * POOL_STDEV2;
      return Math.round(SHRINK_TOWARD2 + (normed-SHRINK_TOWARD2)*(totalSample/(totalSample+SHRINK_K2)));
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
        const key = (s.date||'')+'|'+(s.opponent?.abbreviation||s.opponent?.id||'');
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
        level: s.sport?.abbreviation ?? s.team?.sport?.abbreviation ?? null,
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
        if (!preCum[sKey]) preCum[sKey] = { ab:0, bb:0, hbp:0, so:0, h:0, sb:0, tb:0, bf:0, ipOuts:0, year:s.year, lvl:s.level };
        const sc = preCum[sKey];
        sc.ab  += s.ab  || 0;
        sc.bb  += s.bb  || 0;
        sc.hbp += s.hbp || 0;
        sc.so  += s.so  || 0;
        sc.h   += s.h   || 0;
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

      const deltas = { season: riser.delta };
      for (const days of WINDOWS) {
        const since = cutoff(days);
        const windowGames = allCYGames.filter(g => new Date(g.date) >= since);
        if (!windowGames.length) { deltas[`d${days}`] = null; continue; }
        const windowOverall = scoreWindowedOverall(preCum, windowGames, isPit, player.birthDate, regression2, norms, poolStats2);
        deltas[`d${days}`] = windowOverall != null ? windowOverall - riser.prevOverall : null;
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
