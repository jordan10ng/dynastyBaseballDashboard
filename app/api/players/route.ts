import { NextResponse } from 'next/server'
import { getLeagueInfo, getTeamRosters } from '@/lib/fantrax'
import { queryRun } from '@/lib/db'

const LEAGUE_IDS = [
  '0ehfuam0mg7wqpn7',
  'ew7b8seomg7u7uzi',
  'd3prsagvmgftfdc3',
]

async function getPlayerNames(leagueId: string, playerIds: string[]): Promise<Record<string, any>> {
  const cookie = process.env.FANTRAX_COOKIE ?? ''
  const ids = playerIds.join(',')
  const res = await fetch(
    `https://www.fantrax.com/fxea/general/getPlayerInfo?sport=MLB&playerIds=${ids}`,
    { headers: { Cookie: cookie, Accept: 'application/json' }, cache: 'no-store' }
  )
  const json = await res.json() as any
  // Returns map of id -> player info
  return json?.playerInfo ?? json?.players ?? json ?? {}
}

export async function POST() {
  const now = new Date().toISOString()
  const results = []

  for (const leagueId of LEAGUE_IDS) {
    try {
      const { league, teams } = await getLeagueInfo(leagueId)
      console.log(`[${leagueId}] ${league.name} - ${teams.length} teams`)

      await queryRun(
        `INSERT OR REPLACE INTO leagues (id, name, num_teams, sport, season, raw, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [leagueId, league.name, teams.length, 'MLB', league.year ?? '2025', JSON.stringify({ league, teams }), now]
      )

      // Save teams using their real Fantrax string IDs from league info
      const teamNameById: Record<string, string> = {}
      for (const team of teams) {
        const teamKey = `${leagueId}_${team.id}`
        teamNameById[team.id] = team.name
        await queryRun(
          `INSERT OR REPLACE INTO teams (id, league_id, name, owner, raw) VALUES (?, ?, ?, ?, ?)`,
          [teamKey, leagueId, team.name, team.shortName ?? '', JSON.stringify(team)]
        )
      }

      // Get rosters via beta API
      const rosterData = await getTeamRosters(leagueId)
      const rosters = rosterData?.rosters ?? {}

      // Collect all player IDs across all teams
      const allPlayerIds: string[] = []
      for (const teamRoster of Object.values(rosters) as any[]) {
        for (const item of teamRoster?.rosterItems ?? []) {
          if (item.id) allPlayerIds.push(item.id)
        }
      }

      // Fetch player names in bulk
      let playerMap: Record<string, any> = {}
      if (allPlayerIds.length > 0) {
        try {
          playerMap = await getPlayerNames(leagueId, allPlayerIds)
          console.log(`  Player map sample:`, JSON.stringify(playerMap).slice(0, 300))
        } catch (e: any) {
          console.warn('  Player name fetch failed:', e.message)
        }
      }

      // Save rosters
      for (const [fantraxTeamId, teamRoster] of Object.entries(rosters) as any[]) {
        const teamKey = `${leagueId}_${fantraxTeamId}`
        const items = (teamRoster as any)?.rosterItems ?? []

        await queryRun(`DELETE FROM rosters WHERE league_id = ? AND team_id = ?`, [leagueId, teamKey])

        // Also save the team with real fantrax ID if not already saved
        if (teamRoster?.teamName) {
          await queryRun(
            `INSERT OR REPLACE INTO teams (id, league_id, name, owner, raw) VALUES (?, ?, ?, ?, ?)`,
            [teamKey, leagueId, teamRoster.teamName, '', '{}']
          )
        }

        for (const item of items) {
          const playerInfo = playerMap[item.id]
          const name = playerInfo?.name ?? playerInfo?.playerName ?? item.id
          const position = item.position ?? playerInfo?.position ?? '—'
          const status = item.status ?? ''
          const mlbTeam = playerInfo?.team ?? playerInfo?.teamShortName ?? ''

          await queryRun(
            `INSERT OR REPLACE INTO rosters (team_id, league_id, player_id, player_name, position, status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [teamKey, leagueId, item.id, name, position, status, now]
          )
        }
        console.log(`  ${teamRoster?.teamName}: ${items.length} players`)
      }

      results.push({ id: leagueId, name: league.name, numTeams: teams.length, sport: 'MLB' })
    } catch (err: any) {
      console.error(`Failed league ${leagueId}:`, err.message)
      results.push({ id: leagueId, error: err.message })
    }
  }

  return NextResponse.json({ success: true, leagues: results })
}
