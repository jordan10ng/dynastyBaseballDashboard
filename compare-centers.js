const players = JSON.parse(require('fs').readFileSync(require('os').homedir()+'/Desktop/fantasy-baseball/data/players.json'));
const names = ['Colt Emerson','Konnor Griffin','Leodalis De Vries','Sebastian Walcott'];
const SHRINK_K = { hitter: 200, pitcher: 80 };

const OLD = {
  'Colt Emerson':     { hit:114, power:113, speed:96,  ovr:123 },
  'Konnor Griffin':   { hit:103, power:123, speed:118, ovr:123 },
  'Leodalis De Vries':{ hit:108, power:128, speed:94,  ovr:128 },
  'Sebastian Walcott':{ hit:106, power:111, speed:109, ovr:121 },
};

function shrink(score, sample, center) {
  const conf = sample / (sample + SHRINK_K.hitter);
  return Math.round(center + (score - center) * conf);
}

for (const n of names) {
  const p = Object.values(players).find(pl => pl.name === n);
  if (!p) continue;
  const ms = p.model_scores;
  const sample = ms._sample;
  const raw = ms._raw;
  console.log('\n' + n + '  (sample:' + sample + ')');
  console.log('  raw:        hit:' + raw.hit + '  pwr:' + raw.power + '  spd:' + raw.speed);
  for (const center of [88, 93, 95]) {
    const hit = shrink(raw.hit, sample, center);
    const pwr = shrink(raw.power, sample, center);
    const spd = shrink(raw.speed, sample, center);
    const ovr = Math.round(hit*0.42 + pwr*0.47 + spd*0.11);
    console.log('  center=' + center + ':  hit:' + hit + '  pwr:' + pwr + '  spd:' + spd + '  ovr:' + ovr);
  }
  const o = OLD[n];
  console.log('  OLD:        hit:' + o.hit + '  pwr:' + o.power + '  spd:' + o.speed + '  ovr:' + o.ovr);
}
