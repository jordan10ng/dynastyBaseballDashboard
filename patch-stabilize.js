const fs = require('fs'), path = require('path'), os = require('os');
const file = path.join(os.homedir(), 'Desktop/fantasy-baseball/scripts/build-scores.js');
let src = fs.readFileSync(file, 'utf8');

const OLD = `const SHRINK_K = { hitter: 200, pitcher: 80 };`;

const NEW = `const SHRINK_K = { hitter: 200, pitcher: 80 };
// Per-stat stabilization points
const STAT_SHRINK_K = {
  k_pct_hitter: 60, bb_pct_hitter: 120, iso: 120, sb_rate: 60,
  k_pct_pitcher: 20, bb_pct_pitcher: 40,
};
function statShrinkK(stat, isPitcher) {
  if (stat === 'k_pct') return isPitcher ? STAT_SHRINK_K.k_pct_pitcher : STAT_SHRINK_K.k_pct_hitter;
  if (stat === 'bb_pct') return isPitcher ? STAT_SHRINK_K.bb_pct_pitcher : STAT_SHRINK_K.bb_pct_hitter;
  return STAT_SHRINK_K[stat] ?? (isPitcher ? SHRINK_K.pitcher : SHRINK_K.hitter);
}`;

if (!src.includes(OLD)) { console.error('SHRINK_K not found'); process.exit(1); }
src = src.replace(OLD, NEW);

const OLD2 = `      const pred         = levelModel.slope * z + levelModel.intercept;
      const recencyDecay = Math.pow(0.75, CURRENT_YEAR - year);
      const weight       = levelModel.corr * sample * recencyDecay;`;

const NEW2 = `      const pred         = levelModel.slope * z + levelModel.intercept;
      const recencyDecay = Math.pow(0.75, CURRENT_YEAR - year);
      const statConf     = sample / (sample + statShrinkK(stat, isPitcher));
      const weight       = levelModel.corr * statConf * recencyDecay;`;

if (!src.includes(OLD2)) { console.error('weight line not found'); process.exit(1); }
src = src.replace(OLD2, NEW2);

fs.writeFileSync(file, src);
console.log('build-scores.js patched');
