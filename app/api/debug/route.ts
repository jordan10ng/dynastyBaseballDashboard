import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const cwd = process.cwd()
  const dataDir = path.join(cwd, 'data', 'history')
  const exists = fs.existsSync(dataDir)
  const files = exists ? fs.readdirSync(dataDir).slice(0, 5) : []
  return NextResponse.json({ cwd, dataDir, exists, files })
}
