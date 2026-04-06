const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const players = JSON.parse(fs.readFileSync(path.join(BASE, 'players.json')));
const norms = JSON.parse(fs.readFileSync(path.join(BASE, 'model/norms.json')));
const elasticity = JSON.parse(fs.readFileSync(path.join(BASE, 'model/age-elasticity.json')));
const regression = JSON.parse(fs.readFileSync(path.join(BASE, 'model/regression.json')));

const NAMES = ['Konnor Griffin', 'JJ Wetherholt', 'Ryan Ward', 'Dax Kilby'];
const VALID_YEARS = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026]);
const CURRENT_YEAR = new Date().getFullYear();
const AVG_AGES = {
  'AAA': 26.5, 'AA': 24.5, 'High-A': 23.0, 'Single-A': 21.5,
  'Complex': 19.5, 'DSL': 17.5, 'Rookie': 20.0,
};
const MILB_LEVELS = new Set(Object.keys(AVG_AGES));
const SHRINK_K = { hitter: 200, pitcher: 80 };
const TOOL_STATS = {
  hit:     { stats: ['k_pct','bb_pct'] },
  power:   { stats: ['iso'] },
  speed:   { stats: ['sb_rate'] },
  stuff:   { stats: ['k_pct'] },
  control: { stats: ['bb_pct'] },
};
const COMPOSITE_WEIGHTS = {
  hitter:  { hit: 0.42, power: 0.47, speed: 0.11 },
  pitcher: { stuff: 0.70, control: 0.30 },
};

// Load history
const history = {};
fs.readdirSync(path.join(BASE, 'history')).filter(f => /^\d{4}\.json$/.test(f)).forEach(file => {
  const year = parseInt(file);
  if (!VALID_YEARS.has(year)) return;
  const data = JSON.parse(fs.readFileSync(path.join(BASE, 'history', file)));
  for (const [id, seasons] of Object.entries(data)) {
    if (!history[id]) history[id] = [];
    for (const s of seasons) history[id].push({ ...s, year });
  }
});

function getAge(dob, year) {
  const d = new Date(dob);
  let age = year - d.getFullYear();
  if (d.getMonth() > 6 || (d.getMonth() === 6 && d.getDate() > 1)) age--;
  return age;
}

function getNorm(level, year) {
  for (let y = year; y >= year - 3; y--) {
    const e = norms[`${level}|${y}`];
    if (e) return e;
  }
  return null;
}

function ipToFloat(ip) {
  const parts = String(ip || 0).split('.');
  return parseInt(parts[0] || 0) + (parseInt(parts[1] || 0)) / 3;
}

function getElasticity(isPitcher, level, stat) {
  const side = isPitcher ? 'pitchers' : 'hitters';
  return elasticity?.[side]?.[level]?.[stat]?.k ?? 0.05;
}

