const fs = require('fs');
const f = process.env.HOME + '/Desktop/fantasy-baseball/components/players/PlayerDrawer.tsx';
let s = fs.readFileSync(f, 'utf8');

const OLD = `fetch(\`https://statsapi.mlb.com/api/v1/people/\${mlbamId}/stats?stats=statSplits&group=\${group}&season=\${season}&sitCodes=vl,vr,h,a&gameType=R\`).then(r=>r.json()),`;

const NEW = `fetch(\`https://statsapi.mlb.com/api/v1/people/\${mlbamId}/stats?stats=statSplits&group=\${group}&season=\${season}&sitCodes=vl,vr,h,a&gameType=R\`).then(r=>r.json()),
      fetch(\`https://statsapi.mlb.com/api/v1/people/\${mlbamId}/stats?stats=statSplits&group=\${group}&season=\${season}&sitCodes=vl,vr,h,a&gameType=R&leagueListId=milb_all\`).then(r=>r.json()),`;

const OLD2 = `]).then(([situData,gameLogData,milbGameLogData])=>{
      setSituSplits(situData.stats?.[0]?.splits??[])`;

const NEW2 = `]).then(([situData,milbSituData,gameLogData,milbGameLogData])=>{
      const mlbSitu=situData.stats?.[0]?.splits??[]
      const milbSitu=milbSituData.stats?.[0]?.splits??[]
      const mergedSitu=mlbSitu.length>0?mlbSitu:milbSitu
      setSituSplits(mergedSitu)`;

if (!s.includes(OLD)) { console.error('OLD1 NOT FOUND'); process.exit(1); }
if (!s.includes(OLD2)) { console.error('OLD2 NOT FOUND'); process.exit(1); }
s = s.replace(OLD, NEW);
s = s.replace(OLD2, NEW2);
fs.writeFileSync(f, s);
console.log('done');
