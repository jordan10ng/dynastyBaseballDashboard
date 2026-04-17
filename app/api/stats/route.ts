import { NextResponse } from 'next/server'
import { loadPlayers } from '@/lib/db'
import fs from 'fs'
import path from 'path'

const CURRENT_SEASON = new Date().getFullYear()
const HISTORY_PATH = path.join(process.cwd(), `data/history/${CURRENT_SEASON}.json`)

export async function GET() {
  try {
    const history: Record<string, any[]> = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'))
    const players = loadPlayers()

    // Build mlbam_id → fantraxId map
    const mlbamToFantrax: Record<string, string> = {}
    for (const [fantraxId, p] of Object.entries(players) as any) {
      if (p.mlbam_id) mlbamToFantrax[p.mlbam_id] = fantraxId
    }

    // For each player, pick the current-season rows and flatten to single stat object
    // matching the shape the players page expects
    const stats: Record<string, any> = {}
    for (const [mlbamId, rows] of Object.entries(history)) {
      const fantraxId = mlbamToFantrax[mlbamId]
      if (!fantraxId) continue

      const currentRows = rows.filter(r => r._season === CURRENT_SEASON)
      if (currentRows.length === 0) continue

      const toStatObj = (row: any, mlbamId: string) => ({
        mlbam_id: mlbamId,
        group: row.type,
        season: CURRENT_SEASON,
        gamesPlayed: row.g,
        atBats: row.ab,
        plateAppearances: row.pa,
        hits: row.h,
        doubles: row.doubles,
        triples: row.triples,
        homeRuns: row.hr,
        rbi: row.rbi,
        runs: row.r,
        stolenBases: row.sb,
        caughtStealing: row.cs,
        baseOnBalls: row.bb,
        strikeOuts: row.so,
        hitByPitch: row.hbp,
        totalBases: row.tb,
        intentionalWalks: row.ibb,
        airOuts: row.ao,
        groundOuts: row.go,
        avg: row.avg,
        obp: row.obp,
        slg: row.slg,
        ops: row.ops,
        gamesStarted: row.gs,
        wins: row.w,
        losses: row.l,
        saves: row.sv,
        holds: row.hld,
        blownSaves: row.bs,
        earnedRuns: row.er,
        battersFaced: row.bf,
        inningsPitched: row.ip,
        era: row.era,
        whip: row.whip,
        oAvg: row.baa,
        oObp: row.oObp ?? null,
        oSlg: row.oSlg ?? null,
        _level: row.level,
        _synced: row._synced,
      })

      const pitchRows = currentRows.filter(r => r.type === 'pitching')
      const hitRows   = currentRows.filter(r => r.type === 'hitting')
      const isTwoWay  = pitchRows.length > 0 && hitRows.length > 0

      if (isTwoWay) {
        // Store both — hitting under fantraxId, pitching under fantraxId + '_pit'
        const bestHit   = hitRows.find(r => r.level === 'MLB') ?? hitRows[0]
        const bestPitch = pitchRows.find(r => r.level === 'MLB') ?? pitchRows[0]
        stats[fantraxId]          = toStatObj(bestHit, mlbamId)
        stats[fantraxId + '_pit'] = toStatObj(bestPitch, mlbamId)
      } else {
        const mlbRow = currentRows.find(r => r.level === 'MLB')
        const row = mlbRow ?? currentRows[0]
        stats[fantraxId] = toStatObj(row, mlbamId)
      }
    }

    return NextResponse.json({ stats })
  } catch {
    return NextResponse.json({ stats: {} })
  }
}
