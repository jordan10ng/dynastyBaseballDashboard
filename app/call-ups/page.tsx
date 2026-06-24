'use client'
import { fmtLevel } from '@/lib/players-config'
import { useState, useEffect, useMemo } from 'react'
import { PlayerDrawer } from '../../components/players/PlayerDrawer'
import { useDrawerData } from '../../lib/useDrawerData'

const LEAGUES: { id: string; label: string }[] = [
  { id: '0ehfuam0mg7wqpn7', label: 'D28' },
  { id: 'ew7b8seomg7u7uzi', label: 'D34' },
  { id: 'd3prsagvmgftfdc3', label: 'D52' },
]
const MY_TEAM = 'Winston Salem Dash'

const FRIEND_TEAMS: Record<string, string> = {
  'Winston Salem Dash':     '#22c55e',
  'Bay Area Bush League':   '#a78bfa',
  'Team Colin':             '#38bdf8',
  'Team Pat':               '#fb923c',
  'The Old Gold and Black': '#e879f9',
}
const D52_ID = 'd3prsagvmgftfdc3'
function friendColor(teamName: string | undefined): string | null {
  if (!teamName) return null
  return FRIEND_TEAMS[teamName] ?? null
}
function isOurTeam(teamName: string | undefined): boolean {
  return !!teamName && teamName in FRIEND_TEAMS
}

// Level filter order (high → low). 'All' prepended at render.
const LEVEL_ORDER = ['MLB', 'AAA', 'AA', 'High-A', 'Single-A', 'Complex', 'DSL']

function toolColor(val: number | null): string {
  if (val == null) return 'var(--muted)'
  if (val >= 130) return '#ef4444'
  if (val >= 115) return '#fca5a5'
  if (val >= 95)  return 'var(--text)'
  if (val >= 80)  return '#93c5fd'
  return '#3b82f6'
}

function recencyColor(days: number): string {
  if (days <= 3)  return '#22c55e'
  if (days <= 7)  return '#86efac'
  if (days <= 14) return '#bbf7d0'
  return 'var(--muted)'
}

function cleanPositions(posString: string) {
  if (!posString) return '—'
  const list = posString.split(',').map((p: string) => p.trim())
  if (list.length === 1) return list[0]
  const filtered = list.filter((p: string) => p !== 'INF' && p !== 'OF')
  return filtered.length > 0 ? filtered.join(', ') : list.join(', ')
}

function moveLabel(r: any): string {
  return `${r.fromLevel ? fmtLevel(r.fromLevel) : '?'} → ${fmtLevel(r.toLevel)}`
}

