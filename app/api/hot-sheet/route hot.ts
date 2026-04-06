import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const HOTSHEET_PATH = path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data/model/hot-sheet.json')

export async function GET() {
  try {
    const data = JSON.parse(fs.readFileSync(HOTSHEET_PATH, 'utf8'))
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ bats: [], arms: [], generatedAt: null })
  }
}
