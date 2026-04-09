const fs = require('fs'), path = require('path'), os = require('os');
const BASE = path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const regression = JSON.parse(fs.readFileSync(path.join(BASE, 'model/regression.json')));
const norms      = JSON.parse(fs.readFileSync(path.join(BASE, 'model/norms.json')));
const elasticity = JSON.parse(fs.readFileSync(path.join(BASE, 'model/age-elasticity.json')));
const players    = JSON.parse(fs.readFileSync(path.join(BASE, 'players.json')));

const VALID_YEARS = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026]);
const CURRENT_YEAR = new Date().getFullYear();
const AVG_AGES = { 'AAA':26.5,'AA':24.5,'High-A':23.0,'Single-A':21.5,'Complex':19.5,'DSL':17.5,'Rookie':20.0 };
const MILB_LEVELS = new Set(Object.keys(AVG_AGES));
const AGE_CORR_SCALE = 0.2;
const SPEED_STATS = new Set(['sb_rate']);

const history = {};
for (const f of fs.readdirSync(path.join(BASE,'history')).filter(f=>/^\d{4}\.json$/.test(f))) {
  const year = parseInt(f);
  if (!VALID_YEARS.has(year)) continue;
  const data = JSON.parse(fs.readFileSync(path.join(BASE,'history',f)));
  for (const [id,seasons] of Object.entries(data)) {
    if (!history[id]) history[id]=[];
    for (const s of seasons) history[id].push({...s,year});
  }
}

function ipToFloat(ip) { const p=String(ip||0).split('.'); return parseInt(p[0]||0)+(parseInt(p[1]||0))/3; }
function getAge(dob,year) {
  if (!dob) return null;
  const d=new Date(dob); let age=year-d.getFullYear();
  if (d.getMonth()>6||(d.getMonth()===6&&d.getDate()>1)) age--;
  return age;
}
function getNorm(level,year) {
  for (let y=year;y>=year-3;y--) { const e=norms[`${level}|${y}`]; if(e) return e; } return null;
}

const TARGETS = ['McGonigle','Emerson','Griffin','Walcott','De Vries'];

for (const [id, player] of Object.entries(players)) {
  if (!TARGETS.some(t => player.name.includes(t))) continue;
  if (!player.mlbam_id) continue;

  const isPitcher = (player.positions||'').includes('P');
  const TOOL_STATS = {
    hit:['k_pct','bb_pct'], power:['iso'], speed:['sb_rate'],
    stuff:['k_pct'], control:['bb_pct'],
  };
  const toolList = isPitcher ? ['stuff','control'] : ['hit','power','speed'];

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${player.name} | age: ${getAge(player.birthDate,CURRENT_YEAR)} | mlbam: ${player.mlbam_id}`);
  console.log(`  overall: ${player.model_scores?.overall} | raw: ${JSON.stringify(player.model_scores?._raw)}`);
  console.log('='.repeat(70));

  const seasons = (history[String(player.mlbam_id)]||[])
    .filter(s=>MILB_LEVELS.has(s.level)&&VALID_YEARS.has(s.year)&&s.team)
    .sort((a,b)=>a.year-b.year||a.level.localeCompare(b.level));

  for (const tool of toolList) {
    const statKeys = TOOL_STATS[tool];
    const model = regression.models?.[tool];
    console.log(`\n  --- ${tool.toUpperCase()} ---`);

    let wSum=0, wTot=0;
    for (const s of seasons) {
      const {year,level} = s;
      const sample = isPitcher ? ipToFloat(s.ip) : (s.pa||0);
      if (!sample) continue;
      const normEntry = getNorm(level,year);
      if (!normEntry) continue;
      const n = isPitcher ? normEntry.pitchers : normEntry.hitters;
      if (!n) continue;

      const age = getAge(player.birthDate,year)??AVG_AGES[level];
      const ageDiff = AVG_AGES[level]-age;

      const raw = {};
      if (!isPitcher) {
        raw.k_pct=(s.so||0)/sample; raw.bb_pct=(s.bb||0)/sample;
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
        const zRaw = z;

        const isSpeed = SPEED_STATS.has(stat);
        const corr = elasticity?.hitters?.[level]?.[stat]?.corr_age_residual??0;
        const zAdj = isSpeed ? 0 : corr*ageDiff*AGE_CORR_SCALE;
        z += zAdj;

        const pred = lm.slope*z+lm.intercept;
        const rd = Math.pow(0.75,CURRENT_YEAR-year);
        const w = lm.corr*sample*rd;
        wSum+=pred*w; wTot+=w;

        console.log(`  ${year} ${level.padEnd(9)} ${stat.padEnd(9)} `+
          `val:${v.toFixed(3)} norm_mean:${sn.mean.toFixed(3)} norm_sd:${sn.stdev.toFixed(3)} `+
          `z_raw:${zRaw.toFixed(2)} age_diff:${ageDiff.toFixed(1)} z_adj:${zAdj.toFixed(3)} z_final:${z.toFixed(2)} `+
          `pred:${pred.toFixed(1)} corr:${lm.corr.toFixed(2)} sample:${Math.round(sample)} rd:${rd.toFixed(2)} w:${w.toFixed(1)}`);
      }
    }
    if (wTot>0) console.log(`  => raw score: ${(wSum/wTot).toFixed(2)}`);
  }
}
