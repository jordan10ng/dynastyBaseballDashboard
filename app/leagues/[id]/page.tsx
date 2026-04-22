'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

const LEAGUE_IDS = ['0ehfuam0mg7wqpn7', 'ew7b8seomg7u7uzi', 'd3prsagvmgftfdc3']
const LEAGUE_LABELS: Record<string, string> = {
  '0ehfuam0mg7wqpn7': 'D28',
  'ew7b8seomg7u7uzi': 'D34',
  'd3prsagvmgftfdc3': 'D52',
}
const D52_ID = 'd3prsagvmgftfdc3'
const MY_TEAM = 'Winston Salem Dash'
const FRIEND_TEAMS: Record<string, string> = {
  'Winston Salem Dash':     '#22c55e',
  'Bay Area Bush League':   '#a78bfa',
  'Team Colin':             '#38bdf8',
  'Team Pat':               '#fb923c',
  'The Old Gold and Black': '#e879f9',
}

function teamColor(name: string, leagueId: string) {
  if (name === MY_TEAM) return '#22c55e'
  if (leagueId === D52_ID && FRIEND_TEAMS[name]) return FRIEND_TEAMS[name]
  return '#6b7280'
}

function fmt(n: number) { return n.toFixed(1) }

function rankColor(rank: number, total: number): string {
  if (!rank || !total) return '#6b7280'
  const t = (rank - 1) / Math.max(total - 1, 1) // 0=best, 1=worst
  // green → yellow → red  (best to worst)
  if (t <= 0.5) {
    const r = Math.round(t * 2 * 255)
    return `rgb(${r},200,50)`
  } else {
    const g = Math.round((1 - (t - 0.5) * 2) * 200)
    return `rgb(220,${g},50)`
  }
}

