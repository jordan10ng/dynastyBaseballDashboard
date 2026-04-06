import { NextResponse } from 'next/server'
import { getLeagueInfo, getTeamRosters } from '@/lib/fantrax'
import { queryRun, loadPlayers } from '@/lib/db'

const LEAGUE_IDS = [
  '0ehfuam0mg7wqpn7',
  'ew7b8seomg7u7uzi',
  'd3prsagvmgftfdc3',
]

export async function POST() {
  const now = new Date().toISOString()
  const results = []
  const playerMap = loadPlayers()
  console.log(`Loaded ${Object.keys(playerMap).length} players from players.json`)

  for (const leagueId of LEAGUE_IDS) {
    try {
      const { league, teams } = await getLeagueInfo(leagueId)
      console.log(`[${leagueId}] ${league.name} - ${teams.length} teams`)

      await queryRun(
        `INSERT OR REPLACE INTO leagues (id, name, num_teams, sport, season, raw, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [leagueId, league.name, teams.length, 'MLB', league.year ?? '2025', JSON.stringify({ league, teams }), now]
      )

      const rosterData = await getTeamRosters(leagueId)
      const rosters = rosterData?.rosters ?? {}

      for (const [fantraxTeamId, teamRoster] of Object.entries(rosters) as any[]) {
        const teamKey  = `${leagueId}_${fantraxTeamId}`
        const teamName = (teamRoster as any)?.teamName ?? fantraxTeamId
        const items    = (teamRoster as any)?.rosterItems ?? []

        await queryRun(
          `INSERT OR REPLACE INTO teams (id, league_id, name, owner, raw) VALUES (?, ?, ?, ?, ?)`,
          [teamKey, leagueId, teamName, '', '{}']
        )

        await queryRun(`DELETE FROM rosters WHERE league_id = ? AND team_id = ?`, [leagueId, teamKey])

        let matched = 0
        for (const item of items) {
          const player   = playerMap[item.id]
          const name     = player?.name ?? item.id
          const position = item.position ?? player?.positions ?? '—'
          const status   = item.status ?? ''
          if (player) matched++
          await queryRun(
            `INSERT OR REPLACE INTO rosters (team_id, league_id, player_id, player_name, position, status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [teamKey, leagueId, item.id, name, position, status, now]
          )
        }
        console.log(`  ${teamName}: ${items.length} players (${matched} matched)`)
      }

      results.push({ id: leagueId, name: league.name, numTeams: Object.keys(rosters).length, sport: 'MLB' })
    } catch (err: any) {
      console.error(`Failed league ${leagueId}:`, err.message)
      results.push({ id: leagueId, error: err.message })
    }
  }

  return NextResponse.json({ success: true, leagues: results })
}
