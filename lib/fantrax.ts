/**
 * Fantrax API client using the official beta API endpoints (/fxea/)
 * and the unofficial POST API (/fxpa/) for league info.
 */

const FXEA = 'https://www.fantrax.com/fxea/general'
const FXPA = 'https://www.fantrax.com/fxpa/req'

function getHeaders(): Record<string, string> {
  const cookie = process.env.FANTRAX_COOKIE ?? ''
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Cookie: cookie,
  }
}

// ── Authentication ──────────────────────────────────────────────

export const fantraxLogin = async (username?: string, password?: string) => {
  const url = `${FXPA}?interface=login`
  const payload = {
    responses: [
      {
        type: 'login',
        data: {
          username: username || '',
          password: password || '',
          rememberMe: true
        }
      }
    ]
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store'
  })

  const data = await response.json()
  
  return {
    headers: {
      'set-cookie': response.headers.getSetCookie ? response.headers.getSetCookie() : []
    },
    data
  }
}

// ── Beta REST API (/fxea/) ──────────────────────────────────────

export async function getTeamRosters(leagueId: string) {
  const url = `${FXEA}/getTeamRosters?leagueId=${leagueId}`
  const res = await fetch(url, { headers: getHeaders(), cache: 'no-store' })
  const json = await res.json() as any
  console.log('getTeamRosters keys:', Object.keys(json).join(', '))
  console.log('getTeamRosters sample:', JSON.stringify(json).slice(0, 500))
  return json
}

export async function getStandings(leagueId: string) {
  const url = `${FXEA}/getStandings?leagueId=${leagueId}`
  const res = await fetch(url, { headers: getHeaders(), cache: 'no-store' })
  return res.json()
}

// ── Unofficial POST API (/fxpa/) ────────────────────────────────

async function fxpaRequest(leagueId: string, methods: { method: string; data: Record<string, unknown> }[]) {
  const msgs = methods.map(m => ({ method: m.method, data: { leagueId, ...m.data } }))

  const res = await fetch(`${FXPA}?leagueId=${encodeURIComponent(leagueId)}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ msgs }),
    cache: 'no-store',
  })

  const json = await res.json() as any

  if (json.pageError) {
    const code = json.pageError.code ?? ''
    if (code === 'WARNING_NOT_LOGGED_IN') throw new Error('Not logged in — check FANTRAX_COOKIE in .env.local')
    throw new Error(`Fantrax error: ${json.pageError.title ?? code}`)
  }

  return (json.responses ?? []).map((r: any) => r.data ?? null)
}

export async function getLeagueInfo(leagueId: string) {
  const responses = await fxpaRequest(leagueId, [
    { method: 'getFantasyLeagueInfo', data: {} },
    { method: 'getTeamRosterInfo', data: { view: 'GAMES_PER_POS' } },
  ])

  const settings = (responses[0] as any)?.fantasySettings
  const leagueName = settings?.leagueName ?? `League ${leagueId}`
  const year = settings?.subtitle ?? '2025'

  let teams: { id: string; name: string; shortName?: string }[] = []
  for (const r of responses) {
    const fantasyTeams = (r as any)?.fantasyTeams
    if (fantasyTeams && typeof fantasyTeams === 'object') {
      teams = Object.entries(fantasyTeams).map(([id, t]: any) => ({
        id, name: t?.name ?? id, shortName: t?.shortName,
      }))
      break
    }
  }

  return { league: { id: leagueId, name: leagueName, year }, teams }
}
