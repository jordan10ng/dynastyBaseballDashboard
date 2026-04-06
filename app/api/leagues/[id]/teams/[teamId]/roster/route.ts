import { NextRequest, NextResponse } from 'next/server'
import { queryAll, loadPlayers } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; teamId: string }> }) {
  const { id: leagueId, teamId } = await params
  const playerMap = loadPlayers()
  const rosters = await queryAll('SELECT * FROM rosters', [leagueId])
  const teamRoster = rosters.filter((r: any) => r.team_id === teamId)
  const enriched = teamRoster.map((r: any) => {
    const p = playerMap[r.player_id]
    return { ...r, player_name: p?.name ?? r.player_name, team: p?.team ?? null, age: p?.age ?? null, positions: p?.positions ?? r.position }
  })
  return NextResponse.json({ roster: enriched })
}
