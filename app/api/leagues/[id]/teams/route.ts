import { NextRequest, NextResponse } from 'next/server'
import { queryAll } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const teams = await queryAll('SELECT * FROM teams', [])
  const filtered = teams.filter((t: any) => t.league_id === id)
  return NextResponse.json({ teams: filtered })
}