for (const name of NAMES) {
  const player = Object.values(players).find(p => p.name === name);
  if (!player) { console.log(`\n=== ${name} NOT FOUND ===`); continue; }

  const isPitcher = (player.positions || '').includes('P');
  const toolList = isPitcher ? ['stuff','control'] : ['hit','power','speed'];
  const id = String(player.mlbam_id);
  const seasons = (history[id] || []).filter(s => MILB_LEVELS.has(s.level) && VALID_YEARS.has(s.year) && s.team);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${name} | DOB: ${player.birthDate} | ${isPitcher ? 'PITCHER' : 'HITTER'} | mlbam: ${id}`);
  console.log(`Final scores: ${JSON.stringify(player.model_scores)}`);
  console.log(`${'='.repeat(70)}`);

  // Per-tool diagnostic
  for (const tool of toolList) {
    const statKeys = TOOL_STATS[tool].stats;
    const model = regression.models?.[tool];
    if (!model) { console.log(`\n[${tool.toUpperCase()}] no model`); continue; }

    console.log(`\n--- TOOL: ${tool.toUpperCase()} ---`);
    console.log(`${'YEAR'.padEnd(6)} ${'LEV'.padEnd(10)} ${'AGE'.padEnd(5)} ${'AVG_AGE'.padEnd(9)} ${'YRS_OVR'.padEnd(9)} ${'PENALTY'.padEnd(9)} ${'STAT'.padEnd(10)} ${'RAW'.padEnd(8)} ${'NORM_MEAN'.padEnd(11)} ${'Z'.padEnd(8)} ${'ELAST_K'.padEnd(9)} ${'Z_ADJ'.padEnd(8)} ${'PRED'.padEnd(8)} ${'PRED_ADJ'.padEnd(10)} ${'SAMPLE'.padEnd(8)} ${'DECAY'.padEnd(7)} ${'CORR'.padEnd(7)} ${'WEIGHT'.padEnd(10)} ${'CONTRIB'}`);
    console.log('-'.repeat(160));

    let wSum = 0, wTot = 0, totalSample = 0;

    for (const s of seasons) {
      const { year, level } = s;
      const sample = isPitcher ? ipToFloat(s.ip) : (s.pa || 0);
      if (!sample) continue;

      const normEntry = getNorm(level, year);
      if (!normEntry) continue;
      const n = isPitcher ? normEntry.pitchers : normEntry.hitters;
      if (!n) continue;

      const age = getAge(player.birthDate, year) ?? AVG_AGES[level];
      const avgAge = AVG_AGES[level];
      const ageDiff = avgAge - age; // positive = young for level
      const yearsOver = Math.max(0, age - avgAge);
      const agePenalty = Math.max(0.5, 1 - 0.04 * yearsOver ** 2);

      const raw = {};
      if (!isPitcher) {
        raw.k_pct   = (s.so || 0) / sample;
        raw.bb_pct  = (s.bb || 0) / sample;
        raw.iso     = (parseFloat(s.slg) || 0) - (parseFloat(s.avg) || 0);
        const tob   = (s.h || 0) + (s.bb || 0) + (s.hbp || 0);
        raw.sb_rate = tob > 0 ? (s.sb || 0) / tob : 0;
      } else {
        const bf = s.bf || 0;
        raw.k_pct  = bf > 0 ? (s.so || 0) / bf : null;
        raw.bb_pct = bf > 0 ? (s.bb || 0) / bf : null;
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

        const k = getElasticity(isPitcher, level, stat);
        const zAdj = z * Math.exp(k * ageDiff);
        const rawPred = levelModel.slope * zAdj + levelModel.intercept;
        const pred = rawPred * agePenalty;
        const recencyDecay = Math.pow(0.75, CURRENT_YEAR - year);
        const weight = levelModel.corr * sample * recencyDecay;
        const contrib = pred * weight;

        wSum += contrib;
        wTot += weight;

        console.log(
          `${String(year).padEnd(6)} ${level.padEnd(10)} ${String(age).padEnd(5)} ${String(avgAge).padEnd(9)} ${yearsOver.toFixed(1).padEnd(9)} ${agePenalty.toFixed(3).padEnd(9)} ${stat.padEnd(10)} ${v.toFixed(4).padEnd(8)} ${sn.mean.toFixed(4).padEnd(11)} ${z.toFixed(3).padEnd(8)} ${k.toFixed(4).padEnd(9)} ${zAdj.toFixed(3).padEnd(8)} ${rawPred.toFixed(3).padEnd(8)} ${pred.toFixed(3).padEnd(10)} ${String(Math.round(sample)).padEnd(8)} ${recencyDecay.toFixed(3).padEnd(7)} ${levelModel.corr.toFixed(3).padEnd(7)} ${weight.toFixed(2).padEnd(10)} ${contrib.toFixed(3)}`
        );
      }
      totalSample += sample;
    }

    console.log('-'.repeat(160));
    const rawScore = wTot > 0 ? wSum / wTot : null;
    console.log(`  wSum=${wSum.toFixed(3)} wTot=${wTot.toFixed(3)} rawScore=${rawScore != null ? rawScore.toFixed(3) : 'null'} totalSample=${Math.round(totalSample)}`);
    if (rawScore != null) {
      console.log(`  [Normalization happens pool-wide — see final model_scores above for normed+shrunk result]`);
    }
  }
}
