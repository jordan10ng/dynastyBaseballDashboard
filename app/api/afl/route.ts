// AFL fantasy league standings — read-only. Reads data/afl-rosters-YYYY.json (draft) + data/afl-stats-YYYY.json and
// data/afl-daily-YYYY.json (nightly GHA).
// Standalone: never feeds players.json / norms / model. players.json is only read to map mlbam_id → drawer player id.
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { loadPlayers } from '@/lib/db'

type Pos = 'C' | 'INF' | 'OF' | 'P'
const LINEUP: { slot: string; elig: Pos[] }[] = [
  { slot: 'C',    elig: ['C'] },
  { slot: 'INF',  elig: ['INF'] }, { slot: 'INF', elig: ['INF'] }, { slot: 'INF', elig: ['INF'] }, { slot: 'INF', elig: ['INF'] },
  { slot: 'OF',   elig: ['OF'] },  { slot: 'OF',  elig: ['OF'] },  { slot: 'OF',  elig: ['OF'] },
  { slot: 'Util', elig: ['C', 'INF', 'OF'] },
  { slot: 'P',    elig: ['P'] },   { slot: 'P',   elig: ['P'] },   { slot: 'P',   elig: ['P'] },   { slot: 'P',   elig: ['P'] },
]

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', file), 'utf8')) } catch { return null }
}

function hitPts(s: any): number {
  if (!s) return 0
  return s.TB + s.R + s.RBI + s.BB + s.IBB + s.HBP + s.SB - s.K - s.CS
}

// IP +3/inning on true outs (15.2 IP = 47 outs = 47 pts), not the decimal IP string
function pitPts(s: any): number {
  if (!s) return 0
  return s.OUTS + s.K + 5 * s.W + 5 * s.SV - 5 * s.L - 2 * s.ER - s.H - s.BB - s.HB
}

// Best-ball total for a set of {pos, pts} rows: each pos group is independent, so greedy by pts is optimal
function bestBall(rows: any[]): { total: number; active: Set<any> } {
  const pool = [...rows].sort((a, b) => b.pts - a.pts || a.order - b.order)
  const active = new Set<any>()
  for (const { elig } of LINEUP) {
    const pick = pool.find(r => !active.has(r) && elig.includes(r.pos))
    if (pick) active.add(pick)
  }
  let total = 0
  active.forEach(r => { total += r.pts })
  return { total, active }
}

function addLine(into: Record<string, any>, lines: Record<string, any>) {
  for (const [id, line] of Object.entries(lines ?? {})) {
    const row = into[id] ?? (into[id] = {})
    for (const [k, v] of Object.entries(line as Record<string, number>)) row[k] = (row[k] ?? 0) + v
  }
}

// Per game day: each team's season total through that day (re-optimized), the day's change, rank,
// and every rostered player who played that day. The last day's total is pinned to the live standings
// so the daily deltas always sum exactly to the leaderboard.
function buildDays(rosters: any, daily: any, standings: Record<string, number>, pidByMlbam: Record<string, string>) {
  const dates = Object.keys(daily?.days ?? {}).sort()
  const cum = { hitting: {} as Record<string, any>, pitching: {} as Record<string, any> }
  const prev: Record<string, number> = {}
  const prevRank: Record<string, number> = {}
  return dates.map((date, di) => {
    const day = daily.days[date]
    addLine(cum.hitting, day.hitting)
    addLine(cum.pitching, day.pitching)
    const teams: Record<string, any> = {}
    const players: any[] = []
    for (const t of rosters.teams) {
      const rows = t.roster.filter((r: any) => r.name).map((r: any, i: number) => {
        const id = r.mlbam_id ? String(r.mlbam_id) : ''
        const isP = r.pos === 'P'
        return { r, order: i, pos: r.pos, pts: isP ? pitPts(cum.pitching[id]) : hitPts(cum.hitting[id]), dayLine: isP ? day.pitching?.[id] : day.hitting?.[id] }
      })
      const { total, active } = bestBall(rows)
      const finalTotal = di === dates.length - 1 && t.name in standings ? standings[t.name] : total
      teams[t.name] = { total: finalTotal, delta: finalTotal - (prev[t.name] ?? 0) }
      prev[t.name] = finalTotal
      for (const row of rows) {
        if (!row.dayLine) continue
        const isP = row.pos === 'P'
        players.push({ name: row.r.name, team: t.name, pos: row.pos, pid: pidByMlbam[String(row.r.mlbam_id)] ?? null, pts: isP ? pitPts(row.dayLine) : hitPts(row.dayLine), counted: active.has(row) })
      }
    }
    const order = Object.entries(teams).sort((a, b) => b[1].total - a[1].total)
    order.forEach(([name, v], i) => {
      v.rank = i > 0 && v.total === order[i - 1][1].total ? teams[order[i - 1][0]].rank : i + 1
      v.rankChange = name in prevRank ? prevRank[name] - v.rank : 0
    })
    for (const [name, v] of order) prevRank[name] = v.rank
    players.sort((a, b) => b.pts - a.pts)
    return { date, teams, players }
  })
}

