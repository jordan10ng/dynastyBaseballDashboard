// Standalone Fantrax roster sync for GitHub Actions.
// LOCKSTEP with app/api/fantrax/sync/route.ts + lib/fantrax.ts — update all together.
// Writes leagues/teams/rosters into data/db.json (preserves settings/rankings).
// Requires FANTRAX_COOKIE env. Exits non-zero on auth failure so GHA fails loudly.

const fs = require('fs')
const path = require('path')
const os = require('os')

const BASE = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data')
const DB_PATH = path.join(BASE, 'db.json')
const PLAYERS_PATH = path.join(BASE, 'players.json')

const FXEA = 'https://www.fantrax.com/fxea/general'
const FXPA = 'https://www.fantrax.com/fxpa/req'

const LEAGUE_IDS = [
  '0ehfuam0mg7wqpn7',
  'ew7b8seomg7u7uzi',
  'd3prsagvmgftfdc3',
]

function headers() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Cookie: process.env.FANTRAX_COOKIE || '',
  }
}

async function getTeamRosters(leagueId) {
  const res = await fetch(`${FXEA}/getTeamRosters?leagueId=${leagueId}`, { headers: headers(), cache: 'no-store' })
  return res.json()
}

async function getPlayerTeams() {
  const res = await fetch(`${FXEA}/getPlayerIds?sport=MLB`, { headers: headers(), cache: 'no-store' })
  const json = await res.json()
  const teams = {}
  for (const entry of Object.values(json)) {
    if (entry.fantraxId && entry.team) teams[entry.fantraxId] = entry.team
  }
  return teams
}

async function fxpaRequest(leagueId, methods) {
  const msgs = methods.map(m => ({ method: m.method, data: { leagueId, ...m.data } }))
  const res = await fetch(`${FXPA}?leagueId=${encodeURIComponent(leagueId)}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ msgs }),
    cache: 'no-store',
  })
  const json = await res.json()
  if (json.pageError) {
    const code = json.pageError.code || ''
    if (code === 'WARNING_NOT_LOGGED_IN') throw new Error('AUTH: Not logged in — FANTRAX_COOKIE expired or missing')
    throw new Error(`Fantrax error: ${json.pageError.title || code}`)
  }
  return (json.responses || []).map(r => r.data ?? null)
}

async function getLeagueInfo(leagueId) {
  const responses = await fxpaRequest(leagueId, [
    { method: 'getFantasyLeagueInfo', data: {} },
    { method: 'getTeamRosterInfo', data: { view: 'GAMES_PER_POS' } },
  ])
  const settings = responses[0]?.fantasySettings
  const leagueName = settings?.leagueName || `League ${leagueId}`
  const year = settings?.subtitle || String(new Date().getFullYear())
  let teams = []
  for (const r of responses) {
    const fantasyTeams = r?.fantasyTeams
    if (fantasyTeams && typeof fantasyTeams === 'object') {
      teams = Object.entries(fantasyTeams).map(([id, t]) => ({ id, name: t?.name ?? id, shortName: t?.shortName }))
      break
    }
  }
  return { league: { id: leagueId, name: leagueName, year }, teams }
}

function loadJson(p, fallback) {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')) }
  catch (e) { console.error('load error', p, e.message) }
  return fallback
}

async function main() {
  if (!process.env.FANTRAX_COOKIE) {
    console.error('AUTH: FANTRAX_COOKIE not set — aborting')
    process.exit(1)
  }

  const now = new Date().toISOString()
  const players = loadJson(PLAYERS_PATH, {})
  console.log(`Loaded ${Object.keys(players).length} players`)

  const db = loadJson(DB_PATH, {})
  db.settings = db.settings || {}
  db.leagues = db.leagues || {}
  db.teams = db.teams || {}
  db.rosters = db.rosters || []
  db.rankings = db.rankings || []

  let authFailed = false
  let anySuccess = false
  let playersChanged = false

  try {
    const teamMap = await getPlayerTeams()
    let updated = 0
    for (const [id, team] of Object.entries(teamMap)) {
      if (players[id] && players[id].team !== team) {
        players[id].team = team
        updated++
      }
    }
    console.log(`getPlayerTeams: ${Object.keys(teamMap).length} teams fetched, ${updated} players updated`)
    if (updated > 0) playersChanged = true
  } catch (err) {
    console.error('Failed getPlayerTeams:', err.message)
    if (String(err.message).startsWith('AUTH:')) authFailed = true
  }

  for (const leagueId of LEAGUE_IDS) {
    try {
      const { league, teams } = await getLeagueInfo(leagueId)
      console.log(`[${leagueId}] ${league.name} - ${teams.length} teams`)

      db.leagues[leagueId] = {
        id: leagueId, name: league.name, num_teams: teams.length,
        sport: 'MLB', season: league.year, raw: JSON.stringify({ league, teams }), synced_at: now,
      }

      const rosterData = await getTeamRosters(leagueId)
      const rosters = rosterData?.rosters ?? {}

      for (const [fantraxTeamId, teamRoster] of Object.entries(rosters)) {
        const teamKey = `${leagueId}_${fantraxTeamId}`
        const teamName = teamRoster?.teamName ?? fantraxTeamId
        const items = teamRoster?.rosterItems ?? []

        db.teams[teamKey] = { id: teamKey, league_id: leagueId, name: teamName, owner: '', raw: '{}' }
        db.rosters = db.rosters.filter(r => !(r.league_id === leagueId && r.team_id === teamKey))

        let matched = 0
        for (const item of items) {
          const player = players[item.id]
          const name = player?.name ?? item.id
          const position = item.position ?? player?.positions ?? '—'
          const status = item.status ?? ''
          if (player) matched++
          db.rosters.push({
            team_id: teamKey, league_id: leagueId, player_id: item.id,
            player_name: name, position, status, synced_at: now,
          })
        }
        console.log(`  ${teamName}: ${items.length} players (${matched} matched)`)
      }
      anySuccess = true
    } catch (err) {
      console.error(`Failed league ${leagueId}:`, err.message)
      if (String(err.message).startsWith('AUTH:')) authFailed = true
    }
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8')
  console.log(`Wrote ${DB_PATH} — ${Object.keys(db.leagues).length} leagues, ${Object.keys(db.teams).length} teams, ${db.rosters.length} rosters`)

  if (playersChanged) {
    fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2), 'utf-8')
    console.log(`Wrote ${PLAYERS_PATH} — team fields updated from Fantrax`)
  }

  if (authFailed || !anySuccess) {
    console.error('Fantrax sync failed (auth or no leagues synced)')
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
