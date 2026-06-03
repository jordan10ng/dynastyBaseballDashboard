const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { blendCareer } = require('../lib/score-tools');

const BASE         = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH = path.join(BASE, 'players.json');
const OUT_PATH     = path.join(BASE, 'model/model-rank.json');
const MLBTOOLS_PATH = path.join(BASE, 'model/mlb-tools.json');
const HISTORY_PATH = path.join(BASE, `history/${new Date().getFullYear()}.json`);

const players  = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const mlbTools = JSON.parse(fs.readFileSync(MLBTOOLS_PATH, 'utf8'));
const history  = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));

const LEVEL_ORDER = ['MLB','AAA','AA','High-A','Single-A','ROK','DSL'];

function resolveLevel(mlbam_id) {
  const rows = (history[String(mlbam_id)] || []).filter(r => r._season === new Date().getFullYear());
  if (!rows.length) return null;
  if (rows.some(r => r.level === 'MLB')) return 'MLB';
  for (const lv of LEVEL_ORDER) if (rows.some(r => r.level === lv)) return lv;
  return null;
}

function computeOverall(player) {
  // Pipeline writes player.career_blend (see build-scores.js). Single source of truth.
  // Fallback to live blendCareer for any player the pipeline hasn't blended yet.
  if (player.career_blend) return player.career_blend.overall ?? null;
  const mlbEntry = player.mlbam_id ? mlbTools[String(player.mlbam_id)] : null;
  const blended = blendCareer(player.model_scores ?? null, mlbEntry ?? null);
  return blended?.overall ?? null;
}

function isRP(pos) { return (pos||'').split(',').map(s=>s.trim()).every(p=>['RP','P'].includes(p)); }
function isSP(pos) { return (pos||'').split(',').map(s=>s.trim()).some(p=>p==='SP') && (pos||'').split(',').map(s=>s.trim()).every(p=>['SP','RP','P'].includes(p)); }
function isBat(pos) { return !isRP(pos) && !isSP(pos); }

function levelBon(level) {
  if (!level) return 0;
  if (level === 'MLB')      return 8;
  if (level === 'AAA')      return 3;
  if (level === 'AA')       return -1;
  if (level === 'High-A')   return -3;
  if (level === 'Single-A') return -4;
  return -6;
}
function ageBon(age) {
  if (!age) return 0;
  return (27 - age) * 0.6;
}

// Build scored pool
const all = [];
for (const [fantraxId, player] of Object.entries(players)) {
  const overall = computeOverall(player);
  if (!overall) continue;
  const level = resolveLevel(player.mlbam_id);
  const rp  = isRP(player.positions);
  const sp  = isSP(player.positions);
  const bat = isBat(player.positions);
  const posType = rp ? 'rp' : sp ? 'sp' : 'bat';
  const dynasty = overall
    + levelBon(level)
    + ageBon(player.age)
    + (rp ? -8 : 0);
  all.push({ fantraxId, mlbam_id: player.mlbam_id, name: player.name, age: player.age,
    positions: player.positions, overall, level, dynasty, posType, rp, sp, bat });
}

// Positional slot normalization
// Consensus proportions: bat=55.9%, SP=31.5%, RP=12.7%
const BAT_PCT = 0.559, SP_PCT = 0.315, RP_PCT = 0.127;

const bats = all.filter(r => r.bat).sort((a,b) => b.dynasty - a.dynasty);
const sps  = all.filter(r => r.sp).sort((a,b) => b.dynasty - a.dynasty);
const rps  = all.filter(r => r.rp).sort((a,b) => b.dynasty - a.dynasty);

bats.forEach((r,i) => r.model_rank = Math.round((i + 0.5) / BAT_PCT));
sps.forEach((r,i)  => r.model_rank = Math.round((i + 0.5) / SP_PCT));
rps.forEach((r,i)  => r.model_rank = Math.round((i + 0.5) / RP_PCT));

// Re-sort by model_rank, deduplicate with sequential ranks
all.sort((a,b) => a.model_rank - b.model_rank || b.dynasty - a.dynasty);
all.forEach((r,i) => r.model_rank = i + 1);

// Build output keyed by fantrax ID
const output = { generatedAt: new Date().toISOString(), players: {} };
for (const r of all) {
  output.players[r.fantraxId] = {
    mlbam_id:     r.mlbam_id ?? null,
    model_rank:   r.model_rank,
    dynasty_score: +r.dynasty.toFixed(1),
    overall:      r.overall,
    level:        r.level ?? null,
    age:          r.age ?? null,
    pos_type:     r.posType,
  };
}

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));

console.log(`model-rank.json written: ${all.length} players`);
console.log(`Top 10:`);
all.slice(0,10).forEach(r =>
  console.log(` ${String(r.model_rank).padStart(4)} ${r.name.padEnd(26)} ovr=${r.overall} dyn=${r.dynasty.toFixed(1)} lvl=${r.level||'—'} pos=${r.posType}`)
);
