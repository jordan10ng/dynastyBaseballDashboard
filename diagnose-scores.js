const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BASE          = path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH  = path.join(BASE, 'players.json');
const REGR_PATH     = path.join(BASE, 'model/regression.json');
const NORMS_PATH    = path.join(BASE, 'model/norms.json');
const ELAST_PATH    = path.join(BASE, 'model/age-elasticity.json');
const HISTORY_DIR   = path.join(BASE, 'history');
const MLBTOOLS_PATH = path.join(BASE, 'model/mlb-tools.json');

const regression = JSON.parse(fs.readFileSync(REGR_PATH));
const players    = JSON.parse(fs.readFileSync(PLAYERS_PATH));
const norms      = JSON.parse(fs.readFileSync(NORMS_PATH));
const elasticity = JSON.parse(fs.readFileSync(ELAST_PATH));
const mlbTools   = JSON.parse(fs.readFileSync(MLBTOOLS_PATH));

const VALID_YEARS  = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026]);
const CURRENT_YEAR = new Date().getFullYear();
const MILB_LEVELS  = new Set(['AAA','AA','High-A','Single-A','Complex','DSL','Rookie']);
const AVG_AGES     = { 'AAA':26.5,'AA':24.5,'High-A':23.0,'Single-A':21.5,'Complex':19.5,'DSL':17.5,'Rookie':20.0 };
const SHRINK_K     = { hitter: 200, pitcher: 80 };
const SHRINK_TOWARD = 90;
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

function ipToFloat(ip) { const p=String(ip||0).split('.'); return parseInt(p[0]||0)+(parseInt(p[1]||0))/3; }
function getAge(dob, year) {
  if (!dob) return null;
  const d = new Date(dob); let age = year - d.getFullYear();
  if (d.getMonth()>6||(d.getMonth()===6&&d.getDate()>1)) age--;
  return age;
}
function getNorm(level, year) {
  for (let y=year; y>=year-3; y--) { const e=norms[`${level}|${y}`]; if (e) return e; }
  return null;
}
function getAgeElasticity(isPitcher, level, stat) {
  const group = isPitcher ? 'pitchers' : 'hitters';
  return elasticity?.[group]?.[level]?.[stat]?.k ?? 0;
}
function shrink(score, sample, isPitcher) {
  if (score==null) return null;
  const k = isPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter;
  const conf = sample/(sample+k);
  return SHRINK_TOWARD + (score-SHRINK_TOWARD)*conf;
}
function isRookieEligible(mlbamId, isPitcher) {
  const seasons = (history[String(mlbamId)]||[]).filter(s=>s.level==='MLB');
  if (isPitcher) return seasons.reduce((s,r)=>s+ipToFloat(r.ip),0)<50;
  return seasons.reduce((s,r)=>s+(r.ab||0),0)<130;
}

function scorePlayer(mlbamId, player, isPitcher) {
  const toolList = isPitcher ? ['stuff','control'] : ['hit','power','speed'];
  const toolScores = {};
  let totalSample = 0, hasAny = false;

  for (const tool of toolList) {
    const statKeys = TOOL_STATS[tool];
    const model = regression.models?.[tool];
    if (!model) continue;
    const seasons = (history[String(mlbamId)]||[])
      .filter(s => MILB_LEVELS.has(s.level) && VALID_YEARS.has(s.year) && s.team);

    let wSum=0, wTot=0, sample=0;
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
        raw.k_pct=(s.so||0)/sp; raw.bb_pct=(s.bb||0)/sp;
        raw.iso=(parseFloat(s.slg)||0)-(parseFloat(s.avg)||0);
        const tob=(s.h||0)+(s.bb||0)+(s.hbp||0);
        raw.sb_rate=tob>0?(s.sb||0)/tob:0;
      } else {
        const bf=s.bf||0;
        raw.k_pct=bf>0?(s.so||0)/bf:null;
        raw.bb_pct=bf>0?(s.bb||0)/bf:null;
      }
      for (const stat of statKeys) {
        const lm = model?.[level]?.[stat];
        if (!lm) continue;
        const v = raw[stat];
        if (v==null) continue;
        const sn = n[stat];
        if (!sn||sn.stdev===0) continue;
        let z = (v-sn.mean)/sn.stdev;
        if ((!isPitcher&&stat==='k_pct')||(isPitcher&&stat==='bb_pct')) z=-z;
        const ageK = getAgeElasticity(isPitcher, level, stat);
        z += (ageDiff * ageK) / sn.stdev;
        const pred = lm.slope*z+lm.intercept;
        const rd = Math.pow(0.75, CURRENT_YEAR-year);
        const w = lm.corr*sp*rd;
        wSum+=pred*w; wTot+=w;
      }
      sample+=sp;
    }
    if (wTot===0) continue;
    toolScores[tool] = wSum/wTot;
    totalSample = Math.max(totalSample, sample);
    hasAny = true;
  }
  if (!hasAny) return null;

  const weights = isPitcher ? COMPOSITE_WEIGHTS.pitcher : COMPOSITE_WEIGHTS.hitter;
  let wsum=0, wtot=0;
  for (const [tool,w] of Object.entries(weights)) {
    if (toolScores[tool]!=null) { wsum+=toolScores[tool]*w; wtot+=w; }
  }
  if (wtot===0) return null;
  const composite = wsum/wtot;
  return { composite, toolScores, totalSample };
}

const results = [];
const milbOveralls=[], mlbOveralls=[];
const milbToolRaws=[], mlbToolRaws=[];

