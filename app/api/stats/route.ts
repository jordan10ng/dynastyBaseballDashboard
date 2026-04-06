import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const STATS_PATH = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data/stats.json')

export async function GET() {
  try {
    const stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'))
    return NextResponse.json({ stats })
  } catch {
    return NextResponse.json({ stats: {} })
  }
}
