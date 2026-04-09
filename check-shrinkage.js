const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BASE         = path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH = path.join(BASE, 'players.json');
const REGR_PATH    = path.join(BASE, 'model/regression.json');
const NORMS_PATH   = path.join(BASE, 'model/norms.json');
const HISTORY_DIR  = path.join(BASE, 'history');
const MLBTOOLS_PATH = path.join(BASE, 'model/mlb-tools.json');

const regression  = JSON.parse(fs.readFileSync(REGR_PATH));
const players     = JSON.parse(fs.readFileSync(PLAYERS_PATH));
const norms       = JSON.parse(fs.readFileSync(NORMS_PATH));
const mlbTools    = JSON.parse(fs.readFileSync(MLBTOOLS_PATH));

const VALID_YEARS = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026]);
const CURRENT_YEAR = new Date().getFullYear();
const MILB_LEVELS = new Set(['AAA','AA','High-A','Single-A','Complex','DSL','Rookie']);
const AVG_AGES = { 'AAA':26.5,'AA':24.5,'High-A':23.0,'Single-A':21.5,'Complex':19.5,'DSL':17.5,'Rookie':20.0 };
const SHRINK_K = { hitter: 200, pitcher: 80 };
const AGE_BONUS_C = { hitter: 3.0, pitcher: 2.0 };
const COMPOSITE_WEIGHTS = {
  hitter:  { hit: 0.42, power: 0.47, speed: 0.11 },
  pitcher: { stuff: 0.70, control: 0.30 },
};
const TOOL_STATS = {
  hit: ['k_pct','bb_pct'], power: ['iso'], speed: ['sb_rate'],
  stuff: ['k_pct'], control: ['bb_pct'],
};

const history = {};
for (const f of fs.readdirSync(HISTORY_DIR).filter(f => /^\d{4}\.json$/.test(f))) {
  const year = parseInt(f);
  if (!VALID_YEARS.has(year)) continue;
  const data = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f)));
  for (const [id, seasons] of Object.entries(data)) {
    if (!history[id]) history[id] = [];
    for (const s of seasons) history[id].push({...s, year});
  }
}

function ipToFloat(ip) {
  const p = String(ip||0).split('.');
  return parseInt(p[0]||0) + (parseInt(p[1]||0))/3;
}
function getAge(dob, year) {
  if (!dob) return null;
  const d = new Date(dob);
  let age = year - d.getFullYear();
  if (d.getMonth() > 6 || (d.getMonth()===6 && d.getDate()>1)) age--;
  return age;
}
function getNorm(level, year) {
  for (let y = year; y >= year-3; y--) {
    const e = norms[`${level}|${y}`];
    if (e) return e;
  }
  return null;
}
function isRookieEligible(mlbamId, isPitcher) {
  const seasons = (history[String(mlbamId)]||[]).filter(s => s.level==='MLB');
  if (isPitcher) return seasons.reduce((s,r) => s+ipToFloat(r.ip),0) < 50;
  return seasons.reduce((s,r) => s+(r.ab||0),0) < 130;
}

function getRawCompositeAndMeta(mlbamId, player, isPitcher) {
  const toolList = isPitcher ? ['stuff','control'] : ['hit','power','speed'];
  const toolScores = {};
  let playerWtdAgeDiff = 0, totalSample = 0, hasAny = false;

  for (const tool of toolList) {
    const statKeys = TOOL_STATS[tool];
    const model = regression.models?.[tool];
    if (!model) continue;
    const seasons = (history[String(mlbamId)]||[])
      .filter(s => MILB_LEVELS.has(s.level) && VALID_YEARS.has(s.year) && s.team);

    let wSum=0, wTot=0, ageWSum=0, ageWTot=0, sample=0;
    for (const s of seasons) {
      const { year, level } = s;
      const sp = isPitcher ? ipToFloat(s.ip) : (s.pa||0);
      if (!sp) continue;
      const normEntry = getNorm(level, year);
      if (!normEntry) continue;
      const n = isPitcher ? normEntry.pitchers : normEntry.hitters;
      if (!n) continue;
      const age = getAge(player.birthDate, year) ?? AVG_AGES[level];
      const ageDiff = AVG_AGES[level] - age;
      const raw = {};
      if (!isPitcher) {
        raw.k_pct = (s.so||0)/sp; raw.bb_pct = (s.bb||0)/sp;
        raw.iso = (parseFloat(s.slg)||0)-(parseFloat(s.avg)||0);
        const tob = (s.h||0)+(s.bb||0)+(s.hbp||0);
        raw.sb_rate = tob>0 ? (s.sb||0)/tob : 0;
      } else {
        const bf=s.bf||0;
        raw.k_pct = bf>0?(s.so||0)/bf:null;
        raw.bb_pct = bf>0?(s.bb||0)/bf:null;
      }
      if (!['sb_rate'].includes(statKeys[0])) { ageWSum+=ageDiff*sp; ageWTot+=sp; }
      for (const stat of statKeys) {
        const lm = model?.[level]?.[stat];
        if (!lm) continue;
        const v = raw[stat];
        if (v==null) continue;
        const sn = n[stat];
        if (!sn||sn.stdev===0) continue;
        let z = (v-sn.mean)/sn.stdev;
        if ((!isPitcher&&stat==='k_pct')||(isPitcher&&stat==='bb_pct')) z=-z;
        const pred = lm.slope*z+lm.intercept;
        const rd = Math.pow(0.75, CURRENT_YEAR-year);
        const w = lm.corr*sp*rd;
        wSum+=pred*w; wTot+=w;
      }
      sample+=sp;
    }
    if (wTot===0) continue;
    toolScores[tool] = wSum/wTot;
    if (tool!=='speed') { playerWtdAgeDiff=ageWTot>0?ageWSum/ageWTot:0; totalSample=sample; }
    hasAny=true;
  }
  if (!hasAny) return null;

  const weights = isPitcher ? COMPOSITE_WEIGHTS.pitcher : COMPOSITE_WEIGHTS.hitter;
  let wsum=0, wtot=0;
  for (const [tool,w] of Object.entries(weights)) {
    if (toolScores[tool]!=null) { wsum+=toolScores[tool]*w; wtot+=w; }
  }
  if (wtot===0) return null;
  const rawComposite = wsum/wtot;
  const C = isPitcher ? AGE_BONUS_C.pitcher : AGE_BONUS_C.hitter;
  return { rawComposite, ageBonus: playerWtdAgeDiff*C, totalSample };
}

