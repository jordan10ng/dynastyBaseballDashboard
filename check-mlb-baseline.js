const fs = require('fs'), path = require('path'), os = require('os');
const BASE = path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const norms = JSON.parse(fs.readFileSync(path.join(BASE, 'model/norms.json')));
const regression = JSON.parse(fs.readFileSync(path.join(BASE, 'model/regression.json')));

// For a player with pred=100 (exactly average MLB hit tool):
// 100 = slope * z + intercept  =>  z = (100 - intercept) / slope
// Then raw_stat = mean + z * stdev

const levels = ['Complex','Single-A','High-A','AA','AAA'];
const stats = { hit: ['k_pct','bb_pct'], power: ['iso'] };

console.log('\nWhat stat line = 100 MLB grade at each level (z that produces pred=100):');
console.log('(Emerson comparison in parens)\n');

const emerson = {
  'Complex':  { k_pct: 0.171, bb_pct: 0.171, iso: 0.250 },
  'Single-A': { k_pct: 0.140, bb_pct: 0.181, iso: 0.134 },
  'High-A':   { k_pct: 0.165, bb_pct: 0.131, iso: 0.172 },
  'AA':       { k_pct: 0.193, bb_pct: 0.087, iso: 0.148 },
  'AAA':      { k_pct: 0.222, bb_pct: 0.111, iso: 0.363 },
};

for (const level of levels) {
  console.log('  ' + level);
  for (const [tool, statList] of Object.entries(stats)) {
    for (const stat of statList) {
      const lm = regression.models?.[tool]?.[level]?.[stat];
      if (!lm) continue;
      const normEntry = norms[level+'|2025'] || norms[level+'|2024'] || norms[level+'|2023'];
      if (!normEntry) continue;
      const n = normEntry.hitters?.[stat];
      if (!n) continue;

      // z that gives pred=100
      const z100 = (100 - lm.intercept) / lm.slope;
      // flip back for k_pct (we negated z)
      const zForStat = (stat === 'k_pct') ? -z100 : z100;
      const statVal = n.mean + zForStat * n.stdev;

      const em = emerson[level]?.[stat];
      const emZ = stat === 'k_pct'
        ? -((em - n.mean) / n.stdev)
        : (em - n.mean) / n.stdev;
      const emPred = lm.slope * emZ + lm.intercept;

      console.log('    ' + tool.padEnd(6) + ' ' + stat.padEnd(8) +
        ' 100-grade stat: ' + statVal.toFixed(3) +
        '  Emerson: ' + (em?.toFixed(3) ?? 'n/a') +
        '  Emerson pred: ' + emPred.toFixed(1));
    }
  }
  console.log();
}
