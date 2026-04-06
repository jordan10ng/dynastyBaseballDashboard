import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const BASE = path.join(process.cwd(), 'data')
const SOURCES_DIR = path.join(BASE, 'rankings', 'sources')
const RANKINGS_OUT = path.join(BASE, 'rankings', 'rankings.json')
const PLAYERS_PATH = path.join(BASE, 'players.json')

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function daysOld(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function stalenessWeight(dateStr: string): number {
  const d = daysOld(dateStr)
  if (d >= 365) return 0
  return Math.max(0, 1 - d / 365)
}

function matchPlayer(
  row: { name: string; position: string; team: string },
  nameMap: Record<string, string[]>,
  players: Record<string, any>
): string | null {
  const key = normalize(row.name)
  const candidates = nameMap[key]
  if (!candidates || candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const pos = normalize(row.position)
  const team = normalize(row.team)
  const scored = candidates.map(id => {
    const p = players[id]
    let score = 0
    if (pos && normalize(p.positions ?? '').includes(pos)) score++
    if (team && normalize(p.team ?? '') === team) score++
    return { id, score }
  })
  const best = scored.sort((a, b) => b.score - a.score)
  if (best[0].score === 0 && best.length > 1) return null
  return best[0].id
}

function resolveIds(
  row: { name: string; position: string; team: string },
  nameMap: Record<string, string[]>,
  players: Record<string, any>
): string[] {
  const id = matchPlayer(row, nameMap, players)
  if (id) return [id]
  const key = normalize(row.name)
  const candidates = nameMap[key]
  return candidates && candidates.length > 0 ? candidates : []
}

export async function POST() {
  try {
    const players: Record<string, any> = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'))

    const nameMap: Record<string, string[]> = {}
    for (const [id, p] of Object.entries(players)) {
      const key = normalize(p.name ?? '')
      if (!key) continue
      if (!nameMap[key]) nameMap[key] = []
      nameMap[key].push(id)
    }

    if (!fs.existsSync(SOURCES_DIR)) return NextResponse.json({ error: 'No sources found' }, { status: 400 })
    const sourceFiles = fs.readdirSync(SOURCES_DIR).filter(f => f.endsWith('.json'))
    if (sourceFiles.length === 0) return NextResponse.json({ error: 'No sources found' }, { status: 400 })

    const overallSources: any[] = []
    const prospectSources: any[] = []
    const openSources: any[] = []

    for (const filename of sourceFiles) {
      const raw = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, filename), 'utf-8'))
      const weight = stalenessWeight(raw.date)
      if (weight === 0) continue
      const source = { ...raw, weight, filename }
      if (raw.rankType === 'open') openSources.push(source)
      else if (raw.rankType === 'prospect') prospectSources.push(source)
      else overallSources.push(source)
    }

    // --- OVERALL ---
    const overallData: Record<string, { weightedSum: number; weightSum: number; name: string; position: string; team: string }> = {}
    for (const source of overallSources) {
      const maxRank = Math.max(...source.players.map((p: any) => p.rank ?? 0))
      const penalty = maxRank + 1
      for (const row of source.players) {
        const rank = row.rank ?? penalty
        for (const pid of resolveIds(row, nameMap, players)) {
          if (!overallData[pid]) overallData[pid] = { weightedSum: 0, weightSum: 0, name: players[pid]?.name ?? row.name, position: row.position, team: row.team }
          overallData[pid].weightedSum += rank * source.weight
          overallData[pid].weightSum += source.weight
        }
      }
    }

    const overallRanked: Array<{ id: string; name: string; position: string; team: string; avgRank: number }> = []
    for (const [id, data] of Object.entries(overallData)) {
      if (data.weightSum === 0) continue
      overallRanked.push({ id, name: data.name, position: data.position, team: data.team, avgRank: data.weightedSum / data.weightSum })
    }
    overallRanked.sort((a, b) => a.avgRank - b.avgRank)

    const overallResult: Array<{ id: string; name: string; position: string; team: string; avgRank: number; rank: number }> = []
    for (let i = 0; i < overallRanked.length; i++) {
      const prev = overallResult[i - 1]
      const tied = prev && Math.abs(overallRanked[i].avgRank - overallRanked[i-1].avgRank) < 0.0001
      overallResult.push({ ...overallRanked[i], rank: tied ? prev.rank : i + 1 })
    }

    const overallIds = new Set(overallResult.map(p => p.id))
    const overallRankById: Record<string, number> = {}
    for (const p of overallResult) overallRankById[p.id] = p.rank

    // --- FULL PROSPECT RANKING ---
    const fullProspectData: Record<string, { weightedSum: number; weightSum: number; name: string }> = {}
    for (const source of prospectSources) {
      const maxRank = Math.max(...source.players.map((p: any) => p.rank ?? 0))
      const penalty = maxRank + 1
      for (const row of source.players) {
        const rank = row.rank ?? penalty
        for (const pid of resolveIds(row, nameMap, players)) {
          if (!fullProspectData[pid]) fullProspectData[pid] = { weightedSum: 0, weightSum: 0, name: players[pid]?.name ?? row.name }
          fullProspectData[pid].weightedSum += rank * source.weight
          fullProspectData[pid].weightSum += source.weight
        }
      }
    }

    const fullProspectRanked: Array<{ id: string; name: string; avgRank: number }> = []
    for (const [id, data] of Object.entries(fullProspectData)) {
      if (data.weightSum === 0) continue
      fullProspectRanked.push({ id, name: data.name, avgRank: data.weightedSum / data.weightSum })
    }
    fullProspectRanked.sort((a, b) => a.avgRank - b.avgRank)

    // --- PROSPECT-ONLY ranking ---
    const prospectOnlyRanked: Array<{ id: string; name: string; position: string; team: string; avgRank: number }> = []
    for (const [id, data] of Object.entries(fullProspectData)) {
      if (data.weightSum === 0) continue
      if (overallIds.has(id)) continue
      prospectOnlyRanked.push({ id, name: data.name, position: players[id]?.positions ?? '', team: players[id]?.team ?? '', avgRank: data.weightedSum / data.weightSum })
    }
    prospectOnlyRanked.sort((a, b) => a.avgRank - b.avgRank)
    const prospectOnlyIds = new Set(prospectOnlyRanked.map(p => p.id))

    // --- OPEN UNIVERSE ---
    type XPlayer = { id: string | null; name: string; position: string; team: string; targetPPosition: number }
    const xPlayers: XPlayer[] = []

    for (const source of openSources) {
      for (const row of source.players) {
        if (!row.rank) continue
        const ids = resolveIds(row, nameMap, players)
        const id = ids.length >= 1 ? ids[0] : null
        if (id && (overallIds.has(id) || prospectOnlyIds.has(id))) continue
        xPlayers.push({ id, name: row.name, position: row.position ?? '', team: row.team ?? '', targetPPosition: row.rank })
      }
    }

    type XSlot = XPlayer & { oRankAnchor: number | null; pOnlyPosition: number | null }
    const xWithAnchor: XSlot[] = xPlayers.map(xp => {
      const pIndex = xp.targetPPosition - 1
      const anchorProspect = fullProspectRanked[pIndex]
      if (!anchorProspect) return { ...xp, oRankAnchor: null, pOnlyPosition: null }
      const oRank = overallRankById[anchorProspect.id]
      if (oRank != null) {
        return { ...xp, oRankAnchor: oRank, pOnlyPosition: null }
      } else {
        const pOnlyPos = prospectOnlyRanked.findIndex(p => p.id === anchorProspect.id)
        return { ...xp, oRankAnchor: null, pOnlyPosition: pOnlyPos >= 0 ? pOnlyPos + 1 : null }
      }
    })

    const xAnchored = xWithAnchor.filter(x => x.oRankAnchor !== null).sort((a, b) => a.oRankAnchor! - b.oRankAnchor!)
    const xFallback = xWithAnchor.filter(x => x.oRankAnchor === null)

    // --- BUILD O + anchored X list ---
    type EEntry = { id: string | null; name: string; sortKey: number; source: 'O' | 'X' }
    const eEntries: EEntry[] = []

    for (const p of overallResult) {
      eEntries.push({ id: p.id, name: p.name, sortKey: p.rank, source: 'O' })
    }

    const anchorOffsets: Record<number, number> = {}
    for (const xp of xAnchored) {
      const anchor = xp.oRankAnchor!
      if (anchorOffsets[anchor] === undefined) anchorOffsets[anchor] = 0
      const sortKey = anchor + 0.5 + anchorOffsets[anchor] * 0.05
      anchorOffsets[anchor]++
      eEntries.push({ id: xp.id, name: xp.name, sortKey, source: 'X' })
    }

    eEntries.sort((a, b) => a.sortKey - b.sortKey)

    const finalOX: Array<{ id: string | null; name: string; source: string; rank: number }> = []
    for (let i = 0; i < eEntries.length; i++) {
      const prev = finalOX[i - 1]
      const tied = prev && Math.abs(eEntries[i].sortKey - eEntries[i-1].sortKey) < 0.0001
      finalOX.push({ id: eEntries[i].id, name: eEntries[i].name, source: eEntries[i].source, rank: tied ? prev.rank : i + 1 })
    }

    const lastErank = finalOX.length > 0 ? Math.max(...finalOX.map(p => p.rank)) : 0

    // --- P-only + fallback X ---
    type PXEntry = { id: string; name: string; sortKey: number; source: 'P' | 'X' }
    const pxEntries: PXEntry[] = []

    for (let i = 0; i < prospectOnlyRanked.length; i++) {
      pxEntries.push({ id: prospectOnlyRanked[i].id, name: prospectOnlyRanked[i].name, sortKey: i + 1, source: 'P' })
    }

    for (const xp of xFallback) {
      const sortKey = xp.pOnlyPosition != null ? xp.pOnlyPosition + 0.5 : 99999
      pxEntries.push({ id: xp.id ?? '', name: xp.name, sortKey, source: 'X' })
    }

    pxEntries.sort((a, b) => a.sortKey - b.sortKey)

    const prospectResult: Array<{ id: string; name: string; source: string; rank: number }> = []
    for (let i = 0; i < pxEntries.length; i++) {
      const prev = prospectResult[i - 1]
      const tied = prev && Math.abs(pxEntries[i].sortKey - pxEntries[i-1].sortKey) < 0.0001
      prospectResult.push({
        id: pxEntries[i].id,
        name: pxEntries[i].name,
        source: pxEntries[i].source,
        rank: tied ? prev.rank : lastErank + i + 1
      })
    }

    // --- Write output ---
    const allSources = [...overallSources, ...prospectSources, ...openSources]
    const output = {
      computedAt: new Date().toISOString(),
      sourcesUsed: allSources.map(s => ({ filename: s.filename, sourceName: s.sourceName, date: s.date, rankType: s.rankType, weight: s.weight })),
      overall: finalOX,
      prospects: prospectResult,
    }
    fs.writeFileSync(RANKINGS_OUT, JSON.stringify(output, null, 2), 'utf-8')

    // --- Patch players.json ---
    for (const p of Object.values(players) as any[]) delete p.rank
    for (const entry of finalOX) {
      if (entry.id && players[entry.id]) players[entry.id].rank = entry.rank
    }
    for (const entry of prospectResult) {
      if (entry.id && players[entry.id]) players[entry.id].rank = entry.rank
    }
    fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2), 'utf-8')

    return NextResponse.json({
      success: true,
      overallRanked: finalOX.filter(p => p.source === 'O').length,
      openInO: xAnchored.length,
      prospectsSlotted: prospectResult.filter(p => p.source === 'P').length,
      openInP: xFallback.length,
      totalRanked: finalOX.length + prospectResult.length,
      sourcesUsed: allSources.length,
    })
  } catch (err: any) {
    console.error('Compute error:', err)
    return NextResponse.json({ error: err.message ?? 'Compute failed' }, { status: 500 })
  }
}

export async function GET() {
  const outPath = path.join(BASE, 'rankings', 'rankings.json')
  if (!fs.existsSync(outPath)) return NextResponse.json({ exists: false })
  const raw = JSON.parse(fs.readFileSync(outPath, 'utf-8'))
  return NextResponse.json({
    exists: true,
    computedAt: raw.computedAt,
    overallRanked: raw.overall?.length ?? 0,
    prospectsSlotted: raw.prospects?.length ?? 0,
    sourcesUsed: raw.sourcesUsed?.length ?? 0,
  })
}
