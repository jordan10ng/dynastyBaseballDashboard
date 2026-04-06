import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { loadPlayers } from '@/lib/db'
import fs from 'fs'
import path from 'path'

const STATS_PATH = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data/stats.json')

const PROGRESS_PATH = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data/stats-progress.json')

const CURRENT_SEASON = 2026

function fmt3(n: number): string {
  return n.toFixed(3).replace(/^0\./, '.')
}

function sumBat(splits: any[]): any {
  const t = {
    gamesPlayed:0, atBats:0, plateAppearances:0, hits:0, doubles:0, triples:0,
    homeRuns:0, rbi:0, runs:0, stolenBases:0, caughtStealing:0, baseOnBalls:0,
    strikeOuts:0, hitByPitch:0, totalBases:0, intentionalWalks:0,
    airOuts:0, groundOuts:0,
  }
  for (const s of splits) {
    t.gamesPlayed     += s.gamesPlayed ?? 0
    t.atBats          += s.atBats ?? 0
    t.plateAppearances+= s.plateAppearances ?? 0
    t.hits            += s.hits ?? 0
    t.doubles         += s.doubles ?? 0
    t.triples         += s.triples ?? 0
    t.homeRuns        += s.homeRuns ?? 0
    t.rbi             += s.rbi ?? 0
    t.runs            += s.runs ?? 0
    t.stolenBases     += s.stolenBases ?? 0
    t.caughtStealing  += s.caughtStealing ?? 0
    t.baseOnBalls     += s.baseOnBalls ?? 0
    t.strikeOuts      += s.strikeOuts ?? 0
    t.hitByPitch      += s.hitByPitch ?? 0
    t.totalBases      += s.totalBases ?? 0
    t.intentionalWalks+= s.intentionalWalks ?? 0
    t.airOuts         += s.airOuts ?? 0
    t.groundOuts      += s.groundOuts ?? 0
  }
  const avg = t.atBats ? fmt3(t.hits / t.atBats) : null
  const obp = t.plateAppearances ? fmt3((t.hits + t.baseOnBalls + t.hitByPitch) / t.plateAppearances) : null
  const slg = t.atBats ? fmt3(t.totalBases / t.atBats) : null
  const ops = obp && slg ? fmt3(parseFloat('0'+obp) + parseFloat('0'+slg)) : null
  return { ...t, avg, obp, slg, ops }
}

function sumPitch(splits: any[]): any {
  const t = {
    gamesPlayed:0, gamesStarted:0, wins:0, losses:0, saves:0, holds:0, blownSaves:0,
    earnedRuns:0, atBats:0, baseOnBalls:0, strikeOuts:0, hitByPitch:0, hits:0, battersFaced:0,
    airOuts:0, groundOuts:0,
  }
  let totalOuts = 0
  for (const s of splits) {
    t.gamesPlayed  += s.gamesPlayed ?? 0
    t.gamesStarted += s.gamesStarted ?? 0
    t.wins         += s.wins ?? 0
    t.losses       += s.losses ?? 0
    t.saves        += s.saves ?? 0
    t.holds        += s.holds ?? 0
    t.blownSaves   += s.blownSaves ?? 0
    t.earnedRuns   += s.earnedRuns ?? 0
    t.atBats       += s.atBats ?? 0
    t.baseOnBalls  += s.baseOnBalls ?? 0
    t.strikeOuts   += s.strikeOuts ?? 0
    t.hitByPitch   += s.hitByPitch ?? 0
    t.hits         += s.hits ?? 0
    t.battersFaced += s.battersFaced ?? 0
    t.airOuts      += s.airOuts ?? 0
    t.groundOuts   += s.groundOuts ?? 0
    if (s.inningsPitched) {
      const parts = String(s.inningsPitched).split('.')
      totalOuts += parseInt(parts[0]) * 3 + parseInt(parts[1] ?? '0')
    }
  }
  const ip = `${Math.floor(totalOuts / 3)}.${totalOuts % 3}`
  const era = totalOuts ? (t.earnedRuns * 27 / totalOuts).toFixed(2) : null
  const whip = totalOuts ? ((t.hits + t.baseOnBalls) / (totalOuts / 3)).toFixed(2) : null
  // Opponent slash — hits allowed / atBats faced
  const oAvg = t.atBats ? fmt3(t.hits / t.atBats) : null
  // oOBP and oSLG not calculable from counting stats alone without TB-allowed, store from API on single-team splits
  // For summed rows we store oAvg only; oObp/oSlg come from API on single splits
  return { ...t, inningsPitched: ip, era, whip, oAvg }
}

const LEVEL_ORDER = ['AAA','AA','A+','A','ROK']

function sportAbbrToLevel(abbr: string): string {
  if (abbr === 'AAA') return 'AAA'
  if (abbr === 'AA') return 'AA'
  if (abbr === 'A+' || abbr === 'HiA') return 'A+'
  if (abbr === 'A' || abbr === 'LoA' || abbr === 'A(Short)') return 'A'
  if (abbr === 'ROK' || abbr === 'Rk') return 'ROK'
  return 'Other'
}

