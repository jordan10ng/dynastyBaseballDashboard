const fs = require('fs');
const f = process.env.HOME + '/Desktop/fantasy-baseball/scripts/sync-stats-gha.js';
let s = fs.readFileSync(f, 'utf8');

s = s.replace(
  `const LEVEL_ORDER = ['AAA','AA','A+','A','ROK']`,
  `const LEVEL_ORDER = ['AAA','AA','High-A','Single-A','ROK','DSL']`
);

s = s.replace(
  `  const level = isMLB ? 'MLB' : (() => {\n    const abbrs = splits.map(s => s.sport?.abbreviation ?? '')\n    for (const lv of LEVEL_ORDER) {\n      if (abbrs.some(a => sportAbbrToLevel({abbreviation: a}) === lv)) return lv\n    }\n    return 'MiLB'\n  })()`,
  `  const level = isMLB ? 'MLB' : (() => {\n    const levels = splits.map(s => sportAbbrToLevel(s.sport))\n    for (const lv of LEVEL_ORDER) {\n      if (levels.includes(lv)) return lv\n    }\n    return 'MiLB'\n  })()`
);

fs.writeFileSync(f, s);
console.log('done');