function fmtIP(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

// Seasons with a roster file on disk (afl-rosters-YYYY.json), newest first
function availableSeasons(): number[] {
  try {
    return fs.readdirSync(path.join(process.cwd(), 'data'))
      .map(f => f.match(/^afl-rosters-(\d{4})\.json$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => b - a)
  } catch { return [] }
}

export async function GET(req: Request) {
  const seasons = availableSeasons()
  const requested = Number(new URL(req.url).searchParams.get('season'))
  const season = seasons.includes(requested) ? requested : seasons[0] ?? new Date().getFullYear()
  const rosters = readJson(`afl-rosters-${season}.json`)
  if (!rosters) return NextResponse.json({ season, seasons, syncedAt: null, hasStats: false, teams: [], players: [] })
  const stats = readJson(`afl-stats-${season}.json`) ?? { hitting: {}, pitching: {} }
  const daily = readJson(`afl-daily-${season}.json`)
  // "Last" = most recent game day where any rostered player played (the final AFL day can be a lone title game)
  const rosteredIds = new Set<string>(rosters.teams.flatMap((t: any) => t.roster.filter((r: any) => r.mlbam_id).map((r: any) => String(r.mlbam_id))))
  const lastDate = Object.keys(daily?.days ?? {}).sort().reverse()
    .find(d => [...Object.keys(daily.days[d].hitting ?? {}), ...Object.keys(daily.days[d].pitching ?? {})].some(id => rosteredIds.has(id)))
  const lastDay = lastDate ? daily.days[lastDate] : null
  const hasStats = Object.keys(stats.hitting ?? {}).length > 0 || Object.keys(stats.pitching ?? {}).length > 0

  const pidByMlbam: Record<string, string> = {}
  for (const p of Object.values(loadPlayers()) as any[]) if (p.mlbam_id) pidByMlbam[String(p.mlbam_id)] = p.id

  const players: any[] = []
  const teams: any[] = rosters.teams.map((t: any) => {
    const roster = t.roster.map((r: any, i: number) => {
      if (!r.name) return { ...r, order: i }
      const id = r.mlbam_id ? String(r.mlbam_id) : null
      const isP = r.pos === 'P'
      const raw = id ? (isP ? stats.pitching?.[id] : stats.hitting?.[id]) : null
      const line = raw ? (isP ? { ...raw, IP: fmtIP(raw.OUTS) } : raw) : null
      const pts = isP ? pitPts(raw) : hitPts(raw)
      const lastRaw = id && lastDay ? (isP ? lastDay.pitching?.[id] : lastDay.hitting?.[id]) : null
      const lastPts = lastRaw ? (isP ? pitPts(lastRaw) : hitPts(lastRaw)) : null
      return { ...r, order: i, pid: id ? pidByMlbam[id] ?? null : null, team: t.name, pts, lastPts, stats: line, aflTeam: raw?.team ?? null }
    })

    let lineup: any[]
    if (!hasStats) {
      // Pre-season: draft-board slot order verbatim, top 13 rows active
      lineup = roster.map((r: any, i: number) => ({ ...r, slot: r.slot, active: i < LINEUP.length && !!r.name }))
    } else {
      // Best ball: each pos group is independent, so greedy by pts (ties keep draft order) is optimal
      const pool = roster.filter((r: any) => r.name).sort((a: any, b: any) => b.pts - a.pts || a.order - b.order)
      const used = new Set<any>()
      const active = LINEUP.map(({ slot, elig }) => {
        const pick = pool.find((r: any) => !used.has(r) && elig.includes(r.pos))
        if (pick) used.add(pick)
        return pick ? { ...pick, slot, active: true } : { slot, name: null, active: false }
      })
      const bench = roster.filter((r: any) => r.name && !used.has(r)).sort((a: any, b: any) => a.order - b.order).map((r: any) => ({ ...r, slot: 'Bench', active: false }))
      const benchSlots = roster.length - LINEUP.length
      while (bench.length < benchSlots) bench.push({ slot: 'Bench', name: null, active: false })
      lineup = [...active, ...bench]
    }

    for (const r of lineup) if (r.name) players.push({ ...r })
    const counted = lineup.filter((r: any) => r.active)
    const hit = counted.filter((r: any) => r.pos !== 'P').reduce((s: number, r: any) => s + r.pts, 0)
    const pit = counted.filter((r: any) => r.pos === 'P').reduce((s: number, r: any) => s + r.pts, 0)
    return { name: t.name, pts: hit + pit, hitPts: hit, pitPts: pit, lineup }
  })

  // Rank order for the leaderboard; keep draft order for ties / pre-season
  const ranked = [...teams].sort((a, b) => b.pts - a.pts)
  const lead = ranked[0]?.pts ?? 0
  ranked.forEach((t, i) => { t.rank = i > 0 && t.pts === ranked[i - 1].pts ? ranked[i - 1].rank : i + 1; t.gap = t.pts - lead })

  const days = hasStats ? buildDays(rosters, daily, Object.fromEntries(ranked.map(t => [t.name, t.pts])), pidByMlbam) : []

  return NextResponse.json({ season, seasons, syncedAt: stats.syncedAt ?? null, importedAt: rosters.importedAt ?? null, hasStats, teams: ranked, players, days })
}
