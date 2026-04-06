'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { FixedSizeList as List } from "../../components/players/VirtualList"
import { PlayerRow, StatCol } from '../../components/players/PlayerRow'
import { PlayerDrawer } from '../../components/players/PlayerDrawer'

const LEAGUES: { id: string; label: string }[] = [
  { id: '0ehfuam0mg7wqpn7', label: 'D28' },
  { id: 'ew7b8seomg7u7uzi', label: 'D34' },
  { id: 'd3prsagvmgftfdc3', label: 'D52' },
]

const MY_TEAM = 'Winston Salem Dash'
const BAT_POSITIONS = ['C','1B','2B','SS','3B','INF','LF','CF','RF','OF','UT']
const ARM_POSITIONS = ['SP','RP','P']
const ALL_POSITIONS = [...BAT_POSITIONS, ...ARM_POSITIONS]
const LEVEL_OPTIONS = ['MLB','AAA','AA','A+','A','ROK']

const POS_GROUPS = [
  { label: 'Catcher (C)', positions: ['C'] },
  { label: 'First Base (1B)', positions: ['1B'] },
  { label: 'Second Base (2B)', positions: ['2B'] },
  { label: 'Shortstop (SS)', positions: ['SS'] },
  { label: 'Third Base (3B)', positions: ['3B'] },
  { label: 'Infield (INF)', positions: ['INF'] },
  { label: 'Left Field (LF)', positions: ['LF'] },
  { label: 'Center Field (CF)', positions: ['CF'] },
  { label: 'Right Field (RF)', positions: ['RF'] },
  { label: 'Outfield (OF)', positions: ['OF'] },
  { label: 'Utility (UT)', positions: ['UT'] },
  { label: 'Starting Pitcher (SP)', positions: ['SP'] },
  { label: 'Relief Pitcher (RP)', positions: ['RP'] },
  { label: 'Pitcher (P)', positions: ['P'] },
]

const BAT_COLS: StatCol[] = [
  { key: 'g',      label: 'G',    getValue: s => s?.gamesPlayed ?? null,                    fmt: s => s?.gamesPlayed ?? '—' },
  { key: 'avg',    label: 'BA',   getValue: s => s?.avg ? parseFloat('0'+s.avg) : null,     fmt: s => s?.avg ?? '—' },
  { key: 'obp',    label: 'OBP',  getValue: s => s?.obp ? parseFloat('0'+s.obp) : null,     fmt: s => s?.obp ?? '—' },
  { key: 'slg',    label: 'SLG',  getValue: s => s?.slg ? parseFloat('0'+s.slg) : null,     fmt: s => s?.slg ?? '—' },
  { key: 'ops',    label: 'OPS',  getValue: s => s?.ops ? parseFloat('0'+s.ops) : null,     fmt: s => s?.ops ?? '—' },
  { key: 'so',     label: 'SO',   lowerBetter: true, getValue: s => s?.strikeOuts ?? null,  fmt: s => s?.strikeOuts ?? '—' },
  { key: 'bb',     label: 'BB',   getValue: s => s?.baseOnBalls ?? null,                    fmt: s => s?.baseOnBalls ?? '—' },
  { key: 'pa',     label: 'PA',   getValue: s => s?.plateAppearances ?? null,               fmt: s => s?.plateAppearances ?? '—' },
  { key: 'ab',     label: 'AB',   getValue: s => s?.atBats ?? null,                         fmt: s => s?.atBats ?? '—' },
  { key: 'h',      label: 'H',    getValue: s => s?.hits ?? null,                           fmt: s => s?.hits ?? '—' },
  { key: '2b',     label: '2B',   getValue: s => s?.doubles ?? null,                        fmt: s => s?.doubles ?? '—' },
  { key: '3b',     label: '3B',   getValue: s => s?.triples ?? null,                        fmt: s => s?.triples ?? '—' },
  { key: 'hr',     label: 'HR',   getValue: s => s?.homeRuns ?? null,                       fmt: s => s?.homeRuns ?? '—' },
  { key: 'r',      label: 'R',    getValue: s => s?.runs ?? null,                           fmt: s => s?.runs ?? '—' },
  { key: 'rbi',    label: 'RBI',  getValue: s => s?.rbi ?? null,                            fmt: s => s?.rbi ?? '—' },
  { key: 'sb',     label: 'SB',   getValue: s => s?.stolenBases ?? null,                    fmt: s => s?.stolenBases ?? '—' },
  { key: 'cs',     label: 'CS',   lowerBetter: true, getValue: s => s?.caughtStealing ?? null, fmt: s => s?.caughtStealing ?? '—' },
  { key: 'iso',    label: 'ISO',
    getValue: s => (s?.slg && s?.avg) ? parseFloat('0'+s.slg) - parseFloat('0'+s.avg) : null,
    fmt: s => (s?.slg && s?.avg) ? (parseFloat('0'+s.slg) - parseFloat('0'+s.avg)).toFixed(3).replace(/^0\./, '.') : '—' },
  { key: 'kpct',   label: 'K%',   lowerBetter: true,
    getValue: s => s?.plateAppearances ? s.strikeOuts / s.plateAppearances : null,
    fmt: s => s?.plateAppearances ? (s.strikeOuts / s.plateAppearances * 100).toFixed(1) + '%' : '—' },
  { key: 'bbpct',  label: 'BB%',
    getValue: s => s?.plateAppearances ? s.baseOnBalls / s.plateAppearances : null,
    fmt: s => s?.plateAppearances ? (s.baseOnBalls / s.plateAppearances * 100).toFixed(1) + '%' : '—' },
  { key: 'xbhpct', label: 'XBH%',
    getValue: s => s?.atBats ? ((s.doubles??0)+(s.triples??0)+(s.homeRuns??0)) / s.atBats : null,
    fmt: s => s?.atBats ? (((s.doubles??0)+(s.triples??0)+(s.homeRuns??0)) / s.atBats * 100).toFixed(1) + '%' : '—' },
]

