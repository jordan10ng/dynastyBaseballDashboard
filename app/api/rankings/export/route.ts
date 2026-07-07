import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const BASE = path.join(process.cwd(), 'data')
const BLEND_PATH = path.join(BASE, 'model', 'blend-rank.json')
const PLAYERS_PATH = path.join(BASE, 'players.json')

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export async function GET() {
  if (!fs.existsSync(BLEND_PATH)) {
    return NextResponse.json({ error: 'No blended rankings found' }, { status: 404 })
  }
  const blend = JSON.parse(fs.readFileSync(BLEND_PATH, 'utf8'))
  const players: Record<string, any> = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'))

  const rows = Object.entries(blend.players ?? {})
    .map(([id, r]: [string, any]) => ({ id, ...r }))
    .filter((r) => typeof r.final_rank === 'number')
    .sort((a, b) => a.final_rank - b.final_rank)

  const lines = ['rank,player,pos,team']
  for (const r of rows) {
    const p = players[r.id] ?? {}
    const player = r.name ?? p.name ?? ''
    const pos = p.positions ?? ''
    const team = p.team ?? ''
    lines.push([r.final_rank, csvCell(player), csvCell(pos), csvCell(team)].join(','))
  }

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="blended-ranks-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
