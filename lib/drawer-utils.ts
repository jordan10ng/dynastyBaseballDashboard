export function sportAbbrToLevel(abbr: string, sportId?: number): string {
  if (sportId === 1 || abbr === 'MLB') return 'MLB'
  if (abbr === 'AAA') return 'AAA'
  if (abbr === 'AA') return 'AA'
  if (abbr === 'A+' || abbr === 'HiA') return 'A+'
  if (abbr === 'A' || abbr === 'LoA') return 'A'
  if (abbr === 'A(Short)') return 'A'
  if (abbr === 'ROK' || abbr === 'Rk') return 'ROK'
  return 'Other'
}

export function isMlbLevel(level: string) { return level === 'MLB' }

export const LEVEL_ORDER = ['ROK','A','A+','AA','AAA','MLB','Other']
export function levelSortVal(level: string) {
  const i = LEVEL_ORDER.indexOf(level)
  return i >= 0 ? i : 99
}

export function sumBatStats(rows: any[]): any {
  const t = { gamesPlayed:0, atBats:0, plateAppearances:0, hits:0, doubles:0, triples:0,
    homeRuns:0, rbi:0, runs:0, stolenBases:0, caughtStealing:0, baseOnBalls:0,
    strikeOuts:0, hitByPitch:0, totalBases:0 }
  for (const r of rows) {
    const s = r.stat ?? r
    t.gamesPlayed += s.gamesPlayed ?? 0
    t.atBats += s.atBats ?? 0
    t.plateAppearances += s.plateAppearances ?? 0
    t.hits += s.hits ?? 0
    t.doubles += s.doubles ?? 0
    t.triples += s.triples ?? 0
    t.homeRuns += s.homeRuns ?? 0
    t.rbi += s.rbi ?? 0
    t.runs += s.runs ?? 0
    t.stolenBases += s.stolenBases ?? 0
    t.caughtStealing += s.caughtStealing ?? 0
    t.baseOnBalls += s.baseOnBalls ?? 0
    t.strikeOuts += s.strikeOuts ?? 0
    t.hitByPitch += s.hitByPitch ?? 0
    t.totalBases += s.totalBases ?? 0
  }
  const avgV = t.atBats ? (t.hits / t.atBats).toFixed(3) : null
  const obp = t.plateAppearances ? ((t.hits + t.baseOnBalls + t.hitByPitch) / t.plateAppearances).toFixed(3) : null
  const slg = t.atBats ? (t.totalBases / t.atBats).toFixed(3) : null
  const ops = obp && slg ? (parseFloat(obp) + parseFloat(slg)).toFixed(3) : null
  return { ...t, avg: avgV, obp, slg, ops }
}

export function sumPitchStats(rows: any[]): any {
  const t = { gamesPlayed:0, gamesStarted:0, wins:0, losses:0, saves:0,
    earnedRuns:0, atBats:0, baseOnBalls:0, strikeOuts:0, hitByPitch:0,
    hits:0, battersFaced:0 }
  let totalOuts = 0
  for (const r of rows) {
    const s = r.stat ?? r
    t.gamesPlayed += s.gamesPlayed ?? 0
    t.gamesStarted += s.gamesStarted ?? 0
    t.wins += s.wins ?? 0
    t.losses += s.losses ?? 0
    t.saves += s.saves ?? 0
    t.earnedRuns += s.earnedRuns ?? 0
    t.atBats += s.atBats ?? 0
    t.baseOnBalls += s.baseOnBalls ?? 0
    t.strikeOuts += s.strikeOuts ?? 0
    t.hitByPitch += s.hitByPitch ?? 0
    t.hits += s.hits ?? 0
    t.battersFaced += s.battersFaced ?? 0
    if (s.inningsPitched) {
      const parts = String(s.inningsPitched).split('.')
      totalOuts += parseInt(parts[0]) * 3 + (parseInt(parts[1] ?? '0'))
    }
  }
  const ip = `${Math.floor(totalOuts / 3)}.${totalOuts % 3}`
  const era = totalOuts ? (t.earnedRuns * 27 / totalOuts).toFixed(2) : null
  const whip = totalOuts ? ((t.hits + t.baseOnBalls) / (totalOuts / 3)).toFixed(2) : null
  return { ...t, inningsPitched: ip, era, whip }
}

export function calcKPct(s: any, isPitch: boolean): string {
  if (!s) return '—'
  if (isPitch) {
    const bf = s.battersFaced || ((s.atBats??0)+(s.baseOnBalls??0)+(s.hitByPitch??0))
    return bf ? (s.strikeOuts/bf*100).toFixed(1)+'%' : '—'
  }
  return s.plateAppearances ? (s.strikeOuts/s.plateAppearances*100).toFixed(1)+'%' : '—'
}

export function calcBBPct(s: any, isPitch: boolean): string {
  if (!s) return '—'
  if (isPitch) {
    const bf = s.battersFaced || ((s.atBats??0)+(s.baseOnBalls??0)+(s.hitByPitch??0))
    return bf ? (s.baseOnBalls/bf*100).toFixed(1)+'%' : '—'
  }
  return s.plateAppearances ? (s.baseOnBalls/s.plateAppearances*100).toFixed(1)+'%' : '—'
}

export function stripLeadingZero(val: any): string {
  if (val == null || val === '' || val === '-.--') return '—'
  return String(val).replace(/^(-?)0\./, '$1.')
}
