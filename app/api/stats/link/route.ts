import { NextResponse } from 'next/server'
import { loadPlayers } from '@/lib/db'
import fs from 'fs'
import path from 'path'

const PLAYERS_PATH = path.join(process.cwd(), 'data/players.json')
const RAZZBALL_PATH = path.join(process.cwd(), 'data/razzball.csv')
const PROGRESS_PATH = path.join(process.cwd(), 'data/link-progress.json')

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  const header = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const vals = line.split(',')
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = (vals[i] ?? '').trim() })
    return row
  })
}

// Name search returns retired namesakes too (this once linked ~200 prospects to
// old players), so require an exact name, Fantrax age ±1, an id nobody else
// holds, and exactly one such candidate -- otherwise leave the player unlinked.
async function lookupByName(name: string, age: number | null, claimed: Set<string>): Promise<string | null> {
  if (age == null) return null
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportIds=1,11,12,13,14,15,16`
    )
    if (!res.ok) return null
    const data = await res.json()
    const people = data.people ?? []
    if (people.length === 0) return null
    const year = new Date().getFullYear()
    const hits = people.filter((p: any) =>
      p.id && !claimed.has(String(p.id)) &&
      p.fullName?.toLowerCase() === name.toLowerCase() &&
      p.birthDate && Math.abs(year - parseInt(p.birthDate) - age) <= 1)
    return hits.length === 1 ? String(hits[0].id) : null
  } catch {
    return null
  }
}

async function processChunk(chunk: [string, any][], players: any, claimed: Set<string>): Promise<{ matched: number; failed: number }> {
  let matched = 0
  let failed = 0
  await Promise.all(chunk.map(async ([id, player]) => {
    const mlbamId = await lookupByName(player.name, player.age ?? null, claimed)
    if (mlbamId && !claimed.has(mlbamId)) {
      claimed.add(mlbamId)
      players[id].mlbam_id = mlbamId
      matched++
    } else {
      failed++
    }
  }))
  return { matched, failed }
}

export async function POST() {
  const players = loadPlayers()
  let razzMatched = 0
  let apiMatched = 0
  let alreadyLinked = 0
  let failed = 0

  const writeProgress = (stage: string, current: number, total: number) => {
    try { fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ stage, current, total, ts: Date.now() })) } catch {}
  }

  writeProgress('razzball', 0, 1)
  const csvText = fs.readFileSync(RAZZBALL_PATH, 'utf-8')
  const rows = parseCSV(csvText)

  const razzMap: Record<string, { mlbam_id: string; fangraphs_id: string }> = {}
  for (const row of rows) {
    const fantraxId = (row['FantraxID'] ?? '').replace(/\*/g, '').trim()
    const mlbamId = row['MLBAMID']?.trim()
    const fgId = row['FanGraphsID']?.trim()
    if (fantraxId && mlbamId) {
      razzMap[fantraxId] = { mlbam_id: mlbamId, fangraphs_id: fgId ?? '' }
    }
  }

  const claimed = new Set(Object.values(players).filter((p: any) => p.mlbam_id).map((p: any) => String(p.mlbam_id)))
  for (const [id, player] of Object.entries(players) as any[]) {
    if (player.mlbam_id) { alreadyLinked++; continue }
    const match = razzMap[id]
    if (match && !claimed.has(match.mlbam_id)) {
      claimed.add(match.mlbam_id)
      players[id].mlbam_id = match.mlbam_id
      players[id].fangraphs_id = match.fangraphs_id
      razzMatched++
    }
  }

  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2))
  console.log(`Razzball matched: ${razzMatched}. Already linked: ${alreadyLinked}.`)

  const unmatched = Object.entries(players).filter(([, p]: any) => !p.mlbam_id)
  console.log(`MLB API fallback for ${unmatched.length} players (10 concurrent)...`)

  const CHUNK_SIZE = 10
  const SAVE_EVERY = 100

  for (let i = 0; i < unmatched.length; i += CHUNK_SIZE) {
    const chunk = unmatched.slice(i, i + CHUNK_SIZE)
    const result = await processChunk(chunk, players, claimed)
    apiMatched += result.matched
    failed += result.failed

    if ((i + CHUNK_SIZE) % SAVE_EVERY === 0 || i + CHUNK_SIZE >= unmatched.length) {
      fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2))
    }

    writeProgress('api', i + chunk.length, unmatched.length)

    if (i % 500 === 0) {
      console.log(`  API fallback: ${i + chunk.length} / ${unmatched.length} (matched: ${apiMatched}, failed: ${failed})`)
    }
  }

  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2))
  try { fs.unlinkSync(PROGRESS_PATH) } catch {}

  return NextResponse.json({
    success: true,
    alreadyLinked,
    razzMatched,
    apiMatched,
    failed,
    total: Object.keys(players).length,
    linked: alreadyLinked + razzMatched + apiMatched,
  })
}
