'use client'
import { useState, useEffect, useRef } from 'react'
import { Upload, CheckCircle, AlertCircle, Trash2, Plus, FileText, X, Play, RefreshCw } from 'lucide-react'

interface RankingSource {
  filename: string
  sourceName: string
  date: string
  rowCount: number
  daysOld: number
  weight: number
  rankType: 'overall' | 'prospect' | 'open'
}

interface ColMapping {
  rank: string
  player: string
  position: string
  team: string
}

interface ComputeState {
  exists: boolean
  computedAt?: string
  overallRanked?: number
  prospectsSlotted?: number
  sourcesUsed?: number
}

export default function RankingsPage() {
  const [stats, setStats] = useState<{ ranked: number; total: number } | null>(null)
  const [status, setStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [importMode, setImportMode] = useState(false)
  const [parsedCols, setParsedCols] = useState<string[]>([])
  const [parsedFile, setParsedFile] = useState<File | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [sourceDate, setSourceDate] = useState(new Date().toISOString().slice(0, 10))
  const [rankType, setRankType] = useState<'overall' | 'prospect' | 'open'>('overall')
  const [colMapping, setColMapping] = useState<ColMapping>({ rank: '', player: '', position: '', team: '' })
  const [tierMode, setTierMode] = useState(false)
  const [tierColumn, setTierColumn] = useState('')
  const [orderColumn, setOrderColumn] = useState('')
  const [importStatus, setImportStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [importMessage, setImportMessage] = useState('')
  const importFileRef = useRef<HTMLInputElement>(null)

  const [sources, setSources] = useState<RankingSource[]>([])
  const [compute, setCompute] = useState<ComputeState>({ exists: false })
  const [computeStatus, setComputeStatus] = useState<'idle'|'loading'|'success'|'error'>('idle')
  const [computeMsg, setComputeMsg] = useState('')

  useEffect(() => { loadStats(); loadSources(); loadCompute() }, [])

  async function loadStats() {
    const res = await fetch('/api/rankings')
    const d = await res.json()
    setStats(d)
  }

  async function loadSources() {
    const res = await fetch('/api/rankings/import')
    if (res.ok) { const d = await res.json(); setSources(d.sources ?? []) }
  }

  async function loadCompute() {
    const res = await fetch('/api/rankings/compute')
    if (res.ok) setCompute(await res.json())
  }

  async function handleCompute() {
    setComputeStatus('loading'); setComputeMsg('Running consensus engine...')
    try {
      const res = await fetch('/api/rankings/compute', { method: 'POST' })
      const d = await res.json()
      if (res.ok) {
        setComputeStatus('success')
        setComputeMsg(`Done — ${d.overallRanked} overall · ${d.openInO} open slotted into O · ${d.prospectsSlotted} prospects · ${d.openInP} open slotted into P · ${d.totalRanked} total`)
        loadStats(); loadCompute()
      } else { setComputeStatus('error'); setComputeMsg(d.error ?? 'Compute failed') }
    } catch { setComputeStatus('error'); setComputeMsg('Network error') }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('loading'); setMessage('Uploading...')
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/rankings', { method: 'POST', body: form })
      const d = await res.json()
      if (res.ok) { setStatus('success'); setMessage(`Done — ${d.matched} matched, ${d.unmatched} added by name only`); loadStats() }
      else { setStatus('error'); setMessage(d.error ?? 'Upload failed') }
    } catch { setStatus('error'); setMessage('Upload error') }
    e.target.value = ''
  }

  async function handleClear() {
    await fetch('/api/rankings', { method: 'DELETE' })
    setMessage('Rankings cleared'); setStatus('idle'); loadStats()
  }

  async function handleImportFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParsedFile(file)
    const text = await file.text()
    const firstLine = text.split('\n')[0]
    const cols = firstLine.split(',').map(c => c.replace(/"/g, '').trim()).filter(Boolean)
    setParsedCols(cols)
    const lower = cols.map(c => c.toLowerCase())
    const detect = (candidates: string[]) => cols[lower.findIndex(c => candidates.some(k => c.includes(k)))] ?? ''
    setColMapping({
      rank: detect(['rank', 'ranking', 'points']),
      player: detect(['player', 'name']),
      position: detect(['position', 'pos']),
      team: detect(['team']),
    })
    const tierCol = detect(['arrival', 'tier'])
    if (tierCol) { setTierColumn(tierCol); setTierMode(true) }
    else { setTierColumn(''); setTierMode(false) }
    setOrderColumn(detect(['rank', 'ranking']))
    e.target.value = ''
  }

  function ColSelect({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
        </label>
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.4rem 0.6rem', color: 'var(--text)', fontSize: '0.85rem' }}>
          <option value="">— none —</option>
          {parsedCols.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    )
  }

  async function handleImportSubmit() {
    if (!parsedFile || !sourceName) { setImportStatus('error'); setImportMessage('Need file and source name'); return }
    if (tierMode && !tierColumn) { setImportStatus('error'); setImportMessage('Select a tier column'); return }
    if (!tierMode && !colMapping.rank) { setImportStatus('error'); setImportMessage('Select a rank column'); return }
    if (!colMapping.player) { setImportStatus('error'); setImportMessage('Select a player column'); return }
    setImportStatus('loading'); setImportMessage('Saving source...')
    const form = new FormData()
    form.append('file', parsedFile)
    form.append('sourceName', sourceName)
    form.append('date', sourceDate)
    form.append('rankType', rankType)
    form.append('colMapping', JSON.stringify(colMapping))
    form.append('tierColumn', tierMode ? tierColumn : '')
    form.append('orderColumn', tierMode ? orderColumn : '')
    try {
      const res = await fetch('/api/rankings/import', { method: 'POST', body: form })
      const d = await res.json()
      if (res.ok) {
        setImportStatus('success')
        setImportMessage(`Saved — ${d.rowCount} players from ${sourceName}`)
        setImportMode(false); setParsedFile(null); setParsedCols([])
        setSourceName(''); setRankType('overall'); setTierMode(false)
        setTierColumn(''); setOrderColumn('')
        setSourceDate(new Date().toISOString().slice(0, 10))
        loadSources()
      } else { setImportStatus('error'); setImportMessage(d.error ?? 'Import failed') }
    } catch { setImportStatus('error'); setImportMessage('Import error') }
  }

  async function handleDeleteSource(filename: string) {
    const res = await fetch(`/api/rankings/import?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' })
    if (res.ok) loadSources()
  }

  function weightColor(w: number) {
    if (w >= 0.8) return 'var(--accent)'
    if (w >= 0.5) return '#f59e0b'
    if (w > 0) return 'var(--danger)'
    return 'var(--muted)'
  }

  function timeAgo(iso: string) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  function typeLabel(t: string) {
    if (t === 'overall') return 'Overall'
    if (t === 'prospect') return 'Prospect'
    return 'Open Universe'
  }

  function typeBadgeColor(t: string) {
    if (t === 'overall') return { bg: 'rgba(99,102,241,0.12)', color: 'var(--accent)' }
    if (t === 'prospect') return { bg: 'rgba(34,197,94,0.12)', color: '#4ade80' }
    return { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' }
  }

  const overallSources = sources.filter(s => s.rankType === 'overall')
  const prospectSources = sources.filter(s => s.rankType === 'prospect')
  const openSources = sources.filter(s => s.rankType === 'open')

  function SourceRow({ s }: { s: RankingSource }) {
    const badge = typeBadgeColor(s.rankType)
    return (
      <div style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <FileText size={14} color="var(--muted)" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 2 }}>{s.sourceName}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{s.date} · {s.rowCount.toLocaleString()} players</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '0.75rem', color: weightColor(s.weight), fontFamily: 'var(--font-display)', fontWeight: 700 }}>
            {s.daysOld === 0 ? 'Today' : `${s.daysOld}d old`} · {Math.round(s.weight * 100)}% weight
          </div>
          {s.daysOld >= 365 && <div style={{ fontSize: '0.7rem', color: 'var(--danger)' }}>EXPIRED</div>}
        </div>
        <button onClick={() => handleDeleteSource(s.filename)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, flexShrink: 0 }}>
          <X size={14} />
        </button>
      </div>
    )
  }

  const inputStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.4rem 0.6rem', color: 'var(--text)', fontSize: '0.85rem' }
  const TYPES = ['overall', 'prospect', 'open'] as const
  const typeLabels: Record<string, string> = { overall: 'Overall', prospect: 'Prospect', open: 'Open Universe' }

  return (
    <div style={{ padding: '2.5rem 2rem', maxWidth: 760 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2rem', letterSpacing: '0.04em', textTransform: 'uppercase', margin: '0 0 0.5rem' }}>Rankings</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>Import ranking sources then compute the weighted consensus rank.</p>

      {stats && (
        <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '2rem' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.5rem', color: 'var(--accent)' }}>{stats.ranked.toLocaleString()}</div>
            <div style={{ color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-display)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ranked Players</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.5rem', color: 'var(--text)' }}>{stats.total.toLocaleString()}</div>
            <div style={{ color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-display)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Total Players</div>
          </div>
        </div>
      )}

      {/* COMPUTE */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Compute Consensus Rankings
        </div>
        {compute.exists && (
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.875rem' }}>
            Last run: <span style={{ color: 'var(--text)' }}>{timeAgo(compute.computedAt!)}</span>
            &nbsp;·&nbsp;{compute.overallRanked} overall + {compute.prospectsSlotted} prospects
            &nbsp;·&nbsp;{compute.sourcesUsed} sources
          </div>
        )}
        <button className="btn-primary" onClick={handleCompute} disabled={computeStatus === 'loading' || sources.length === 0}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {computeStatus === 'loading' ? <RefreshCw size={14} /> : <Play size={14} />}
          {computeStatus === 'loading' ? 'Computing...' : 'Compute Rankings'}
        </button>
        {computeMsg && (
          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: computeStatus === 'error' ? 'var(--danger)' : 'var(--accent)' }}>
            {computeStatus === 'error' ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
            {computeMsg}
          </div>
        )}
      </div>

      {/* SOURCE LIBRARY */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ranking Sources</span>
          <button className="btn-primary" onClick={() => { setImportMode(m => !m); setImportStatus('idle'); setImportMessage('') }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
            <Plus size={12} /> Add Source
          </button>
        </div>

        {importMode && (
          <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px auto', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder="e.g. PLive Open Universe" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input type="date" value={sourceDate} onChange={e => setSourceDate(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type <span style={{ color: 'var(--danger)' }}>*</span></label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {TYPES.map(t => (
                    <button key={t} onClick={() => setRankType(t)}
                      style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: `1px solid ${rankType === t ? 'var(--accent)' : 'var(--border)'}`, background: rankType === t ? 'rgba(99,102,241,0.15)' : 'var(--surface)', color: rankType === t ? 'var(--accent)' : 'var(--muted)', fontSize: '0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {typeLabels[t]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <input ref={importFileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImportFileSelect} />
            <button className="btn-ghost" onClick={() => importFileRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
              <Upload size={13} /> {parsedFile ? parsedFile.name : 'Choose CSV'}
            </button>

            {parsedCols.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  <input type="checkbox" id="tierMode" checked={tierMode} onChange={e => setTierMode(e.target.checked)}
                    style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
                  <label htmlFor="tierMode" style={{ fontSize: '0.8rem', color: 'var(--muted)', cursor: 'pointer' }}>
                    Tier format — rank column contains "Top 10", "Top 30" style values
                  </label>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.5rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Map Columns</div>

                {tierMode ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem', marginBottom: '1rem' }}>
                    <ColSelect label="Tier Column" value={tierColumn} onChange={setTierColumn} required />
                    <ColSelect label="Order Within Tier" value={orderColumn} onChange={setOrderColumn} />
                    <ColSelect label="Player" value={colMapping.player} onChange={v => setColMapping(m => ({ ...m, player: v }))} required />
                    <ColSelect label="Position" value={colMapping.position} onChange={v => setColMapping(m => ({ ...m, position: v }))} />
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.6rem', marginBottom: '1rem' }}>
                    <ColSelect label="Rank" value={colMapping.rank} onChange={v => setColMapping(m => ({ ...m, rank: v }))} required />
                    <ColSelect label="Player" value={colMapping.player} onChange={v => setColMapping(m => ({ ...m, player: v }))} required />
                    <ColSelect label="Position" value={colMapping.position} onChange={v => setColMapping(m => ({ ...m, position: v }))} />
                    <ColSelect label="Team" value={colMapping.team} onChange={v => setColMapping(m => ({ ...m, team: v }))} />
                  </div>
                )}
              </>
            )}

            {importMessage && (
              <div style={{ fontSize: '0.8rem', color: importStatus === 'error' ? 'var(--danger)' : 'var(--accent)', marginBottom: '0.75rem' }}>{importMessage}</div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-primary" onClick={handleImportSubmit} disabled={importStatus === 'loading' || !parsedFile}>
                {importStatus === 'loading' ? 'Saving...' : 'Save Source'}
              </button>
              <button className="btn-ghost" onClick={() => { setImportMode(false); setParsedFile(null); setParsedCols([]); setImportMessage('') }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {overallSources.length > 0 && (
          <>
            <div style={{ padding: '0.5rem 1.25rem', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Overall</span>
            </div>
            {overallSources.map(s => <SourceRow key={s.filename} s={s} />)}
          </>
        )}

        {prospectSources.length > 0 && (
          <>
            <div style={{ padding: '0.5rem 1.25rem', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Prospect</span>
            </div>
            {prospectSources.map(s => <SourceRow key={s.filename} s={s} />)}
          </>
        )}

        {openSources.length > 0 && (
          <>
            <div style={{ padding: '0.5rem 1.25rem', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#f59e0b' }}>Open Universe</span>
            </div>
            {openSources.map(s => <SourceRow key={s.filename} s={s} />)}
          </>
        )}

        {sources.length === 0 && !importMode && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>No sources imported yet</div>
        )}
      </div>

      <details style={{ marginBottom: '1rem' }}>
        <summary style={{ color: 'var(--muted)', fontSize: '0.8rem', cursor: 'pointer', marginBottom: '0.75rem' }}>Legacy direct import (overwrites rank field)</summary>
        <div className="card" style={{ padding: '1.25rem' }}>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleUpload} />
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={status === 'loading'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Upload size={14} />
              {status === 'loading' ? 'Uploading...' : 'Upload Rankings CSV'}
            </button>
            {stats && stats.ranked > 0 && (
              <button className="btn-ghost" onClick={handleClear} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Trash2 size={14} /> Clear Rankings
              </button>
            )}
          </div>
          {message && (
            <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {status === 'error' ? <AlertCircle size={16} color="var(--danger)" /> : <CheckCircle size={16} color="var(--accent)" />}
              <span style={{ fontSize: '0.875rem' }}>{message}</span>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
