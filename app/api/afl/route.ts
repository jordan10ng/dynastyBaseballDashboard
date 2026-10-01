// AFL fantasy league standings — read-only. Reads data/afl-rosters-YYYY.json (draft) + data/afl-stats-YYYY.json (nightly GHA).
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

function fmtIP(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

export async function GET() {
  const season = new Date().getFullYear()
  const rosters = readJson(`afl-rosters-${season}.json`)
  if (!rosters) return NextResponse.json({ season, syncedAt: null, hasStats: false, teams: [], players: [] })
  const stats = readJson(`afl-stats-${season}.json`) ?? { hitting: {}, pitching: {} }
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
      return { ...r, order: i, pid: id ? pidByMlbam[id] ?? null : null, team: t.name, pts, stats: line, aflTeam: raw?.team ?? null }
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

  return NextResponse.json({ season, syncedAt: stats.syncedAt ?? null, importedAt: rosters.importedAt ?? null, hasStats, teams: ranked, players })
}
