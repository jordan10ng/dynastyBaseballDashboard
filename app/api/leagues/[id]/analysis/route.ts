import { NextRequest, NextResponse } from 'next/server'
import { queryAll, loadPlayers } from '@/lib/db'
import fs from 'fs'
import pathMod from 'path'

const ARM_POSITIONS = new Set(['SP','RP','P'])

function rankValue(rank: number | null | undefined): number {
  if (!rank || rank <= 0) return 0
  return Math.pow(0.9942, rank - 1) * 100
}

function isPitcher(positions: string[]): boolean {
  return positions.length > 0 && positions.every(p => ARM_POSITIONS.has(p))
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params
  const playerMap = loadPlayers()
  const historyPath = pathMod.join(process.cwd(), 'data', 'history', `${new Date().getFullYear()}.json`)
  const history: Record<string, any[]> = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : {}
  function resolveLevel(mlbamId: string | undefined): string | null {
    if (!mlbamId) return null
    const rows = history[mlbamId]
    if (!rows || rows.length === 0) return null
    const sorted = [...rows].sort((a, b) => (b._synced ?? '').localeCompare(a._synced ?? ''))
    const row = sorted[0]
    const lv = (row.level ?? '').replace('High-A','A+').replace('Single-A','A').replace('Low-A','A')
    return lv || null
  }
  const allTeams = await queryAll('SELECT * FROM teams', [])
  const leagueTeams = allTeams.filter((t: any) => t.league_id === leagueId)
  const allRosters = await queryAll('SELECT * FROM rosters', [leagueId])

  const teamData = leagueTeams.map((team: any) => {
    const roster = allRosters
      .filter((r: any) => r.team_id === team.id)
      .map((r: any) => {
        const p = playerMap[r.player_id] ?? {}
        const positions: string[] = Array.isArray(p.positions) ? p.positions : typeof p.positions === 'string' ? p.positions.split(',').map((s:string)=>s.trim()).filter(Boolean) : r.position ? [r.position] : []
        const rank: number | null = p.rank ?? null
        const age: number | null = p.age ?? null
        const resolvedLevel = resolveLevel(p.mlbam_id) ?? p.level ?? null
        const isMinors = r.status === 'MINORS'
        const val = rankValue(rank)
        const arm = isPitcher(positions) ? val : 0
        const bat = !isPitcher(positions) && positions.length > 0 ? val : 0
        return {
          player_id: r.player_id,
          player_name: p.name ?? r.player_name,
          position: r.position,
          positions,
          status: r.status,
          rank,
          age,
          level: resolvedLevel,
          mlb_team: p.team ?? null,
          val,
          bat,
          arm,
          isMinors,
        }
      })

    const ranked = roster.filter(p => p.rank && p.rank > 0)
    const total = ranked.reduce((s, p) => s + p.val, 0)
    const bat   = ranked.reduce((s, p) => s + p.bat, 0)
    const arm   = ranked.reduce((s, p) => s + p.arm, 0)
    const mlb   = ranked.filter(p => !p.isMinors).reduce((s, p) => s + p.val, 0)
    const milb  = ranked.filter(p => p.isMinors).reduce((s, p) => s + p.val, 0)
    const ages  = roster.filter(p => p.age).map(p => p.age as number)
    const avgAge = ages.length > 0 ? +(ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1) : null

    return { id: team.id, name: team.name, total, bat, arm, mlb, milb, avgAge, roster }
  })

  const metrics = ['total','bat','arm','mlb','milb'] as const
  const ranks: Record<string, Record<string, number>> = {}
  for (const m of metrics) {
    const sorted = [...teamData].sort((a, b) => (b[m] ?? 0) - (a[m] ?? 0))
    for (let i = 0; i < sorted.length; i++) {
      if (!ranks[sorted[i].id]) ranks[sorted[i].id] = {}
      ranks[sorted[i].id][m] = i + 1
    }
  }

  const result = teamData.map(t => ({ ...t, ranks: ranks[t.id] ?? {} }))
  return NextResponse.json({ teams: result })
}
