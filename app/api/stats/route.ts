import { NextResponse } from 'next/server'
import { loadPlayers } from '@/lib/db'
import fs from 'fs'
import path from 'path'
import { sumStatObjs, calcOObp, calcOSlg, cleanSeasonRows, normLevel, LEVEL_RANK } from '@/lib/sum-stat-rows'

const CURRENT_SEASON = new Date().getFullYear()
const HISTORY_DIR = path.join(process.cwd(), 'data/history')

const readYear = (y: number): Record<string, any[]> => {
  try { return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, `${y}.json`), 'utf-8')) } catch { return {} }
}

// Past seasons never change mid-process — cache their cleaned rows. The current
// season is re-read every request (nightly sync rewrites it).
const pastCache: Record<string, Record<string, any[]>> = {}
function pastSeason(y: number) {
  return pastCache[y] ??= Object.fromEntries(Object.entries(readYear(y)).map(([id, rows]) => [id, cleanSeasonRows(rows)]))
}
function pastCareer() {
  return pastCache.career ??= (() => {
    const out: Record<string, any[]> = {}
    const years = fs.readdirSync(HISTORY_DIR).map(f => f.match(/^(\d{4})\.json$/)?.[1]).filter(Boolean).map(Number).filter(y => y < CURRENT_SEASON)
    for (const y of years) for (const [id, rows] of Object.entries(pastSeason(y))) (out[id] ??= []).push(...rows)
    return out
  })()
}
function currentSeason() {
  const out: Record<string, any[]> = {}
  for (const [id, rows] of Object.entries(readYear(CURRENT_SEASON))) {
    const cur = rows.filter(r => r._season === CURRENT_SEASON)
    if (cur.length) out[id] = cur
  }
  return out
}

// ?season=YYYY | career — omitted means current season (every other page)
export async function GET(req: Request) {
  try {
    const param = new URL(req.url).searchParams.get('season')
    const season = param === 'career' ? 'career' : param ? Number(param) : CURRENT_SEASON
    const current = currentSeason()
    let history: Record<string, any[]> = current
    if (season === 'career') {
      history = { ...pastCareer() }
      for (const [id, rows] of Object.entries(current)) history[id] = [...(history[id] ?? []), ...rows]
    } else if (season !== CURRENT_SEASON) {
      history = pastSeason(season)
    }
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

      const currentRows = rows
      if (currentRows.length === 0) continue

      const toStatObj = (row: any, mlbamId: string) => ({
        mlbam_id: mlbamId,
        group: row.type,
        season,
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

      // Name tag: a single season shows that season's level (its own _level);
      // career shows where the player is NOW — highest current-season level,
      // else the roster level.
      const nowLevel = (type: string) => {
        if (season !== 'career') return null
        const ls = (current[mlbamId] ?? []).filter(r => r.type === type).map(r => normLevel(r.level))
        return LEVEL_RANK.find(l => ls.includes(l)) ?? players[fantraxId]?.level ?? null
      }

      // MLB line if any, else all MiLB levels summed. _byLevel lets the players
      // page re-sum by level filter; _currentLevel is the highest level played.
      const build = (rows: any[]) => {
        const grouped: Record<string, any[]> = {}
        for (const r of rows) {
          const o = toStatObj(r, mlbamId)
          if (o.group === 'pitching' && o.oObp == null) o.oObp = calcOObp(o)
          if (o.group === 'pitching' && o.oSlg == null) o.oSlg = calcOSlg(o)
          ;(grouped[normLevel(o._level)] ??= []).push(o)
        }
        const levels = LEVEL_RANK.filter(l => grouped[l])
        const _byLevel = Object.fromEntries(levels.map(l => [l, sumStatObjs(grouped[l])]))
        const base = _byLevel.MLB ?? sumStatObjs(levels.map(l => _byLevel[l]))
        const now = nowLevel(base.group)
        return now ? { ...base, _byLevel, _level: now, _currentLevel: now } : { ...base, _byLevel, _currentLevel: base._level }
      }

      // Role from Fantrax positions (as the sync does) — past seasons include
      // pitchers' old at-bats, which must not make them look two-way
      const pos = String(players[fantraxId]?.positions ?? '').split(',').map((x: string) => x.trim())
      const hasArm = pos.some((x: string) => x === 'SP' || x === 'RP' || x === 'P')
      const hasBat = pos.some((x: string) => x && x !== 'SP' && x !== 'RP' && x !== 'P')
      const unknown   = !hasArm && !hasBat
      const pitchRows = hasArm || unknown ? currentRows.filter(r => r.type === 'pitching') : []
      const hitRows   = hasBat || unknown ? currentRows.filter(r => r.type === 'hitting') : []
      const isTwoWay  = pitchRows.length > 0 && hitRows.length > 0

      if (isTwoWay) {
        // Store both — hitting under fantraxId, pitching under fantraxId + '_pit'
        stats[fantraxId]          = build(hitRows)
        stats[fantraxId + '_pit'] = build(pitchRows)
      } else if (pitchRows.length || hitRows.length) {
        stats[fantraxId] = build(pitchRows.length ? pitchRows : hitRows)
      }
    }

    return NextResponse.json({ stats })
  } catch {
    return NextResponse.json({ stats: {} })
  }
}
