'use client'
import { memo } from 'react'

const MY_TEAM = 'Winston Salem Dash'
const ARM_POSITIONS = ['SP','RP','P']

const LEAGUES: { id: string; label: string }[] = [
  { id: '0ehfuam0mg7wqpn7', label: 'D28' },
  { id: 'ew7b8seomg7u7uzi', label: 'D34' },
  { id: 'd3prsagvmgftfdc3', label: 'D52' },
]

function isPitcher(positions: string) {
  return ARM_POSITIONS.includes(positions?.split(',')[0]?.trim())
}

function cleanPositions(posString: string) {
  if (!posString) return '—'
  const list = posString.split(',').map(p => p.trim())
  if (list.length === 1) return list[0]
  const filtered = list.filter(p => p !== 'INF' && p !== 'OF')
  return filtered.length > 0 ? filtered.join(', ') : list.join(', ')
}

function toolColor(val: any) {
  if (val == null) return 'var(--muted)'
  if (val >= 130) return '#ef4444'
  if (val >= 115) return '#fca5a5'
  if (val >= 95)  return 'var(--text)'
  if (val >= 80)  return '#93c5fd'
  return '#3b82f6'
}

export type StatCol = {
  key: string
  label: string
  lowerBetter?: boolean
  getValue: (s: any) => number | null
  fmt: (s: any) => string
}

type PlayerRowProps = {
  displayRank: number
  player: any
  stats: any
  statLine: string
  tools: any
  isMinors: boolean
  owner: { teamName: string; teamId: string } | undefined
  pOwnership: Record<string, string>
  cols: string
  showExtraCol: boolean
  showOwnership: boolean
  showStatCols: boolean
  showToolCols: boolean
  activeCols: StatCol[]
  activeToolKeys: string[]
  statSortKey: string
  toolSortKey: string
  batArmsFilter: string
  TOOL_LABELS: Record<string, string>
  onClick: () => void
}

