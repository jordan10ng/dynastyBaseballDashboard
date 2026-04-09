const fs = require('fs'), path = require('path'), os = require('os');
const BASE = path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const norms = JSON.parse(fs.readFileSync(path.join(BASE, 'model/norms.json')));
const elast = JSON.parse(fs.readFileSync(path.join(BASE, 'model/age-elasticity.json')));

// Show: for each level, what z-adjustment does a player 3 years young get per stat?
const levels = ['DSL','Complex','Rookie','Single-A','High-A','AA','AAA'];
const hitterStats = ['k_pct','bb_pct','iso','sb_rate'];
const pitcherStats = ['k_pct','bb_pct'];
const ageDiff = 3;

console.log('\nHITTERS — z-adjustment for player 3 years younger than avg at level:');
console.log('level        stat        k        stdev    z-adj');
for (const level of levels) {
  for (const stat of hitterStats) {
    const k = elast.hitters?.[level]?.[stat]?.k;
    if (k == null) continue;
    let stdev = null;
    for (let y = 2025; y >= 2022; y--) {
      const s = norms[`${level}|${y}`]?.hitters?.[stat]?.stdev;
      if (s) { stdev = s; break; }
    }
    if (!stdev) continue;
    const zadj = (ageDiff * k) / stdev;
    console.log(level.padEnd(12), stat.padEnd(12), String(k).padEnd(8), stdev.toFixed(4).padEnd(8), zadj.toFixed(3));
  }
}