async function fetchStats(mlbamId: string, group: string): Promise<any> {
  try {
    const [mlbRes, milbRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=season&season=${CURRENT_SEASON}&group=${group}`),
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=season&season=${CURRENT_SEASON}&group=${group}&leagueListId=milb_all`),
    ])

    const mlbData = mlbRes.ok ? await mlbRes.json() : null
    const milbData = milbRes.ok ? await milbRes.json() : null

    const mlbSplits = (mlbData?.stats?.[0]?.splits ?? []).filter((s: any) => !!s.team)

    if (mlbSplits.length > 0) {
      const statObjs = mlbSplits.map((s: any) => s.stat)
      const summed = group === 'pitching' ? sumPitch(statObjs) : sumBat(statObjs)
      // For single-team MLB players, grab oObp/oSlg directly from API
      if (mlbSplits.length === 1 && group === 'pitching') {
        const raw = mlbSplits[0].stat
        summed.oObp = raw.obp ?? null
        summed.oSlg = raw.slg ?? null
      }
      return { ...summed, _level: 'MLB' }
    }

    const milbSplits = (milbData?.stats?.[0]?.splits ?? [])
      .filter((s: any) => !!s.team && s.sport?.id !== 1)

    if (milbSplits.length === 0) return null

    const abbrs = milbSplits.map((s: any) => s.sport?.abbreviation ?? '')
    let highestLevel = 'MiLB'
    for (const lv of LEVEL_ORDER) {
      if (abbrs.some((a: string) => sportAbbrToLevel(a) === lv)) {
        highestLevel = lv
        break
      }
    }

    const statObjs = milbSplits.map((s: any) => s.stat)
    const summed = group === 'pitching' ? sumPitch(statObjs) : sumBat(statObjs)
    if (milbSplits.length === 1 && group === 'pitching') {
      const raw = milbSplits[0].stat
      summed.oObp = raw.obp ?? null
      summed.oSlg = raw.slg ?? null
    }
    return { ...summed, _level: highestLevel }
  } catch {
    return null
  }
}

export async function POST() {
  const players = loadPlayers()
  const linked = Object.entries(players).filter(([, p]: any) => p.mlbam_id)
  console.log(`Syncing stats for ${linked.length} linked players...`)

  const stats: Record<string, any> = {}
  let synced = 0
  let noStats = 0
  let errors = 0

  const writeProgress = (current: number, total: number) => {
    try {
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify({
        stage: 'stats', current, total, synced, noStats, errors, ts: Date.now()
      }))
    } catch {}
  }

  const CHUNK_SIZE = 10
  const SAVE_EVERY = 200

  for (let i = 0; i < linked.length; i += CHUNK_SIZE) {
    const chunk = linked.slice(i, i + CHUNK_SIZE)

    await Promise.all(chunk.map(async ([fantraxId, player]: any) => {
      try {
        const isPitcher = player.positions?.includes('SP') || player.positions?.includes('RP') || player.positions?.includes('P')
        const group = isPitcher ? 'pitching' : 'hitting'
        const stat = await fetchStats(player.mlbam_id, group)
        if (stat) {
          stats[fantraxId] = {
            mlbam_id: player.mlbam_id,
            group,
            season: CURRENT_SEASON,
            ...stat,
            _synced: new Date().toISOString(),
          }
          synced++
        } else {
          noStats++
        }
      } catch {
        errors++
      }
    }))

    if ((i + CHUNK_SIZE) % SAVE_EVERY === 0 || i + CHUNK_SIZE >= linked.length) {
      fs.writeFileSync(STATS_PATH, JSON.stringify(stats))
    }

    writeProgress(i + chunk.length, linked.length)

    if (i % 1000 === 0) {
      console.log(`  Stats: ${i + chunk.length} / ${linked.length} (synced: ${synced}, noStats: ${noStats}, errors: ${errors})`)
    }
  }

  fs.writeFileSync(STATS_PATH, JSON.stringify(stats))
  try { fs.unlinkSync(PROGRESS_PATH) } catch {}

  // Rebuild model pipeline
  const SCRIPTS = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/scripts')
  const modelSteps = [
    { cmd: `node "${SCRIPTS}/build-norms.js"`, label: 'norms' },
    { cmd: `python3 "${SCRIPTS}/build-mlb-tools.py"`, label: 'mlb-tools' },
    { cmd: `python3 "${SCRIPTS}/build-regression.py"`, label: 'regression' },
    { cmd: `node "${SCRIPTS}/build-scores.js"`, label: 'scores' },
  ]
  const modelResults: Record<string, string> = {}
  for (const step of modelSteps) {
    try {
      console.log(`Model: running ${step.label}...`)
      execSync(step.cmd, { stdio: 'inherit', timeout: 5 * 60 * 1000 })
      modelResults[step.label] = 'ok'
      console.log(`Model: ${step.label} done`)
    } catch (e: any) {
      modelResults[step.label] = 'error'
      console.error(`Model: ${step.label} failed`, e.message)
    }
  }

  return NextResponse.json({ success: true, linked: linked.length, synced, noStats, errors, model: modelResults })
}
