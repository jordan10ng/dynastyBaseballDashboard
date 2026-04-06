import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const filePath = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data/model/mlb-tools.json')
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)
    return NextResponse.json({ tools: data })
  } catch {
    return NextResponse.json({ tools: {} })
  }
}
