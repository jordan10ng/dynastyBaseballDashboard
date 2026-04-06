import { NextRequest, NextResponse } from 'next/server'
import { fantraxLogin } from '@/lib/fantrax'
import { setSetting, queryRun } from '@/lib/db'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()
  if (!username || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  try {
    const res = await fantraxLogin(username, password)
    const cookies = res.headers['set-cookie']?.join('; ') ?? ''
    const responseData = res.data?.responses?.[0]?.data

    if (!responseData || res.data?.responses?.[0]?.error) {
      return NextResponse.json({ error: 'Invalid credentials or Fantrax login failed' }, { status: 401 })
    }

    await setSetting('fantrax_cookies', cookies)
    await setSetting('fantrax_user', username)

    const leagues = responseData.leagues ?? responseData.leagueList ?? []
    const now = new Date().toISOString()

    for (const l of leagues) {
      await queryRun(
        `INSERT OR REPLACE INTO leagues (id, name, num_teams, sport, season, raw, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [l.id, l.name, l.numTeams ?? 0, l.sport ?? 'MLB', l.season ?? '', JSON.stringify(l), now]
      )
    }

    return NextResponse.json({
      success: true,
      leagues: leagues.map((l: any) => ({
        id: l.id, name: l.name, numTeams: l.numTeams, sport: l.sport ?? 'MLB',
      }))
    })
  } catch (err: any) {
    console.error('Fantrax connect error:', err?.message)
    return NextResponse.json({ error: 'Connection failed. Check credentials.' }, { status: 500 })
  }
}
