'use client'
import { useState, useEffect, useMemo } from 'react'
import { ArrowLeftRight, Plus, X, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { PlayerDrawer } from '../../components/players/PlayerDrawer'
import { useDrawerData } from '../../lib/useDrawerData'

const LEAGUES = [
  { id: '0ehfuam0mg7wqpn7', label: 'D28' },
  { id: 'ew7b8seomg7u7uzi', label: 'D34' },
  { id: 'd3prsagvmgftfdc3', label: 'D52' },
]

const DRAFT_PICKS = [
  { id: 'draft-1', name: '1st Round Pick', positions: 'PICK', rank: null, customValue: 10 },
  { id: 'draft-2', name: '2nd Round Pick', positions: 'PICK', rank: null, customValue: 4 },
  { id: 'draft-3', name: '3rd Round Pick', positions: 'PICK', rank: null, customValue: 2 },
]

function valueFromRank(rank: number | null | undefined): number {
  if (!rank) return 0
  const val = 100 * Math.pow(0.9942, rank - 1)
  return Math.max(0.1, Math.round(val * 10) / 10)
}

function getPlayerValue(p: any): number {
  if (p.customValue !== undefined) return p.customValue
  return valueFromRank(p.rank)
}

export default function TradePage() {
  const [players, setPlayers] = useState<any[]>([])
  const [allPlayers, setAllPlayers] = useState<any[]>([])
  const [allTeams, setAllTeams] = useState<any[]>([])
  const [allRosters, setAllRosters] = useState<any[]>([])
  const [selectedLeague, setSelectedLeague] = useState<string>('')
  const [teamA_id, setTeamA_id] = useState<string>('')
  const [teamB_id, setTeamB_id] = useState<string>('')
  const [teamA, setTeamA] = useState<any[]>([])
  const [teamB, setTeamB] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [addingTo, setAddingTo] = useState<'A' | 'B' | null>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null)

  const { statsMap, mlbToolsMap } = useDrawerData()
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/players/all').then(r => r.json()),
      ...LEAGUES.map(l => fetch(`/api/leagues/${l.id}/teams`).then(r => r.json())),
      ...LEAGUES.map(l => fetch(`/api/leagues/${l.id}/rosters`).then(r => r.json())),
    ]).then(([pd, ...rest]) => {
      const teamResults = rest.slice(0, LEAGUES.length)
      const rosterResults = rest.slice(LEAGUES.length)
      const rawPlayers = pd.players ?? []
      setAllPlayers(rawPlayers)
      setPlayers([...DRAFT_PICKS, ...rawPlayers])
      setAllTeams(teamResults.flatMap((d: any) => d.teams ?? []))
      setAllRosters(rosterResults.flatMap((d: any) => d.rosters ?? []))
    })
  }, [])

  useEffect(() => {
    setTeamA_id(''); setTeamB_id('')
    setTeamA([]); setTeamB([])
    setAddingTo(null); setSearch('')
  }, [selectedLeague])

  const globalOwnership = useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    for (const r of allRosters) {
      if (!map[r.player_id]) map[r.player_id] = {}
      map[r.player_id][r.league_id] = r.team_name
    }
    return map
  }, [allRosters])

  const minorsIds = useMemo(
    () => new Set(allPlayers.filter(p => !p.mlbam_id || !mlbToolsMap[p.mlbam_id]).map(p => p.id)),
    [allPlayers, mlbToolsMap]
  )

  const isLeagueMode = !!selectedLeague
  const leagueTeams = isLeagueMode ? allTeams.filter(t => t.league_id === selectedLeague) : []

  function calcValue(side: any[]) {
    return side.reduce((sum, p) => sum + getPlayerValue(p), 0)
  }

  const valA = calcValue(teamA)
  const valB = calcValue(teamB)
  const diff = valA - valB
  const fair = Math.abs(diff) < 5

  function togglePlayerA(p: any) {
    setTeamA(prev => prev.some(x => x.id === p.id) ? prev.filter(x => x.id !== p.id) : [...prev, p])
  }
  function togglePlayerB(p: any) {
    setTeamB(prev => prev.some(x => x.id === p.id) ? prev.filter(x => x.id !== p.id) : [...prev, p])
  }
  function addPlayerOpenMode(p: any) {
    if (addingTo === 'A' && !teamA.find(x => x.id === p.id)) setTeamA(prev => [...prev, p])
    else if (addingTo === 'B' && !teamB.find(x => x.id === p.id)) setTeamB(prev => [...prev, p])
    setSearch(''); setAddingTo(null)
  }

  function getTeamAssets(teamId: string) {
    if (!teamId) return []
    const teamPlayerIds = new Set(allRosters.filter(r => r.team_id === teamId).map(r => r.player_id))
    const list = players.filter(p => teamPlayerIds.has(p.id) || p.customValue !== undefined)
    return list.sort((a, b) => getPlayerValue(b) - getPlayerValue(a))
  }

  const assetsA = isLeagueMode && teamA_id ? getTeamAssets(teamA_id) : []
  const assetsB = isLeagueMode && teamB_id ? getTeamAssets(teamB_id) : []

  const searchResultsOpenMode = (!isLeagueMode && search.length > 1)
    ? players.filter(p =>
        p.name?.toLowerCase().includes(search.toLowerCase()) &&
        !teamA.find(x => x.id === p.id) &&
        !teamB.find(x => x.id === p.id)
      ).slice(0, 15)
    : []

  const btn = (active: boolean) => ({
    padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid',
    borderColor: active ? '#3b82f6' : 'var(--border)',
    background: active ? 'rgba(59,130,246,0.1)' : 'transparent',
    color: active ? '#3b82f6' : 'var(--muted)',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem',
    letterSpacing: '0.04em', cursor: 'pointer',
  })

  return (
    <div style={{ padding: isMobile ? '1rem' : '2.5rem 2rem' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2rem', letterSpacing: '0.04em', textTransform: 'uppercase', margin: '0 0 0.4rem' }}>Trade Calculator</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Add players to each side. Values are derived from your uploaded rankings.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginRight: 4 }}>Mode</span>
        <button onClick={() => setSelectedLeague('')} style={btn(selectedLeague === '')}>Open</button>
        {LEAGUES.map(l => (
          <button key={l.id} onClick={() => setSelectedLeague(l.id)} style={btn(selectedLeague === l.id)}>{l.label}</button>
        ))}
      </div>

      {players.length === DRAFT_PICKS.length && (
        <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', borderLeft: '3px solid var(--warning)', fontSize: '0.875rem', color: 'var(--muted)' }}>
          No rankings loaded — upload rankings first for accurate trade values.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto 1fr', gap: '1.5rem', alignItems: 'start' }}>
        <TradeSide
          label="Team A" color="#3b82f6"
          players={teamA} value={valA}
          leagueTeams={leagueTeams} selectedTeamId={teamA_id} onSelectTeam={setTeamA_id}
          onRemove={(p: any) => setTeamA((prev: any) => prev.filter((x: any) => x.id !== p.id))}
          isLeagueMode={isLeagueMode} teamAssets={assetsA}
          onTogglePlayer={togglePlayerA} minorsIds={minorsIds}
          onAdd={() => { setAddingTo('A'); setSearch('') }}
          active={!isLeagueMode && addingTo === 'A'}
          onOpenDrawer={setSelectedPlayer}
        />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', paddingTop: '3.5rem' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: fair ? 'rgba(34,197,94,0.1)' : diff > 0 ? 'rgba(59,130,246,0.1)' : 'rgba(168,85,247,0.1)',
            border: `2px solid ${fair ? 'var(--accent)' : diff > 0 ? '#3b82f6' : '#a855f7'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {fair ? <Minus size={20} color="var(--accent)" /> : diff > 0 ? <TrendingUp size={20} color="#3b82f6" /> : <TrendingDown size={20} color="#a855f7" />}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: fair ? 'var(--accent)' : diff > 0 ? '#60a5fa' : '#c084fc', textAlign: 'center' }}>
            {fair ? 'Fair' : diff > 0 ? 'A Wins' : 'B Wins'}
          </div>
          {!fair && (
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center' }}>
              {Math.abs(diff).toFixed(1)} pts
            </div>
          )}
        </div>

        <TradeSide
          label="Team B" color="#a855f7"
          players={teamB} value={valB}
          leagueTeams={leagueTeams} selectedTeamId={teamB_id} onSelectTeam={setTeamB_id}
          onRemove={(p: any) => setTeamB((prev: any) => prev.filter((x: any) => x.id !== p.id))}
          isLeagueMode={isLeagueMode} teamAssets={assetsB}
          onTogglePlayer={togglePlayerB} minorsIds={minorsIds}
          onAdd={() => { setAddingTo('B'); setSearch('') }}
          active={!isLeagueMode && addingTo === 'B'}
          onOpenDrawer={setSelectedPlayer}
        />
      </div>

      {!isLeagueMode && addingTo && (
        <div style={{ marginTop: '2rem' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.5rem' }}>
            Adding to Team {addingTo}
          </div>
          <input
            autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search player name or 'pick'..."
            style={{ width: '100%', maxWidth: 480, background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 6, padding: '0.6rem 0.875rem', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', marginBottom: 4 }}
          />
          {searchResultsOpenMode.length > 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, overflowY: 'auto', maxHeight: '400px' }}>
              {searchResultsOpenMode.map((p, i) => (
                <div key={p.id + i} style={{ padding: '0.6rem 1rem', borderBottom: '1px solid rgba(48,54,61,0.5)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      onClick={() => addPlayerOpenMode(p)}
                      style={{ fontWeight: 600, fontSize: '0.9rem', color: p.customValue ? '#f59e0b' : 'inherit', cursor: 'pointer' }}
                    >{p.name}</span>
                    {minorsIds.has(p.id) && <span style={{ color: '#4ade80', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.7rem' }}>M</span>}
                    <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{p.positions?.split(',')[0]}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    {!p.customValue && <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>#{p.rank ?? 'UR'}</span>}
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent)' }}>{getPlayerValue(p).toFixed(1)}</span>
                    <button
                      onClick={() => addPlayerOpenMode(p)}
                      style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.7rem', padding: '0.2rem 0.5rem', cursor: 'pointer' }}
                    >+ Add</button>
                    {!p.customValue && (
                      <button
                        onClick={() => setSelectedPlayer(p)}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '0.1rem 0.3rem' }}
                        title="View player"
                      >ⓘ</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="btn-ghost" onClick={() => { setAddingTo(null); setSearch('') }} style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>
            Done
          </button>
        </div>
      )}

      <div style={{ marginTop: '2.5rem', padding: '1rem 1.25rem', background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6 }}>
        <strong style={{ color: '#c084fc' }}>Value formula:</strong> Fixed exponential decay (0.9942 base).
        Rank #1 = 100 pts. Rank ~400 = 10 pts. Draft picks hold static values (1st=10, 2nd=4, 3rd=2).
      </div>

      {selectedPlayer && (
        <PlayerDrawer
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          globalOwnership={globalOwnership}
          minorsIds={minorsIds}
          mlbToolsMap={mlbToolsMap}
          statsMap={statsMap}
          allPlayers={allPlayers}
        />
      )}
    </div>
  )
}

function TradeSide({
  label, color, players, value,
  onRemove, onAdd, active,
  leagueTeams, selectedTeamId, onSelectTeam,
  isLeagueMode, teamAssets, onTogglePlayer, minorsIds,
  onOpenDrawer,
}: any) {
  const [localSearch, setLocalSearch] = useState('')
  const [posFilter, setPosFilter] = useState<'all' | 'bat' | 'pit' | 'pick'>('all')
  const [minorsFilter, setMinorsFilter] = useState<'all' | 'mlb' | 'minors'>('all')

  const displayedRoster = teamAssets?.filter((p: any) => {
    if (localSearch && !p.name?.toLowerCase().includes(localSearch.toLowerCase())) return false
    if (minorsFilter === 'mlb' && minorsIds?.has(p.id)) return false
    if (minorsFilter === 'minors' && !minorsIds?.has(p.id)) return false
    const isPick = p.customValue !== undefined
    const isPit = ['SP', 'RP', 'P'].some(pos => p.positions?.includes(pos))
    const isBat = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'UT', 'DH', 'INF'].some(pos => p.positions?.includes(pos))
    if (posFilter === 'bat' && !isBat) return false
    if (posFilter === 'pit' && !isPit) return false
    if (posFilter === 'pick' && !isPick) return false
    return true
  }) || []

  const toggleBtn = (isActive: boolean) => ({
    padding: '0.3rem 0.5rem',
    background: isActive ? `${color}20` : 'transparent',
    color: isActive ? color : 'var(--muted)',
    border: 'none', fontSize: '0.65rem', fontWeight: 800,
    fontFamily: 'var(--font-display)', textTransform: 'uppercase' as const,
    cursor: 'pointer', borderRadius: 4, transition: 'all 0.1s',
  })

  return (
    <div className="card" style={{ padding: '1.25rem', borderColor: active ? color : 'var(--border)', transition: 'border-color 0.15s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div style={{ flex: 1, marginRight: '1rem' }}>
          {isLeagueMode && leagueTeams && leagueTeams.length > 0 ? (
            <select value={selectedTeamId} onChange={e => { onSelectTeam(e.target.value); setLocalSearch('') }}
              style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: `1px solid ${color}`, color, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.85rem', textTransform: 'uppercase', padding: '0.4rem', borderRadius: 6, outline: 'none', cursor: 'pointer' }}>
              <option value="" disabled>Select Team</option>
              {leagueTeams.map((t: any) => (
                <option key={t.id} value={t.id} style={{ background: 'var(--bg-card)', color: 'var(--text)' }}>{t.name}</option>
              ))}
            </select>
          ) : (
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '0.06em', textTransform: 'uppercase', color }}>{label}</div>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.5rem', color: 'var(--text)' }}>
          {value.toFixed(1)}<span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 4 }}>pts</span>
        </div>
      </div>

      {players.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.8rem', border: '1px dashed var(--border)', borderRadius: 6, marginBottom: '0.75rem' }}>
          No assets added
        </div>
      ) : (
        <div style={{ marginBottom: '0.75rem' }}>
          {players.map((p: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid rgba(48,54,61,0.5)' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem', color: p.customValue ? '#f59e0b' : 'inherit' }}>{p.name}</span>
                  {!p.customValue && (
                    <button onClick={() => onOpenDrawer(p)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1 }} title="View player">ⓘ</button>
                  )}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                  {p.positions?.split(',')[0]}
                  {!p.customValue && ` · #${p.rank ?? 'UR'}`}
                  {!p.customValue && p.age ? ` · Age ${p.age}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.9rem', color }}>{getPlayerValue(p).toFixed(1)}</span>
                <button onClick={() => onRemove(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}>
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLeagueMode && (
        <button className="btn-ghost" onClick={onAdd} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
          <Plus size={14} /> Add Asset
        </button>
      )}

      {isLeagueMode && selectedTeamId && (
        <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(48,54,61,0.5)' }}>
          <input value={localSearch} onChange={e => setLocalSearch(e.target.value)} placeholder="Search roster..."
            style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.4rem 0.75rem', color: 'var(--text)', fontSize: '0.85rem', outline: 'none', marginBottom: '0.5rem' }} />

          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
              {(['all', 'bat', 'pit', 'pick'] as const).map(f => (
                <button key={f} onClick={() => setPosFilter(f)} style={toggleBtn(posFilter === f)}>{f}</button>
              ))}
            </div>
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
              {(['all', 'mlb', 'minors'] as const).map(f => (
                <button key={f} onClick={() => setMinorsFilter(f)} style={toggleBtn(minorsFilter === f)}>{f}</button>
              ))}
            </div>
          </div>

          <div style={{ maxHeight: '380px', overflowY: 'auto', paddingRight: '0.4rem', margin: '0 -0.4rem', paddingLeft: '0.4rem' }}>
            {displayedRoster.map((p: any, i: number) => {
              const isSelected = players.some((x: any) => x.id === p.id)
              return (
                <div key={p.id + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid rgba(48,54,61,0.3)', borderRadius: 4 }}>
                  <div
                    onClick={() => onTogglePlayer(p)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, cursor: 'pointer', opacity: isSelected ? 0.4 : 1 }}
                  >
                    {isSelected ? <Minus size={12} color="var(--muted)" /> : <Plus size={12} color="var(--muted)" />}
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: p.customValue ? '#f59e0b' : 'var(--text)' }}>{p.name}</span>
                    {minorsIds?.has(p.id) && <span style={{ color: '#4ade80', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.65rem' }}>M</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                      {p.positions?.split(',')[0]}
                      {!p.customValue && ` · #${p.rank ?? 'UR'}`}
                    </span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.8rem', color }}>{getPlayerValue(p).toFixed(1)}</span>
                    {!p.customValue && (
                      <button onClick={() => onOpenDrawer(p)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '0 2px', lineHeight: 1 }} title="View player">ⓘ</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
