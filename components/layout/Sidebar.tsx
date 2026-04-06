'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, ListOrdered, ArrowLeftRight, RefreshCw, Flame } from 'lucide-react'

const nav = [
  { href: '/',         label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/players',  label: 'Players',    icon: Users },
  { href: '/rankings', label: 'Rankings',   icon: ListOrdered },
  { href: '/trade',    label: 'Trade Calc', icon: ArrowLeftRight },
  { href: '/hot-sheet', label: 'Hot Sheet',  icon: Flame },
  { href: '/sync',     label: 'Sync',       icon: RefreshCw },
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside style={{ width: 220, minHeight: '100vh', background: 'var(--bg-card)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ padding: '1.5rem 1.25rem 1rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.4rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent)', lineHeight: 1 }}>DIAMOND</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: 2 }}>Fantasy Baseball</div>
      </div>
      <nav style={{ padding: '0.75rem', flex: 1 }}>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = path === href || (href !== '/' && path.startsWith(href))
          return (
            <Link key={href} href={href} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.6rem 0.75rem', borderRadius: 6, marginBottom: 2, textDecoration: 'none', fontFamily: 'var(--font-display)', fontWeight: active ? 700 : 600, fontSize: '0.9rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: active ? 'var(--accent)' : 'var(--muted)', background: active ? 'rgba(34,197,94,0.08)' : 'transparent', borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s' }}>
              <Icon size={16} strokeWidth={active ? 2.5 : 2} />
              {label}
            </Link>
          )
        })}
      </nav>
      <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--border)', fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>LOCAL BUILD</div>
    </aside>
  )
}
