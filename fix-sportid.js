const fs = require('fs');

const SPORT_ID_MAP = `const SPORT_ID_TO_LEVEL = { 1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'Single-A', 15: 'ROK', 16: 'DSL', 17: 'ROK', 19: 'ROK' };`;

function patch(f, isTS) {
  let s = fs.readFileSync(f, 'utf8');
  const typeAnnotation = isTS ? ': string' : '';
  const paramType = isTS ? 'sport: any' : 'sport';
  const mapType = isTS ? ': Record<number,string>' : '';

  const oldFn = isTS
    ? `function sportAbbrToLevel(abbr: string): string {\n  if (abbr === 'AAA') return 'AAA'\n  if (abbr === 'AA') return 'AA'\n  if (abbr === 'A+' || abbr === 'HiA') return 'High-A'\n  if (abbr === 'A' || abbr === 'LoA' || abbr === 'A(Short)') return 'Single-A'\n  if (abbr === 'ROK' || abbr === 'Rk') return 'ROK'\n  return 'Other'\n}`
    : `function sportAbbrToLevel(abbr) {\n  if (abbr === 'AAA') return 'AAA'\n  if (abbr === 'AA') return 'AA'\n  if (abbr === 'A+' || abbr === 'HiA') return 'High-A'\n  if (abbr === 'A' || abbr === 'LoA' || abbr === 'A(Short)') return 'Single-A'\n  if (abbr === 'ROK' || abbr === 'Rk') return 'ROK'\n  return 'Other'\n}`;

  const newFn = `const SPORT_ID_TO_LEVEL${mapType} = { 1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'Single-A', 15: 'ROK', 16: 'DSL', 17: 'ROK', 19: 'ROK' };
function sportAbbrToLevel(${paramType})${typeAnnotation} {
  if (!sport) return 'Other';
  if (sport.id && SPORT_ID_TO_LEVEL[sport.id]) return SPORT_ID_TO_LEVEL[sport.id];
  const abbr = sport.abbreviation || '';
  if (abbr === 'AAA') return 'AAA';
  if (abbr === 'AA') return 'AA';
  if (abbr === 'A+' || abbr === 'HiA') return 'High-A';
  if (abbr === 'A' || abbr === 'LoA' || abbr === 'A(Short)') return 'Single-A';
  if (abbr === 'ROK' || abbr === 'Rk') return 'ROK';
  return 'Other';
}`;

  if (!s.includes(oldFn)) { console.error('NOT FOUND in', f); return; }
  s = s.replace(oldFn, newFn);
  s = s.replace(/sportAbbrToLevel\(a\)/g, 'sportAbbrToLevel({abbreviation: a})');
  fs.writeFileSync(f, s);
  console.log('patched', f);
}

patch(process.env.HOME + '/Desktop/fantasy-baseball/scripts/sync-stats-gha.js', false);
patch(process.env.HOME + '/Desktop/fantasy-baseball/app/api/stats/sync/route.ts', true);
