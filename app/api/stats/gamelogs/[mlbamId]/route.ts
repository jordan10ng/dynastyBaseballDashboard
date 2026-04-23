import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(req: Request, { params }: { params: Promise<{ mlbamId: string }> }) {
  const { mlbamId } = await params
  const url = new URL(req.url)
  const year = url.searchParams.get('year') ?? String(new Date().getFullYear())
  try {
    const fpath = path.join(process.cwd(), `data/history/gamelogs/${year}/${mlbamId}.json`)
    const data = JSON.parse(fs.readFileSync(fpath, 'utf8'))
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ hitting: [], pitching: [] })
  }
}
