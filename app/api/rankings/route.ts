import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

const PLAYERS_PATH = path.join(os.homedir(), 'Desktop', 'fantasy-baseball', 'data', 'players.json')

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    const cols: string[] = []
    let current = '', inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuotes = !inQuotes }
      else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = '' }
      else { current += ch }
    }
    cols.push(current.trim())
    rows.push(cols)
  }
  return rows
}

export async function GET() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'))
  const ranked = Object.values(players).filter((p: any) => p.rank).length
  return NextResponse.json({ ranked, total: Object.keys(players).length })
}

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  const text = await file.text()
  const rows = parseCSV(text)
  if (rows.length < 2) return NextResponse.json({ error: 'CSV empty' }, { status: 400 })
  const header = rows[0].map(h => h.toLowerCase().trim())
  const idx = {
    rank:     header.findIndex(h => h === 'rank'),
    player:   header.findIndex(h => h === 'player'),
    position: header.findIndex(h => h === 'position' || h === 'pos'),
    team:     header.findIndex(h => h === 'team'),
  }
  if (idx.player < 0) return NextResponse.json({ error: 'No player column found' }, { status: 400 })
  const players: Record<string, any> = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'))
  const nameMap: Record<string, string> = {}
  for (const [id, p] of Object.entries(players) as any[]) {
    nameMap[p.name?.toLowerCase().trim()] = id
  }
  let matched = 0, unmatched = 0
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i]
    const name = cols[idx.player]?.trim()
    if (!name) continue
    const rank = parseInt(cols[idx.rank]) || i
    const id = nameMap[name.toLowerCase()]
    if (id) {
      players[id].rank = rank
      matched++
    } else {
      const key = `_name_${name.toLowerCase().replace(/\s+/g, '_')}`
      players[key] = { id: key, name, team: cols[idx.team] ?? '', positions: cols[idx.position] ?? '', level: 'MLB', age: null, rank }
      unmatched++
    }
  }
  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2), 'utf-8')
  console.log(`Rankings: ${matched} matched, ${unmatched} unmatched`)
  return NextResponse.json({ success: true, matched, unmatched })
}

export async function DELETE() {
  const players: Record<string, any> = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'))
  for (const p of Object.values(players) as any[]) delete p.rank
  for (const key of Object.keys(players)) { if (key.startsWith('_name_')) delete players[key] }
  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2), 'utf-8')
  return NextResponse.json({ success: true })
}
