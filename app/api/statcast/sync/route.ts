import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import path from 'path'

export async function POST() {
  const script = path.join(process.cwd(), 'scripts/sync-statcast-gha.js')
  try {
    const output = execSync(`node "${script}"`, { encoding: 'utf-8', timeout: 15 * 60 * 1000 })
    console.log(output)
    return NextResponse.json({ success: true, output })
  } catch (e: any) {
    console.error('Statcast sync failed', e.message)
    return NextResponse.json({ success: false, error: e.message, output: e.stdout }, { status: 500 })
  }
}
