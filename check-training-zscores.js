const fs = require('fs'), path = require('path');
const BASE = path.join(require('os').homedir(), 'Desktop/fantasy-baseball/data');
const norms = JSON.parse(fs.readFileSync(path.join(BASE, 'model/norms.json')));
const mlbTools = JSON.parse(fs.readFileSync(path.join(BASE, 'model/mlb-tools.json')));
const VALID_YEARS = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025]);
const MILB_LEVELS = ['DSL','Complex','Rookie','Single-A','High-A','AA','AAA'];
const history = {};
for (const f of fs.readdirSync(path.join(BASE,'history')).filter(f => /^\d{4}\.json$/.test(f))) {
  const year = parseInt(f);
  if (!VALID_YEARS.has(year)) continue;
  const data = JSON.parse(fs.readFileSync(path.join(BASE,'history',f)));
  for (const [id,seasons] of Object.entries(data)) {
    if (!history[id]) history[id] = [];
    for (const s of seasons) history[id].push({...s, year});
  }
}
// For each level, what is the mean z-score of MLB-bound players vs all players
const levelStats = {};
for (const [mlbamId] of Object.entries(mlbTools)) {
  const seasons = (history[String(mlbamId)] || []).filter(s => MILB_LEVELS.includes(s.level) && VALID_YEARS.has(s.year));
  for (const s of seasons) {
    const n = norms[s.level+'|'+s.year]?.hitters;
    if (!n || !s.pa || s.pa < 30) continue;
    const iso = (parseFloat(s.slg)||0) - (parseFloat(s.avg)||0);
    const isoN = n.iso;
    if (!isoN || isoN.stdev === 0) continue;
    const z = (iso - isoN.mean) / isoN.stdev;
    if (!levelStats[s.level]) levelStats[s.level] = [];
    levelStats[s.level].push(z);
  }
}
console.log('Mean ISO z-score of MLB-bound players at each level (full pop norms):');
console.log('(0 = average minor leaguer, positive = above average)');
for (const level of MILB_LEVELS) {
  const zs = levelStats[level] || [];
  if (!zs.length) continue;
  const mean = zs.reduce((a,b)=>a+b,0)/zs.length;
  console.log(level.padEnd(12), 'mean z:', mean.toFixed(3), ' n:', zs.length);
}