const ARM_COLS: StatCol[] = [
  { key: 'g',      label: 'G',     getValue: s => s?.gamesPlayed ?? null,                    fmt: s => s?.gamesPlayed ?? '—' },
  { key: 'wl',     label: 'W-L',
    getValue: s => (s?.wins!=null && s?.losses!=null && (s.wins+s.losses)>0) ? s.wins/(s.wins+s.losses) : null,
    fmt: s => (s?.wins!=null && s?.losses!=null) ? `${s.wins}-${s.losses}` : '—' },
  { key: 'ip',     label: 'IP',    getValue: s => s?.inningsPitched ? parseFloat(s.inningsPitched) : null, fmt: s => s?.inningsPitched ?? '—' },
  { key: 'baa',    label: 'BAA',   lowerBetter: true,
    getValue: s => { const v = s?.oAvg??s?.avg; return v ? parseFloat('0'+v) : null },
    fmt: s => s?.oAvg ?? s?.avg ?? '—' },
  { key: 'era',    label: 'ERA',   lowerBetter: true, getValue: s => s?.era ? parseFloat(s.era) : null,   fmt: s => s?.era ?? '—' },
  { key: 'whip',   label: 'WHIP',  lowerBetter: true, getValue: s => s?.whip ? parseFloat(s.whip) : null, fmt: s => s?.whip ?? '—' },
  { key: 'h',      label: 'H',     lowerBetter: true, getValue: s => s?.hits ?? null,                     fmt: s => s?.hits ?? '—' },
  { key: 'r',      label: 'R',     lowerBetter: true, getValue: s => s?.runs ?? null,                     fmt: s => s?.runs ?? '—' },
  { key: 'er',     label: 'ER',    lowerBetter: true, getValue: s => s?.earnedRuns ?? null,               fmt: s => s?.earnedRuns ?? '—' },
  { key: 'hr',     label: 'HR',    lowerBetter: true, getValue: s => s?.homeRuns ?? null,                 fmt: s => s?.homeRuns ?? '—' },
  { key: 'bb',     label: 'BB',    lowerBetter: true, getValue: s => s?.baseOnBalls ?? null,              fmt: s => s?.baseOnBalls ?? '—' },
  { key: 'so',     label: 'SO',    getValue: s => s?.strikeOuts ?? null,                                  fmt: s => s?.strikeOuts ?? '—' },
  { key: 'kpct',   label: 'K%',
    getValue: s => { const bf = s?.battersFaced||((s?.atBats??0)+(s?.baseOnBalls??0)+(s?.hitByPitch??0)); return bf ? s.strikeOuts/bf : null },
    fmt: s => { const bf = s?.battersFaced||((s?.atBats??0)+(s?.baseOnBalls??0)+(s?.hitByPitch??0)); return bf ? (s.strikeOuts/bf*100).toFixed(1)+'%' : '—' } },
  { key: 'bbpct',  label: 'BB%',   lowerBetter: true,
    getValue: s => { const bf = s?.battersFaced||((s?.atBats??0)+(s?.baseOnBalls??0)+(s?.hitByPitch??0)); return bf ? s.baseOnBalls/bf : null },
    fmt: s => { const bf = s?.battersFaced||((s?.atBats??0)+(s?.baseOnBalls??0)+(s?.hitByPitch??0)); return bf ? (s.baseOnBalls/bf*100).toFixed(1)+'%' : '—' } },
  { key: 'kbbpct', label: 'K-BB%',
    getValue: s => { const bf = s?.battersFaced||((s?.atBats??0)+(s?.baseOnBalls??0)+(s?.hitByPitch??0)); return bf ? (s.strikeOuts-s.baseOnBalls)/bf : null },
    fmt: s => { const bf = s?.battersFaced||((s?.atBats??0)+(s?.baseOnBalls??0)+(s?.hitByPitch??0)); return bf ? ((s.strikeOuts-s.baseOnBalls)/bf*100).toFixed(1)+'%' : '—' } },
]

function posOrder(pos: string) {
  const order = ['C','1B','2B','SS','3B','INF','LF','CF','RF','OF','UT','SP','RP','P']
  const i = order.indexOf(pos)
  return i >= 0 ? i : 99
}

function isPitcher(positions: string) {
  return ARM_POSITIONS.includes(positions?.split(',')[0]?.trim())
}

function statLine(s: any): string {
  if (!s) return ''
  const level = s._level ? `${s._level}` : null
  if (s.group === 'pitching') {
    const bf = s?.battersFaced || ((s?.atBats??0)+(s?.baseOnBalls??0)+(s?.hitByPitch??0))
    const kPct = bf ? (s.strikeOuts/bf*100).toFixed(1)+'%' : '—'
    const bbPct = bf ? (s.baseOnBalls/bf*100).toFixed(1)+'%' : '—'
    const wl = (s.wins!=null && s.losses!=null) ? `${s.wins}-${s.losses}` : null
    const sv = s.saves!=null ? `${s.saves} SV${s.blownSaves ? ` (${s.blownSaves} BS)` : ''}` : null
    const holds = s.holds ? `${s.holds} H` : null
    return [level, `${s.gamesPlayed??'—'} G`, s.inningsPitched ? `${s.inningsPitched} IP` : null,
      wl, sv, holds, s.hits!=null ? `${s.hits} H` : null,
      s.era ? `${s.era} ERA` : null, s.whip ? `${s.whip} WHIP` : null,
      kPct!=='—' ? `${kPct} K%` : null, bbPct!=='—' ? `${bbPct} BB%` : null,
    ].filter(Boolean).join(' · ')
  } else {
    const pa = s.plateAppearances ?? 0
    const kPct = pa ? (s.strikeOuts/pa*100).toFixed(1)+'%' : '—'
    const bbPct = pa ? (s.baseOnBalls/pa*100).toFixed(1)+'%' : '—'
    const sb = s.stolenBases!=null ? `${s.stolenBases} SB${s.caughtStealing?` (${s.caughtStealing} CS)`:''}` : null
    return [level, `${s.gamesPlayed??'—'} G`, `${s.avg??'—'} / ${s.obp??'—'} / ${s.slg??'—'}`,
      s.homeRuns!=null?`${s.homeRuns} HR`:null, s.rbi!=null?`${s.rbi} RBI`:null,
      s.runs!=null?`${s.runs} R`:null, sb,
      kPct!=='—'?`${kPct} K%`:null, bbPct!=='—'?`${bbPct} BB%`:null].filter(Boolean).join(' · ')
  }
}

