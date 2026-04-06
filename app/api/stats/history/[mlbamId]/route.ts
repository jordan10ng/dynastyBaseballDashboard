import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.env.HOME ?? '', 'Desktop/fantasy-baseball/data/history')
const YEARS = ['2015','2016','2017','2018','2019','2020','2021','2022','2023','2024','2025','2026']

export async function GET(_req: NextRequest, { params }: { params: Promise<{ mlbamId: string }> }) {
  const { mlbamId } = await params
  if (!mlbamId) return NextResponse.json({ error: 'missing mlbamId' }, { status: 400 })

  const results: any[] = []

  for (const year of YEARS) {
    const file = path.join(DATA_DIR, `${year}.json`)
    if (!fs.existsSync(file)) continue
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      const rows = data[mlbamId]
      if (!rows || !rows.length) continue
      for (const row of rows) {
        results.push({ ...row, season: year })
      }
    } catch {}
  }

  return NextResponse.json({ splits: results })
}
