const fs = require('fs'), path = require('path');
const BASE = path.join(require('os').homedir(), 'Desktop/fantasy-baseball/data');
const mlbTools = JSON.parse(fs.readFileSync(path.join(BASE, 'model/mlb-tools.json')));
const mlbSet = new Set(Object.keys(mlbTools));
const LEVELS = ['DSL','Complex','Rookie','Single-A','High-A','AA','AAA'];
const VALID_YEARS = [2015,2016,2017,2018,2019,2021,2022,2023,2024,2025];
const counts = {};
for (const year of VALID_YEARS) {
  const fpath = path.join(BASE, 'history', year+'.json');
  if (!fs.existsSync(fpath)) continue;
  const data = JSON.parse(fs.readFileSync(fpath));
  for (const [mlbamId, seasons] of Object.entries(data)) {
    const isMLB = mlbSet.has(String(mlbamId));
    for (const s of seasons) {
      if (!LEVELS.includes(s.level)) continue;
      const key = s.level + '|' + year;
      if (!counts[key]) counts[key] = {total:0, mlbBound:0};
      counts[key].total++;
      if (isMLB) counts[key].mlbBound++;
    }
  }
}
console.log('level        year   total  mlbBound  pct');
for (const level of LEVELS) {
  for (const year of VALID_YEARS) {
    const k = level+'|'+year;
    const c = counts[k];
    if (!c) continue;
    const pct = (c.mlbBound/c.total*100).toFixed(1);
    console.log(level.padEnd(12), year, String(c.total).padStart(7), String(c.mlbBound).padStart(9), (pct+'%').padStart(7));
  }
}
