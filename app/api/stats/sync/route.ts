import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { loadPlayers, savePlayers } from '@/lib/db'
import fs from 'fs'
import path from 'path'

const BASE = path.join(process.cwd(), 'data')
const PLAYERS_PATH = path.join(BASE, 'players.json')
const CURRENT_SEASON = new Date().getFullYear()
const HISTORY_PATH = path.join(BASE, `history/${CURRENT_SEASON}.json`)

function fmt3(n: number): string {
  return n.toFixed(3).replace(/^0\./, '.')
}

const LEVEL_ORDER = ['AAA','AA','High-A','Single-A','ROK','ACL','FCL','DSL']

const SPORT_ID_TO_LEVEL: Record<number,string> = { 1: 'MLB', 11: 'AAA', 12: 'AA', 13: 'High-A', 14: 'Single-A', 15: 'ROK', 16: 'ROK', 17: 'DSL', 19: 'ROK' };
function sportAbbrToLevel(sport: any): string {
  if (!sport) return 'Other';
  if (sport.id && SPORT_ID_TO_LEVEL[sport.id]) return SPORT_ID_TO_LEVEL[sport.id];
  const abbr = sport.abbreviation || '';
  if (abbr === 'AAA') return 'AAA';
  if (abbr === 'AA') return 'AA';
  if (abbr === 'A+' || abbr === 'HiA') return 'High-A';
  if (abbr === 'A' || abbr === 'LoA' || abbr === 'A(Short)') return 'Single-A';
  if (abbr === 'ROK' || abbr === 'Rk') return 'ROK';
  return 'Other';
}

function splitsToRow(splits: any[], group: string, isMLB: boolean): any {
  const t: any = group === 'pitching' ? {
    gamesPlayed:0, gamesStarted:0, wins:0, losses:0, saves:0, holds:0, blownSaves:0,
    earnedRuns:0, atBats:0, baseOnBalls:0, strikeOuts:0, hitByPitch:0, hits:0, battersFaced:0,
    airOuts:0, groundOuts:0, doubles:0, triples:0, homeRuns:0, runs:0, stolenBases:0,
    caughtStealing:0, totalBases:0,
  } : {
    gamesPlayed:0, atBats:0, plateAppearances:0, hits:0, doubles:0, triples:0,
    homeRuns:0, rbi:0, runs:0, stolenBases:0, caughtStealing:0, baseOnBalls:0,
    strikeOuts:0, hitByPitch:0, totalBases:0, intentionalWalks:0, airOuts:0, groundOuts:0,
  }

  let totalOuts = 0

  for (const s of splits) {
    for (const k of Object.keys(t)) {
      t[k] += s[k] ?? 0
    }
    if (group === 'pitching' && s.inningsPitched) {
      const parts = String(s.inningsPitched).split('.')
      totalOuts += parseInt(parts[0]) * 3 + parseInt(parts[1] ?? '0')
    }
  }

  const team = splits[0]?.team?.name ?? ''
  const level = isMLB ? 'MLB' : (() => {
    const levels = splits.map((s: any) => sportAbbrToLevel(s.sport))
    for (const lv of LEVEL_ORDER) {
      if (levels.includes(lv)) return lv
    }
    const sid = splits[0]?.sport?.id ?? 0
    if (sid === 16) {
      if (team.includes('ACL')) return 'ACL'
      if (team.includes('FCL')) return 'FCL'
    }
    return SPORT_ID_TO_LEVEL[sid] ?? 'MiLB'
  })()
  const sportId = isMLB ? 1 : (splits[0]?.sport?.id ?? 0)

  if (group === 'pitching') {
    const ip = `${Math.floor(totalOuts / 3)}.${totalOuts % 3}`
    const era = totalOuts ? (t.earnedRuns * 27 / totalOuts).toFixed(2) : null
    const whip = totalOuts ? ((t.hits + t.baseOnBalls) / (totalOuts / 3)).toFixed(2) : null
    const baa = t.atBats ? fmt3(t.hits / t.atBats) : null
    const row: any = {
      type: 'pitching', team, league: '', level, sportId,
      g: t.gamesPlayed, gs: t.gamesStarted, w: t.wins, l: t.losses,
      sv: t.saves, hld: t.holds, bs: t.blownSaves,
      ip, er: t.earnedRuns, bf: t.battersFaced,
      bb: t.baseOnBalls, so: t.strikeOuts, hbp: t.hitByPitch,
      h: t.hits, ab: t.atBats, go: t.groundOuts, ao: t.airOuts,
      hr: t.homeRuns, r: t.runs,
      era, whip, baa,
    }
    if (splits.length === 1) {
      row.oObp = splits[0].stat?.obp ?? null
      row.oSlg = splits[0].stat?.slg ?? null
    }
    return row
  } else {
    const avg = t.atBats ? fmt3(t.hits / t.atBats) : null
    const obp = t.plateAppearances ? fmt3((t.hits + t.baseOnBalls + t.hitByPitch) / t.plateAppearances) : null
    const slg = t.atBats ? fmt3(t.totalBases / t.atBats) : null
    const ops = obp && slg ? fmt3(parseFloat('0'+obp) + parseFloat('0'+slg)) : null
    return {
      type: 'hitting', team, league: '', level, sportId,
      g: t.gamesPlayed, ab: t.atBats, pa: t.plateAppearances,
      h: t.hits, doubles: t.doubles, triples: t.triples, hr: t.homeRuns,
      rbi: t.rbi, r: t.runs, sb: t.stolenBases, cs: t.caughtStealing,
      bb: t.baseOnBalls, so: t.strikeOuts, hbp: t.hitByPitch,
      tb: t.totalBases, ibb: t.intentionalWalks,
      go: t.groundOuts, ao: t.airOuts,
      avg, obp, slg, ops,
    }
  }
}