export const PlayerRow = memo(function PlayerRow({
  displayRank,
  player,
  stats,
  statLine,
  tools,
  isMinors,
  owner,
  pOwnership,
  cols,
  showExtraCol,
  showOwnership,
  showStatCols,
  showToolCols,
  activeCols,
  activeToolKeys,
  statSortKey,
  toolSortKey,
  batArmsFilter,
  TOOL_LABELS,
  onClick,
}: PlayerRowProps) {
  const pitch = isPitcher(player.positions)

  return (
    <div onClick={onClick} style={{
      display: 'grid', gridTemplateColumns: cols, gap: '0.5rem',
      padding: '0.38rem 0.5rem', borderBottom: '1px solid rgba(48,54,61,0.4)',
      alignItems: 'center', background: 'transparent',
      borderLeft: '2px solid transparent', marginLeft: '-0.5rem',
      minWidth: showExtraCol ? 'max-content' : undefined,
      cursor: 'pointer',
    }}>
      {/* Display rank # */}
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.65rem', color: 'rgba(100,100,100,0.5)', position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 2 }}>
        {displayRank}
      </div>

      {/* Consensus rank */}
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', color: 'var(--muted)', position: 'sticky', left: '28px', background: 'var(--bg)', zIndex: 2 }}>
        {player.rank ?? '—'}
      </div>

      {/* Position */}
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', position: 'sticky', left: '72px', background: 'var(--bg)', zIndex: 2 }}>
        {cleanPositions(player.positions)}
      </div>

      {/* Player name + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, overflow: 'hidden', position: 'sticky', left: '162px', background: 'var(--bg)', zIndex: 2 }}>
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'nowrap' }}>
            <span style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.name}</span>
            {isMinors && <span style={{ color: '#4ade80', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.7rem', flexShrink: 0 }}>M</span>}
            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              {LEAGUES.map(league => {
                const teamName = pOwnership[league.id]
                const circleColor = teamName ? (teamName === MY_TEAM ? '#22c55e' : '#eab308') : '#ef4444'
                return (
                  <div key={league.id} title={`${league.label}: ${teamName || 'FA'}`}
                    style={{ width: '6px', height: '6px', borderRadius: '50%', background: circleColor, opacity: 0.9 }} />
                )
              })}
            </div>
          </div>
          {!showExtraCol && statLine && (
            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', opacity: 0.7, marginTop: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {statLine}
            </div>
          )}
        </div>
      </div>

      {/* Team */}
      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {player.team}
      </div>

      {/* Age */}
      <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
        {player.age ?? '—'}
      </div>

      {/* Level (only when stat/tool cols visible) */}
      {showExtraCol && (
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
          {stats?._level ?? '—'}
        </div>
      )}

      {/* Ownership column */}
      {showOwnership && (
        <div style={{ fontSize: '0.75rem', color: owner ? (owner.teamName === MY_TEAM ? '#f59e0b' : 'var(--muted)') : 'rgba(100,100,100,0.4)', fontWeight: owner?.teamName === MY_TEAM ? 700 : 400 }}>
          {owner?.teamName ?? 'FA'}
        </div>
      )}

      {/* Stat columns */}
      {showStatCols && activeCols.map(col => {
        const val = col.fmt(stats)
        const isSorted = statSortKey === col.key
        return (
          <div key={col.key} style={{
            fontSize: '0.75rem', fontFamily: 'var(--font-display)',
            color: isSorted ? 'var(--accent)' : val === '—' ? 'rgba(100,100,100,0.35)' : 'var(--muted)',
            fontWeight: isSorted ? 700 : 500, textAlign: 'right',
          }}>
            {val}
          </div>
        )
      })}

      {/* OVR+ cell in All/Stats mode */}
      {batArmsFilter === 'all' && !showToolCols && (() => {
        const val = tools?.overall ?? null
        const isSorted = toolSortKey === 'overall'
        return (
          <div style={{
            fontSize: '0.75rem', fontFamily: 'var(--font-display)', fontWeight: 700,
            color: isSorted ? 'var(--accent)' : toolColor(val), textAlign: 'right' as const,
          }}>
            {val ?? '—'}
          </div>
        )
      })()}

      {/* Tool columns */}
      {showToolCols && activeToolKeys.map(key => {
        if (pitch && ['hit','power','speed'].includes(key)) return <div key={key} style={{ fontSize: '0.75rem', color: 'rgba(100,100,100,0.35)', textAlign: 'right' as const }}>—</div>
        if (!pitch && ['stuff','control'].includes(key)) return <div key={key} style={{ fontSize: '0.75rem', color: 'rgba(100,100,100,0.35)', textAlign: 'right' as const }}>—</div>
        const val = tools?.[key] ?? null
        const isSorted = toolSortKey === key
        return (
          <div key={key} style={{
            fontSize: '0.75rem', fontFamily: 'var(--font-display)', fontWeight: 700,
            color: toolColor(val), textAlign: 'right' as const,
            opacity: isSorted ? 1 : 0.85,
          }}>
            {val ?? '—'}
          </div>
        )
      })}
    </div>
  )
}, (prev, next) => {
  // Only re-render if data that affects this specific row changed
  return (
    prev.displayRank === next.displayRank &&
    prev.batArmsFilter === next.batArmsFilter &&
    prev.player === next.player &&
    prev.stats === next.stats &&
    prev.tools === next.tools &&
    prev.isMinors === next.isMinors &&
    prev.owner === next.owner &&
    prev.pOwnership === next.pOwnership &&
    prev.cols === next.cols &&
    prev.showExtraCol === next.showExtraCol &&
    prev.showOwnership === next.showOwnership &&
    prev.showStatCols === next.showStatCols &&
    prev.showToolCols === next.showToolCols &&
    prev.activeCols === next.activeCols &&
    prev.activeToolKeys === next.activeToolKeys &&
    prev.statSortKey === next.statSortKey &&
    prev.toolSortKey === next.toolSortKey
  )
})