for (const [id, player] of Object.entries(players)) {
  const mlbamId = player.mlbam_id;
  if (!mlbamId) continue;
  const isPitcher = (player.positions||'').includes('P');
  if (!isRookieEligible(mlbamId, isPitcher)) continue;
  const recent = (history[String(mlbamId)]||[])
    .filter(s => MILB_LEVELS.has(s.level) && s.year>=CURRENT_YEAR-3 && s.team);
  if (!recent.length) continue;
  const res = scorePlayer(mlbamId, player, isPitcher);
  if (!res) continue;

  const overall = Math.round(shrink(res.composite, res.totalSample, isPitcher));
  const isGrad  = !!mlbTools[String(mlbamId)];
  const levelOrder = ['AAA','AA','High-A','Single-A','Rookie','Complex','DSL'];
  const topLevel = levelOrder.find(l => recent.some(s=>s.level===l)) || recent[0].level;
  const age = getAge(player.birthDate, CURRENT_YEAR);

  (isGrad ? mlbOveralls : milbOveralls).push(overall);
  const toolArr = isGrad ? mlbToolRaws : milbToolRaws;
  for (const [t,v] of Object.entries(res.toolScores)) { if (v!=null) toolArr.push({tool:t,v}); }

  results.push({ name: player.name, overall, rawComposite: Math.round(res.composite*10)/10,
    age, topLevel, isPitcher, isGrad, sample: Math.round(res.totalSample),
    tools: Object.fromEntries(Object.entries(res.toolScores).map(([t,v])=>[t,v!=null?Math.round(v*10)/10:null])) });
}

results.sort((a,b) => b.overall-a.overall);

function avg(arr) { return arr.length?(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1):'n/a'; }
function toolAvg(arr,tool) { const v=arr.filter(x=>x.tool===tool).map(x=>x.v); return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):'n/a'; }

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  DIAMOND MODEL DIAGNOSTIC (age-in-z, shrink→90, no renorm)');
console.log('════════════════════════════════════════════════════════════════\n');

console.log('── AVERAGES BY GROUP ──────────────────────────────────────────');
console.log(`  MiLB prospects  (n=${milbOveralls.length})   overall avg: ${avg(milbOveralls)}`);
console.log(`  MLB grads       (n=${mlbOveralls.length})   overall avg: ${avg(mlbOveralls)}`);
console.log('\n  MiLB raw tool scores:');
for (const t of ['hit','power','speed','stuff','control']) { const v=toolAvg(milbToolRaws,t); if(v!=='n/a') console.log(`    ${t.padEnd(8)} ${v}`); }
console.log('\n  MLB grad raw tool scores:');
for (const t of ['hit','power','speed','stuff','control']) { const v=toolAvg(mlbToolRaws,t); if(v!=='n/a') console.log(`    ${t.padEnd(8)} ${v}`); }

console.log('\n── TOP 30 OVERALL ─────────────────────────────────────────────');
console.log('  #   Name                        OVR  rawComp  age  level     sample  group  tools');
results.slice(0,30).forEach((r,i) => {
  const toolStr = Object.entries(r.tools).filter(([,v])=>v!=null).map(([t,v])=>`${t}:${v}`).join(' ');
  console.log(
    `  ${String(i+1).padStart(2)}  ${r.name.padEnd(28)} ${String(r.overall).padStart(4)}` +
    `  ${String(r.rawComposite).padStart(7)}  ${String(r.age??'?').padStart(3)}` +
    `  ${(r.topLevel||'?').padEnd(9)} ${String(r.sample).padStart(6)}` +
    `  ${r.isGrad?'MLB ':'MiLB'}  [${toolStr}]`
  );
});

const judgeEntry = results.find(r=>r.name.toLowerCase().includes('judge'));
const troutEntry = results.find(r=>r.name.toLowerCase().includes('trout'));
console.log('\n── BENCHMARKS ─────────────────────────────────────────────────');
if (judgeEntry) {
  const aboveJudge = results.filter(r=>r.overall>judgeEntry.overall&&!r.isGrad).length;
  console.log(`  Aaron Judge    overall: ${judgeEntry.overall}  rawComposite: ${judgeEntry.rawComposite}`);
  console.log(`  MiLB above Judge: ${aboveJudge}`);
}
if (troutEntry) console.log(`  Mike Trout     overall: ${troutEntry.overall}  rawComposite: ${troutEntry.rawComposite}`);

const overalls = results.map(r=>r.overall).sort((a,b)=>a-b);
const buckets = [[0,80],[80,85],[85,90],[90,95],[95,100],[100,105],[105,110],[110,115],[115,999]];
console.log('\n── DISTRIBUTION ───────────────────────────────────────────────');
console.log(`  mean: ${avg(overalls)}  p10: ${overalls[Math.floor(overalls.length*.1)]}  p25: ${overalls[Math.floor(overalls.length*.25)]}  p50: ${overalls[Math.floor(overalls.length*.5)]}  p75: ${overalls[Math.floor(overalls.length*.75)]}  p90: ${overalls[Math.floor(overalls.length*.9)]}  p99: ${overalls[Math.floor(overalls.length*.99)]}`);
console.log('  '+buckets.map(([lo,hi])=>{
  const cnt=overalls.filter(s=>s>=lo&&s<hi).length;
  return `${hi===999?lo+'+':lo+'-'+hi}: ${cnt}`;
}).join('  '));
console.log('\n════════════════════════════════════════════════════════════════\n');
