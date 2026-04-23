import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/model/pool-stats.json'), 'utf8'))
    return NextResponse.json(data)
  } catch { return NextResponse.json({}) }
}
