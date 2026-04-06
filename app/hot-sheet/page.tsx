'use client'
import { useState, useEffect, useMemo } from 'react'
import { PlayerDrawer } from '../../components/players/PlayerDrawer'
import { useDrawerData } from '../../lib/useDrawerData'

const LEAGUES: { id: string; label: string }[] = [
  { id: '0ehfuam0mg7wqpn7', label: 'D28' },
  { id: 'ew7b8seomg7u7uzi', label: 'D34' },
  { id: 'd3prsagvmgftfdc3', label: 'D52' },
]
const MY_TEAM = 'Winston Salem Dash'

function toolColor(val: number | null): string {
  if (val == null) return 'var(--muted)'
  if (val >= 130) return '#ef4444'
  if (val >= 115) return '#fca5a5'
  if (val >= 95)  return 'var(--text)'
  if (val >= 80)  return '#93c5fd'
  return '#3b82f6'
}

function deltaColor(d: number): string {
  if (d >= 15) return '#22c55e'
  if (d >= 10) return '#86efac'
  if (d >= 5)  return '#bbf7d0'
  return 'var(--muted)'
}

function cleanPositions(posString: string) {
  if (!posString) return '—'
  const list = posString.split(',').map((p: string) => p.trim())
  if (list.length === 1) return list[0]
  const filtered = list.filter((p: string) => p !== 'INF' && p !== 'OF')
  return filtered.length > 0 ? filtered.join(', ') : list.join(', ')
}

function fmtStatLine(r: any, tab: 'bats' | 'arms', statsMap: Record<string, any>): string {
  const s = statsMap[r.id]
  if (!s) return ''
  if (tab === 'arms') {
    const bf = s.battersFaced || ((s.atBats ?? 0) + (s.baseOnBalls ?? 0) + (s.hitByPitch ?? 0))
    const kPct = bf && s.strikeOuts != null ? (s.strikeOuts / bf * 100).toFixed(1) + '%' : null
    const bbPct = bf && s.baseOnBalls != null ? (s.baseOnBalls / bf * 100).toFixed(1) + '%' : null
    const wl = s.wins != null && s.losses != null ? `${s.wins}-${s.losses}` : null
    return [s.gamesPlayed != null ? `${s.gamesPlayed} G` : null, wl, s.inningsPitched ? `${s.inningsPitched} IP` : null, s.era ? `${s.era} ERA` : null, kPct ? `${kPct} K%` : null, bbPct ? `${bbPct} BB%` : null].filter(Boolean).join(' · ')
  } else {
    const pa = s.plateAppearances ?? 0
    const kPct = pa && s.strikeOuts != null ? (s.strikeOuts / pa * 100).toFixed(1) + '%' : null
    const bbPct = pa && s.baseOnBalls != null ? (s.baseOnBalls / pa * 100).toFixed(1) + '%' : null
    return [s.gamesPlayed != null ? `${s.gamesPlayed} G` : null, s.ops ? `${s.ops} OPS` : null, kPct ? `${kPct} K%` : null, bbPct ? `${bbPct} BB%` : null, s.homeRuns != null ? `${s.homeRuns} HR` : null, s.stolenBases != null ? `${s.stolenBases} SB` : null].filter(Boolean).join(' · ')
  }
}

function fmtToolLine(ms: any, tab: 'bats' | 'arms'): string {
  if (!ms) return ''
  if (tab === 'bats') {
    return [ms.hit != null ? `HIT+ ${ms.hit}` : null, ms.power != null ? `PWR+ ${ms.power}` : null, ms.speed != null ? `SPD+ ${ms.speed}` : null, ms.overall != null ? `OVR+ ${ms.overall}` : null].filter(Boolean).join(' · ')
  } else {
    return [ms.stuff != null ? `STF+ ${ms.stuff}` : null, ms.control != null ? `CTL+ ${ms.control}` : null, ms.overall != null ? `OVR+ ${ms.overall}` : null].filter(Boolean).join(' · ')
  }
}

