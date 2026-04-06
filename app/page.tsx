'use client'
import { Users, ListOrdered, ArrowLeftRight, RefreshCw } from 'lucide-react'
import Link from 'next/link'

const cards = [
  { href: '/players',  icon: Users,          label: 'Players',    desc: 'Full player universe with league, team, ownership, and minors filters.', color: '#22c55e' },
  { href: '/rankings', icon: ListOrdered,    label: 'Rankings',   desc: 'Upload your CSV rankings and manage your player values.', color: '#3b82f6' },
  { href: '/trade',    icon: ArrowLeftRight, label: 'Trade Calc', desc: 'Build trades between teams and score them using your rankings.', color: '#a855f7' },
  { href: '/sync',     icon: RefreshCw,      label: 'Sync',       desc: 'Connect Fantrax and keep your league data up to date.', color: '#f59e0b' },
]

export default function Home() {
  return (
    <div style={{ padding: '2.5rem 2rem' }}>
      <div style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2.5rem', letterSpacing: '0.04em', textTransform: 'uppercase', margin: 0, lineHeight: 1 }}>Command Center</h1>
        <p style={{ color: 'var(--muted)', marginTop: '0.5rem', fontSize: '0.95rem' }}>Your fantasy baseball dashboard.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        {cards.map(({ href, icon: Icon, label, desc, color }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div className="card" style={{ padding: '1.5rem', cursor: 'pointer', height: '100%', transition: 'border-color 0.15s, background 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = color; (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-card)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: `${color}18`, border: `1px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                <Icon size={20} color={color} />
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text)', marginBottom: '0.4rem' }}>{label}</div>
              <div style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.5 }}>{desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
