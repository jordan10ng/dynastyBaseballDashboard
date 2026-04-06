const ARM_POSITIONS = ['SP','RP','P']

export const LEAGUES: { id: string; label: string }[] = [
  { id: '0ehfuam0mg7wqpn7', label: 'D28' },
  { id: 'ew7b8seomg7u7uzi', label: 'D34' },
  { id: 'd3prsagvmgftfdc3', label: 'D52' },
]

export const MY_TEAM = 'Winston Salem Dash'

export const isPitcher = (positions: string) =>
  ARM_POSITIONS.includes(positions?.split(',')[0]?.trim())

export const cleanPositions = (posString: string) => {
  if (!posString) return '—'
  const list = posString.split(',').map(p => p.trim())
  if (list.length === 1) return list[0]
  const filtered = list.filter(p => p !== 'INF' && p !== 'OF')
  return filtered.length > 0 ? filtered.join(', ') : list.join(', ')
}

export const toolColor = (val: any) => {
  if (val == null) return 'var(--muted)'
  if (val >= 130) return '#ef4444'
  if (val >= 115) return '#fca5a5'
  if (val >= 95)  return 'var(--text)'
  if (val >= 80)  return '#93c5fd'
  return '#3b82f6'
}
