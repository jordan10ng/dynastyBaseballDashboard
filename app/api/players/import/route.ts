import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json')

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

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const text = await file.text()
  const rows = parseCSV(text)
  if (rows.length < 2) return NextResponse.json({ error: 'CSV appears empty' }, { status: 400 })

  const header = rows[0].map(h => h.toLowerCase())
  const idx = {
    id:       header.findIndex(h => h === 'id' || h.includes('player id')),
    name:     header.findIndex(h => h === 'player'),
    position: header.findIndex(h => h === 'position' || h === 'pos'),
    team:     header.findIndex(h => h === 'team'),
    age:      header.findIndex(h => h === 'age'),
  }

  const players: Record<string, any> = {}
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i]
    const rawId = cols[idx.id] ?? ''
    const id = rawId.replace(/\*/g, '').trim()
    if (!id) continue
    const name = cols[idx.name] ?? ''
    if (!name) continue
    players[id] = {
      id,
      name,
      team:      cols[idx.team] ?? '',
      positions: cols[idx.position] ?? '',
      level:     'MLB',
      age:       idx.age >= 0 ? parseInt(cols[idx.age]) || null : null,
    }
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2), 'utf-8')

  console.log(`Saved ${Object.keys(players).length} players to players.json`)
  return NextResponse.json({ success: true, count: Object.keys(players).length })
}
