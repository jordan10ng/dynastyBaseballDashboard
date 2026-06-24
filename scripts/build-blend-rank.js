const fs = require('fs'), path = require('path'), os = require('os');
const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');

const RANKINGS_PATH  = path.join(BASE, 'rankings/rankings.json');
const MODELRANK_PATH = path.join(BASE, 'model/model-rank.json');
const OUT_PATH       = path.join(BASE, 'model/blend-rank.json');
const PLAYERS_PATH   = path.join(BASE, 'players.json');

const players   = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const rankings  = JSON.parse(fs.readFileSync(RANKINGS_PATH, 'utf8'));
const modelRank = JSON.parse(fs.readFileSync(MODELRANK_PATH, 'utf8'));

// Staleness
const sources = rankings.sourcesUsed ?? [];
let weightSum=0, dateSum=0;
for (const s of sources) { dateSum+=new Date(s.date).getTime()*s.weight; weightSum+=s.weight; }
const effectiveDate = new Date(dateSum/weightSum);
const daysSince = (Date.now()-effectiveDate.getTime())/(1000*60*60*24);
const staleness = Math.min(daysSince/365,1.0);
const consensusW = 1.0, modelW = 0.0; // model blend disabled — re-enable when model is stable

console.log(`Effective date: ${effectiveDate.toISOString().slice(0,10)}, staleness: ${(staleness*100).toFixed(1)}%`);
console.log(`Weights — consensus: ${(consensusW*100).toFixed(1)}%, model: ${(modelW*100).toFixed(1)}%`);

const consensusMap = {};
for (const p of (rankings.overall??[])) { if(p.id&&p.rank) consensusMap[p.id]=p.rank; }
const totalRanked = Object.keys(consensusMap).length;
console.log(`Consensus ranked: ${totalRanked}`);

const modelMap = modelRank.players ?? {};

const ranked=[], unranked=[];
for (const [fantraxId, player] of Object.entries(players)) {
  const modelEntry = modelMap[fantraxId];
  const cnsRank = consensusMap[fantraxId] ?? null;
  // Keep any player with a rank source: consensus and/or model.
  // Consensus-ranked players without a model entry must still be ranked.
  if (!modelEntry && !cnsRank) continue;
  const mRank   = modelEntry ? modelEntry.model_rank : null;

  if (cnsRank) {
    // ranked: blend consensus + model (mRank may be null when no model entry)
    const blended = mRank != null ? cnsRank*consensusW + mRank*modelW : cnsRank;
    ranked.push({ fantraxId, name:player.name, age:player.age, cns_rank:cnsRank, model_rank:mRank,
      blended_rank:blended, overall:modelEntry?.overall ?? null, dynasty_score:modelEntry?.dynasty_score ?? null,
      level:modelEntry?.level ?? null, pos_type:modelEntry?.pos_type ?? null, mlbam_id:modelEntry?.mlbam_id ?? player.mlbam_id ?? null });
  } else {
    // unranked: model rank only, will be offset below ranked players
    unranked.push({ fantraxId, name:player.name, age:player.age, cns_rank:null, model_rank:mRank,
      blended_rank:mRank, overall:modelEntry.overall, dynasty_score:modelEntry.dynasty_score,
      level:modelEntry.level, pos_type:modelEntry.pos_type, mlbam_id:modelEntry.mlbam_id });
  }
}

// Sort each group
ranked.sort((a,b)=>a.blended_rank-b.blended_rank);
unranked.sort((a,b)=>a.model_rank-b.model_rank);

// Assign final ranks — ranked players first, then unranked
ranked.forEach((r,i)=>r.final_rank=i+1);
unranked.forEach((r,i)=>r.final_rank=ranked.length+i+1);

// --- Insert X candidates ---
// nonGradRanked: consensus-ranked players with minors_rank (non-graduated prospects), sorted by final_rank
const xCandidates = rankings.xCandidates ?? [];
const nonGradRanked = ranked.filter(r => players[r.fantraxId]?.minors_rank !== undefined);
// nonGradRanked is already sorted by final_rank since ranked is sorted