export default function CallUpsPage() {
  const [data, setData] = useState<{ bats: any[]; arms: any[]; generatedAt?: string | null }>({ bats: [], arms: [] })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'bats' | 'arms'>('bats')
  const [level, setLevel] = useState<string>('All')
  const [allRosters, setAllRosters] = useState<any[]>([])
  const [allPlayers, setAllPlayers] = useState<any[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null)
  const [isMobile, setIsMobile] = useState(false)

  const { statsMap, mlbToolsMap, regression, norms, poolStats } = useDrawerData()

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/call-ups').then(r => r.json()),
      fetch('/api/players/all').then(r => r.json()),
      ...LEAGUES.map(l => fetch(`/api/leagues/${l.id}/rosters`).then(r => r.json())),
    ]).then(([cu, pd, ...rosterResults]) => {
      setData(cu)
      setAllPlayers(pd.players ?? [])
      setAllRosters(rosterResults.flatMap((d: any) => d.rosters ?? []))
      setLoading(false)
    })
  }, [])

  const globalOwnership = useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    for (const r of allRosters) {
      if (!map[r.player_id]) map[r.player_id] = {}
      map[r.player_id][r.league_id] = r.team_name
    }
    return map
  }, [allRosters])

  const minorsIds = useMemo(
    () => new Set(allPlayers.filter(p => {
      if (!p.mlbam_id) return true
      const t = mlbToolsMap[String(p.mlbam_id)]
      if (!t) return true
      return (t._pa ?? 0) < 130 && (t._ip ?? 0) < 50
    }).map(p => p.id)),
    [allPlayers, mlbToolsMap]
  )

  const playerMap = useMemo(() => {
    const map: Record<string, any> = {}
    for (const p of allPlayers) map[p.id] = p
    return map
  }, [allPlayers])

  const sideRows = tab === 'bats' ? (data.bats ?? []) : (data.arms ?? [])

  // Levels actually present in the current side, ordered high→low.
  const levelsPresent = useMemo(() => {
    const s = new Set(sideRows.map((r: any) => r.toLevel))
    return LEVEL_ORDER.filter(l => s.has(l))
  }, [sideRows])

  const rows = level === 'All' ? sideRows : sideRows.filter((r: any) => r.toLevel === level)

  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const btn = (active: boolean) => ({
    padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid',
    borderColor: active ? 'var(--accent)' : 'var(--border)',
    background: active ? 'rgba(34,197,94,0.1)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--muted)',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem',
    letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  })

  const batCols = '64px 72px 1fr 96px 52px 52px 52px 56px'
  const armCols = '64px 72px 1fr 96px 52px 52px 56px'
  const gridCols = tab === 'bats' ? batCols : armCols

  return (
    <div style={{ padding: isMobile ? '1rem' : '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.4rem', color: 'var(--text)', letterSpacing: '-0.02em' }}>
            ⬆️ Call-Ups
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
            Promoted to a new level — last 30 days{generatedAt ? ` · Updated ${generatedAt}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {isMobile ? (
            <select value={level} onChange={e => setLevel(e.target.value)} style={{
              background: 'rgba(56,189,248,0.1)', border: '1px solid #38bdf8',
              color: '#38bdf8', borderRadius: 6, padding: '0.35rem 0.5rem',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem',
              letterSpacing: '0.04em', cursor: 'pointer',
            }}>
              <option value="All">All</option>
              {levelsPresent.map(l => <option key={l} value={l}>{fmtLevel(l)}</option>)}
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {['All', ...levelsPresent].map(l => (
                <button key={l} onClick={() => setLevel(l)} style={{
                  ...btn(level === l),
                  borderColor: level === l ? '#38bdf8' : 'var(--border)',
                  background: level === l ? 'rgba(56,189,248,0.1)' : 'transparent',
                  color: level === l ? '#38bdf8' : 'var(--muted)',
                }}>{l === 'All' ? 'All' : fmtLevel(l)}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setTab('bats')} style={btn(tab === 'bats')}>Bats</button>
            <button onClick={() => setTab('arms')} style={btn(tab === 'arms')}>Arms</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No call-ups in the last 30 days{level !== 'All' ? ` at ${fmtLevel(level)}` : ''}.</div>
      ) : isMobile ? (
        /* ── Mobile layout ── */
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r: any, i: number) => {
            const player = playerMap[r.id]
            const pOwn = globalOwnership[r.id] || {}
            const myTeamOwned = Object.values(pOwn).some(t => isOurTeam(t))
            const ms = player?.model_scores

            return (
              <div
                key={r.id ?? i}
                onClick={() => player && setSelectedPlayer(player)}
                style={{
                  display: 'flex', gap: '0.75rem', padding: '0.75rem 0',
                  borderBottom: '1px solid rgba(48,54,61,0.4)',
                  borderLeft: myTeamOwned ? '2px solid #f59e0b' : '2px solid transparent',
                  paddingLeft: myTeamOwned ? '0.5rem' : '0',
                  background: myTeamOwned ? 'rgba(245,158,11,0.04)' : 'transparent',
                  cursor: player ? 'pointer' : 'default',
                  alignItems: 'center',
                }}
              >
                <div style={{ flexShrink: 0, width: 44, textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', color: '#38bdf8' }}>
                    {fmtLevel(r.toLevel)}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: recencyColor(r.daysAgo), fontFamily: 'var(--font-display)', fontWeight: 700 }}>{r.daysAgo}d ago</div>
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'nowrap', overflow: 'hidden' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: myTeamOwned ? '#f59e0b' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {[cleanPositions(r.positions), moveLabel(r)].filter(Boolean).join(' · ')}
                    </span>
                    {r.rank && <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-display)', color: 'var(--muted)', flexShrink: 0 }}>#{r.rank}</span>}
                    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                      {LEAGUES.map(league => {
                        const teamName = pOwn[league.id]
                        const fc = league.id === D52_ID ? friendColor(teamName) : friendColor(MY_TEAM === teamName ? teamName : undefined)
                        const color = teamName ? (fc ?? '#eab308') : '#ef4444'
                        return <div key={league.id} style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, opacity: 0.85 }} />
                      })}
                    </div>
                  </div>
                  {r.statLine && (
                    <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.statLine}
                    </div>
                  )}
                  {ms && (
                    <div style={{ fontSize: '0.62rem', fontFamily: 'var(--font-display)', fontWeight: 700, marginTop: '2px', display: 'flex', gap: '0.4rem', flexWrap: 'nowrap', overflow: 'hidden' }}>
                      {tab === 'bats' ? <>
                        {ms.hit != null && <span style={{ color: toolColor(ms.hit) }}>HIT+ {ms.hit}</span>}
                        {ms.power != null && <span style={{ color: toolColor(ms.power) }}>PWR+ {ms.power}</span>}
                        {ms.speed != null && <span style={{ color: toolColor(ms.speed) }}>SPD+ {ms.speed}</span>}
                        {ms.overall != null && <span style={{ color: toolColor(ms.overall) }}>OVR+ {ms.overall}</span>}
                      </> : <>
                        {ms.stuff != null && <span style={{ color: toolColor(ms.stuff) }}>STF+ {ms.stuff}</span>}
                        {ms.control != null && <span style={{ color: toolColor(ms.control) }}>CTL+ {ms.control}</span>}
                        {ms.overall != null && <span style={{ color: toolColor(ms.overall) }}>OVR+ {ms.overall}</span>}
                      </>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── Desktop layout ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: gridCols,
            gap: '0.5rem', padding: '0.2rem 0.75rem',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.62rem',
            letterSpacing: '0.08em', color: 'var(--muted)',
            borderBottom: '1px solid var(--border)', marginBottom: '0.25rem',
            position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
          }}>
            <div>DATE</div>
            <div>POS</div>
            <div>PLAYER</div>
            <div>MOVE</div>
            {tab === 'bats' ? <>
              <div style={{ textAlign: 'right' }}>HIT+</div>
              <div style={{ textAlign: 'right' }}>PWR+</div>
              <div style={{ textAlign: 'right' }}>SPD+</div>
            </> : <>
              <div style={{ textAlign: 'right' }}>STF+</div>
              <div style={{ textAlign: 'right' }}>CTL+</div>
            </>}
            <div style={{ textAlign: 'right' }}>OVR+</div>
          </div>

          {rows.map((r: any, i: number) => {
            const player = playerMap[r.id]
            const pOwn = globalOwnership[r.id] || {}
            const myTeamOwned = Object.values(pOwn).some(t => isOurTeam(t))
            const ms = player?.model_scores

            return (
              <div
                key={r.id ?? i}
                onClick={() => player && setSelectedPlayer(player)}
                style={{
                  display: 'grid', gridTemplateColumns: gridCols,
                  gap: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: 6,
                  background: myTeamOwned ? 'rgba(245,158,11,0.06)' : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                  borderLeft: myTeamOwned ? '2px solid #f59e0b' : '2px solid transparent',
                  alignItems: 'center',
                  cursor: player ? 'pointer' : 'default',
                }}
                onMouseEnter={e => player && (e.currentTarget.style.background = myTeamOwned ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.05)')}
                onMouseLeave={e => (e.currentTarget.style.background = myTeamOwned ? 'rgba(245,158,11,0.06)' : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent')}
              >
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.7rem', color: recencyColor(r.daysAgo) }}>
                  {r.daysAgo}d ago
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', color: 'var(--muted)' }}>
                  {cleanPositions(r.positions)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'nowrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: myTeamOwned ? '#f59e0b' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                    {r.rank && <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-display)', color: 'var(--muted)', flexShrink: 0 }}>#{r.rank}</span>}
                    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                      {LEAGUES.map(league => {
                        const teamName = pOwn[league.id]
                        const fc = league.id === D52_ID ? friendColor(teamName) : friendColor(MY_TEAM === teamName ? teamName : undefined)
                        const color = teamName ? (fc ?? '#eab308') : '#ef4444'
                        return <div key={league.id} title={`${league.label}: ${teamName || 'FA'}`}
                          style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, opacity: 0.85 }} />
                      })}
                    </div>
                  </div>
                  {r.statLine && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '1px' }}>{r.statLine}</div>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', color: '#38bdf8' }}>
                  {moveLabel(r)}
                </div>
                {tab === 'bats' ? <>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.hit ?? null) }}>{ms?.hit ?? '—'}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.power ?? null) }}>{ms?.power ?? '—'}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.speed ?? null) }}>{ms?.speed ?? '—'}</div>
                </> : <>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.stuff ?? null) }}>{ms?.stuff ?? '—'}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.control ?? null) }}>{ms?.control ?? '—'}</div>
                </>}
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.88rem', color: toolColor(ms?.overall ?? null) }}>
                  {ms?.overall ?? '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectedPlayer && (
        <PlayerDrawer
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          globalOwnership={globalOwnership}
          minorsIds={minorsIds}
          mlbToolsMap={mlbToolsMap}
          statsMap={statsMap}
          regression={regression}
          norms={norms}
          poolStats={poolStats}
          allPlayers={allPlayers}
        />
      )}
    </div>
  )
}
