'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Trophy, Users, ChevronRight, RefreshCw } from 'lucide-react'

export default function LeaguesPage() {
  const [leagues, setLeagues] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/leagues')
      .then(r => r.json())
      .then(d => { setLeagues(d.leagues ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: '2.5rem 2rem' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2rem', letterSpacing: '0.04em', textTransform: 'uppercase', margin: '0 0 0.4rem' }}>Leagues</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: 0 }}>
            {loading ? 'Loading...' : leagues.length > 0 ? `${leagues.length} league${leagues.length > 1 ? 's' : ''} synced` : 'No leagues synced yet'}
          </p>
        </div>
        <Link href="/sync"><button className="btn-ghost">Sync Leagues</button></Link>
      </div>

      {!loading && leagues.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
          <Trophy size={40} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>No leagues yet</div>
          <div style={{ fontSize: '0.875rem' }}>Go to <Link href="/sync" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Sync</Link> to connect your Fantrax account.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {leagues.map((league: any) => (
            <Link key={league.id} href={`/leagues/${league.id}`} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: 42, height: 42, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Trophy size={18} color="#f59e0b" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 2 }}>{league.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.8rem', display: 'flex', gap: '0.75rem' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Users size={12} /> {league.num_teams} teams</span>
                      <span>{league.sport}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className="tag" style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--accent)' }}>Synced</span>
                  <ChevronRight size={16} color="var(--muted)" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
