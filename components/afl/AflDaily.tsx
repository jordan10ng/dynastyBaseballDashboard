'use client'
// AFL fantasy daily views — "last night" cards, season race chart, collapsible daily log.
// Data comes from /api/afl `days`: [{ date, teams: { [name]: { total, delta, rank, rankChange } }, players: [...] }]
import { useState, useEffect, useRef, useMemo } from 'react'

type Move = { name: string; pos: string }
type Day = { date: string; teams: Record<string, { total: number; delta: number; rank: number; rankChange: number; movedIn?: Move[]; movedOut?: Move[] }>; players: any[] }

const ink = { text: 'var(--text)', muted: 'var(--muted)', border: 'var(--border)' }
const display = { fontFamily: 'var(--font-display)', fontWeight: 700 as const }
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }
const sectionTitle = { ...display, fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: ink.muted }

const fmtSigned = (n: number) => (n > 0 ? `+${n}` : String(n))
const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th')
// Game dates are calendar dates; parse at noon so no timezone shifts the day
const parseDay = (d: string) => new Date(`${d}T12:00:00`)
const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => parseDay(d).toLocaleDateString('en-US', opts)

function RankMove({ n }: { n: number }) {
  if (!n) return null
  return <span style={{ color: ink.muted, fontSize: '0.7rem', marginLeft: 4 }}>{n > 0 ? '▲' : '▼'}{Math.abs(n)}</span>
}

