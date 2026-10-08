'use client'
// AFL fantasy league standings — public, read-only. Data from /api/afl (draft rosters + nightly AFL stats).
// Separate from the TEMPORARY AFL tag/filter (lib/afl.ts).
import { useState, useEffect, useMemo } from 'react'
import { PlayerDrawer } from '../../components/players/PlayerDrawer'
import { useDrawerData } from '../../lib/useDrawerData'
import { LastNight, SeasonChart, DailyLog } from '../../components/afl/AflDaily'

// AFL-only color map — intentionally NOT the shared FRIEND_TEAMS map
const AFL_COLORS: Record<string, string> = {
  Jordan: '#22c55e',
  Matt:   '#a78bfa',
  Colin:  '#38bdf8',
  Rath:   '#fb923c',
  Soo:    '#e879f9',
  Brett:  '#2dd4bf',
}
const aflColor = (team: string | undefined) => (team && AFL_COLORS[team]) || 'var(--muted)'

const LEAGUES = ['0ehfuam0mg7wqpn7', 'ew7b8seomg7u7uzi', 'd3prsagvmgftfdc3']

const HIT_COLS = ['TB', 'R', 'RBI', 'K', 'BB', 'SB', 'CS', 'IBB', 'HBP'] as const
const PIT_COLS = ['IP', 'H', 'ER', 'BB', 'HB', 'K', 'W', 'L', 'SV'] as const

type TopFilter = 'all' | 'hit' | 'pit' | 'INF' | 'OF' | 'C'
const TOP_FILTERS: { key: TopFilter; label: string }[] = [
  { key: 'all', label: 'Overall' }, { key: 'hit', label: 'Hitters' }, { key: 'pit', label: 'Pitchers' },
  { key: 'INF', label: 'INF' }, { key: 'OF', label: 'OF' }, { key: 'C', label: 'C' },
]

function fmtPts(n: number | undefined): string {
  if (n == null) return '—'
  return String(Math.round(n * 10) / 10)
}

function statLine(p: any): string {
  const s = p.stats
  if (!s) return p.pos === 'P' ? '0.0 IP' : '0 PA'
  if (p.pos === 'P') return [`${s.IP} IP`, `${s.K} K`, `${s.ER} ER`, s.W || s.L ? `${s.W}-${s.L}` : null, s.SV ? `${s.SV} SV` : null].filter(Boolean).join(' · ')
  return [`${s.H}-${s.AB}`, s.HR ? `${s.HR} HR` : null, `${s.TB} TB`, `${s.R} R`, `${s.RBI} RBI`, s.SB ? `${s.SB} SB` : null].filter(Boolean).join(' · ')
}

// Mounted on the first player click (then kept), so the public page doesn't pull drawer data up front
function DrawerHost({ pid, onClose }: { pid: string | null; onClose: () => void }) {
  const { statsMap, mlbToolsMap, regression, norms, poolStats } = useDrawerData()
  const [allPlayers, setAllPlayers] = useState<any[]>([])
  const [allRosters, setAllRosters] = useState<any[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/players/all').then(r => r.json()),
      ...LEAGUES.map(id => fetch(`/api/leagues/${id}/rosters`).then(r => r.json()).catch(() => ({}))),
    ]).then(([pd, ...rr]) => {
      setAllPlayers(pd.players ?? [])
      setAllRosters(rr.flatMap((d: any) => d.rosters ?? []))
    })
  }, [])

  const globalOwnership = useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    for (const r of allRosters) (map[r.player_id] ??= {})[r.league_id] = r.team_name
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

  const player = pid ? allPlayers.find(p => p.id === pid) : null
  if (!player) return null
  return (
    <PlayerDrawer
      player={player}
      onClose={onClose}
      globalOwnership={globalOwnership}
      minorsIds={minorsIds}
      mlbToolsMap={mlbToolsMap}
      statsMap={statsMap}
      regression={regression}
      norms={norms}
      poolStats={poolStats}
      allPlayers={allPlayers}
    />
  )
}