// New draftees/signees often lack an mlbam_id because they aren't indexed by
// MLB's people/search API yet. The per-level roster endpoint (sportId 1 = MLB,
// 11-17 = MiLB levels) does list them by name, so resolve unlinked players here
// before the stats fetch. Ambiguous (non-unique) name matches are skipped rather
// than guessed, since a wrong mlbam_id silently corrupts that player's stats.
const ROSTER_SPORT_IDS = [1, 11, 12, 13, 14, 15, 16, 17]

async function resolveMissingMlbamIds(players: Record<string, any>): Promise<number> {
  const missing = Object.values(players).filter((p: any) => !p.mlbam_id)
  if (missing.length === 0) return 0

  // Ids already claimed by some other player in the pool must never be handed
  // out again here -- two real people can share a name, and if one of them is
  // already correctly linked, the other should stay unlinked rather than be
  // silently merged onto the same id (this exact bug corrupted stats for both).
  const claimedIds = new Set(Object.values(players).filter((p: any) => p.mlbam_id).map((p: any) => String(p.mlbam_id)))

  const nameToIds: Record<string, Set<number>> = {}
  for (const sportId of ROSTER_SPORT_IDS) {
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/sports/${sportId}/players?season=${CURRENT_SEASON}`)
      const data = res.ok ? await res.json() : null
      for (const person of data?.people ?? []) {
        if (!person.fullName || !person.id) continue
        if (!nameToIds[person.fullName]) nameToIds[person.fullName] = new Set()
        nameToIds[person.fullName].add(person.id)
      }
    } catch {}
  }

  let resolved = 0
  for (const player of missing as any[]) {
    const ids = nameToIds[player.name]
    if (!ids) continue
    const candidates = Array.from(ids).filter(id => !claimedIds.has(String(id)))
    if (candidates.length === 1) {
      player.mlbam_id = String(candidates[0])
      claimedIds.add(String(candidates[0]))
      resolved++
    }
  }
  return resolved
}

async function fetchRows(mlbamId: string, group: string): Promise<any[] | null> {
  try {
    const [mlbRes, milbRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=season&season=${CURRENT_SEASON}&group=${group}`),
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=season&season=${CURRENT_SEASON}&group=${group}&leagueListId=milb_all`),
    ])

    const mlbData = mlbRes.ok ? await mlbRes.json() : null
    const milbData = milbRes.ok ? await milbRes.json() : null

    const mlbSplits = (mlbData?.stats?.[0]?.splits ?? []).filter((s: any) => !!s.team)
    const milbSplits = (milbData?.stats?.[0]?.splits ?? []).filter((s: any) => !!s.team && s.sport?.id !== 1)

    const rows: any[] = []
    if (mlbSplits.length > 0) rows.push(splitsToRow(mlbSplits.map((s: any) => ({...s.stat, team: s.team, sport: s.sport})), group, true))
    if (milbSplits.length > 0) { const bySport: Record<string,any[]> = {}; for (const s of milbSplits) { const key = String(s.sport?.id ?? "other"); if (!bySport[key]) bySport[key] = []; bySport[key].push(s); } for (const gs of Object.values(bySport)) { rows.push(splitsToRow(gs.map((s: any) => ({...s.stat, team: s.team, sport: s.sport})), group, false)); } }
    return rows.length > 0 ? rows : null
  } catch {
    return null
  }
}


async function syncGameLogs(players: Record<string,any>) {
  const YEAR = CURRENT_SEASON;
  let history2026: Record<string,any> = {};
  try { history2026 = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8')); } catch {}
  const ranked = Object.values(players).filter((p: any) => p.mlbam_id && p.rank != null && history2026[p.mlbam_id]?.length > 0);
  console.log(`Syncing game logs for ${ranked.length} ranked players...`);
  let done = 0, errors = 0;

  const fetchGL = async (mlbamId: string, group: string) => {
    const base = `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&season=${YEAR}&group=${group}&gameType=R`;
    const [r1, r2] = await Promise.all([fetch(base), fetch(base + '&leagueListId=milb_all')]);
    const d1 = r1.ok ? await r1.json() : {};
    const d2 = r2.ok ? await r2.json() : {};
    const all = [...(d1?.stats?.[0]?.splits ?? []), ...(d2?.stats?.[0]?.splits ?? [])];
    const seen = new Set<string>();
    return all.filter((s: any) => {
      const k = (s.date ?? '') + '|' + (s.opponent?.abbreviation ?? s.opponent?.name ?? '');
      if (seen.has(k)) return false; seen.add(k); return true;
    }).map((s: any) => ({ date: s.date, opponent: s.opponent?.abbreviation ?? s.opponent?.name ?? '?', isHome: s.isHome, level: s.sport?.abbreviation ?? null, group, ...s.stat }));
  }

  const GL_CHUNK = 20;
  for (let gi = 0; gi < ranked.length; gi += GL_CHUNK) {
    await Promise.all((ranked as any[]).slice(gi, gi + GL_CHUNK).map(async (p: any) => {
      try {
        const pos = (p.positions || '').split(',').map((s: string) => s.trim());
        const hasArm = pos.some((x: string) => ['SP','RP','P'].includes(x));
        const hasBat = pos.some((x: string) => !['SP','RP','P'].includes(x));
        const writePath = path.join(process.env.HOME ?? '', `Desktop/fantasy-baseball-gamelogs/${YEAR}/${p.mlbam_id}.json`);

        let existing: any = { hitting: [], pitching: [] };
        if (fs.existsSync(writePath)) {
          try { existing = JSON.parse(fs.readFileSync(writePath, 'utf-8')); } catch {}
        }

        if (hasBat || (!hasArm && !hasBat)) {
          const rows = await fetchGL(p.mlbam_id, 'hitting');
          const existingDates = new Set((existing.hitting ?? []).map((r: any) => r.date + '|' + (r.opponent ?? '')));
          const newRows = rows.filter((r: any) => !existingDates.has(r.date + '|' + (r.opponent ?? '')));
          existing.hitting = [...(existing.hitting ?? []), ...newRows];
        }
        if (hasArm) {
          const rows = await fetchGL(p.mlbam_id, 'pitching');
          const existingDates = new Set((existing.pitching ?? []).map((r: any) => r.date + '|' + (r.opponent ?? '')));
          const newRows = rows.filter((r: any) => !existingDates.has(r.date + '|' + (r.opponent ?? '')));
          existing.pitching = [...(existing.pitching ?? []), ...newRows];
        }

        fs.mkdirSync(path.dirname(writePath), { recursive: true });
        fs.writeFileSync(writePath, JSON.stringify(existing));
        done++;
      } catch (e) { errors++; }
    }));
  }
  console.log(`Game logs done: ${done} updated, ${errors} errors`);
}
export async function POST() {
  const players = loadPlayers()

  const resolved = await resolveMissingMlbamIds(players)
  if (resolved > 0) {
    savePlayers(players)
    console.log(`Resolved mlbam_id for ${resolved} previously-unlinked players`)
  }

  const linked = Object.entries(players).filter(([, p]: any) => p.mlbam_id)
  console.log(`Syncing stats for ${linked.length} linked players into history/${CURRENT_SEASON}.json...`)

  let history: Record<string, any[]> = {}
  try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8')) } catch {}

  let synced = 0, noStats = 0, errors = 0
  const CHUNK_SIZE = 10
  const SAVE_EVERY = 200

  for (let i = 0; i < linked.length; i += CHUNK_SIZE) {
    const chunk = linked.slice(i, i + CHUNK_SIZE)

    await Promise.all(chunk.map(async ([, player]: any) => {
      try {
        const pos = (player.positions || '').split(',').map((s: string) => s.trim())
        const hasArm = pos.some((p: string) => p === 'SP' || p === 'RP' || p === 'P')
        const hasBat = pos.some((p: string) => p !== 'SP' && p !== 'RP' && p !== 'P')
        const groups: string[] = (hasArm && hasBat) ? ['pitching','hitting'] : hasArm ? ['pitching'] : ['hitting']
        const allRows: any[] = []
        for (const group of groups) {
          const rows = await fetchRows(player.mlbam_id, group)
          if (rows) allRows.push(...rows)
        }
        if (allRows.length > 0) {
          const existing = history[player.mlbam_id] ?? []
          const priorRows = existing.filter((r: any) => r._season && r._season !== CURRENT_SEASON)
          history[player.mlbam_id] = [...priorRows, ...allRows.map(r => ({ ...r, _season: CURRENT_SEASON, _synced: new Date().toISOString() }))]
          synced++
        } else {
          noStats++
        }
      } catch { errors++ }
    }))

    if ((i + CHUNK_SIZE) % SAVE_EVERY === 0 || i + CHUNK_SIZE >= linked.length) {
      fs.writeFileSync(HISTORY_PATH, JSON.stringify(history))
    }

    if (i % 1000 === 0) {
      console.log(`  Stats: ${i + chunk.length} / ${linked.length} (synced: ${synced}, noStats: ${noStats}, errors: ${errors})`)
    }
  }

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history))
  await syncGameLogs(players)

  const SCRIPTS = path.join(process.cwd(), 'scripts')
  const modelSteps = [
    { cmd: `node "${SCRIPTS}/build-norms.js"`, label: 'norms' },
    { cmd: `python3 "${SCRIPTS}/build-mlb-tools.py"`, label: 'mlb-tools' },
    { cmd: `python3 "${SCRIPTS}/build-regression.py"`, label: 'regression' },
    { cmd: `node "${SCRIPTS}/build-scores.js"`, label: 'scores' },
    { cmd: `node "${SCRIPTS}/build-model-rank.js"`, label: 'model-rank' },
    { cmd: `node "${SCRIPTS}/build-blend-rank.js"`, label: 'blend-rank' },
  ]
  const modelResults: Record<string, string> = {}
  for (const step of modelSteps) {
    try {
      console.log(`Model: running ${step.label}...`)
      execSync(step.cmd, { stdio: 'inherit', timeout: 5 * 60 * 1000 })
      modelResults[step.label] = 'ok'
    } catch (e: any) {
      modelResults[step.label] = 'error'
      console.error(`Model: ${step.label} failed`, e.message)
    }
  }

  return NextResponse.json({ success: true, linked: linked.length, synced, noStats, errors, model: modelResults })
}
