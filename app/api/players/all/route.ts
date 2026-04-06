import { NextResponse } from 'next/server'
import { loadPlayers } from '@/lib/db'

export async function GET() {
  const players = loadPlayers()
  return NextResponse.json({ players: Object.values(players) })
}
