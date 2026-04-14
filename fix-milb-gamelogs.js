const fs = require('fs');
const f = process.env.HOME + '/Desktop/fantasy-baseball/components/players/PlayerDrawer.tsx';
let s = fs.readFileSync(f, 'utf8');

const OLD = `fetch(\`https://statsapi.mlb.com/api/v1/people/\${mlbamId}/stats?stats=gameLog&group=\${group}&season=\${season}&gameType=R\`).then(r=>r.json()),
    ]).then(([situData,gameLogData])=>{
      setSituSplits(situData.stats?.[0]?.splits??[])
      const logs=gameLogData.stats?.[0]?.splits??[]`;

const NEW = `fetch(\`https://statsapi.mlb.com/api/v1/people/\${mlbamId}/stats?stats=gameLog&group=\${group}&season=\${season}&gameType=R\`).then(r=>r.json()),
      fetch(\`https://statsapi.mlb.com/api/v1/people/\${mlbamId}/stats?stats=gameLog&group=\${group}&season=\${season}&gameType=R&leagueListId=milb_all\`).then(r=>r.json()),
    ]).then(([situData,gameLogData,milbGameLogData])=>{
      setSituSplits(situData.stats?.[0]?.splits??[])
      const mlbLogs=gameLogData.stats?.[0]?.splits??[]
      const milbLogs=milbGameLogData.stats?.[0]?.splits??[]
      const logs=[...mlbLogs,...milbLogs]`;

if (!s.includes(OLD)) { console.error('NOT FOUND'); process.exit(1); }
s = s.replace(OLD, NEW);
fs.writeFileSync(f, s);
console.log('done');
