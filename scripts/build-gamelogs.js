const fs   = require('fs');
const path = require('path');
const os   = require('os');

const BASE    = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS = JSON.parse(fs.readFileSync(path.join(BASE, 'players.json'), 'utf8'));
const OUT_DIR = path.join(BASE, 'history/gamelogs');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const DELAY_MS = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HISTORY_DIR = path.join(BASE, 'history');
const YEARS = fs.readdirSync(HISTORY_DIR)
  .filter(f => /^\d{4}\.json$/.test(f))
  .map(f => parseInt(f))
  .filter(y => y >= 2015)
  .sort();

async function fetchLogs(mlbamId, group, year) {
  const base = `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&season=${year}&group=${group}&gameType=R`;
  const [mlbRes, milbRes] = await Promise.all([fetch(base), fetch(base+'&leagueListId=milb_all')]);
  const mlbData = mlbRes.ok ? await mlbRes.json() : {};
  const milbData = milbRes.ok ? await milbRes.json() : {};
  const mlbSplits = mlbData.stats?.[0]?.splits ?? [];
  const milbSplits = milbData.stats?.[0]?.splits ?? [];
  const all = [...mlbSplits, ...milbSplits];
  // dedupe by date+opponent
  const seen = new Set();
  return all.filter(s => {
    const key = (s.date??'')+'|'+(s.opponent?.abbreviation??s.opponent?.name??s.opponent?.id??'');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(s => ({
    date: s.date,
    opponent: s.opponent?.abbreviation ?? s.opponent?.name ?? '?',
    isHome: s.isHome,
    level: s.sport?.abbreviation ?? s.team?.sport?.abbreviation ?? null,
    group,
    ...s.stat,
  }));
}

async function run() {
  const players = Object.values(PLAYERS).filter(p => p.mlbam_id && p.rank != null);
  const currentYear = new Date().getFullYear();
  console.log(`Pulling game logs for ${players.length} ranked players, years ${YEARS[0]}–${YEARS[YEARS.length-1]}...`);

  let done = 0, skipped = 0, errors = 0;

  for (const p of players) {
    const posList = (p.positions || '').split(',').map(s => s.trim());
    const hasArm = posList.some(x => ['SP','RP','P'].includes(x));
    const hasBat = posList.some(x => !['SP','RP','P'].includes(x));

    for (const year of YEARS) {
      const yearDir = path.join(OUT_DIR, String(year));
      if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir);
      const outPath = path.join(yearDir, `${p.mlbam_id}.json`);

      if (fs.existsSync(outPath) && year === currentYear) {
        const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        const lastDate = existing.hitting?.at(-1)?.date ?? existing.pitching?.at(-1)?.date ?? '';
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (lastDate >= yesterday) { skipped++; continue; }
      }

      try {
        const result = {};
        if (hasBat || (!hasArm && !hasBat)) {
          result.hitting = await fetchLogs(p.mlbam_id, 'hitting', year);
          await sleep(DELAY_MS);
        }
        if (hasArm) {
          result.pitching = await fetchLogs(p.mlbam_id, 'pitching', year);
          await sleep(DELAY_MS);
        }
        fs.writeFileSync(outPath, JSON.stringify(result));
        done++;
        if (done % 200 === 0) console.log(`  ${done} done, ${skipped} skipped, ${errors} errors`);
      } catch (e) {
        errors++;
        console.error(`  Error ${p.name} (${p.mlbam_id}) ${year}:`, e.message);
      }
    }
  }
  console.log(`\nDone. ${done} pulled, ${skipped} skipped, ${errors} errors.`);
}

run();
