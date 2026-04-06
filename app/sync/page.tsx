'use client'
import { useState, useRef } from 'react'
import { RefreshCw, CheckCircle, AlertCircle, Upload, Link as LinkIcon, BarChart2 } from 'lucide-react'

export default function SyncPage() {
  const [syncStatus, setSyncStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [syncMsg, setSyncMsg] = useState('')
  const [leagues, setLeagues] = useState<any[]>([])
  const [importStatus, setImportStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [importMsg, setImportMsg] = useState('')
  const [linkStatus, setLinkStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [linkMsg, setLinkMsg] = useState('')
  const [statStatus, setStatStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [statMsg, setStatMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleSync() {
    setSyncStatus('loading'); setSyncMsg('Syncing...')
    try {
      const res = await fetch('/api/fantrax/sync', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setSyncStatus('success')
        setLeagues(data.leagues ?? [])
        setSyncMsg(`Done! Synced ${data.leagues?.length ?? 0} leagues.`)
      } else {
        setSyncStatus('error'); setSyncMsg(data.error ?? 'Sync failed.')
      }
    } catch { setSyncStatus('error'); setSyncMsg('Network error.') }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportStatus('loading'); setImportMsg('Importing players...')
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/players/import', { method: 'POST', body: form })
      const data = await res.json()
      if (res.ok) {
        setImportStatus('success'); setImportMsg(`Imported ${data.count} players.`)
      } else {
        setImportStatus('error'); setImportMsg(data.error ?? 'Import failed.')
      }
    } catch { setImportStatus('error'); setImportMsg('Import error.') }
    e.target.value = ''
  }

  async function handleLink() {
    setLinkStatus('loading'); setLinkMsg('Linking player IDs — this may take a few minutes...')
    try {
      const res = await fetch('/api/stats/link', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setLinkStatus('success')
        setLinkMsg(
          `Linked ${data.linked} / ${data.total} players — ` +
          `${data.razzMatched} from Razzball, ${data.apiMatched} from MLB API, ` +
          `${data.alreadyLinked} already linked, ${data.failed} unmatched.`
        )
      } else {
        setLinkStatus('error'); setLinkMsg(data.error ?? 'Link failed.')
      }
    } catch { setLinkStatus('error'); setLinkMsg('Network error.') }
  }

  async function handleStatSync() {
    setStatStatus('loading'); setStatMsg('Fetching stats — this will take a few minutes...')
    try {
      const res = await fetch('/api/stats/sync', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setStatStatus('success')
        setStatMsg(
          `Synced ${data.synced} players with stats. ` +
          `${data.noStats} had no stats yet, ${data.errors} errors.`
        )
      } else {
        setStatStatus('error'); setStatMsg(data.error ?? 'Stat sync failed.')
      }
    } catch { setStatStatus('error'); setStatMsg('Network error.') }
  }

  const StatusMsg = ({ status, msg }: { status: string; msg: string }) => (
    <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem',
      color: status === 'error' ? 'var(--danger)' : 'var(--accent)' }}>
      {status === 'error' ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
      {msg}
    </div>
  )

  return (
    <div style={{ padding: '2.5rem 2rem', maxWidth: 720 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2rem', letterSpacing: '0.04em', textTransform: 'uppercase', margin: '0 0 0.5rem' }}>
        Sync
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
        First import your Fantrax draft CSV to seed the player database, then sync your leagues.
      </p>

      {/* Step 1: Import players */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Step 1 — Import Player Database
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
          Upload a Fantrax draft results CSV to seed player names and IDs. Download from Fantrax → Draft → Export CSV.
        </p>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} />
        <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={importStatus === 'loading'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Upload size={14} />
          {importStatus === 'loading' ? 'Importing...' : 'Upload Draft CSV'}
        </button>
        {importMsg && <StatusMsg status={importStatus} msg={importMsg} />}
      </div>

      {/* Step 2: Sync leagues */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Step 2 — Sync Leagues
        </div>
        <button className="btn-primary" onClick={handleSync} disabled={syncStatus === 'loading'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <RefreshCw size={15} />
          {syncStatus === 'loading' ? 'Syncing...' : 'Sync My Leagues'}
        </button>
        {syncMsg && <StatusMsg status={syncStatus} msg={syncMsg} />}
      </div>

      {leagues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
          {leagues.map((league: any) => (
            <div key={league.id} className="card" style={{ padding: '0.875rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{league.name ?? league.id}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: 2 }}>
                  {league.error ? `Error: ${league.error}` : `${league.numTeams ?? '?'} teams · MLB`}
                </div>
              </div>
              <span className="tag" style={{ background: league.error ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', color: league.error ? 'var(--danger)' : 'var(--accent)' }}>
                {league.error ? 'Failed' : 'Synced'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Step 3: Link player IDs */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Step 3 — Link Player IDs
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
          Matches players to MLB Stats API IDs via Razzball CSV, then MLB API fallback. Run once, re-run when new players are added. Takes 2–5 minutes.
        </p>
        <button className="btn-ghost" onClick={handleLink} disabled={linkStatus === 'loading'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <LinkIcon size={14} />
          {linkStatus === 'loading' ? 'Linking...' : 'Link Player IDs'}
        </button>
        {linkMsg && <StatusMsg status={linkStatus} msg={linkMsg} />}
      </div>

      {/* Step 4: Sync stats */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Step 4 — Sync Stats
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
          Fetches current season stats from MLB Stats API for all linked players (MLB + MiLB). Run daily. Takes 3–8 minutes.
        </p>
        <button className="btn-ghost" onClick={handleStatSync} disabled={statStatus === 'loading'}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <BarChart2 size={14} />
          {statStatus === 'loading' ? 'Syncing stats...' : 'Sync Stats'}
        </button>
        {statMsg && <StatusMsg status={statStatus} msg={statMsg} />}
      </div>
    </div>
  )
}
