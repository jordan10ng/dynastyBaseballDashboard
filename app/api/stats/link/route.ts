import { NextResponse } from 'next/server'
import { loadPlayers } from '@/lib/db'
import fs from 'fs'
import path from 'path'

const PLAYERS_PATH = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data/players.json')
const RAZZBALL_PATH = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data/razzball.csv')
const PROGRESS_PATH = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data/link-progress.json')

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

async function lookupByName(name: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}&sportIds=1,11,12,13,14,15,16`
    )
    if (!res.ok) return null
    const data = await res.json()
    const people = data.people ?? []
    if (people.length === 0) return null
    const exact = people.find((p: any) => p.fullName?.toLowerCase() === name.toLowerCase())
    const hit = exact ?? people[0]
    return hit?.id ? String(hit.id) : null
  } catch {
    return null
  }
}

async function processChunk(chunk: [string, any][], players: any): Promise<{ matched: number; failed: number }> {
  let matched = 0
  let failed = 0
  await Promise.all(chunk.map(async ([id, player]) => {
    const mlbamId = await lookupByName(player.name)
    if (mlbamId) {
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

  // --- Phase 1: Razzball CSV join ---
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

  for (const [id, player] of Object.entries(players) as any[]) {
    if (player.mlbam_id) { alreadyLinked++; continue }
    const match = razzMap[id]
    if (match) {
      players[id].mlbam_id = match.mlbam_id
      players[id].fangraphs_id = match.fangraphs_id
      razzMatched++
    }
  }

  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2))
  console.log(`Razzball matched: ${razzMatched}. Already linked: ${alreadyLinked}.`)

  // --- Phase 2: MLB API fallback, 10 concurrent ---
  const unmatched = Object.entries(players).filter(([, p]: any) => !p.mlbam_id)
  console.log(`MLB API fallback for ${unmatched.length} players (10 concurrent)...`)

  const CHUNK_SIZE = 10
  const SAVE_EVERY = 100

  for (let i = 0; i < unmatched.length; i += CHUNK_SIZE) {
    const chunk = unmatched.slice(i, i + CHUNK_SIZE)
    const result = await processChunk(chunk, players)
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
