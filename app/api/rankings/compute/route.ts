import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const BASE = path.join(process.cwd(), 'data')
const SOURCES_DIR = path.join(BASE, 'rankings', 'sources')
const RANKINGS_OUT = path.join(BASE, 'rankings', 'rankings.json')
const PLAYERS_PATH = path.join(BASE, 'players.json')
const ALIASES_PATH = path.join(BASE, 'rankings', 'aliases.json')

function normalize(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|vi{0,3}|ix|v)$/i, '')
    .trim()
}

function daysOld(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

const HALF_LIFE_DAYS = 45
function stalenessWeight(dateStr: string): number {
  const d = daysOld(dateStr)
  if (d >= 365) return 0
  return Math.pow(0.5, d / HALF_LIFE_DAYS)
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

    // Alt-name mapping for players ranking sources refer to inconsistently
    // (e.g. "Leo De Vries" vs canonical "Leodalis De Vries") — points an
    // alias key at whatever candidates the canonical name already resolves to.
    if (fs.existsSync(ALIASES_PATH)) {
      const aliases: Record<string, string> = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'))
      for (const [aliasName, canonicalName] of Object.entries(aliases)) {
        const canonicalKey = normalize(canonicalName)
        const candidates = nameMap[canonicalKey]
        if (candidates) nameMap[normalize(aliasName)] = candidates
      }
    }

    if (!fs.existsSync(SOURCES_DIR)) return NextResponse.json({ error: 'No sources found' }, { status: 400 })
    const sourceFiles = fs.readdirSync(SOURCES_DIR).filter(f => f.endsWith('.json'))
    if (sourceFiles.length === 0) return NextResponse.json({ error: 'No sources found' }, { status: 400 })

    // Load all sources, deduplicate by normalized sourceName keeping only most recent per name+type
    const sourceMap: Map<string, any> = new Map()
    for (const filename of sourceFiles) {
      const raw = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, filename), 'utf-8'))
      const weight = stalenessWeight(raw.date)
      if (weight === 0) continue
      const source = { ...raw, weight, filename }
      const key = `${(raw.sourceName ?? '').toLowerCase().trim()}|${raw.rankType ?? 'overall'}`
      const existing = sourceMap.get(key)
      if (!existing || raw.date > existing.date) sourceMap.set(key, source)
    }
    const dedupedSources = Array.from(sourceMap.values())

    const overallSources: any[] = []
    const prospectSources: any[] = []
    const openSources: any[] = []

    for (const source of dedupedSources) {
      if (source.rankType === 'open') openSources.push(source)
      else if (source.rankType === 'prospect') prospectSources.push(source)
      else overallSources.push(source)
    }

    // Rows whose player name didn't resolve to anyone in players.json — these
    // silently drop out of the consensus entirely, which is how names like
    // "Leo De Vries" vs "Leodalis De Vries" go unnoticed until a rank looks wrong.
    const unmatched: Array<{ source: string; rankType: string; name: string }> = []

    // --- OVERALL ---
    // Pre-scan: per-source PID sets and per-source penalties for absence
    const sourcePidSets: Set<string>[] = []
    const sourcePenalties: number[] = []
    for (const source of overallSources) {
      const maxRank = Math.max(...source.players.map((p: any) => p.rank ?? 0))
      sourcePenalties.push(maxRank + 1)
      const pids = new Set<string>()
      for (const row of source.players) {
        const ids = resolveIds(row, nameMap, players)
        if (ids.length === 0) unmatched.push({ source: source.sourceName, rankType: source.rankType, name: row.name })
        for (const pid of ids) pids.add(pid)
      }
      sourcePidSets.push(pids)
    }
    const allOverallPids = new Set<string>(sourcePidSets.flatMap(s => Array.from(s)))

    // realWeightSum tracks weight from sources that actually ranked the player,
    // as opposed to weight from the absence penalty — used below to tell "genuinely
    // ranked, just not highly" apart from "mostly unranked, filled in with penalties."
    const overallData: Record<string, { weightedSum: number; weightSum: number; realWeightSum: number; name: string; position: string; team: string }> = {}
    for (let si = 0; si < overallSources.length; si++) {
      const source = overallSources[si]
      const penalty = sourcePenalties[si]
      for (const row of source.players) {
        const rank = row.rank ?? penalty
        for (const pid of resolveIds(row, nameMap, players)) {
          if (!overallData[pid]) overallData[pid] = { weightedSum: 0, weightSum: 0, realWeightSum: 0, name: players[pid]?.name ?? row.name, position: row.position, team: row.team }
          overallData[pid].weightedSum += rank * source.weight
          overallData[pid].weightSum += source.weight
          overallData[pid].realWeightSum += source.weight
        }
      }
      for (const pid of Array.from(allOverallPids)) {
        if (!sourcePidSets[si].has(pid)) {
          if (!overallData[pid]) overallData[pid] = { weightedSum: 0, weightSum: 0, realWeightSum: 0, name: players[pid]?.name ?? '', position: players[pid]?.positions ?? '', team: players[pid]?.team ?? '' }
          overallData[pid].weightedSum += penalty * source.weight
          overallData[pid].weightSum += source.weight
        }
      }
    }

    const overallRanked: Array<{ id: string; name: string; position: string; team: string; avgRank: number; realCoverage: number }> = []
    for (const [id, data] of Object.entries(overallData)) {
      if (data.weightSum === 0) continue
      overallRanked.push({ id, name: data.name, position: data.position, team: data.team, avgRank: data.weightedSum / data.weightSum, realCoverage: data.realWeightSum / data.weightSum })
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
        const ids = resolveIds(row, nameMap, players)
        if (ids.length === 0) unmatched.push({ source: source.sourceName, rankType: source.rankType, name: row.name })
        for (const pid of ids) {
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

    // --- UNIFIED CONSENSUS ---
    // A player's overall placement is only untrustworthy when it's mostly built
    // from absence penalties rather than real rankings — e.g. missing from most
    // overall boards, so the "average" is mostly synthetic worst-case filler. In
    // that case defer to the prospect-list consensus instead. But when a player
    // IS genuinely ranked by (most of) the overall sources — even if that real
    // placement is deep, or disagrees with the prospect boards — that's a real
    // signal and must not be overridden just because a narrower prospect-only
    // pool happens to rate them higher (a top prospect will almost always have
    // a better percentile within a prospects-only pool than within a pool that
    // also includes every MLB regular, so "pick whichever percentile is best"
    // was wrong — it overrode real, converged overall consensus).
    const REAL_COVERAGE_THRESHOLD = 0.5
    const overallPctById: Record<string, number> = {}
    const overallCoverageById: Record<string, number> = {}
    overallRanked.forEach((p, i) => { overallPctById[p.id] = (i + 1) / overallRanked.length; overallCoverageById[p.id] = p.realCoverage })

    const prospectPctById: Record<string, number> = {}
    fullProspectRanked.forEach((p, i) => { prospectPctById[p.id] = (i + 1) / fullProspectRanked.length })

    const combinedIds = new Set<string>([...overallRanked.map(p => p.id), ...fullProspectRanked.map(p => p.id)])
    const combined: Array<{ id: string; name: string; pct: number; fromProspect: boolean }> = []
    for (const id of Array.from(combinedIds)) {
      const oPct = overallPctById[id]
      const pPct = prospectPctById[id]
      const coverage = overallCoverageById[id]
      const overallUntrustworthy = oPct === undefined || coverage < REAL_COVERAGE_THRESHOLD
      const fromProspect = pPct !== undefined && overallUntrustworthy
      combined.push({ id, name: players[id]?.name ?? overallData[id]?.name ?? fullProspectData[id]?.name ?? '', pct: fromProspect ? pPct : oPct, fromProspect })
    }
    combined.sort((a, b) => a.pct - b.pct)

    // --- OPEN UNIVERSE CANDIDATES ---
    // Collect X players for insertion in build-blend-rank.js using minors_rank anchoring
    const xCandidates: Array<{ id: string | null; name: string; position: string; team: string; targetPPosition: number }> = []
    for (const source of openSources) {
      for (const row of source.players) {
        if (!row.rank) continue
        const ids = resolveIds(row, nameMap, players)
        const id = ids.length >= 1 ? ids[0] : null
        if (id && combinedIds.has(id)) continue
        xCandidates.push({ id, name: row.name, position: row.position ?? '', team: row.team ?? '', targetPPosition: row.rank })
      }
    }

    // Assign final consensus ranks — overallFinal is the single ranked list (feeds
    // build-blend-rank.js's consensusMap); prospectResult is the subset of it whose
    // final position came from the prospect signal, kept for the sources-used summary.
    const overallFinal: Array<{ id: string; name: string; rank: number }> = []
    const prospectResult: Array<{ id: string; name: string; rank: number }> = []
    for (let i = 0; i < combined.length; i++) {
      const prev = overallFinal[i - 1]
      const tied = prev && Math.abs(combined[i].pct - combined[i - 1].pct) < 0.0001
      const entry = { id: combined[i].id, name: combined[i].name, rank: tied ? prev.rank : i + 1 }
      overallFinal.push(entry)
      if (combined[i].fromProspect) prospectResult.push(entry)
    }

    // --- Write output ---
    const allSources = [...overallSources, ...prospectSources, ...openSources]
    const output = {
      computedAt: new Date().toISOString(),
      sourcesUsed: allSources.map(s => ({ filename: s.filename, sourceName: s.sourceName, date: s.date, rankType: s.rankType, weight: s.weight })),
      overall: overallFinal,
      prospects: prospectResult,
      xCandidates,
      unmatched,
    }
    fs.writeFileSync(RANKINGS_OUT, JSON.stringify(output, null, 2), 'utf-8')

    // --- Patch players.json ---
    for (const p of Object.values(players) as any[]) { delete p.rank; delete p.minors_rank }
    for (const entry of overallFinal) {
      if (entry.id && players[entry.id]) players[entry.id].rank = entry.rank
    }
    for (const entry of prospectResult) {
      if (entry.id && players[entry.id]) players[entry.id].rank = entry.rank
    }
    // minors_rank = position in the full prospect list (all sources, overall + prospect)
    for (let i = 0; i < fullProspectRanked.length; i++) {
      const { id } = fullProspectRanked[i]
      if (id && players[id]) players[id].minors_rank = i + 1
    }
    fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2), 'utf-8')

    // --- Run blend ---
    let blendMsg = ''
    try {
      const blendScript = path.join(process.cwd(), 'scripts', 'build-blend-rank.js')
      execSync(`node "${blendScript}"`, { cwd: process.cwd(), timeout: 30000 })
      blendMsg = 'blend ok'
    } catch (blendErr: any) {
      blendMsg = `blend failed: ${blendErr.message ?? blendErr}`
    }

    return NextResponse.json({
      success: true,
      overallRanked: overallFinal.length - prospectResult.length,
      prospectsSlotted: prospectResult.length,
      xCandidates: xCandidates.length,
      totalRanked: overallFinal.length,
      sourcesUsed: allSources.length,
      blendMsg,
      unmatched,
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
    overallRanked: (raw.overall?.length ?? 0) - (raw.prospects?.length ?? 0),
    prospectsSlotted: raw.prospects?.length ?? 0,
    sourcesUsed: raw.sourcesUsed?.length ?? 0,
    unmatched: raw.unmatched ?? [],
  })
}