function statLineCompact(s: any): string {
  if (!s) return ''
  if (s.group === 'pitching') {
    const bf = s?.battersFaced || ((s?.atBats??0)+(s?.baseOnBalls??0)+(s?.hitByPitch??0))
    const kPct = bf && s.strikeOuts != null ? (s.strikeOuts/bf*100).toFixed(1)+'%' : null
    const bbPct = bf && s.baseOnBalls != null ? (s.baseOnBalls/bf*100).toFixed(1)+'%' : null
    const wl = s.wins!=null && s.losses!=null ? `${s.wins}-${s.losses}` : null
    return [wl, s.inningsPitched ? `${s.inningsPitched} IP` : null, s.era ? `${s.era} ERA` : null, kPct ? `${kPct} K%` : null, bbPct ? `${bbPct} BB%` : null].filter(Boolean).join(' · ')
  } else {
    const pa = s.plateAppearances ?? 0
    const kPct = pa && s.strikeOuts != null ? (s.strikeOuts/pa*100).toFixed(1)+'%' : null
    const bbPct = pa && s.baseOnBalls != null ? (s.baseOnBalls/pa*100).toFixed(1)+'%' : null
    return [s.ops ? `${s.ops} OPS` : null, kPct ? `${kPct} K%` : null, bbPct ? `${bbPct} BB%` : null, s.homeRuns!=null ? `${s.homeRuns} HR` : null, s.stolenBases!=null ? `${s.stolenBases} SB` : null].filter(Boolean).join(' · ')
  }
}

function toolColor(val: any) {
  if (val == null) return 'var(--muted)'
  if (val >= 130) return '#ef4444'
  if (val >= 115) return '#fca5a5'
  if (val >= 95)  return 'var(--text)'
  if (val >= 80)  return '#93c5fd'
  return '#3b82f6'
}

function computeTools(player: any, mlbToolsMap: Record<string, any>): any {
  if (player.mlbam_id && mlbToolsMap[player.mlbam_id]) {
    const t = mlbToolsMap[player.mlbam_id]
    if (t.overall != null) return t
    const isPit = t.type === 'pitcher'
    let overall = null
    if (isPit && t.stuff != null && t.control != null) {
      overall = Math.round(t.stuff * 0.70 + t.control * 0.30)
    } else if (!isPit && t.hit != null && t.power != null && t.speed != null) {
      overall = Math.round(t.hit * 0.42 + t.power * 0.47 + t.speed * 0.11)
    } else if (!isPit && t.hit != null && t.power != null) {
      overall = Math.round((t.hit * 0.42 + t.power * 0.47) / 0.89)
    }
    return { ...t, overall }
  }
  return player.model_scores ?? null
}

type StatFilter = { id: number; kind: 'stat' | 'tool'; key: string; min: string; max: string }
type SortMode = 'rank' | 'position' | 'stat' | 'tool'
type MinorsFilter = 'all' | 'mlb' | 'minors'
type OwnFilter = 'all' | 'mine' | 'owned' | 'fa' | 'mine+fa'
type BatArmsFilter = 'all' | 'bats' | 'arms'
type DataView = 'stats' | 'tools'

const TOOL_LABELS: Record<string,string> = { hit:'HIT+', power:'PWR+', speed:'SPD+', stuff:'STF+', control:'CTL+', overall:'OVR+' }
const BAT_TOOL_KEYS = ['hit','power','speed','overall']
const ARM_TOOL_KEYS = ['stuff','control','overall']

const btn = (active: boolean, mine?: boolean) => ({
  padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid',
  borderColor: active ? (mine ? '#f59e0b' : 'var(--accent)') : mine ? 'rgba(245,158,11,0.4)' : 'var(--border)',
  background: active ? (mine ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)') : 'transparent',
  color: active ? (mine ? '#f59e0b' : 'var(--accent)') : mine ? '#f59e0b' : 'var(--muted)',
  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.75rem',
  letterSpacing: '0.04em', cursor: 'pointer', whiteSpace: 'nowrap' as const,
})

const advInputStyle = {
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '0.35rem 0.5rem', color: 'var(--text)', fontSize: '0.75rem',
  outline: 'none', width: '65px', fontFamily: 'var(--font-display)'
}

let statFilterIdSeq = 0

const ROW_HEIGHT = 58

