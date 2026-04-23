import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DATA = process.env.DATA_BASE ?? path.join(process.env.HOME!, 'Desktop/fantasy-baseball/data')

export async function GET() {
  const reg = JSON.parse(fs.readFileSync(path.join(DATA, 'model/regression.json'), 'utf8'))
  return NextResponse.json(reg)
}
