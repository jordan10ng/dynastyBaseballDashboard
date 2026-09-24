// Sums /api/stats-shaped stat objects (one per level) into a single line and
// recomputes rate stats from the summed counts. Shared by the stats route
// (MiLB season totals) and the players page (level-filtered totals).

const COUNT_KEYS = [
  'gamesPlayed', 'atBats', 'plateAppearances', 'hits', 'doubles', 'triples', 'homeRuns',
  'rbi', 'runs', 'stolenBases', 'caughtStealing', 'baseOnBalls', 'strikeOuts', 'hitByPitch',
  'totalBases', 'intentionalWalks', 'airOuts', 'groundOuts', 'gamesStarted', 'wins', 'losses',
  'saves', 'holds', 'blownSaves', 'earnedRuns', 'battersFaced',
]

// Page's level-filter labels (matches normalizeLevel in app/players/page.tsx)
export function normLevel(l: string | undefined): string {
  if (!l) return ''
  if (l === 'High-A') return 'A+'
  if (l === 'Single-A') return 'A'
  if (l === 'Rookie' || l === 'ROK' || l === 'Complex' || l === 'DSL' || l === 'ACL' || l === 'FCL') return 'ROK'
  return l
}

export const LEVEL_RANK = ['MLB', 'AAA', 'AA', 'A+', 'A', 'ROK']

const fmt3 = (n: number) => n.toFixed(3).replace(/^0\./, '.')

const ipToOuts = (ip: string | number | undefined) => {
  if (ip == null || ip === '') return 0
  const [whole, frac] = String(ip).split('.')
  return parseInt(whole) * 3 + parseInt(frac ?? '0')
}

// Opponent OBP from counts — no sac flies stored, so reads a hair high
export function calcOObp(s: any): string | null {
  const den = (s.atBats ?? 0) + (s.baseOnBalls ?? 0) + (s.hitByPitch ?? 0)
  return den ? fmt3(((s.hits ?? 0) + (s.baseOnBalls ?? 0) + (s.hitByPitch ?? 0)) / den) : null
}

export function sumStatObjs(objs: any[]): any {
  if (objs.length === 0) return null
  if (objs.length === 1) return objs[0]

  // Identity fields (_level, group, mlbam_id…) come from the first — callers pass highest level first
  const out: any = { ...objs[0] }
  for (const k of COUNT_KEYS) {
    const vals = objs.map(o => o[k]).filter(v => typeof v === 'number')
    out[k] = vals.length ? vals.reduce((a, b) => a + b, 0) : undefined
  }

  if (out.group === 'pitching') {
    const outs = objs.reduce((a, o) => a + ipToOuts(o.inningsPitched), 0)
    out.inningsPitched = `${Math.floor(outs / 3)}.${outs % 3}`
    out.era  = outs ? (out.earnedRuns * 27 / outs).toFixed(2) : null
    out.whip = outs ? ((out.hits + out.baseOnBalls) / (outs / 3)).toFixed(2) : null
    out.oAvg = out.atBats ? fmt3(out.hits / out.atBats) : null
    out.oObp = calcOObp(out)
    out.oSlg = null
  } else {
    out.avg = out.atBats ? fmt3(out.hits / out.atBats) : null
    out.obp = out.plateAppearances ? fmt3((out.hits + out.baseOnBalls + out.hitByPitch) / out.plateAppearances) : null
    out.slg = out.atBats ? fmt3(out.totalBases / out.atBats) : null
    out.ops = out.obp && out.slg ? fmt3(parseFloat('0' + out.obp) + parseFloat('0' + out.slg)) : null
  }
  out._synced = objs.map(o => o._synced).filter(Boolean).sort().pop() ?? out._synced
  return out
}
