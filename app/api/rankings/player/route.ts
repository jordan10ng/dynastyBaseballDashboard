import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const RANKINGS_DIR = path.join(process.cwd(), 'data', 'rankings', 'sources')

function normalize(s: string) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|vi{0,3}|ix|v)$/i, '')
    .replace(/[^a-z0-9]/g, '')
}

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  if (!name) return NextResponse.json({ appearances: [] })
  const norm = normalize(name)
  if (!fs.existsSync(RANKINGS_DIR)) return NextResponse.json({ appearances: [] })
  const files = fs.readdirSync(RANKINGS_DIR).filter((f: string) => f.endsWith('.json'))
  const appearances: { sourceName: string; date: string; rank: number | null; rankType: string }[] = []
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(RANKINGS_DIR, file), 'utf-8'))
      if (raw.rankType === 'open') continue
      const match = (raw.players ?? []).find((p: any) => normalize(p.name) === norm)
      if (match) appearances.push({ sourceName: raw.sourceName, date: raw.date, rank: match.rank, rankType: raw.rankType ?? 'overall' })
    } catch {}
  }
  appearances.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return NextResponse.json({ appearances })
}