// ── Last night ────────────────────────────────────────────────────────────────
export function LastNight({ day, color, isFinal, onPlayer }: { day: Day; color: (t: string) => string; isFinal: boolean; onPlayer: (pid: string) => void }) {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = parseDay(day.date).toDateString() === yesterday.toDateString()
  const label = isFinal ? 'Final day' : isYesterday ? 'Last night' : 'Latest games'
  const order = Object.entries(day.teams).sort((a, b) => b[1].delta - a[1].delta || a[1].rank - b[1].rank)
  const star = day.players[0]

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <div style={sectionTitle}>{label} · {fmtDay(day.date)}</div>
        {star && star.pts > 0 && (
          <div style={{ fontSize: '0.75rem', color: ink.muted }}>
            ⭐ <span
              onClick={star.pid ? () => onPlayer(star.pid) : undefined}
              style={{ color: ink.text, fontWeight: 700, cursor: star.pid ? 'pointer' : 'default' }}
            >{star.name}</span> {star.pts} pts · <span style={{ color: color(star.team), fontWeight: 700 }}>{star.team}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {order.map(([name, t]) => {
          const best = day.players.find(p => p.team === name)
          return (
            <div key={name} style={{ ...card, padding: '0.6rem 0.7rem', borderLeft: `3px solid ${color(name)}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ ...display, fontSize: '0.95rem', color: color(name) }}>{name}</span>
                <span style={{ fontSize: '0.7rem', color: ink.muted }}>{ordinal(t.rank)}<RankMove n={t.rankChange} /></span>
              </div>
              <div style={{ ...display, fontWeight: 800, fontSize: '1.5rem', color: ink.text, lineHeight: 1.15 }}>{fmtSigned(t.delta)}</div>
              <div style={{ fontSize: '0.7rem', color: ink.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {best ? <>{best.name} {best.pts}{!best.counted && ' (BN)'}</> : 'No games'}
              </div>
              {/* Best-ball lineup changes caused by this day's games */}
              {(t.movedIn?.length || t.movedOut?.length) ? (
                <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${ink.border}`, fontSize: '0.68rem', lineHeight: 1.5 }}>
                  {t.movedIn?.map(m => <div key={'in' + m.name} style={{ color: ink.text }}>▲ {m.name} <span style={{ color: ink.muted }}>{m.pos} in</span></div>)}
                  {t.movedOut?.map(m => <div key={'out' + m.name} style={{ color: ink.muted }}>▼ {m.name} {m.pos} out</div>)}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Season race chart ─────────────────────────────────────────────────────────
export function SeasonChart({ days, teamOrder, color, isMobile }: { days: Day[]; teamOrder: string[]; color: (t: string) => string; isMobile: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<string | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Leading "Start" point at 0 so even a single game day draws a line
  const points = useMemo(() => [{ date: '', teams: Object.fromEntries(teamOrder.map(t => [t, { total: 0, delta: 0 }])) } as any, ...days], [days, teamOrder])
  const height = isMobile ? 220 : 280
  const m = { top: 12, right: isMobile ? 74 : 80, bottom: 24, left: 36 }
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom
  const maxY = Math.max(10, ...days.flatMap(d => Object.values(d.teams).map(t => t.total)))
  const minY = Math.min(0, ...days.flatMap(d => Object.values(d.teams).map(t => t.total)))
  const step = [5, 10, 25, 50, 100, 200, 250, 500].find(s => (maxY - minY) / s <= 5) ?? 1000
  const yTop = Math.ceil(maxY / step) * step, yBot = Math.floor(minY / step) * step
  const x = (i: number) => m.left + (points.length === 1 ? iw : (i / (points.length - 1)) * iw)
  const y = (v: number) => m.top + ih - ((v - yBot) / (yTop - yBot || 1)) * ih
  const ticks: number[] = []
  for (let v = yBot; v <= yTop; v += step) ticks.push(v)

  // Direct end labels, nudged apart so they never collide
  const last = points[points.length - 1]
  const ends = teamOrder.map(t => ({ t, y: y(last.teams[t]?.total ?? 0) })).sort((a, b) => a.y - b.y)
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13
  const overflow = ends.length ? ends[ends.length - 1].y - (m.top + ih + 4) : 0
  if (overflow > 0) ends.forEach(e => { e.y -= overflow })

  // X labels: first, last, and evenly spaced in between
  const maxLabels = isMobile ? 4 : 7
  const every = Math.max(1, Math.ceil((points.length - 1) / (maxLabels - 1)))
  const xLabels = points.map((p, i) => i).filter(i => i > 0 && ((i - 1) % every === 0 || i === points.length - 1))

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const px = e.clientX - r.left
    const i = points.length === 1 ? 0 : Math.round((px / r.width) * (points.length - 1))
    setHover(Math.max(1, Math.min(points.length - 1, i)))
  }

  const hp = hover != null ? points[hover] : null
  const tipLeft = hover != null ? x(hover) : 0
  const tipOnLeft = tipLeft > width * 0.6

  return (
    <div style={{ ...card, padding: '0.75rem 0.75rem 0.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        <div style={sectionTitle}>Season points by day</div>
        {/* Legend doubles as highlight toggle — identity is never color-alone */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {teamOrder.map(t => (
            <button key={t} onClick={() => setFocus(f => (f === t ? null : t))} style={{
              display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
              opacity: focus && focus !== t ? 0.4 : 1, color: ink.text, fontSize: '0.72rem', fontWeight: focus === t ? 700 : 500,
            }}>
              <span style={{ width: 14, height: 2, background: color(t), borderRadius: 1 }} />{t}
            </button>
          ))}
        </div>
      </div>
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <svg width={width} height={height} style={{ display: 'block', touchAction: 'pan-y' }} role="img" aria-label="Season points by day for each team">
          {ticks.map(v => (
            <g key={v}>
              <line x1={m.left} x2={m.left + iw} y1={y(v)} y2={y(v)} stroke={ink.border} strokeWidth={1} strokeDasharray={v === 0 ? undefined : '2 3'} />
              <text x={m.left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} fill={ink.muted}>{v}</text>
            </g>
          ))}
          {xLabels.map(i => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === points.length - 1 ? 'end' : 'middle'} fontSize={10} fill={ink.muted}>
              {fmtDay(points[i].date, { month: 'numeric', day: 'numeric' })}
            </text>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={m.top + ih} stroke={ink.muted} strokeWidth={1} />}
          {teamOrder.map(t => {
            const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.teams[t]?.total ?? 0)}`).join('')
            const dim = focus && focus !== t
            return (
              <g key={t} opacity={dim ? 0.2 : 1}>
                <path d={d} fill="none" stroke={color(t)} strokeWidth={focus === t ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(points.length - 1)} cy={y(last.teams[t]?.total ?? 0)} r={4} fill={color(t)} stroke="var(--bg-card)" strokeWidth={2} />
                {hover != null && <circle cx={x(hover)} cy={y(points[hover].teams[t]?.total ?? 0)} r={4} fill={color(t)} stroke="var(--bg-card)" strokeWidth={2} />}
              </g>
            )
          })}
          {ends.map(e => (
            <text key={e.t} x={m.left + iw + 8} y={e.y} dy="0.32em" fontSize={11} fontWeight={600} fill={ink.text} opacity={focus && focus !== e.t ? 0.3 : 1}>
              {e.t} {last.teams[e.t]?.total ?? 0}
            </text>
          ))}
          <rect x={m.left} y={m.top} width={iw} height={ih} fill="transparent"
            onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null) }} />
        </svg>
        {hp && (
          <div style={{
            position: 'absolute', top: m.top, pointerEvents: 'none', zIndex: 2,
            ...(tipOnLeft ? { right: width - tipLeft + 10 } : { left: tipLeft + 10 }),
            background: 'var(--bg)', border: `1px solid ${ink.border}`, borderRadius: 6, padding: '6px 8px', minWidth: 120,
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}>
            <div style={{ fontSize: '0.68rem', color: ink.muted, marginBottom: 4 }}>{fmtDay(hp.date)}</div>
            {Object.entries(hp.teams as Day['teams']).sort((a, b) => b[1].total - a[1].total).map(([t, v]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', lineHeight: 1.5 }}>
                <span style={{ width: 10, height: 2, background: color(t) }} />
                <span style={{ color: ink.text, fontWeight: 700, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.total}</span>
                <span style={{ color: ink.muted }}>{t}</span>
                <span style={{ color: ink.muted, marginLeft: 'auto', paddingLeft: 8, fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(v.delta)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Daily log (collapsed by default; doubles as the chart's table view) ──────
export function DailyLog({ days, teamOrder, color, isMobile, onPlayer }: { days: Day[]; teamOrder: string[]; color: (t: string) => string; isMobile: boolean; onPlayer: (pid: string) => void }) {
  const [open, setOpen] = useState(false)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const rows = [...days].reverse()
  const detail = days.find(d => d.date === openDay)
  const dateW = isMobile ? 64 : 96, colW = isMobile ? 52 : 70
  const th = { ...display, fontSize: '0.68rem', letterSpacing: '0.04em', color: ink.muted, padding: '0.45rem 0.4rem', textAlign: 'right' as const, borderBottom: `1px solid ${ink.border}`, background: 'var(--bg-card)', whiteSpace: 'nowrap' as const }
  const td = { padding: '0.45rem 0.4rem', fontSize: '0.8rem', textAlign: 'right' as const, borderBottom: `1px solid ${ink.border}`, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const }
  const sticky = { position: 'sticky' as const, left: 0, zIndex: 1, background: 'var(--bg-card)', textAlign: 'left' as const, width: dateW, minWidth: dateW, borderRight: `1px solid ${ink.border}` }

  return (
    <div style={{ ...card, marginBottom: '1.5rem', overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none',
        padding: '0.7rem 0.75rem', cursor: 'pointer', color: ink.muted,
      }}>
        <span style={sectionTitle}>Daily log · {days.length} {days.length === 1 ? 'day' : 'days'}</span>
        <span style={{ fontSize: '0.8rem' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderTop: `1px solid ${ink.border}` }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: dateW + teamOrder.length * colW }}>
            <thead>
              <tr>
                <th style={{ ...th, ...sticky }}>Day</th>
                {teamOrder.map(t => <th key={t} style={{ ...th, color: color(t) }}>{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(d => {
                const best = Math.max(...Object.values(d.teams).map(t => t.delta))
                const expanded = openDay === d.date
                return (
                  <tr key={d.date} onClick={() => setOpenDay(expanded ? null : d.date)} style={{ cursor: 'pointer', background: expanded ? 'var(--bg-hover)' : undefined }}>
                    <td style={{ ...td, ...sticky, background: expanded ? 'var(--bg-hover)' : 'var(--bg-card)', color: ink.muted, fontSize: '0.75rem' }}>
                      {expanded ? '▾ ' : '▸ '}{fmtDay(d.date, isMobile ? { month: 'numeric', day: 'numeric' } : { weekday: 'short', month: 'numeric', day: 'numeric' })}
                    </td>
                    {teamOrder.map(t => {
                      const v = d.teams[t]
                      const top = v && v.delta === best && best > 0
                      return (
                        <td key={t} style={{ ...td, color: top ? ink.text : ink.muted, fontWeight: top ? 800 : 400 }}>
                          {v ? fmtSigned(v.delta) : '—'}
                          {top && <div style={{ height: 2, background: color(t), borderRadius: 1, marginTop: 2, marginLeft: 'auto', width: 18 }} />}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && detail && (
        <div style={{ padding: '0.6rem 0.75rem', borderTop: `1px solid ${ink.border}`, background: 'var(--bg)' }}>
          <div style={{ ...sectionTitle, fontSize: '0.72rem', marginBottom: 6 }}>{fmtDay(detail.date)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem 1rem' }}>
            {teamOrder.map(t => {
              const ps = detail.players.filter(p => p.team === t)
              return (
                <div key={t}>
                  <div style={{ ...display, fontSize: '0.8rem', color: color(t), marginBottom: 2 }}>
                    {t} <span style={{ color: ink.muted, fontWeight: 400 }}>{fmtSigned(detail.teams[t]?.delta ?? 0)} · total {detail.teams[t]?.total ?? 0}</span>
                  </div>
                  {ps.length === 0 && <div style={{ fontSize: '0.72rem', color: ink.muted }}>No games</div>}
                  {ps.map(p => (
                    <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', lineHeight: 1.6, opacity: p.counted ? 1 : 0.45 }}>
                      <span>
                        <span onClick={p.pid ? () => onPlayer(p.pid) : undefined} style={{ color: ink.text, cursor: p.pid ? 'pointer' : 'default' }}>{p.name}</span>
                        <span style={{ color: ink.muted, fontSize: '0.65rem', marginLeft: 5 }}>{p.pos}{!p.counted && ' · BN'}</span>
                      </span>
                      <span style={{ color: ink.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.pts}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: '0.68rem', color: ink.muted, marginTop: 8 }}>
            Team number = change in best-ball total. Lineup swaps can make it differ from the sum of player points; dimmed (BN) players aren't in the optimal lineup.
          </div>
        </div>
      )}
    </div>
  )
}
