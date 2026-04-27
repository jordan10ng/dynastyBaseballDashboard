import { NextResponse } from 'next/server'
import { head } from '@vercel/blob'
import fs from 'fs'
import path from 'path'

const LOCAL_GL = process.env.GAMELOG_DIR ?? path.join(process.env.HOME ?? '', 'Desktop/fantasy-baseball-gamelogs')

export async function GET(req: Request, { params }: { params: Promise<{ mlbamId: string }> }) {
  const { mlbamId } = await params
  const url = new URL(req.url)
  const year = url.searchParams.get('year') ?? String(new Date().getFullYear())

  const localPath = path.join(LOCAL_GL, year, `${mlbamId}.json`)
  if (fs.existsSync(localPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(localPath, 'utf8'))
      return NextResponse.json(data)
    } catch {}
  }

  try {
    const meta = await head(`gamelogs/${year}/${mlbamId}.json`)
    const res = await fetch(meta.url)
    if (!res.ok) throw new Error('blob fetch failed')
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ hitting: [], pitching: [] })
  }
}