const xEntries = [];
for (const xc of xCandidates) {
  const anchor = nonGradRanked[xc.targetPPosition - 1];
  if (!anchor) continue;
  xEntries.push({ fantraxId: xc.id ?? '', name: xc.name, position: xc.position ?? '', team: xc.team ?? '',
    sortKey: anchor.final_rank + 0.5, cns_rank: null, model_rank: null, blended_rank: null,
    overall: null, dynasty_score: null, level: null, pos_type: null, mlbam_id: null, age: null });
}

// Merge ranked + X entries, re-sort, reassign final ranks
const allRankedAndX = [
  ...ranked.map(r => ({ ...r, sortKey: r.final_rank })),
  ...xEntries,
];
allRankedAndX.sort((a,b) => a.sortKey - b.sortKey);
allRankedAndX.forEach((r,i) => r.final_rank = i+1);

// Append unranked after (offset by allRankedAndX length)
unranked.forEach((r,i) => r.final_rank = allRankedAndX.length + i + 1);

const all=[...allRankedAndX,...unranked];

console.log(`X candidates inserted: ${xEntries.length} of ${xCandidates.length}`);

// Write output
const output = {
  generatedAt: new Date().toISOString(),
  effectiveDate: effectiveDate.toISOString().slice(0,10),
  daysSince: Math.round(daysSince),
  staleness: +staleness.toFixed(4),
  consensusW: +consensusW.toFixed(4),
  modelW: +modelW.toFixed(4),
  players: {},
};
for (const r of all) {
  if (!r.fantraxId) continue;
  output.players[r.fantraxId] = {
    mlbam_id:     r.mlbam_id,
    name:         r.name,
    final_rank:   r.final_rank,
    cns_rank:     r.cns_rank,
    model_rank:   r.model_rank,
    blended_rank: r.blended_rank != null ? +r.blended_rank.toFixed(1) : null,
    overall:      r.overall,
    dynasty_score:r.dynasty_score,
    level:        r.level,
    pos_type:     r.pos_type,
  };
}
fs.writeFileSync(OUT_PATH, JSON.stringify(output,null,2));

console.log(`\nblend-rank.json written: ${ranked.length} ranked + ${unranked.length} unranked = ${all.length} total`);
console.log('\n=== Top 25 blended (ranked players only first) ===');
ranked.slice(0,25).forEach(r=>{
  console.log(String(r.final_rank).padStart(3), r.name.padEnd(26),
    'cns='+String(r.cns_rank).padStart(4), 'model='+String(r.model_rank).padStart(5),
    'blend='+r.blended_rank.toFixed(0).padStart(5),
    'ovr='+String(r.overall).padStart(3), 'age='+String(r.age||'?').padStart(2),
    (r.level||'—').padEnd(8));
});
console.log('\n=== Top 10 unranked by model ===');
unranked.slice(0,10).forEach(r=>{
  console.log(String(r.final_rank).padStart(5), r.name.padEnd(26),
    'model='+String(r.model_rank).padStart(5),
    'ovr='+String(r.overall).padStart(3), 'age='+String(r.age||'?').padStart(2),
    (r.level||'—').padEnd(8));
});

// Write final_rank back to players.json as rank field
const playersOut = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
// Clear stale ranks so players dropped from this run don't keep old values
for (const p of Object.values(playersOut)) { if (p.rank !== undefined) delete p.rank; }
let updated = 0;
for (const r of all) {
  if (playersOut[r.fantraxId]) {
    playersOut[r.fantraxId].rank = r.final_rank;
    updated++;
  }
}
fs.writeFileSync(PLAYERS_PATH, JSON.stringify(playersOut, null, 2));
console.log(`players.json updated: ${updated} ranks written`);
