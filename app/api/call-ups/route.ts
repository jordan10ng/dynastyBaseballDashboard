import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const CALLUPS_PATH = path.join(process.cwd(), 'data/model/call-ups.json')

export async function GET() {
  try {
    const data = JSON.parse(fs.readFileSync(CALLUPS_PATH, 'utf8'))
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ bats: [], arms: [], generatedAt: null })
  }
}