// ── SVG Scatter ──────────────────────────────────────────────────────────────
function ScatterPlot({ teams, xKey, yKey, xLabel, yLabel, leagueId, onTeam, quadrants }: {
  teams: any[], xKey: string, yKey: string, xLabel: string, yLabel: string,
  leagueId: string, onTeam: (t: any) => void,
  quadrants?: [string, string, string, string] // TL TR BL BR
}) {
  const W = 320, H = 220, PAD = { t: 16, r: 16, b: 36, l: 48 }
  const xs = teams.map(t => t[xKey] ?? 0)
  const ys = teams.map(t => t[yKey] ?? 0)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const xRange = xMax - xMin || 1, yRange = yMax - yMin || 1
  const px = (v: number) => PAD.l + ((v - xMin) / xRange) * (W - PAD.l - PAD.r)
  const py = (v: number) => H - PAD.b - ((v - yMin) / yRange) * (H - PAD.t - PAD.b)
  const xMid = (xMin + xMax) / 2, yMid = (yMin + yMax) / 2

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.75rem', flex: 1, minWidth: 280 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.5rem' }}>
        {xLabel} vs {yLabel}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        {/* quadrant lines */}
        <line x1={px(xMid)} y1={PAD.t} x2={px(xMid)} y2={H - PAD.b} stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={PAD.l} y1={py(yMid)} x2={W - PAD.r} y2={py(yMid)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray="4 3" />
        {/* quadrant labels */}
        {quadrants && <>
          <text x={PAD.l + 4} y={PAD.t + 12} fill="rgba(255,255,255,0.12)" fontSize={9} fontFamily="monospace">{quadrants[0]}</text>
          <text x={W - PAD.r - 4} y={PAD.t + 12} fill="rgba(255,255,255,0.12)" fontSize={9} fontFamily="monospace" textAnchor="end">{quadrants[1]}</text>
          <text x={PAD.l + 4} y={H - PAD.b - 6} fill="rgba(255,255,255,0.12)" fontSize={9} fontFamily="monospace">{quadrants[2]}</text>
          <text x={W - PAD.r - 4} y={H - PAD.b - 6} fill="rgba(255,255,255,0.12)" fontSize={9} fontFamily="monospace" textAnchor="end">{quadrants[3]}</text>
        </>}
        {/* axes labels */}
        <text x={W / 2} y={H - 2} fill="rgba(255,255,255,0.3)" fontSize={9} textAnchor="middle" fontFamily="monospace">{xLabel}</text>
        <text x={10} y={H / 2} fill="rgba(255,255,255,0.3)" fontSize={9} textAnchor="middle" fontFamily="monospace" transform={`rotate(-90, 10, ${H / 2})`}>{yLabel}</text>
        {/* dots */}
        {teams.map(t => {
          const cx = px(t[xKey] ?? 0), cy = py(t[yKey] ?? 0)
          const col = teamColor(t.name, leagueId)
          const isMe = t.name === MY_TEAM
          return (
            <g key={t.id} style={{ cursor: 'pointer' }} onClick={() => onTeam(t)}>
              <circle cx={cx} cy={cy} r={isMe ? 7 : 5} fill={col} fillOpacity={isMe ? 0.9 : 0.7} stroke={col} strokeWidth={isMe ? 2 : 1} />
              <text x={cx} y={cy - 9} fill={col} fontSize={8} textAnchor="middle" fontFamily="monospace" fontWeight={isMe ? 700 : 400}>
                {t.name.split(' ').pop()}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Bar chart (horizontal) ───────────────────────────────────────────────────
function HBar({ label, value, max, color, rank, total }: { label: string, value: number, max: number, color: string, rank?: number, total?: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const rc = rank != null && total ? rankColor(rank, total) : color
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {rank != null && <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.65rem', color: rc }}>#{rank}{total ? `/${total}` : ''}</span>}
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', color: rc }}>{fmt(value)}</span>
        </div>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: rc, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

// ── Bubble chart (count + value) ─────────────────────────────────────────────
function BubbleChart({ data, color }: { data: { label: string, count: number, val: number }[], color: string }) {
  const W = 400, H = 140
  const PAD = { t: 20, r: 12, b: 28, l: 28 }
  const active = data.filter(d => d.count > 0)
  if (active.length === 0) return <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>No data</div>
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const maxVal = Math.max(...data.map(d => d.val), 1)
  const n = data.length
  const colW = (W - PAD.l - PAD.r) / n
  const cx = (i: number) => PAD.l + colW * i + colW / 2
  const cy = (count: number) => PAD.t + (1 - count / maxCount) * (H - PAD.t - PAD.b)
  const maxR = Math.min(colW * 0.42, 22)
  const r = (val: number) => val <= 0 ? 0 : Math.max(4, Math.sqrt(val / maxVal) * maxR)
  const yTicks = [0, Math.round(maxCount / 2), maxCount]
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {yTicks.map(v => (
        <g key={v}>
          <line x1={PAD.l} y1={cy(v)} x2={W - PAD.r} y2={cy(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
          <text x={PAD.l - 4} y={cy(v) + 3} fill="rgba(255,255,255,0.25)" fontSize={8} textAnchor="end" fontFamily="monospace">{v}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const bcy = d.count > 0 ? cy(d.count) : H - PAD.b
        const br = r(d.val)
        return (
          <g key={d.label}>
            {d.count > 0 && (
              <>
                <circle cx={cx(i)} cy={bcy} r={br}
                  fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1.5} strokeOpacity={0.7} />
                <text x={cx(i)} y={bcy - 4} fill="white" fontSize={7} textAnchor="middle" fontFamily="monospace" fontWeight={700}>#: {d.count}</text>
                <text x={cx(i)} y={bcy + 6} fill="white" fontSize={7} textAnchor="middle" fontFamily="monospace">val: {Math.round(d.val)}</text>
              </>
            )}
            <text x={cx(i)} y={H - 4} fill="rgba(255,255,255,0.4)" fontSize={8} textAnchor="middle" fontFamily="monospace">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Sortable table ───────────────────────────────────────────────────────────
type SortKey = 'name' | 'total' | 'bat' | 'arm' | 'mlb' | 'milb' | 'avgAge'
function LeagueTable({ teams, leagueId, onTeam }: { teams: any[], leagueId: string, onTeam: (t: any) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [asc, setAsc] = useState(false)

  function toggle(k: SortKey) {
    if (sortKey === k) setAsc(a => !a)
    else { setSortKey(k); setAsc(false) }
  }

  const sorted = [...teams].sort((a, b) => {
    const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
    if (typeof av === 'string') return asc ? av.localeCompare(bv) : bv.localeCompare(av)
    return asc ? av - bv : bv - av
  })

  const cols: { key: SortKey, label: string }[] = [
    { key: 'name',   label: 'Team'  },
    { key: 'total',  label: 'Total' },
    { key: 'bat',    label: 'Bat'   },
    { key: 'arm',    label: 'Arm'   },
    { key: 'mlb',    label: 'MLB'   },
    { key: 'milb',   label: 'MiLB'  },
    { key: 'avgAge', label: 'Age'   },
  ]

  const thStyle = (k: SortKey): React.CSSProperties => ({
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    color: sortKey === k ? 'var(--accent)' : 'var(--muted)',
    padding: '0.4rem 0.6rem', cursor: 'pointer', whiteSpace: 'nowrap',
    textAlign: k === 'name' ? 'left' : 'right', userSelect: 'none',
  })

  return (
    <div style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {cols.map(c => (
              <th key={c.key} style={thStyle(c.key)} onClick={() => toggle(c.key)}>
                {c.label}{sortKey === c.key ? (asc ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => {
            const col = teamColor(t.name, leagueId)
            const isMe = t.name === MY_TEAM
            return (
              <tr key={t.id} onClick={() => onTeam(t)} style={{ borderBottom: '1px solid rgba(48,54,61,0.5)', cursor: 'pointer', background: isMe ? 'rgba(34,197,94,0.04)' : 'transparent' }}>
                <td style={{ padding: '0.5rem 0.6rem', fontWeight: 700, color: col, whiteSpace: 'nowrap' }}>{t.name}</td>
                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700 }}>{fmt(t.total)}</td>
                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontFamily: 'var(--font-display)', color: 'var(--muted)' }}>{fmt(t.bat)}</td>
                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontFamily: 'var(--font-display)', color: 'var(--muted)' }}>{fmt(t.arm)}</td>
                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontFamily: 'var(--font-display)', color: 'var(--muted)' }}>{fmt(t.mlb)}</td>
                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontFamily: 'var(--font-display)', color: 'var(--muted)' }}>{fmt(t.milb)}</td>
                <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontFamily: 'var(--font-display)', color: 'var(--muted)' }}>{t.avgAge ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Team view ────────────────────────────────────────────────────────────────
const LEVELS_ORDER = ['DSL','Complex','Rookie','A','A+','AA','AAA','MLB']
const AGE_BUCKETS = [
  { label: '≤21',  test: (a: number) => a <= 21 },
  { label: '22-24', test: (a: number) => a >= 22 && a <= 24 },
  { label: '25-27', test: (a: number) => a >= 25 && a <= 27 },
  { label: '28-30', test: (a: number) => a >= 28 && a <= 30 },
  { label: '31+',  test: (a: number) => a >= 31 },
]
const POS_ORDER = ['C','1B','2B','SS','3B','INF','LF','CF','RF','OF','UT','SP','RP','P']
const POS_ROLLUP: Record<string, string[]> = {
  '1B': ['INF'], '2B': ['INF'], 'SS': ['INF'], '3B': ['INF'],
  'LF': ['OF'],  'CF': ['OF'],  'RF': ['OF'],
  'SP': ['P'],   'RP': ['P'],
}

function TeamView({ team, allTeams, leagueId }: { team: any, allTeams: any[], leagueId: string }) {
  const [depthTab, setDepthTab] = useState<'position'|'age'|'level'>('position')
  const col = teamColor(team.name, leagueId)
  const n = allTeams.length

  // KPI tiles
  const kpis = [
    { label: 'Total',  val: fmt(team.total),  rank: team.ranks?.total },
    { label: 'Prospect', val: fmt(team.milb), rank: team.ranks?.milb },
    { label: 'MLB',    val: fmt(team.mlb),    rank: team.ranks?.mlb  },
    { label: 'Bat',    val: fmt(team.bat),    rank: team.ranks?.bat  },
    { label: 'Arm',    val: fmt(team.arm),    rank: team.ranks?.arm  },
  ]

  // age curve
  const ageCurve = AGE_BUCKETS.map(b => {
    const players = team.roster.filter((p: any) => p.age != null && b.test(p.age))
    return { label: b.label, count: players.length, val: players.reduce((s: number, p: any) => s + p.val, 0) }
  })

  // depth: by position
  const posMax = Math.max(...POS_ORDER.map(pos => {
    const players = team.roster.filter((p: any) => p.position === pos)
    return players.reduce((s: number, p: any) => s + p.val, 0)
  }), 1)
  const leagueMaxByPos: Record<string, number> = {}
  for (const pos of POS_ORDER) {
    leagueMaxByPos[pos] = Math.max(...allTeams.map(t =>
      playersForPos(t.roster, pos).reduce((s: number, p: any) => s + p.val, 0)
    ), 1)
  }
  function playersForPos(roster: any[], pos: string) {
    const rollupSources = Object.entries(POS_ROLLUP).filter(([, groups]) => groups.includes(pos)).map(([k]) => k)
    if (rollupSources.length > 0) {
      // rollup bucket — include anyone whose position is one of the sources
      return roster.filter((p: any) => {
        const positions = Array.isArray(p.positions) ? p.positions : [p.position]
        return positions.some((pp: string) => rollupSources.includes(pp))
      })
    }
    // specific position — match any of the player's positions
    return roster.filter((p: any) => {
      const positions = Array.isArray(p.positions) ? p.positions : [p.position]
      return positions.includes(pos)
    })
  }
  const posGroups = POS_ORDER.map(pos => {
    const players = playersForPos(team.roster, pos)
    const val = players.reduce((s: number, p: any) => s + p.val, 0)
    const leagueRank = [...allTeams]
      .map(t => playersForPos(t.roster, pos).reduce((s: number, p: any) => s + p.val, 0))
      .sort((a, b) => b - a)
      .indexOf(val) + 1
    return { pos, val, leagueRank, players }
  }).filter(g => g.val > 0)

  // depth: by age
  const ageBars = AGE_BUCKETS.map(b => {
    const players = team.roster.filter((p: any) => p.age != null && b.test(p.age))
    return { label: b.label, count: players.length, val: players.reduce((s: number, p: any) => s + p.val, 0) }
  })

  // depth: by level
  const levelBars = LEVELS_ORDER.map(lv => {
    const players = team.roster.filter((p: any) => {
      const lv2 = (p.level ?? '').replace('High-A','A+').replace('Single-A','A').replace('Low-A','A').replace('A (Low)','A').replace('A (High)','A+')
      return lv2 === lv
    })
    return { label: lv, count: players.length, val: players.reduce((s: number, p: any) => s + p.val, 0) }
  }).filter(l => l.count > 0)

  return (
    <div>
      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        {kpis.map(k => (
          <div key={k.label} style={{ flex: 1, minWidth: 100, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.3rem', color: k.rank != null ? rankColor(k.rank, n) : col }}>{k.val}</div>
            {k.rank != null && <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.7rem', color: rankColor(k.rank, n), marginTop: 2 }}>#{k.rank} of {n}</div>}
          </div>
        ))}
      </div>

      {/* Depth charts */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: '1rem' }}>
          {(['position','age','level'] as const).map(tab => (
            <button key={tab} onClick={() => setDepthTab(tab)} style={{ padding: '0.35rem 0.75rem', borderRadius: 6, border: '1px solid', borderColor: depthTab === tab ? col : 'var(--border)', background: depthTab === tab ? `${col}18` : 'transparent', color: depthTab === tab ? col : 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}>
              {tab}
            </button>
          ))}
        </div>

        {depthTab === 'position' && (
          <div>
            {posGroups.map(g => (
              <HBar key={g.pos} label={g.pos} value={g.val} max={leagueMaxByPos[g.pos]} color={col} rank={g.leagueRank} total={n} />
            ))}
          </div>
        )}

        {depthTab === 'age' && (
          <BubbleChart data={ageBars} color={col} />
        )}

        {depthTab === 'level' && (
          <BubbleChart data={levelBars} color={col} />
        )}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function LeaguePage() {
  const params = useParams()
  const router = useRouter()
  const leagueId = (params.id as string) ?? LEAGUE_IDS[0]

  const [selectedLeague, setSelectedLeague] = useState(leagueId)
  const [teams, setTeams] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTeam, setSelectedTeam] = useState<any>(null)
  const [leagues, setLeagues] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/leagues').then(r => r.json()).then(d => setLeagues(d.leagues ?? []))
  }, [])

  useEffect(() => {
    setLoading(true)
    setSelectedTeam(null)
    fetch(`/api/leagues/${selectedLeague}/analysis`)
      .then(r => r.json())
      .then(d => { setTeams(d.teams ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedLeague])

  const myTeam = teams.find(t => t.name === MY_TEAM)

  return (
    <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
        {selectedTeam && (
          <button onClick={() => setSelectedTeam(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.06em', textTransform: 'uppercase', padding: 0 }}>
            <ArrowLeft size={14} /> League
          </button>
        )}
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '0.04em', textTransform: 'uppercase', margin: 0, color: selectedTeam ? teamColor(selectedTeam.name, selectedLeague) : 'var(--text)' }}>
          {selectedTeam ? selectedTeam.name : 'League'}
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {leagues.map(l => (
            <button key={l.id} onClick={() => setSelectedLeague(l.id)} style={{ padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid', borderColor: selectedLeague === l.id ? 'var(--accent)' : 'var(--border)', background: selectedLeague === l.id ? 'rgba(34,197,94,0.1)' : 'transparent', color: selectedLeague === l.id ? 'var(--accent)' : 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.04em', cursor: 'pointer' }}>
              {LEAGUE_LABELS[l.id] ?? l.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Loading...</div>
      ) : selectedTeam ? (
        <TeamView team={selectedTeam} allTeams={teams} leagueId={selectedLeague} />
      ) : (
        <>
          {/* Scatter plots */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <ScatterPlot
              teams={teams} xKey="total" yKey="avgAge" xLabel="Value" yLabel="Avg Age"
              leagueId={selectedLeague} onTeam={setSelectedTeam}
              quadrants={['Old/Cheap','Old/Rich','Young/Cheap','Young/Rich']}
            />
            <ScatterPlot
              teams={teams} xKey="bat" yKey="arm" xLabel="Bat" yLabel="Arm"
              leagueId={selectedLeague} onTeam={setSelectedTeam}
              quadrants={['Pitching','Two-Way','Thin','Hitting']}
            />
            <ScatterPlot
              teams={teams} xKey="milb" yKey="mlb" xLabel="MiLB" yLabel="MLB"
              leagueId={selectedLeague} onTeam={setSelectedTeam}
              quadrants={['Win-Now','Two-Way','Thin','Rebuilding']}
            />
          </div>

          {/* League table */}
          <LeagueTable teams={teams} leagueId={selectedLeague} onTeam={setSelectedTeam} />
        </>
      )}
    </div>
  )
}