export default function AFLPage() {
  const [data, setData] = useState<any>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [team, setTeam] = useState<string>('Jordan')
  const [topFilter, setTopFilter] = useState<TopFilter>('all')
  const [season, setSeason] = useState<number | null>(null)
  const [drawerPid, setDrawerPid] = useState<string | null>(null)
  const [drawerReady, setDrawerReady] = useState(false)
  useEffect(() => { if (drawerPid) setDrawerReady(true) }, [drawerPid])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    fetch(season ? `/api/afl?season=${season}` : '/api/afl').then(r => r.json()).then(setData).catch(() => setData({ teams: [], players: [] }))
  }, [season])

  const teams: any[] = data?.teams ?? []
  const activeTeam = teams.find(t => t.name === team) ?? teams[0]

  const topPlayers = useMemo(() => {
    const list = (data?.players ?? []).filter((p: any) => {
      if (topFilter === 'all') return true
      if (topFilter === 'hit') return p.pos !== 'P'
      if (topFilter === 'pit') return p.pos === 'P'
      return p.pos === topFilter
    })
    return [...list].sort((a: any, b: any) => b.pts - a.pts || (a.round ?? 99) - (b.round ?? 99)).slice(0, 25)
  }, [data, topFilter])

  const updated = data?.syncedAt
    ? new Date(data.syncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  const btn = (active: boolean, color = 'var(--accent)') => ({
    padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid',
    borderColor: active ? color : 'var(--border)',
    background: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent',
    color: active ? color : 'var(--muted)',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem',
    letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  })

  const hasDays = (data?.days?.length ?? 0) > 0
  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' as const }
  const sectionTitle = { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--muted)', marginBottom: '0.5rem' }
  const th = { padding: '0.45rem 0.5rem', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--muted)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const, borderBottom: '1px solid var(--border)', background: 'var(--bg-card)' }
  const td = { padding: '0.45rem 0.5rem', fontSize: '0.8rem', textAlign: 'right' as const, whiteSpace: 'nowrap' as const, borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' as const }
  const stickyL = (left: number) => ({ position: 'sticky' as const, left, zIndex: 1, background: 'var(--bg-card)' })

  const PlayerName = ({ p }: { p: any }) => {
    if (!p.name) return <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>— open —</span>
    const clickable = !!p.pid
    return (
      <span
        onClick={clickable ? () => setDrawerPid(p.pid) : undefined}
        style={{ color: 'var(--text)', fontWeight: 600, cursor: clickable ? 'pointer' : 'default', textDecoration: clickable ? 'underline dotted var(--border)' : 'none', textUnderlineOffset: 3 }}
      >{p.name}</span>
    )
  }

  const TeamTable = ({ rows, kind }: { rows: any[]; kind: 'hit' | 'pit' }) => {
    const cols = kind === 'hit' ? HIT_COLS : PIT_COLS
    const slotW = 46, nameW = isMobile ? 132 : 190
    return (
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: slotW + nameW + 56 + (hasDays ? 44 : 0) + cols.length * 40 }}>
          <thead>
            <tr>
              <th style={{ ...th, ...stickyL(0), textAlign: 'left', width: slotW, minWidth: slotW }}>Slot</th>
              <th style={{ ...th, ...stickyL(slotW), textAlign: 'left', width: nameW, minWidth: nameW, borderRight: '1px solid var(--border)' }}>{kind === 'hit' ? 'Hitters' : 'Pitchers'}</th>
              <th style={{ ...th, color: 'var(--text)' }}>Pts</th>
              {hasDays && <th style={th}>Last</th>}
              {cols.map(c => <th key={c} style={th}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const dim = !r.active
              return (
                <tr key={i} style={{ opacity: dim ? 0.45 : 1 }}>
                  <td style={{ ...td, ...stickyL(0), textAlign: 'left', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
                    {r.slot === 'Bench' ? 'BN' : r.slot === 'Util' ? 'UT' : r.slot}
                  </td>
                  <td style={{ ...td, ...stickyL(slotW), textAlign: 'left', borderRight: '1px solid var(--border)', maxWidth: nameW, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <PlayerName p={r} />
                    {r.name && r.slot !== r.pos && <span style={{ marginLeft: 6, fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{r.pos}</span>}
                  </td>
                  <td style={{ ...td, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.9rem', color: r.name ? 'var(--text)' : 'var(--muted)' }}>{r.name ? fmtPts(r.pts) : ''}</td>
                  {hasDays && <td style={{ ...td, color: 'var(--muted)' }}>{r.name && r.lastPts != null ? (r.lastPts > 0 ? `+${r.lastPts}` : r.lastPts) : ''}</td>}
                  {cols.map(c => <td key={c} style={{ ...td, color: 'var(--muted)' }}>{r.name ? (r.stats?.[c] ?? (c === 'IP' ? '0.0' : 0)) : ''}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  if (!data) {
    return <div style={{ padding: isMobile ? '1rem' : '2rem', color: 'var(--muted)', fontSize: '0.85rem' }}>Loading AFL standings…</div>
  }

  const lineup: any[] = activeTeam?.lineup ?? []
  const hitRows = lineup.filter(r => r.name ? r.pos !== 'P' : r.slot !== 'P' && r.slot !== 'Bench')
  const pitRows = lineup.filter(r => r.name ? r.pos === 'P' : r.slot === 'P')
  const openBench = lineup.filter(r => !r.name && r.slot === 'Bench').length
  const leaderPts = teams[0]?.pts ?? 0
  const isFinal = data.season < new Date().getFullYear()
  const days: any[] = data.days ?? []
  // Most recent day any rostered player played — matches the API's per-player "Last" column
  const lastDay = [...days].reverse().find(d => d.players.length > 0)
  const teamOrder = teams.map(t => t.name)
  const lbCols = isMobile ? '28px 1fr 56px 52px' : `40px 1fr 80px ${lastDay ? '70px ' : ''}80px 90px 90px`

  return (
    <div style={{ padding: isMobile ? '1rem 1rem 88px' : '2rem', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.4rem', color: 'var(--text)', letterSpacing: '-0.02em' }}>
            🌵 AFL Fantasy {data.season}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
            Season-total best ball · 1 C · 4 INF · 3 OF · 1 UT · 4 P{isFinal ? ' · Final' : updated ? ` · Updated ${updated}` : ''}
          </div>
        </div>
        {(data.seasons?.length ?? 0) > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {data.seasons.map((y: number) => <button key={y} onClick={() => setSeason(y)} style={btn(data.season === y)}>{y}</button>)}
          </div>
        )}
      </div>

      {lastDay && <LastNight day={lastDay} color={aflColor} isFinal={isFinal} onPlayer={setDrawerPid} />}

      {/* Leaderboard */}
      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: lbCols, ...th, padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)', background: 'transparent' }}>
          <div style={{ textAlign: 'left' }}>#</div>
          <div style={{ textAlign: 'left' }}>Team</div>
          <div>Pts</div>
          {lastDay && !isMobile && <div>Last</div>}
          <div>Gap</div>
          {!isMobile && <><div>Hit</div><div>Pitch</div></>}
        </div>
        {teams.map(t => {
          const color = aflColor(t.name)
          const selected = activeTeam?.name === t.name
          const last = lastDay?.teams?.[t.name]
          const hitShare = t.pts > 0 ? Math.max(0, t.hitPts) / (Math.max(0, t.hitPts) + Math.max(0, t.pitPts) || 1) : 0.5
          return (
            <div key={t.name} onClick={() => setTeam(t.name)} style={{
              display: 'grid', gridTemplateColumns: lbCols,
              alignItems: 'center', padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border)', cursor: 'pointer',
              background: selected ? `color-mix(in srgb, ${color} 8%, transparent)` : 'transparent',
              borderLeft: `3px solid ${selected ? color : 'transparent'}`,
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', color: t.rank === 1 && data.hasStats ? color : 'var(--muted)' }}>{t.rank}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', color }}>{t.name}</span>
                </div>
                {isMobile && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: 2, marginLeft: 18 }}>
                    Hit {fmtPts(t.hitPts)} · Pitch {fmtPts(t.pitPts)}
                  </div>
                )}
                {data.hasStats && (
                  <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', marginTop: 5, marginLeft: 18, maxWidth: 180, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${hitShare * 100}%`, background: color }} />
                    <div style={{ flex: 1, background: `color-mix(in srgb, ${color} 40%, transparent)` }} />
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem', color: 'var(--text)' }}>
                {fmtPts(t.pts)}
                {isMobile && last && <div style={{ fontFamily: 'var(--font-body)', fontWeight: 400, fontSize: '0.68rem', color: 'var(--muted)' }}>{last.delta > 0 ? '+' : ''}{last.delta}{last.rankChange ? ` ${last.rankChange > 0 ? '▲' : '▼'}${Math.abs(last.rankChange)}` : ''}</div>}
              </div>
              {last && !isMobile && (
                <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {last.delta > 0 ? '+' : ''}{last.delta}
                  {last.rankChange !== 0 && <span style={{ fontSize: '0.7rem', marginLeft: 4 }}>{last.rankChange > 0 ? '▲' : '▼'}{Math.abs(last.rankChange)}</span>}
                </div>
              )}
              <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{t.pts === leaderPts ? '—' : fmtPts(t.gap)}</div>
              {!isMobile && <>
                <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtPts(t.hitPts)}</div>
                <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtPts(t.pitPts)}</div>
              </>}
            </div>
          )
        })}
      </div>

      {days.length > 0 && <SeasonChart days={days} teamOrder={teamOrder} color={aflColor} isMobile={isMobile} />}
      {days.length > 0 && <DailyLog days={days} teamOrder={teamOrder} color={aflColor} isMobile={isMobile} onPlayer={setDrawerPid} />}

      {/* Team selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {isMobile ? (
          <select value={activeTeam?.name ?? ''} onChange={e => setTeam(e.target.value)} style={{
            background: 'var(--bg-card)', border: `1px solid ${aflColor(activeTeam?.name)}`, color: aflColor(activeTeam?.name),
            borderRadius: 6, padding: '0.45rem 0.6rem', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.9rem', flex: 1,
          }}>
            {teams.map(t => <option key={t.name} value={t.name}>{t.rank}. {t.name} — {fmtPts(t.pts)} pts</option>)}
          </select>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {teams.map(t => <button key={t.name} onClick={() => setTeam(t.name)} style={btn(activeTeam?.name === t.name, aflColor(t.name))}>{t.name}</button>)}
          </div>
        )}
        {activeTeam && !isMobile && (
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{fmtPts(activeTeam.pts)}</span> pts · Hit {fmtPts(activeTeam.hitPts)} · Pitch {fmtPts(activeTeam.pitPts)}
          </div>
        )}
      </div>

      {/* Team tables */}
      {activeTeam && (
        <div style={{ ...card, marginBottom: '1.5rem', borderTop: `3px solid ${aflColor(activeTeam.name)}` }}>
          <TeamTable rows={hitRows} kind="hit" />
          <div style={{ height: 10, background: 'var(--bg)' }} />
          <TeamTable rows={pitRows} kind="pit" />
          {openBench > 0 && (
            <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: 'var(--muted)', opacity: 0.7, fontStyle: 'italic' }}>
              {openBench} open bench {openBench === 1 ? 'spot' : 'spots'}
            </div>
          )}
        </div>
      )}

      {/* Top players */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ ...sectionTitle, marginBottom: 0 }}>Top Players</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TOP_FILTERS.map(f => <button key={f.key} onClick={() => setTopFilter(f.key)} style={{ ...btn(topFilter === f.key), padding: isMobile ? '0.3rem 0.55rem' : '0.4rem 0.75rem' }}>{f.label}</button>)}
        </div>
      </div>
      <div style={card}>
        {topPlayers.map((p: any, i: number) => {
          const color = aflColor(p.team)
          return (
            <div key={`${p.team}-${p.name}`} style={{ display: 'grid', gridTemplateColumns: isMobile ? '24px 1fr 52px' : '32px 1fr 90px 60px', alignItems: 'center', gap: 8, padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.8rem', color: 'var(--muted)' }}>{i + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', minWidth: 0 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><PlayerName p={p} /></span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 700, flexShrink: 0 }}>{p.pos}</span>
                  {!p.active && <span style={{ fontSize: '0.6rem', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px', flexShrink: 0 }}>BN</span>}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isMobile && <span style={{ color, fontWeight: 700 }}>{p.team} · </span>}{statLine(p)}
                </div>
              </div>
              {!isMobile && <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.85rem', color }}>{p.team}</div>}
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', color: 'var(--text)' }}>{fmtPts(p.pts)}</div>
            </div>
          )
        })}
      </div>

      {drawerReady && <DrawerHost pid={drawerPid} onClose={() => setDrawerPid(null)} />}
    </div>
  )
}