// collect raw scores
const pool = [];
for (const [id, player] of Object.entries(players)) {
  const mlbamId = player.mlbam_id;
  if (!mlbamId) continue;
  const isPitcher = (player.positions||'').includes('P');
  if (!isRookieEligible(mlbamId, isPitcher)) continue;
  const recent = (history[String(mlbamId)]||[])
    .filter(s => MILB_LEVELS.has(s.level) && s.year>=CURRENT_YEAR-3 && s.team);
  if (!recent.length) continue;
  const res = getRawCompositeAndMeta(mlbamId, player, isPitcher);
  if (!res) continue;
  pool.push({ name: player.name, isPitcher, isGrad: !!mlbTools[String(mlbamId)], ...res });
}

function shrink(score, sample, isPitcher, toward) {
  const k = isPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter;
  const conf = sample / (sample + k);
  return toward + (score - toward) * conf;
}

function dist(scores) {
  scores.sort((a,b)=>a-b);
  const n = scores.length;
  const mean = scores.reduce((a,b)=>a+b,0)/n;
  const pct = p => scores[Math.floor(n*p)];
  const buckets = [
    [0,80],[80,85],[85,90],[90,95],[95,100],[100,105],[105,110],[110,115],[115,999]
  ];
  const bStr = buckets.map(([lo,hi]) => {
    const cnt = scores.filter(s => s>=lo && s<hi).length;
    const label = hi===999 ? `${lo}+` : `${lo}-${hi}`;
    return `${label}: ${cnt}`;
  }).join('  ');
  return { mean: mean.toFixed(1), p10: pct(0.1).toFixed(1), p25: pct(0.25).toFixed(1),
           p50: pct(0.5).toFixed(1), p75: pct(0.75).toFixed(1), p90: pct(0.9).toFixed(1),
           p99: pct(0.99).toFixed(1), n, bStr };
}

const TOWARD_VALS = [
  { label: 'current (100)', val: 100 },
  { label: 'toward 95',     val: 95  },
  { label: 'toward 90',     val: 90  },
  { label: 'toward 86',     val: 86  },
  { label: 'toward 80',     val: 80  },
];

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  SHRINKAGE TARGET COMPARISON');
console.log('════════════════════════════════════════════════════════════════\n');

for (const { label, val } of TOWARD_VALS) {
  const scores = pool.map(p => Math.round(shrink(p.rawComposite + p.ageBonus, p.totalSample, p.isPitcher, val)));
  const d = dist(scores);
  console.log(`── ${label.padEnd(18)} (n=${d.n}) ──────────────────────────────`);
  console.log(`   mean:${d.mean}  p10:${d.p10}  p25:${d.p25}  p50:${d.p50}  p75:${d.p75}  p90:${d.p90}  p99:${d.p99}`);
  console.log(`   ${d.bStr}`);

  // top 10
  const ranked = pool
    .map(p => ({ name: p.name, isGrad: p.isGrad, score: Math.round(shrink(p.rawComposite+p.ageBonus, p.totalSample, p.isPitcher, val)) }))
    .sort((a,b) => b.score-a.score).slice(0,10);
  console.log(`   top10: ${ranked.map(r => `${r.name}(${r.score}${r.isGrad?'*':''})`).join(', ')}`);
  console.log();
}

console.log('  * = MLB grad (in mlb-tools.json)\n');
console.log('════════════════════════════════════════════════════════════════\n');
