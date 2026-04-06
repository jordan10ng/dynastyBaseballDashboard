import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH      = path.join(DATA_DIR, 'db.json')
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json')

interface DbData {
  settings: Record<string, string>
  leagues:  Record<string, any>
  teams:    Record<string, any>
  rosters:  any[]
  rankings: any[]
}

const EMPTY: DbData = { settings: {}, leagues: {}, teams: {}, rosters: [], rankings: [] }

function load(): DbData {
  try {
    if (fs.existsSync(DB_PATH)) return { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) }
  } catch (e) { console.error('db load error:', e) }
  return { ...EMPTY }
}

function save(data: DbData) {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8') }
  catch (e) { console.error('db save error:', e) }
}

export function loadPlayers(): Record<string, any> {
  try {
    if (fs.existsSync(PLAYERS_PATH)) return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'))
  } catch (e) { console.error('players load error:', e) }
  return {}
}

export async function getSetting(key: string): Promise<string | null> {
  return load().settings[key] ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = load(); db.settings[key] = value; save(db)
}

export async function queryAll(sql: string, params: any[] = []): Promise<any[]> {
  const db = load()

  if (sql.includes('FROM leagues')) {
    const rows = Object.values(db.leagues)
    if (params[0]) return rows.filter((r: any) => r.id === params[0])
    return rows.sort((a: any, b: any) => (a.name ?? '').localeCompare(b.name ?? ''))
  }
  if (sql.includes('FROM teams')) {
    const rows = Object.values(db.teams)
    if (params[0]) return rows.filter((r: any) => r.league_id === params[0])
    return rows
  }
  if (sql.includes('FROM rosters')) {
    if (params[0] && params[1]) return db.rosters.filter((r: any) => r.league_id === params[0] && r.team_id === params[1])
    if (params[0]) return db.rosters.filter((r: any) => r.league_id === params[0])
    return db.rosters
  }
  if (sql.includes('FROM players')) {
    const players = loadPlayers()
    const rows = Object.values(players)
    if (params[0]) return rows.filter((r: any) => r.id === params[0])
    return rows
  }
  if (sql.includes('FROM rankings')) {
    const players = loadPlayers()
    if (sql.includes('GROUP BY')) return groupRankingsBySets(db.rankings)
    return db.rankings
      .map((r: any) => ({
        ...r,
        team:  players[r.player_id]?.team ?? null,
        level: players[r.player_id]?.level ?? null,
        age:   players[r.player_id]?.age ?? null,
      }))
      .sort((a: any, b: any) => (a.rank ?? 0) - (b.rank ?? 0))
  }
  return []
}

function groupRankingsBySets(rankings: any[]) {
  const map: Record<string, any> = {}
  for (const r of rankings) {
    if (!map[r.set_name]) map[r.set_name] = { set_name: r.set_name, count: 0, uploaded_at: r.uploaded_at }
    map[r.set_name].count++
    if (r.uploaded_at > map[r.set_name].uploaded_at) map[r.set_name].uploaded_at = r.uploaded_at
  }
  return Object.values(map).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
}

export async function queryRun(sql: string, params: any[] = []): Promise<void> {
  const db = load()

  if (sql.includes('INTO leagues')) {
    const [id, name, num_teams, sport, season, raw, synced_at] = params
    db.leagues[id] = { id, name, num_teams, sport, season, raw, synced_at }
  } else if (sql.includes('INTO teams')) {
    const [id, league_id, name, owner, raw] = params
    db.teams[id] = { id, league_id, name, owner, raw }
  } else if (sql.includes('INTO rosters')) {
    const [team_id, league_id, player_id, player_name, position, status, synced_at] = params
    db.rosters.push({ team_id, league_id, player_id, player_name, position, status, synced_at })
  } else if (sql.includes('DELETE FROM rankings')) {
    db.rankings = db.rankings.filter((r: any) => r.set_name !== params[0])
  } else if (sql.includes('DELETE FROM rosters') && params.length === 2) {
    db.rosters = db.rosters.filter((r: any) => !(r.league_id === params[0] && r.team_id === params[1]))
  } else if (sql.includes('DELETE FROM rosters') && params.length === 1) {
    db.rosters = db.rosters.filter((r: any) => r.league_id !== params[0])
  }

  save(db)
}

export async function queryRunMany(sql: string, rows: any[][]): Promise<void> {
  const db = load()
  if (sql.includes('INTO rankings')) {
    for (const [set_name, rank, player_name, position, uploaded_at] of rows) {
      db.rankings.push({ set_name, rank, player_name, position, uploaded_at })
    }
  }
  save(db)
}
