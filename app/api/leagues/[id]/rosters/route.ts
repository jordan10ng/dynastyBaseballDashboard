import { NextRequest, NextResponse } from 'next/server'
import { queryAll, loadPlayers } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = await params
  const playerMap = loadPlayers()
  const teams = await queryAll('SELECT * FROM teams', [])
  const leagueTeams = teams.filter((t: any) => t.league_id === leagueId)
  const teamNameById: Record<string, string> = {}
  for (const t of leagueTeams) teamNameById[t.id] = t.name
  const rosters = await queryAll('SELECT * FROM rosters', [leagueId])
  const leagueRosters = rosters.filter((r: any) => r.league_id === leagueId)
  const enriched = leagueRosters.map((r: any) => {
    const p = playerMap[r.player_id]
    return { ...r, player_name: p?.name ?? r.player_name, team_name: teamNameById[r.team_id] ?? r.team_id, mlb_team: p?.team ?? null, age: p?.age ?? null }
  })
  return NextResponse.json({ rosters: enriched })
}
