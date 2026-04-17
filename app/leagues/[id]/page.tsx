'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const LEAGUE_NAMES: Record<string, string> = {
  '0ehfuam0mg7wqpn7': 'DO MLB - D28',
  'ew7b8seomg7u7uzi': 'DO MLB - D34',
  'd3prsagvmgftfdc3': 'DO MLB - D52',
}

const MY_TEAM = 'Winston Salem Dash'

const FRIEND_TEAMS: Record<string, string> = {
  'Winston Salem Dash':     '#22c55e',
  'Bay Area Bush League':   '#a78bfa',
  'Team Colin':             '#38bdf8',
  'Team Pat':               '#fb923c',
  'The Old Gold and Black': '#e879f9',
}
const D52_ID = 'd3prsagvmgftfdc3'

const POS_GROUPS = [
  { label: 'Catchers',    positions: ['C'] },
  { label: 'Infielders',  positions: ['1B','2B','SS','3B','INF'] },
  { label: 'Outfielders', positions: ['LF','CF','RF','OF'] },
  { label: 'Utility',     positions: ['UT'] },
  { label: 'Pitchers',    positions: ['SP','RP','P'] },
]

type MinorsFilter = 'mlb' | 'both-sep' | 'both-mix' | 'minors'

export default function LeaguePage() {
  const params = useParams()
  const leagueId = params.id as string
  const [leagues, setLeagues] = useState<any[]>([])
  const [selectedLeague, setSelectedLeague] = useState(leagueId)
  const [teams, setTeams] = useState<any[]>([])
  const [selectedTeam, setSelectedTeam] = useState<string>('')
  const [roster, setRoster] = useState<any[]>([])
  const [minorsFilter, setMinorsFilter] = useState<MinorsFilter>('both-sep')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/leagues').then(r => r.json()).then(d => setLeagues(d.leagues ?? []))
  }, [])

  useEffect(() => {
    if (!selectedLeague) return
    fetch(`/api/leagues/${selectedLeague}/teams`).then(r => r.json()).then(d => {
      const teamList = d.teams ?? []
      setTeams(teamList)
      const myTeam = teamList.find((t: any) => t.name === MY_TEAM) ?? teamList[0]
      if (myTeam) setSelectedTeam(myTeam.id)
    })
  }, [selectedLeague])

  useEffect(() => {
    if (!selectedTeam) return
    setLoading(true)
    fetch(`/api/leagues/${selectedLeague}/teams/${selectedTeam}/roster`).then(r => r.json()).then(d => {
      setRoster(d.roster ?? [])
      setLoading(false)
    })
  }, [selectedTeam, selectedLeague])

  function groupRoster() {
    const mlb    = roster.filter(p => p.status !== 'MINORS')
    const minors = roster.filter(p => p.status === 'MINORS')
    function byPos(players: any[]) {
      const groups: { label: string; players: any[] }[] = []
      for (const group of POS_GROUPS) {
        const matched = players.filter(p => group.positions.includes(p.position))
        if (matched.length > 0) groups.push({ label: group.label, players: matched })
      }
      return groups
    }
    if (minorsFilter === 'mlb')      return byPos(mlb)
    if (minorsFilter === 'minors')   return byPos(minors)
    if (minorsFilter === 'both-mix') return byPos(roster)
    return [...byPos(mlb), ...(minors.length > 0 ? [{ label: '— Minor Leagues —', players: [] }, ...byPos(minors)] : [])]
  }

  const grouped = groupRoster()
  const currentTeam = teams.find(t => t.id === selectedTeam)

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.4rem' }}>League</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {leagues.map(l => (
              <button key={l.id} onClick={() => setSelectedLeague(l.id)} style={{ padding: '0.45rem 0.85rem', borderRadius: 6, border: '1px solid', borderColor: selectedLeague === l.id ? 'var(--accent)' : 'var(--border)', background: selectedLeague === l.id ? 'rgba(34,197,94,0.1)' : 'transparent', color: selectedLeague === l.id ? 'var(--accent)' : 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {l.name.replace('DO MLB - ', '')}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.4rem' }}>Team</div>
          <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.45rem 0.85rem', color: selectedLeague === D52_ID ? (FRIEND_TEAMS[teams.find((t:any)=>t.id===selectedTeam)?.name??''] ?? 'var(--text)') : 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', outline: 'none', minWidth: 220 }}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.4rem' }}>Show</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {([{ val: 'mlb', label: 'MLB Only' }, { val: 'both-sep', label: 'Both' }, { val: 'both-mix', label: 'Mixed' }, { val: 'minors', label: 'Minors' }] as { val: MinorsFilter; label: string }[]).map(opt => (
              <button key={opt.val} onClick={() => setMinorsFilter(opt.val)} style={{ padding: '0.45rem 0.75rem', borderRadius: 6, border: '1px solid', borderColor: minorsFilter === opt.val ? 'var(--accent)' : 'var(--border)', background: minorsFilter === opt.val ? 'rgba(34,197,94,0.1)' : 'transparent', color: minorsFilter === opt.val ? 'var(--accent)' : 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: selectedLeague === D52_ID && currentTeam?.name ? (FRIEND_TEAMS[currentTeam.name] ?? 'var(--text)') : 'var(--text)' }}>{currentTeam?.name ?? '—'}</div>
        <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: 2 }}>{LEAGUE_NAMES[selectedLeague]} · {roster.length} players</div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Loading roster...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {grouped.map((group, gi) => (
            <div key={gi}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: group.label.startsWith('—') ? 'var(--accent)' : 'var(--muted)', borderBottom: group.label.startsWith('—') ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border)', paddingBottom: '0.35rem', marginBottom: '0.5rem' }}>
                {group.label}
              </div>
              {group.players.map((player, pi) => {
                const isMinors = player.status === 'MINORS'
                const isIL = player.status === 'INJURED_RESERVE'
                return (
                  <div key={pi} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.45rem 0', borderBottom: '1px solid rgba(48,54,61,0.4)' }}>
                    <div style={{ width: 36, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.06em', color: 'var(--muted)', flexShrink: 0 }}>{player.position}</div>
                    <div style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem', color: isMinors ? '#4ade80' : 'var(--text)' }}>{player.player_name}</div>
                    {player.team && <div style={{ color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{player.team}</div>}
                    {(isMinors || isIL || player.status === 'RESERVE') && (
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4, background: isIL ? 'rgba(239,68,68,0.15)' : isMinors ? 'rgba(74,222,128,0.1)' : 'rgba(100,100,100,0.15)', color: isIL ? 'var(--danger)' : isMinors ? '#4ade80' : 'var(--muted)' }}>
                        {isIL ? 'IL' : isMinors ? 'MiLB' : 'RES'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
