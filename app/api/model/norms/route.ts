import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DATA = process.env.DATA_BASE ?? path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data')

export async function GET() {
  const norms = JSON.parse(fs.readFileSync(path.join(DATA, 'model/norms.json'), 'utf8'))
  return NextResponse.json(norms)
}