export default function PlayersPage() {
  const [allPlayers, setAllPlayers] = useState<any[]>([])
  const [allTeams, setAllTeams] = useState<any[]>([])
  const [allRosters, setAllRosters] = useState<any[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, any>>({})
  const [mlbToolsMap, setMlbToolsMap] = useState<Record<string, any>>({})
  const [dataView, setDataView] = useState<DataView>('stats')
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [mobileLimit, setMobileLimit] = useState(75)
  useEffect(() => {
    setMounted(true)
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const [toolSortKey, setToolSortKey] = useState('')
  const [selectedLeague, setSelectedLeague] = useState('')
  const [selectedTeam, setSelectedTeam] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null)
  const [minorsFilter, setMinorsFilter] = useState<MinorsFilter>('all')
  const [ownFilter, setOwnFilter] = useState<OwnFilter>('all')
  const [batArmsFilter, setBatArmsFilter] = useState<BatArmsFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('rank')
  const [statSortKey, setStatSortKey] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [rankMin, setRankMin] = useState('')
  const [rankMax, setRankMax] = useState('')
  const [ageMin, setAgeMin] = useState('')
  const [ageMax, setAgeMax] = useState('')
  const [selectedPosFilters, setSelectedPosFilters] = useState<string[]>([])
  const [posDropdownOpen, setPosDropdownOpen] = useState(false)
  const [selectedMlbTeam, setSelectedMlbTeam] = useState('')
  const [selectedLevelFilters, setSelectedLevelFilters] = useState<string[]>([])
  const [levelDropdownOpen, setLevelDropdownOpen] = useState(false)
  const [statFilters, setStatFilters] = useState<StatFilter[]>([])
  const listRef = useRef<any>(null)
  const hdrRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const floatingHeaderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/players/all').then(r => r.json()),
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/model/tools').then(r => r.json()),
      ...LEAGUES.map(l => fetch(`/api/leagues/${l.id}/teams`).then(r => r.json())),
      ...LEAGUES.map(l => fetch(`/api/leagues/${l.id}/rosters`).then(r => r.json())),
    ]).then(([pd, sd, td, ...rest]) => {
      const teamResults = rest.slice(0, LEAGUES.length)
      const rosterResults = rest.slice(LEAGUES.length)
      setAllPlayers(pd.players ?? [])
      setStatsMap(sd.stats ?? {})
      setMlbToolsMap(td.tools ?? {})
      setAllTeams(teamResults.flatMap((d: any) => d.teams ?? []))
      setAllRosters(rosterResults.flatMap((d: any) => d.rosters ?? []))
      setLoading(false)
    })
  }, [])

  // Scroll list back to top whenever filtered result set changes
  useEffect(() => { listRef.current?.scrollTo(0); setMobileLimit(75) }, [search, minorsFilter, batArmsFilter, ownFilter, selectedLeague, selectedTeam, sortMode, statSortKey, toolSortKey])

  const onScrollContainer = useCallback(() => {
    if (floatingHeaderRef.current && scrollContainerRef.current) {
      floatingHeaderRef.current.scrollLeft = scrollContainerRef.current.scrollLeft
    }
  }, [])

  const mlbTeams = useMemo(() => {
    const teams = new Set<string>()
    allPlayers.forEach(p => p.team && teams.add(p.team))
    return Array.from(teams).sort()
  }, [allPlayers])

  const minorsIds = useMemo(
    () => new Set(allPlayers.filter(p => !p.mlbam_id || !mlbToolsMap[p.mlbam_id]).map(p => p.id)),
    [allPlayers, mlbToolsMap]
  )

  const globalOwnership = useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    for (const r of allRosters) {
      if (!map[r.player_id]) map[r.player_id] = {}
      map[r.player_id][r.league_id] = r.team_name
    }
    return map
  }, [allRosters])

  const ownershipMap = useMemo(() => {
    const map: Record<string, { teamName: string; teamId: string }> = {}
    const leagueRosters = selectedLeague ? allRosters.filter(r => r.league_id === selectedLeague) : []
    for (const r of leagueRosters) map[r.player_id] = { teamName: r.team_name, teamId: r.team_id }
    return map
  }, [allRosters, selectedLeague])

  const leagueTeams = useMemo(
    () => selectedLeague ? allTeams.filter(t => t.league_id === selectedLeague) : [],
    [allTeams, selectedLeague]
  )

  // Pre-compute tools map once — avoids recomputing inside every row render
  const playerToolsMap = useMemo(() => {
    const map: Record<string, any> = {}
    for (const p of allPlayers) map[p.id] = computeTools(p, mlbToolsMap)
    return map
  }, [allPlayers, mlbToolsMap])

  // Pre-compute stat lines once
  const statLineMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of allPlayers) map[p.id] = batArmsFilter === 'all' ? statLineCompact(statsMap[p.id]) : statLine(statsMap[p.id])
    return map
  }, [allPlayers, statsMap, batArmsFilter])

  // Memoize derived display values so filtered dep array stays stable
  const activeCols = useMemo<StatCol[]>(
    () => batArmsFilter === 'bats' ? BAT_COLS : batArmsFilter === 'arms' ? ARM_COLS : [],
    [batArmsFilter]
  )
  const showStatCols = useMemo(() => dataView === 'stats' && batArmsFilter !== 'all', [dataView, batArmsFilter])
  const showToolCols = useMemo(() => dataView === 'tools', [dataView])
  const showExtraCol = useMemo(() => showStatCols || showToolCols || batArmsFilter === 'all', [showStatCols, showToolCols, batArmsFilter])
  const activeToolKeys = useMemo<string[]>(
    () => batArmsFilter === 'bats' ? BAT_TOOL_KEYS : batArmsFilter === 'arms' ? ARM_TOOL_KEYS : ['overall'],
    [batArmsFilter]
  )

  const availableToolKeys = useMemo<string[]>(
    () => batArmsFilter === 'bats' ? BAT_TOOL_KEYS : batArmsFilter === 'arms' ? ARM_TOOL_KEYS : [],
    [batArmsFilter]
  )

  const availablePositions = useMemo(
    () => batArmsFilter === 'bats' ? BAT_POSITIONS : batArmsFilter === 'arms' ? ARM_POSITIONS : ALL_POSITIONS,
    [batArmsFilter]
  )

  useEffect(() => { setSelectedTeam('') }, [selectedLeague])
  useEffect(() => {
    if (!selectedTeam && sortMode === 'position') setSortMode('rank')
  }, [selectedTeam, sortMode])
  useEffect(() => {
    if (batArmsFilter === 'bats') setSelectedPosFilters(prev => prev.filter(p => BAT_POSITIONS.includes(p)))
    else if (batArmsFilter === 'arms') setSelectedPosFilters(prev => prev.filter(p => ARM_POSITIONS.includes(p)))
    setStatSortKey('')
    setSortMode('rank')
    setStatFilters([])
  }, [batArmsFilter])

  const syncScroll = useCallback((scrollLeft: number) => {
    if (hdrRef.current) {
      hdrRef.current.scrollLeft = scrollLeft
    }
  }, [])

  const addStatFilter = useCallback(() => {
    if (activeCols.length === 0 && availableToolKeys.length === 0) return
    const defaultKind: 'stat' | 'tool' = activeCols.length > 0 ? 'stat' : 'tool'
    const defaultKey = defaultKind === 'stat' ? activeCols[0].key : availableToolKeys[0]
    setStatFilters(prev => [...prev, { id: ++statFilterIdSeq, kind: defaultKind, key: defaultKey, min: '', max: '' }])
  }, [activeCols, availableToolKeys])
  const removeStatFilter = useCallback((id: number) => {
    setStatFilters(prev => prev.filter(f => f.id !== id))
  }, [])
  const updateStatFilter = useCallback((id: number, field: 'kind'|'key'|'min'|'max', value: string) => {
    setStatFilters(prev => prev.map(f => {
      if (f.id !== id) return f
      if (field === 'kind') {
        const newKey = value === 'stat' ? (activeCols[0]?.key ?? '') : (availableToolKeys[0] ?? '')
        return { ...f, kind: value as 'stat'|'tool', key: newKey, min: '', max: '' }
      }
      return { ...f, [field]: value }
    }))
  }, [activeCols, availableToolKeys])
  const toggleTeam = useCallback((id: string) => setSelectedTeam(prev => prev === id ? '' : id), [])
  const togglePosFilter = useCallback((pos: string) => {
    setSelectedPosFilters(prev => prev.includes(pos) ? prev.filter(x => x !== pos) : [...prev, pos])
  }, [])
  const toggleLevelFilter = useCallback((lev: string) => {
    setSelectedLevelFilters(prev => prev.includes(lev) ? prev.filter(x => x !== lev) : [...prev, lev])
  }, [])
  const handleStatColClick = useCallback((key: string) => {
    if (statSortKey === key) { setStatSortKey(''); setSortMode('rank') }
    else { setStatSortKey(key); setSortMode('stat') }
  }, [statSortKey])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = allPlayers.filter(p => {
      if (q && !p.name?.toLowerCase().includes(q) && !p.team?.toLowerCase().includes(q)) return false
      if (minorsFilter === 'mlb' && minorsIds.has(p.id)) return false
      if (minorsFilter === 'minors' && !minorsIds.has(p.id)) return false
      if (batArmsFilter === 'bats' && isPitcher(p.positions)) return false
      if (batArmsFilter === 'arms' && !isPitcher(p.positions)) return false

      {
        const pOwn = globalOwnership[p.id] || {}
        const isOwnedAnywhere = Object.keys(pOwn).length > 0
        const isMineAnywhere = Object.values(pOwn).includes(MY_TEAM)
        const isOwned = selectedLeague ? !!pOwn[selectedLeague] : isOwnedAnywhere
        const isMine = selectedLeague ? pOwn[selectedLeague] === MY_TEAM : isMineAnywhere
        if (ownFilter === 'mine' && !isMine) return false
        if (ownFilter === 'owned' && !isOwned) return false
        if (ownFilter === 'fa' && isOwned) return false
        if (ownFilter === 'mine+fa' && isOwned && !isMine) return false
      }

      if (selectedTeam && ownFilter !== 'mine+fa') {
        const owner = ownershipMap[p.id]
        if (!(owner && selectedTeam === owner.teamId) && !(selectedTeam === 'FA' && !owner)) return false
      }

      if (!selectedLeague) {
        if (rankMin && (p.rank == null || p.rank < Number(rankMin))) return false
        if (rankMax && (p.rank == null || p.rank > Number(rankMax))) return false
        if (ageMin && (p.age == null || Number(p.age) < Number(ageMin))) return false
        if (ageMax && p.age && Number(p.age) > Number(ageMax)) return false
        if (selectedMlbTeam && p.team !== selectedMlbTeam) return false
        if (selectedPosFilters.length > 0) {
          const playerPos = p.positions?.split(',').map((pos: string) => pos.trim()) || []
          if (!selectedPosFilters.some(sp => playerPos.includes(sp))) return false
        }
        if (selectedLevelFilters.length > 0) {
          if (!selectedLevelFilters.includes(statsMap[p.id]?._level ?? '')) return false
        }
        if (batArmsFilter !== 'all' && statFilters.length > 0) {
          const playerStats = statsMap[p.id]
          const playerTools = playerToolsMap[p.id]
          for (const sf of statFilters) {
            if (sf.kind === 'tool') {
              const val = playerTools?.[sf.key] ?? null
              if (sf.min !== '' && (val == null || val < Number(sf.min))) return false
              if (sf.max !== '' && (val == null || val > Number(sf.max))) return false
            } else {
              const col = activeCols.find(c => c.key === sf.key)
              if (!col) continue
              const val = col.getValue(playerStats)
              if (sf.min !== '' && (val == null || val < Number(sf.min))) return false
              if (sf.max !== '' && (val == null || val > Number(sf.max))) return false
            }
          }
        }
      }
      return true
    })

    if (sortMode === 'tool' && toolSortKey) {
      result = [...result].sort((a, b) => {
        const va = playerToolsMap[a.id]?.[toolSortKey] ?? null
        const vb = playerToolsMap[b.id]?.[toolSortKey] ?? null
        if (va == null && vb == null) return 0
        if (va == null) return 1; if (vb == null) return -1
        return vb - va
      })
    } else if (sortMode === 'stat' && statSortKey && showStatCols) {
      const col = activeCols.find(c => c.key === statSortKey)
      if (col) {
        result = [...result].sort((a, b) => {
          const va = col.getValue(statsMap[a.id])
          const vb = col.getValue(statsMap[b.id])
          if (va == null && vb == null) return 0
          if (va == null) return 1; if (vb == null) return -1
          return col.lowerBetter ? va - vb : vb - va
        })
      }
    } else if (sortMode === 'rank') {
      result = [...result].sort((a, b) => {
        if (a.rank && b.rank) return a.rank - b.rank
        if (a.rank) return -1; if (b.rank) return 1
        return (a.name ?? '').localeCompare(b.name ?? '')
      })
    } else if (sortMode === 'position') {
      result = [...result].sort((a, b) =>
        posOrder(a.positions?.split(',')[0]) - posOrder(b.positions?.split(',')[0]) ||
        (a.rank ?? 9999) - (b.rank ?? 9999)
      )
    }
    return result
  }, [allPlayers, search, minorsFilter, batArmsFilter, ownFilter, selectedLeague, selectedTeam,
      rankMin, rankMax, ageMin, ageMax, selectedMlbTeam, selectedPosFilters, selectedLevelFilters,
      sortMode, statSortKey, toolSortKey, showStatCols, showToolCols, activeCols, statsMap,
      statFilters, minorsIds, ownershipMap, globalOwnership, playerToolsMap, availableToolKeys])

  const grouped = useMemo(() => {
    if (sortMode !== 'position') return []
    const result: { label: string; players: any[] }[] = []
    for (const group of POS_GROUPS) {
      const players = filtered.filter(p => group.positions.includes(p.positions?.split(',')[0]?.trim()))
      if (players.length > 0) result.push({ label: group.label, players })
    }
    const ungrouped = filtered.filter(p => !ALL_POSITIONS.includes(p.positions?.split(',')[0]?.trim()))
    if (ungrouped.length > 0) result.push({ label: 'Other', players: ungrouped })
    return result
  }, [filtered, sortMode])

  const showOwnership = !!selectedLeague && !selectedTeam
  const hasAdvancedFilters = !!(rankMin || rankMax || ageMin || ageMax || selectedPosFilters.length || selectedMlbTeam || selectedLevelFilters.length || statFilters.length)

  const playerColWidth = batArmsFilter === 'all' ? '1fr' : '200px'
  const baseColDef = showExtraCol
    ? (showOwnership ? `28px 44px 90px ${playerColWidth} 52px 36px 40px 1fr` : `28px 44px 90px ${playerColWidth} 52px 36px 40px`)
    : (showOwnership ? '28px 44px 90px 1fr 52px 36px 1fr' : '28px 44px 90px 1fr 52px 36px')
  const statColDef = showStatCols ? activeCols.map(() => '64px').join(' ') + (batArmsFilter === 'all' ? ' 56px' : '') : showToolCols ? activeToolKeys.map(() => '56px').join(' ') : batArmsFilter === 'all' ? '56px' : ''
  const cols = [baseColDef, statColDef].filter(Boolean).join(' ')

  const baseHeaders = showExtraCol
    ? (showOwnership ? ['#','CONS RK','POS','PLAYER','TEAM','AGE','LEV','OWNED BY'] : ['#','CONS RK','POS','PLAYER','TEAM','AGE','LEV'])
    : (showOwnership ? ['#','CONS RK','POS','PLAYER','TEAM','AGE','OWNED BY'] : ['#','CONS RK','POS','PLAYER','TEAM','AGE'])

  const sortOptions: { val: SortMode; label: string }[] = [{ val: 'rank', label: 'Rank' }]
  if (selectedTeam) sortOptions.push({ val: 'position', label: 'Position' })

  // Virtualized row renderer
  const VirtualRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const player = filtered[index]
    if (!player) return null
    return (
      <div key={index} style={style}>
        <PlayerRow
          displayRank={index + 1}
          batArmsFilter={batArmsFilter}
          player={player}
          stats={statsMap[player.id]}
          statLine={statLineMap[player.id] ?? ''}
          tools={playerToolsMap[player.id]}
          isMinors={minorsIds.has(player.id)}
          owner={ownershipMap[player.id]}
          pOwnership={globalOwnership[player.id] ?? {}}
          cols={cols}
          showExtraCol={showExtraCol}
          showOwnership={showOwnership}
          showStatCols={showStatCols}
          showToolCols={showToolCols}
          activeCols={activeCols}
          activeToolKeys={activeToolKeys}
          statSortKey={statSortKey}
          toolSortKey={toolSortKey}
          TOOL_LABELS={TOOL_LABELS}
          onClick={() => setSelectedPlayer(player)}
        />
      </div>
    )
  }, [filtered, statsMap, statLineMap, playerToolsMap, minorsIds, ownershipMap, globalOwnership,
      cols, showExtraCol, showOwnership, showStatCols, showToolCols, activeCols, activeToolKeys,
      statSortKey, toolSortKey])

  return (
    <div style={{ padding: '2rem' }}>
      {/* League */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginRight: 4 }}>League</span>
        <button onClick={() => setSelectedLeague('')} style={btn(selectedLeague === '')}>All</button>
        {LEAGUES.map(l => <button key={l.id} onClick={() => setSelectedLeague(selectedLeague === l.id ? '' : l.id)} style={btn(selectedLeague === l.id)}>{l.label}</button>)}
      </div>

      {/* Team */}
      {selectedLeague && leagueTeams.length > 0 && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginRight: 4 }}>Team</span>
          <button onClick={() => toggleTeam('FA')} style={btn(selectedTeam === 'FA')}>Free Agents</button>
          {leagueTeams.map(t => <button key={t.id} onClick={() => toggleTeam(t.id)} style={btn(selectedTeam === t.id, t.name === MY_TEAM)}>{t.name}</button>)}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search players..."
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.4rem 0.75rem', color: 'var(--text)', fontSize: '0.875rem', outline: 'none', width: 200 }} />

        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>Sort</span>
          {sortOptions.map(opt => (
            <button key={opt.val} onClick={() => { setSortMode(opt.val); setStatSortKey('') }} style={btn(sortMode === opt.val && statSortKey === '')}>{opt.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: '0.5rem' }}>
          {([{ val: 'all', label: 'All' }, { val: 'mine', label: 'Mine' }, { val: 'owned', label: 'Owned' }, { val: 'fa', label: 'FA' }, { val: 'mine+fa', label: 'Mine+FA' }] as { val: OwnFilter; label: string }[]).map(opt => (
            <button key={opt.val} onClick={() => setOwnFilter(opt.val)} style={btn(ownFilter === opt.val)}>{opt.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: '0.5rem' }}>
          {([{ val: 'all', label: 'All' }, { val: 'mlb', label: 'MLB' }, { val: 'minors', label: 'Minors' }] as { val: MinorsFilter; label: string }[]).map(opt => (
            <button key={opt.val} onClick={() => setMinorsFilter(opt.val)} style={btn(minorsFilter === opt.val)}>{opt.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: '0.5rem' }}>
          {([{ val: 'all', label: 'All' }, { val: 'bats', label: 'Bats' }, { val: 'arms', label: 'Arms' }] as { val: BatArmsFilter; label: string }[]).map(opt => (
            <button key={opt.val} onClick={() => setBatArmsFilter(opt.val)} style={btn(batArmsFilter === opt.val)}>{opt.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, marginLeft: '0.5rem' }}>
          {([{ val: 'stats', label: 'Stats' }, { val: 'tools', label: 'Tools' }] as { val: DataView; label: string }[]).map(opt => (
            <button key={opt.val} onClick={() => { setDataView(opt.val); setStatSortKey(''); setToolSortKey('') }} style={btn(dataView === opt.val)}>{opt.label}</button>
          ))}
        </div>

        <span style={{ color: 'var(--muted)', fontSize: '0.8rem', marginLeft: 'auto' }}>{filtered.length.toLocaleString()} players</span>
      </div>

      {/* Advanced Filters */}
      {!selectedLeague && (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', alignSelf: 'center' }}>Filters</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>RANK:</span>
            <input type="number" placeholder="Min" value={rankMin} onChange={e => setRankMin(e.target.value)} style={advInputStyle} />
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>-</span>
            <input type="number" placeholder="Max" value={rankMax} onChange={e => setRankMax(e.target.value)} style={advInputStyle} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>AGE:</span>
            <input type="number" placeholder="Min" value={ageMin} onChange={e => setAgeMin(e.target.value)} style={advInputStyle} />
            <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>-</span>
            <input type="number" placeholder="Max" value={ageMax} onChange={e => setAgeMax(e.target.value)} style={advInputStyle} />
          </div>

          <div style={{ position: 'relative' }}>
            <button onClick={() => setPosDropdownOpen(!posDropdownOpen)}
              style={{ ...advInputStyle, width: 'auto', cursor: 'pointer', background: selectedPosFilters.length ? 'rgba(59,130,246,0.1)' : 'var(--bg-card)', borderColor: selectedPosFilters.length ? '#3b82f6' : 'var(--border)' }}>
              Positions {selectedPosFilters.length > 0 && `(${selectedPosFilters.length})`}
            </button>
            {posDropdownOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', minWidth: '180px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)' }}>
                {availablePositions.map(pos => (
                  <label key={pos} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selectedPosFilters.includes(pos)} onChange={() => togglePosFilter(pos)} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                    {pos}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button onClick={() => setLevelDropdownOpen(!levelDropdownOpen)}
              style={{ ...advInputStyle, width: 'auto', cursor: 'pointer', background: selectedLevelFilters.length ? 'rgba(59,130,246,0.1)' : 'var(--bg-card)', borderColor: selectedLevelFilters.length ? '#3b82f6' : 'var(--border)' }}>
              Level {selectedLevelFilters.length > 0 && `(${selectedLevelFilters.length})`}
            </button>
            {levelDropdownOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: '100px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)' }}>
                {LEVEL_OPTIONS.map(lev => (
                  <label key={lev} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selectedLevelFilters.includes(lev)} onChange={() => toggleLevelFilter(lev)} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                    {lev}
                  </label>
                ))}
              </div>
            )}
          </div>

          <select value={selectedMlbTeam} onChange={e => setSelectedMlbTeam(e.target.value)} style={{ ...advInputStyle, width: 'auto', cursor: 'pointer' }}>
            <option value="">All MLB Teams</option>
            {mlbTeams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {batArmsFilter !== 'all' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
              {statFilters.map(sf => (
                <div key={sf.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <select value={sf.kind} onChange={e => updateStatFilter(sf.id, 'kind', e.target.value)} style={{ ...advInputStyle, width: 'auto' }}>
                    {activeCols.length > 0 && <option value="stat">Stat</option>}
                    {availableToolKeys.length > 0 && <option value="tool">Tool</option>}
                  </select>
                  <select value={sf.key} onChange={e => updateStatFilter(sf.id, 'key', e.target.value)} style={{ ...advInputStyle, width: 'auto' }}>
                    {sf.kind === 'stat'
                      ? activeCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)
                      : availableToolKeys.map(k => <option key={k} value={k}>{TOOL_LABELS[k] ?? k}</option>)
                    }
                  </select>
                  <input type="number" placeholder="Min" value={sf.min} onChange={e => updateStatFilter(sf.id, 'min', e.target.value)} style={advInputStyle} />
                  <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>–</span>
                  <input type="number" placeholder="Max" value={sf.max} onChange={e => updateStatFilter(sf.id, 'max', e.target.value)} style={advInputStyle} />
                  <button onClick={() => removeStatFilter(sf.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>✕</button>
                </div>
              ))}
              <button onClick={addStatFilter} style={{ ...advInputStyle, width: 'auto', cursor: 'pointer', color: 'var(--accent)', borderColor: 'var(--accent)', background: 'rgba(34,197,94,0.05)' }}>
                + Add Stat Filter
              </button>
            </div>
          )}

          {hasAdvancedFilters && (
            <button onClick={() => { setRankMin(''); setRankMax(''); setAgeMin(''); setAgeMax(''); setSelectedPosFilters([]); setSelectedMlbTeam(''); setSelectedLevelFilters([]); setStatFilters([]) }}
              style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '0.7rem', fontFamily: 'var(--font-display)', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', marginLeft: 'auto', alignSelf: 'flex-start' }}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Mobile list */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Mobile header */}
          <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 44px', gap: '0.4rem', padding: '0.2rem 0rem', marginBottom: '0.25rem', borderBottom: '1px solid var(--border)' }}>
            {['RK','PLAYER','OVR+'].map((h, i) => (
              <div key={i} style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.58rem', letterSpacing: '0.08em', color: 'var(--muted)', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</div>
            ))}
          </div>
          {loading ? <div style={{ color: 'var(--muted)', padding: '1rem 0' }}>Loading...</div> : filtered.slice(0, mobileLimit).map((p, i) => {
            const pOwn = globalOwnership[p.id] || {}
            const myTeamOwned = Object.values(pOwn).includes(MY_TEAM)
            const tools = playerToolsMap[p.id]
            const ovr = tools?.overall ?? null
            const s = statsMap[p.id]
            const level = s?._level ?? p.level ?? '—'
            return (
              <div key={p.id} onClick={() => setSelectedPlayer(p)} style={{
                display: 'grid', gridTemplateColumns: '36px 1fr 44px', gap: '0.4rem',
                padding: '0.5rem 0rem', borderBottom: '1px solid rgba(48,54,61,0.4)',
                alignItems: 'center', cursor: 'pointer',
                borderLeft: myTeamOwned ? '2px solid #f59e0b' : '2px solid transparent',
                marginLeft: myTeamOwned ? '-2px' : '0',
                background: myTeamOwned ? 'rgba(245,158,11,0.04)' : 'transparent',
              }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.65rem', color: 'rgba(100,100,100,0.5)' }}>{p.rank ?? '—'}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', overflow: 'hidden' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.82rem', color: myTeamOwned ? '#f59e0b' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{p.name}</span>
                    {minorsIds.has(p.id) && <span style={{ color: '#4ade80', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.62rem', flexShrink: 0 }}>M</span>}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 600, marginBottom: '1px' }}>
                    {[p.positions?.split(',')[0]?.trim(), p.team, level].filter(Boolean).join(' · ')}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {statLineMap[p.id] || '—'}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.82rem', color: ovr == null ? 'rgba(100,100,100,0.35)' :
                  ovr >= 130 ? '#ef4444' : ovr >= 115 ? '#fca5a5' : ovr >= 95 ? 'var(--text)' : ovr >= 80 ? '#93c5fd' : '#3b82f6',
                  textAlign: 'right' }}>{ovr ?? '—'}</div>
              </div>
            )
          })}
          {!loading && filtered.length > mobileLimit && (
            <button onClick={() => setMobileLimit(n => n + 75)} style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.06em', cursor: 'pointer' }}>
              LOAD MORE ({filtered.length - mobileLimit} remaining)
            </button>
          )}
        </div>
      ) : (
      <>
      {/* One scroll container — header + rows together */}
      <div ref={hdrRef} style={{ overflowX: 'scroll', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', scrollbarWidth: 'none' } as any}>
        {!mounted ? null : (
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: '0.5rem', padding: '0.2rem 0.5rem', marginBottom: '0.25rem', marginLeft: '-0.5rem', minWidth: showExtraCol ? 'max-content' : undefined }}>
          {baseHeaders.map((h, i) => {
            const stickyLeft = i === 0 ? 0 : i === 1 ? 28 : i === 2 ? 72 : i === 3 ? 162 : undefined
            const isSticky = stickyLeft !== undefined
            return (
              <div key={i} style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.08em', color: 'var(--muted)', ...(isSticky ? { position: 'sticky', left: stickyLeft, background: 'var(--bg)', zIndex: 3 } : {}) }}>{h}</div>
            )
          })}
          {showStatCols && activeCols.map(col => (
            <div key={col.key} onClick={() => handleStatColClick(col.key)} style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.08em', color: statSortKey === col.key ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', textAlign: 'right', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
              {col.label}{statSortKey === col.key && <span style={{ fontSize: '0.55rem' }}>{col.lowerBetter ? '▲' : '▼'}</span>}
            </div>
          ))}
          {batArmsFilter === 'all' && !showToolCols && (
            <div onClick={() => { if (toolSortKey === 'overall') { setToolSortKey(''); setSortMode('rank') } else { setToolSortKey('overall'); setSortMode('tool') } }} style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.08em', color: toolSortKey === 'overall' ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', textAlign: 'right', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
              OVR+{toolSortKey === 'overall' && <span style={{ fontSize: '0.55rem' }}>▼</span>}
            </div>
          )}
          {showToolCols && activeToolKeys.map(key => (
            <div key={key} onClick={() => { if (toolSortKey === key) { setToolSortKey(''); setSortMode('rank') } else { setToolSortKey(key); setSortMode('tool') } }} style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.08em', color: toolSortKey === key ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', textAlign: 'right', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px' }}>
              {TOOL_LABELS[key] ?? key}{toolSortKey === key && <span style={{ fontSize: '0.55rem' }}>▼</span>}
            </div>
          ))}
        </div>
        )}
      </div>
      <div style={{ overflowX: showExtraCol ? 'auto' : 'visible' }}>
        {loading ? (
          <div style={{ color: 'var(--muted)' }}>Loading...</div>
        ) : sortMode === 'position' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: showStatCols ? 'max-content' : undefined }}>
            {grouped.map((group, gi) => (
              <div key={gi}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.7rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', paddingBottom: '0.3rem', marginBottom: '0.3rem' }}>
                  {group.label} <span style={{ opacity: 0.4, fontWeight: 400 }}>({group.players.length})</span>
                </div>
                {group.players.map((p, gi2) => (
                  <PlayerRow
                    key={p.id}
                    displayRank={filtered.indexOf(p) + 1}
                    batArmsFilter={batArmsFilter}
                    player={p}
                    stats={statsMap[p.id]}
                    statLine={statLineMap[p.id] ?? ''}
                    tools={playerToolsMap[p.id]}
                    isMinors={minorsIds.has(p.id)}
                    owner={ownershipMap[p.id]}
                    pOwnership={globalOwnership[p.id] ?? {}}
                    cols={cols}
                    showExtraCol={showExtraCol}
                    showOwnership={showOwnership}
                    showStatCols={showStatCols}
                    showToolCols={showToolCols}
                    activeCols={activeCols}
                    activeToolKeys={activeToolKeys}
                    statSortKey={statSortKey}
                    toolSortKey={toolSortKey}
                    TOOL_LABELS={TOOL_LABELS}
                    onClick={() => setSelectedPlayer(p)}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <List
            ref={listRef}
            height={window !== undefined ? Math.max(400, (typeof window !== 'undefined' ? window.innerHeight : 800) - 320) : 600}
            itemCount={filtered.length}
            itemSize={ROW_HEIGHT}
            width="100%"
            style={{ minWidth: showExtraCol ? 'max-content' : undefined }}
            onHScroll={syncScroll}
          >
            {VirtualRow}
          </List>
        )}
      </div>
      </>
      )}

      {selectedPlayer && (
        <PlayerDrawer
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          globalOwnership={globalOwnership}
          minorsIds={minorsIds}
          mlbToolsMap={mlbToolsMap}
          statsMap={statsMap}
          allPlayers={allPlayers}
        />
      )}
    </div>
  )
}