export default function HotSheetPage() {
  const [data, setData] = useState<{ bats: any[]; arms: any[]; generatedAt: string | null }>({ bats: [], arms: [], generatedAt: null })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'bats' | 'arms'>('bats')
  const [allRosters, setAllRosters] = useState<any[]>([])
  const [allPlayers, setAllPlayers] = useState<any[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null)
  const [isMobile, setIsMobile] = useState(false)

  const { statsMap, mlbToolsMap } = useDrawerData()

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/hot-sheet').then(r => r.json()),
      fetch('/api/players/all').then(r => r.json()),
      ...LEAGUES.map(l => fetch(`/api/leagues/${l.id}/rosters`).then(r => r.json())),
    ]).then(([hs, pd, ...rosterResults]) => {
      setData(hs)
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
    () => new Set(allPlayers.filter(p => !p.mlbam_id || !mlbToolsMap[p.mlbam_id]).map(p => p.id)),
    [allPlayers, mlbToolsMap]
  )

  const playerMap = useMemo(() => {
    const map: Record<string, any> = {}
    for (const p of allPlayers) map[p.id] = p
    return map
  }, [allPlayers])

  const rows = tab === 'bats' ? data.bats : data.arms

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

  const batCols = '48px 80px 1fr 48px 52px 52px 52px 56px'
  const armCols = '48px 80px 1fr 48px 52px 52px 56px'
  const gridCols = tab === 'bats' ? batCols : armCols

  return (
    <div style={{ padding: isMobile ? '1rem' : '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.4rem', color: 'var(--text)', letterSpacing: '-0.02em' }}>
            🔥 Hot Sheet
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
            Biggest model score gainers this season{generatedAt ? ` · Updated ${generatedAt}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setTab('bats')} style={btn(tab === 'bats')}>Bats</button>
          <button onClick={() => setTab('arms')} style={btn(tab === 'arms')}>Arms</button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No hot sheet data yet — run a Sync Stats to generate.</div>
      ) : isMobile ? (
        /* ── Mobile layout ── */
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((r: any, i: number) => {
            const player = playerMap[r.id]
            const pOwn = globalOwnership[r.id] || {}
            const myTeamOwned = Object.values(pOwn).includes(MY_TEAM)
            const ms = player?.model_scores
            const level = statsMap[r.id]?._level ?? '—'
            const statLine = fmtStatLine(r, tab, statsMap)
            const toolLine = fmtToolLine(ms, tab)

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
                {/* Delta */}
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', color: deltaColor(r.delta), flexShrink: 0, width: 36, textAlign: 'center' }}>
                  +{r.delta}
                </div>

                {/* Info stack */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  {/* Name + rank + dots */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'nowrap', overflow: 'hidden' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem', color: myTeamOwned ? '#f59e0b' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                    {r.rank && <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-display)', color: 'var(--muted)', flexShrink: 0 }}>#{r.rank}</span>}
                    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                      {LEAGUES.map(league => {
                        const teamName = pOwn[league.id]
                        const color = teamName ? (teamName === MY_TEAM ? '#22c55e' : '#eab308') : '#ef4444'
                        return <div key={league.id} style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, opacity: 0.85 }} />
                      })}
                    </div>
                  </div>
                  {/* Pos · Team · Level */}
                  <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 600, marginTop: '1px' }}>
                    {[cleanPositions(r.positions), player?.team, level].filter(Boolean).join(' · ')}
                  </div>
                  {/* Stat line */}
                  {statLine && (
                    <div style={{ fontSize: '0.62rem', color: 'var(--muted)', marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {statLine}
                    </div>
                  )}
                  {/* Tool line */}
                  {toolLine && (
                    <div style={{ fontSize: '0.62rem', fontFamily: 'var(--font-display)', fontWeight: 700, marginTop: '2px', color: toolColor(ms?.overall ?? null), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {toolLine}
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
            <div>ΔOVR</div>
            <div>POS</div>
            <div>PLAYER</div>
            <div style={{ textAlign: 'right' }}>LEV</div>
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
            const myTeamOwned = Object.values(pOwn).includes(MY_TEAM)
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
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.85rem', color: deltaColor(r.delta) }}>
                  +{r.delta}
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
                        const color = teamName ? (teamName === MY_TEAM ? '#22c55e' : '#eab308') : '#ef4444'
                        return <div key={league.id} title={`${league.label}: ${teamName || 'FA'}`}
                          style={{ width: '5px', height: '5px', borderRadius: '50%', background: color, opacity: 0.85 }} />
                      })}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '1px' }}>
                    {player?.team ?? ''}
                    {(() => { const sl = fmtStatLine(r, tab, statsMap); return sl ? <span>{player?.team ? ' · ' : ''}{sl}</span> : null })()}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', color: 'var(--muted)' }}>
                  {statsMap[r.id]?._level ?? '—'}
                </div>
                {tab === 'bats' ? <>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.hit ?? null) }}>{ms?.hit ?? '—'}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.power ?? null) }}>{ms?.power ?? '—'}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.speed ?? null) }}>{ms?.speed ?? '—'}</div>
                </> : <>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.stuff ?? null) }}>{ms?.stuff ?? '—'}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: toolColor(ms?.control ?? null) }}>{ms?.control ?? '—'}</div>
                </>}
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.88rem', color: toolColor(r.overall) }}>
                  {r.overall}
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
          allPlayers={allPlayers}
        />
      )}
    </div>
  )
}
