import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const RANKINGS_DIR = path.join(process.cwd(), 'data', 'rankings', 'sources')

function ensureDir() {
  const parent = path.join(process.cwd(), 'data', 'rankings')
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
  if (!fs.existsSync(RANKINGS_DIR)) fs.mkdirSync(RANKINGS_DIR, { recursive: true })
}

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

function daysOld(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function stalenessWeight(dateStr: string): number {
  const d = daysOld(dateStr)
  if (d >= 365) return 0
  return Math.max(0, 1 - d / 365)
}

function parseTier(val: string | undefined): number | null {
  if (!val) return null
  const m = val.trim().match(/^Top\s+(\d+)$/i)
  return m ? parseInt(m[1]) : null
}

function parseRank(val: string | undefined): number | null {
  if (!val || val.trim() === '' || val.trim().toUpperCase() === 'NR') return null
  const n = parseFloat(val)
  return isNaN(n) ? null : Math.round(n)
}

export async function GET() {
  ensureDir()
  const files = fs.readdirSync(RANKINGS_DIR).filter(f => f.endsWith('.json'))
  const sources = files.map(filename => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(RANKINGS_DIR, filename), 'utf-8'))
      const d = daysOld(raw.date)
      return {
        filename,
        sourceName: raw.sourceName,
        date: raw.date,
        rankType: raw.rankType ?? 'overall',
        rowCount: raw.players?.length ?? 0,
        daysOld: d,
        weight: stalenessWeight(raw.date),
      }
    } catch { return null }
  }).filter(Boolean)

  sources.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return NextResponse.json({ sources })
}

export async function POST(req: NextRequest) {
  ensureDir()
  const form = await req.formData()
  const file = form.get('file') as File
  const sourceName = form.get('sourceName') as string
  const date = form.get('date') as string
  const rankType = (form.get('rankType') as string) ?? 'overall'
  const colMappingRaw = form.get('colMapping') as string
  const tierColumn = (form.get('tierColumn') as string) ?? ''
  const orderColumn = (form.get('orderColumn') as string) ?? ''

  if (!file || !sourceName || !date || !colMappingRaw) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  let colMapping: Record<string, string>
  try { colMapping = JSON.parse(colMappingRaw) }
  catch { return NextResponse.json({ error: 'Invalid column mapping' }, { status: 400 }) }

  const text = await file.text()
  const rows = parseCSV(text)
  if (rows.length < 2) return NextResponse.json({ error: 'CSV empty' }, { status: 400 })

  const header = rows[0].map(h => h.trim())
  const colIndex = (colName: string) => colName ? header.findIndex(h => h === colName) : -1

  const idxPlayer   = colIndex(colMapping.player)
  const idxRank     = colIndex(colMapping.rank)
  const idxPosition = colIndex(colMapping.position)
  const idxTeam     = colIndex(colMapping.team)
  const idxTier     = colIndex(tierColumn)
  const idxOrder    = colIndex(orderColumn)

  if (idxPlayer < 0) {
    return NextResponse.json({ error: 'Player column is required' }, { status: 400 })
  }

  const isTierMode = tierColumn && idxTier >= 0
  if (!isTierMode && idxRank < 0) {
    return NextResponse.json({ error: 'Rank column is required for non-tier imports' }, { status: 400 })
  }

  const rawRows: Array<{ name: string; position: string; team: string; rank: number | null; tier: number | null; order: number }> = []
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i]
    const name = cols[idxPlayer]?.trim()
    if (!name) continue
    rawRows.push({
      name,
      position: idxPosition >= 0 ? (cols[idxPosition]?.trim() ?? '') : '',
      team:     idxTeam     >= 0 ? (cols[idxTeam]?.trim() ?? '') : '',
      rank:     idxRank     >= 0 ? parseRank(cols[idxRank]) : null,
      tier:     idxTier     >= 0 ? parseTier(cols[idxTier]) : null,
      order:    idxOrder    >= 0 ? (parseRank(cols[idxOrder]) ?? i) : i,
    })
  }

  let players: Array<{ name: string; rank: number | null; position: string; team: string }>

  if (isTierMode) {
    rawRows.sort((a, b) => a.order - b.order)
    const tierCounters: Record<number, number> = {}
    players = rawRows.map(row => {
      const tier = row.tier
      if (tier === null) return { name: row.name, rank: null, position: row.position, team: row.team }
      if (tierCounters[tier] === undefined) tierCounters[tier] = 0
      const assignedRank = tier + tierCounters[tier]
      tierCounters[tier]++
      return { name: row.name, rank: assignedRank, position: row.position, team: row.team }
    })
  } else {
    players = rawRows.map(row => ({
      name: row.name,
      rank: row.rank,
      position: row.position,
      team: row.team,
    }))
  }

  const datePart = date.replace(/-/g, '')
  const namePart = sourceName.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const filename = `${datePart}_${namePart}.json`

  fs.writeFileSync(path.join(RANKINGS_DIR, filename), JSON.stringify({
    sourceName, date, rankType,
    importedAt: new Date().toISOString(),
    colMapping,
    tierColumn: tierColumn || null,
    orderColumn: orderColumn || null,
    players,
  }, null, 2), 'utf-8')

  return NextResponse.json({ success: true, filename, rowCount: players.length })
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const filename = searchParams.get('filename')
  if (!filename) return NextResponse.json({ error: 'No filename' }, { status: 400 })
  if (!filename.endsWith('.json') || filename.includes('/') || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
  }
  const filepath = path.join(RANKINGS_DIR, filename)
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
  return NextResponse.json({ success: true })
}
