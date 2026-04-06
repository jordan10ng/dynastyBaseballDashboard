import { NextResponse } from 'next/server'
import { queryAll } from '@/lib/db'

export async function GET() {
  const leagues = await queryAll('SELECT * FROM leagues ORDER BY name')
  console.log('leagues API returning:', leagues.length, 'leagues')
  return NextResponse.json({ leagues })
}
