'use client'
import { fmtLevel } from '@/lib/players-config'
import React, { useState, useEffect, useMemo } from 'react'
import { StatcastPanel, parseStatcastCSV } from './StatcastPanel'
import { isPitcher, cleanPositions, toolColor, LEAGUES, MY_TEAM } from '../../lib/players-config'
import { sportAbbrToLevel, isMlbLevel, levelSortVal, sumBatStats, sumPitchStats, calcKPct, calcBBPct, stripLeadingZero } from '../../lib/drawer-utils'
// @ts-ignore -- CommonJS shared module (see lib/score-tools.js)
import { scoreMilbTool, scoreMlbTool, blendCareer } from '../../lib/score-tools'

const LEVEL_ORDER = ['ROK','A','Single-A','A+','High-A','AA','AAA','MLB','Other']

function StatCell({ val, bold }: { val: any; bold?: boolean }) {
  const display = stripLeadingZero(val)
  return (
    <td style={{ padding:'0.3rem 0.45rem', textAlign:'right', fontSize:'0.76rem', fontFamily:'var(--font-display)', fontWeight:bold?700:500, color:display==='—'?'rgba(100,100,100,0.3)':'var(--text)', whiteSpace:'nowrap' }}>{display}</td>
  )
}

function LabelCell({ label, bold, muted, color }: { label: string; bold?: boolean; muted?: boolean; color?: string }) {
  return (
    <td style={{ padding:'0.3rem 0.45rem', fontSize:'0.76rem', fontFamily:'var(--font-display)', fontWeight:bold?700:500, color:color??(bold?'var(--accent)':muted?'var(--muted)':'var(--text)'), whiteSpace:'nowrap' }}>{label}</td>
  )
}

function SectionHeader({ title, extra }: { title: string; extra?: React.ReactNode }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', margin:'2rem 0 0.75rem', paddingBottom:'0.4rem', borderBottom:'1px solid var(--border)' }}>
      <div style={{ fontFamily:'var(--font-display)', fontWeight:700, fontSize:'0.68rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--muted)' }}>{title}</div>
      {extra}
    </div>
  )
}

function ToolArcChart({ points, isPitcher, dateMode }: { points: any[]; isPitcher: boolean; dateMode?: boolean }) {
  const [tooltip, setTooltip] = React.useState<{x:number,y:number,pt:any}|null>(null)
  if (!points.length) return null
  const tools = isPitcher
    ? [{ key:'overall', label:'OVR+', color:'#f59e0b', bold:true },{ key:'stuff', label:'Stuff+', color:'#60a5fa', bold:false },{ key:'control', label:'Ctrl+', color:'#34d399', bold:false }]
    : [{ key:'overall', label:'OVR+', color:'#f59e0b', bold:true },{ key:'hit', label:'Hit+', color:'#22d3ee', bold:false },{ key:'power', label:'Pwr+', color:'#fb923c', bold:false },{ key:'speed', label:'Spd+', color:'#4ade80', bold:false }]

  const W = 560, H = 190, PL = 36, PR = 16, PT = 16, PB = 28
  const chartW = W - PL - PR, chartH = H - PT - PB

  // dynamic Y range
  const allVals = points.flatMap((p: any) => tools.map(t => p[t.key]).filter((v:any) => v != null)) as number[]
  const dataMin = Math.min(...allVals), dataMax = Math.max(...allVals)
  const YMIN = Math.floor((Math.min(dataMin, 88) - 4) / 5) * 5
  const YMAX = Math.ceil((Math.max(dataMax, 110) + 4) / 5) * 5
  const tickStep = (YMAX - YMIN) <= 30 ? 5 : 10
  const yTicks = Array.from({ length: Math.floor((YMAX - YMIN) / tickStep) + 1 }, (_,i) => YMIN + i * tickStep)

  const xLabels = points.map((p: any) => dateMode ? (p.date ?? `${p.year}`) : `${p.year} ${p.level}`)
  const xScale = (i: number) => PL + (i / Math.max(xLabels.length - 1, 1)) * chartW
  const yScale = (v: number) => PT + chartH - ((v - YMIN) / (YMAX - YMIN)) * chartH

  // First MLB point index for lime green shading
  const firstMlbIdx = points.findIndex((p:any) => p.level === 'MLB')

  return (
    <div style={{overflowX:'auto',position:'relative'}}>
      <svg width={W} height={H} style={{fontFamily:'var(--font-display)',display:'block'}}
        onMouseLeave={() => setTooltip(null)}>
        <defs>
          <pattern id='mlbHatch' patternUnits='userSpaceOnUse' width={8} height={8} patternTransform='rotate(45)'>
            <line x1={0} y1={0} x2={0} y2={8} stroke='rgba(132,204,22,0.12)' strokeWidth={2.5}/>
          </pattern>
        </defs>
        {/* diagonal hatch — only actual MLB-level segments */}
        {(() => {
          const step = chartW / Math.max(points.length - 1, 1)
          const segs: {x:number,w:number}[] = []
          let i = 0
          while (i < points.length) {
            if (points[i].level === 'MLB') {
              const start = i
              while (i < points.length && points[i].level === 'MLB') i++
              const end = i - 1
              const x = Math.max(PL, xScale(start) - step / 2)
              const x2 = Math.min(PL + chartW, xScale(end) + step / 2)
              segs.push({ x, w: x2 - x })
            } else { i++ }
          }
          return segs.map((s, ri) => (
            <rect key={ri} x={s.x} y={PT} width={s.w} height={chartH} fill='url(#mlbHatch)'/>
          ))
        })()}
        {/* score bands */}
        {[
          { lo: 130, hi: 999, color: 'rgba(239,68,68,0.08)' },
          { lo: 115, hi: 130, color: 'rgba(252,165,165,0.07)' },
          { lo: 95,  hi: 115, color: 'rgba(255,255,255,0.02)' },
          { lo: 80,  hi: 95,  color: 'rgba(147,197,253,0.06)' },
          { lo: 0,   hi: 80,  color: 'rgba(59,130,246,0.08)' },
        ].map(({lo,hi,color}) => {
          const y1 = yScale(Math.min(hi, YMAX))
          const y2 = yScale(Math.max(lo, YMIN))
          if (y2 <= y1) return null
          return <rect key={lo} x={PL} y={y1} width={chartW} height={y2-y1} fill={color}/>
        })}
        {yTicks.map(y => (
          <g key={y}>
            <line x1={PL} x2={W-PR} y1={yScale(y)} y2={yScale(y)} stroke='rgba(255,255,255,0.04)' strokeWidth={1}/>
            <text x={PL-4} y={yScale(y)+3} textAnchor='end' fontSize={9} fill='rgba(150,150,150,0.4)'>{y}</text>
          </g>
        ))}
        <line x1={PL} x2={W-PR} y1={yScale(100)} y2={yScale(100)} stroke='rgba(255,255,255,0.12)' strokeWidth={1} strokeDasharray='3,3'/>
        {tools.map(({ key, color, bold }) => {
          const validPts = points.filter((p: any) => p[key] != null)
          if (validPts.length < 1) return null
          const pts2 = validPts.map((p: any, _i: number) => {
            const xi = points.indexOf(p)
            return [xScale(xi), yScale(p[key])]
          })
          const d = pts2.map((p: any, i: number) => `${i===0?'M':'L'}${p[0]},${p[1]}`).join(' ')
          return (
            <g key={key}>
              <path d={d} fill='none' stroke={color} strokeWidth={bold?2.5:1.5} strokeOpacity={bold?1:0.7}/>
            </g>
          )
        })}
        {points.map((pt: any, i: number) => (
          <g key={i} style={{cursor:'pointer'}}
            onMouseEnter={e => {
              const svg = (e.currentTarget as SVGElement).closest('svg')!
              const rect = svg.getBoundingClientRect()
              const cx = xScale(i)
              const cy = yScale(pt.overall ?? pt.stuff ?? pt.hit ?? 0)
              setTooltip({ x: cx, y: cy, pt })
            }}>
            <circle cx={xScale(i)} cy={yScale(0)+9999} r={12} fill='transparent'/>
            <line x1={xScale(i)} x2={xScale(i)} y1={PT} y2={H-PB} stroke='rgba(255,255,255,0)' strokeWidth={16}
              onMouseEnter={e => {
                setTooltip({ x: xScale(i), y: H/2, pt })
              }}/>
            {tools.filter(({bold})=>bold).map(({ key, color }) => pt[key] != null && (
              <circle key={key} cx={xScale(i)} cy={yScale(pt[key])} r={1.5} fill={color} fillOpacity={0.5}/>
            ))}
          </g>
        ))}
        {dateMode ? (() => {
          const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
          const markers: any[] = []
          const levelChanges: any[] = []
          points.forEach((pt:any, i:number) => {
            const prev = points[i-1]
            const newYear = !prev || pt.year !== prev.year
            const newLevel = !prev || pt.level !== prev.level
            const newMonth = !prev || pt.date?.slice(0,7) !== prev.date?.slice(0,7)
            if (newYear) markers.push({i, lbl: String(pt.year), strong: true, divider: i>0})
            else if (newMonth && points.length < 300) {
              const mo = pt.date ? parseInt(pt.date.slice(5,7),10)-1 : -1
              markers.push({i, lbl: mo>=0?MONTH_ABBR[mo]:'', strong: false, divider: false})
            }
            if (newLevel) levelChanges.push({i, lbl: pt.level})
          })
          return <>
            {markers.map(({i,lbl,strong,divider}:{i:number,lbl:string,strong:boolean,divider:boolean}) => (
              <g key={'m'+i}>
                {divider && <line x1={xScale(i)} x2={xScale(i)} y1={PT} y2={H-PB} stroke='rgba(255,255,255,0.08)' strokeWidth={1} strokeDasharray='3,3'/>}
                <text x={xScale(i)} y={H-6} textAnchor='middle' fontSize={strong?9:7.5} fontWeight={strong?700:400} fill={strong?'rgba(200,200,200,0.6)':'rgba(120,120,120,0.4)'}>{lbl}</text>
              </g>
            ))}
            {levelChanges.map(({i,lbl}:{i:number,lbl:string}) => (
              <g key={'l'+i}>
                <line x1={xScale(i)} x2={xScale(i)} y1={PT} y2={H-PB} stroke='rgba(168,85,247,0.35)' strokeWidth={1} strokeDasharray='2,4'/>
                <text x={xScale(i)+3} y={PT+10} textAnchor='start' fontSize={7.5} fill='rgba(168,85,247,0.7)'>{lbl}</text>
              </g>
            ))}
          </>
        })() : xLabels.map((lbl, i) => (
          <text key={i} x={xScale(i)} y={H-6} textAnchor='middle' fontSize={8.5} fill='rgba(150,150,150,0.6)'>{lbl as string}</text>
        ))}
      </svg>
      {tooltip && (
        <div style={{
          position:'absolute', left: tooltip.x + 8, top: 8, pointerEvents:'none',
          background:'rgba(15,20,30,0.95)', border:'1px solid var(--border)', borderRadius:6,
          padding:'0.4rem 0.6rem', fontSize:'0.7rem', fontFamily:'var(--font-display)',
          zIndex:10, minWidth:100, boxShadow:'0 4px 12px rgba(0,0,0,0.5)'
        }}>
          <div style={{fontWeight:700,color:'var(--accent)',marginBottom:'0.25rem'}}>{dateMode ? `${tooltip.pt.date} · ${tooltip.pt.level??''}` : `${tooltip.pt.year} · ${tooltip.pt.level}`}</div>
          {tools.map(({ key, label, color }) => tooltip.pt[key] != null && (
            <div key={key} style={{display:'flex',justifyContent:'space-between',gap:'0.75rem',color}}>
              <span style={{opacity:0.8}}>{label}</span>
              <span style={{fontWeight:700}}>{tooltip.pt[key]}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex',gap:'1rem',marginTop:'0.25rem',flexWrap:'wrap'}}>
        {tools.map(({ key, label, color, bold }) => (
          <div key={key} style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <div style={{width:bold?16:12,height:bold?2.5:1.5,background:color,borderRadius:2,opacity:bold?1:0.7}}/>
            <span style={{fontSize:'0.65rem',fontFamily:'var(--font-display)',color:'rgba(150,150,150,0.7)',fontWeight:bold?700:500}}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ARC_AVG_AGES: Record<string,number> = {
  'ACL':17.9,'FCL':17.9,'DSL':17.9,'Complex':19.9,'Rookie':20.4,'Single-A':21.3,'High-A':22.6,'AA':24.0,'AAA':26.4
}
const ARC_K: Record<string,number> = { k_pct:60, bb_pct:120, iso:120, sb_rate:60, k_pct_pit:20, bb_pct_pit:40 }

export function PlayerDrawer({ player, onClose, globalOwnership, minorsIds, mlbToolsMap, statsMap, allPlayers, regression, norms, poolStats }: {
  player: any; onClose: () => void; globalOwnership: Record<string, Record<string, string>>
  minorsIds: Set<string>; mlbToolsMap: Record<string, any>; statsMap: Record<string, any>; allPlayers: any[]
  regression?: any; norms?: any; poolStats?: any
}) {
  const [bio, setBio] = useState<any>(null)
  const [rankAppearances, setRankAppearances] = useState<any[]>([])
  const [allSplits, setAllSplits] = useState<any[]>([])
  const [situSplits, setSituSplits] = useState<any[]>([])
  const [careerSituSplits, setCareerSituSplits] = useState<any[]>([])
  const [gameLogs, setGameLogs] = useState<any[]>([])
  const [statcastRows, setStatcastRows] = useState<any[]>([])
  const [allGameLogs, setAllGameLogs] = useState<Record<number,{hitting:any[],pitching:any[]}>>({})
  const [drawerLoading, setDrawerLoading] = useState(true)
  const [extraLoading, setExtraLoading] = useState(true)
  const [statcastLoading, setStatcastLoading] = useState(true)
  const [error, setError] = useState('')
  const [showMinors, setShowMinors] = useState(true)
  const [activeTab, setActiveTab] = useState<'stats'|'statcast'>('stats')
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set())
  const [twoWaySide, setTwoWaySide] = useState<'hit'|'pitch'>('pitch')
  const [arcMode, setArcMode] = useState<'milb'|'mlb'|'full'>('full')

  const posList = (player.positions || '').split(',').map((p: string) => p.trim())
  const hasArm = posList.some((p: string) => ['SP','RP','P'].includes(p))
  const hasBat = posList.some((p: string) => !['SP','RP','P'].includes(p))
  const isTwoWayPlayer = hasArm && hasBat
  const pitch = isTwoWayPlayer ? twoWaySide === 'pitch' : isPitcher(player.positions)
  const mlbamId = player.mlbam_id
  const pOwnership = globalOwnership[player.id] || {}
  const isMinors = minorsIds.has(player.id)
  const primaryPos = player.positions?.split(',')[0]?.trim()

  const posRank = useMemo(() => {
    if (!player.rank || !primaryPos) return null
    const samePos = allPlayers.filter(p => p.rank!=null && p.positions?.split(',')[0]?.trim()===primaryPos).sort((a,b)=>a.rank-b.rank)
    const idx = samePos.findIndex(p => p.id===player.id)
    return idx>=0 ? idx+1 : null
  }, [allPlayers, player.id, player.rank, primaryPos])

  const minorsRank = useMemo(() => {
    if (!isMinors || !player.rank) return null
    const ranked = allPlayers.filter(p => minorsIds.has(p.id) && p.rank!=null).sort((a,b)=>a.rank-b.rank)
    const idx = ranked.findIndex(p => p.id===player.id)
    return idx>=0 ? idx+1 : null
  }, [allPlayers, player.id, player.rank, isMinors, minorsIds])

  const minorsPosRank = useMemo(() => {
    if (!isMinors || !player.rank || !primaryPos) return null
    const ranked = allPlayers.filter(p => minorsIds.has(p.id) && p.rank!=null && p.positions?.split(',')[0]?.trim()===primaryPos).sort((a,b)=>a.rank-b.rank)
    const idx = ranked.findIndex(p => p.id===player.id)
    return idx>=0 ? idx+1 : null
  }, [allPlayers, player.id, player.rank, isMinors, minorsIds, primaryPos])

  // Career grade — single source of truth from build-scores.js#career_blend.
  // Fallback to live blendCareer for any player the pipeline hasn't blended yet.
  const toolGrades = useMemo(() => {
    if (player.career_blend) return player.career_blend
    const mlbEntry = mlbamId ? mlbToolsMap[String(mlbamId)] : null
    const model = player.model_scores
    return blendCareer(model ?? null, mlbEntry ?? null)
  }, [player.career_blend, mlbamId, mlbToolsMap, player.model_scores])



  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key==='Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    if (!mlbamId) { setDrawerLoading(false); setExtraLoading(false); return }
    setDrawerLoading(true); setExtraLoading(true); setError('')
    setRankAppearances([])
    fetch(`/api/rankings/player?name=${encodeURIComponent(player.name)}`).then(r=>r.json()).then(d=>setRankAppearances(d.appearances??[])).catch(()=>{})
    Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}?hydrate=currentTeam`).then(r=>r.json()),
      fetch(`/api/stats/history/${mlbamId}`).then(r=>r.json()),
    ]).then(([peopleData,histData]) => {
      // fetch game logs for all years directly from MLB API (both MLB + MiLB, both groups for two-way)
      const histYears = Array.from(new Set((histData.splits??[]).map((s:any)=>parseInt(s.season??'0')).filter((y:number)=>y>=2015))).sort() as number[]
      const currentYear = new Date().getFullYear()
      if (!histYears.includes(currentYear)) histYears.push(currentYear)
      const dedup = (splits: any[]) => {
        const seen = new Set<string>()
        return splits.filter(s => {
          // Dedup on gamePk (unique per game): keeps doubleheaders distinct, while the same
          // game returned by BOTH the MLB and MiLB fetches still collapses. The old date|opponent
          // key wrongly merged two-games-one-day, undercounting AB/SO/etc.
          const key = String(s.game?.gamePk ?? ((s.date??'')+'|'+(s.opponent?.abbreviation??s.opponent?.name??s.opponent?.id??'')))
          if (seen.has(key)) return false
          seen.add(key); return true
        })
      }
      const flattenLog = (data: any) => data?.stats?.[0]?.splits ?? []
      const fetchGroupYear = async (group: string, yr: number): Promise<any[]> => {
        const base = `https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&season=${yr}&group=${group}&gameType=R`
        const [mlbRes, milbRes] = await Promise.all([
          fetch(base).then(r=>r.ok?r.json():{}).catch(()=>({})),
          fetch(base+'&leagueListId=milb_all').then(r=>r.ok?r.json():{}).catch(()=>({})),
        ])
        return dedup([...flattenLog(mlbRes), ...flattenLog(milbRes)]).map(s => ({
          date: s.date,
          opponent: s.opponent,
          isHome: s.isHome,
          // DSL returns the generic "ROK" sport abbreviation; pin it via league name so it
          // scores against DSL norms/slopes — normLevel would otherwise map ROK → Complex.
          level: /Dominican Summer/i.test(s.league?.name ?? '')
            ? 'DSL'
            : (s.sport?.abbreviation ?? s.team?.sport?.abbreviation ?? null),
          ...s.stat,
        }))
      }
      // fetch all years in parallel; always fetch both groups so BAT/ARM toggle works without refetch
      Promise.all(histYears.map(async (yr: number) => {
        const [hitting, pitching] = await Promise.all([
          fetchGroupYear('hitting', yr),
          fetchGroupYear('pitching', yr),
        ])
        return { yr, hitting, pitching }
      })).then(results => {
        const logs: Record<number,{hitting:any[],pitching:any[]}> = {}
        for (const { yr, hitting, pitching } of results) logs[yr] = { hitting, pitching }
        setAllGameLogs(logs)
      })
      setBio(peopleData.people?.[0]??null)
      const splits = (histData.splits ?? [])
        .filter((s:any) => s.type === (pitch ? 'pitching' : 'hitting'))
        // re-filter when twoWaySide changes (pitch derived from twoWaySide above)
        .map((s:any) => ({
          season: s.season,
          team: { name: s.team, abbreviation: s.team },
          sport: { id: s.sportId, abbreviation: s.level },
          _level: s.level,
          stat: {
            gamesPlayed: s.g,
            // batting
            plateAppearances: s.pa,
            atBats: s.ab,
            hits: s.h,
            doubles: s.doubles,
            triples: s.triples,
            homeRuns: s.hr,
            runs: s.r,
            rbi: s.rbi,
            stolenBases: s.sb,
            caughtStealing: s.cs,
            totalBases: s.tb,
            strikeOuts: s.so,
            baseOnBalls: s.bb,
            avg: s.avg,
            obp: s.obp,
            slg: s.slg,
            ops: s.ops,
            // pitching
            wins: s.w,
            losses: s.l,
            inningsPitched: s.ip,
            era: s.era,
            whip: s.whip,
            earnedRuns: s.er,
            battersFaced: s.bf,
            hitByPitch: s.hbp,
            saves: s.sv,
            blownSaves: s.bs,
            holds: s.hld,
            oAvg: s.baa,
            gamesStarted: s.gs,
          },
        }))
      splits.sort((a:any,b:any)=>(a.season??'').localeCompare(b.season??''))
      setAllSplits(splits); setDrawerLoading(false)
    }).catch(()=>{setError('Failed to load player data.');setDrawerLoading(false);setExtraLoading(false)})
  }, [mlbamId, pitch])

  useEffect(() => {
    if (allSplits.length===0) return
    const seasons=Array.from(new Set(allSplits.map((s:any)=>s.season))).sort()
    const mostRecent=seasons[seasons.length-1]
    if (mostRecent) setExpandedYears(new Set([mostRecent]))
  }, [allSplits])

  useEffect(() => {
    if (!mlbamId||drawerLoading) return
    const group=pitch?'pitching':'hitting', season=new Date().getFullYear(), playerType=pitch?'pitcher':'batter'
    Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=statSplits&group=${group}&season=${season}&sitCodes=vl,vr,h,a&gameType=R`).then(r=>r.json()),
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=statSplits&group=${group}&season=${season}&sitCodes=vl,vr,h,a&gameType=R&leagueListId=milb_all`).then(r=>r.json()),
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&group=${group}&season=${season}&gameType=R`).then(r=>r.json()),
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=gameLog&group=${group}&season=${season}&gameType=R&leagueListId=milb_all`).then(r=>r.json()),
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=careerStatSplits&group=${group}&sitCodes=vl,vr&gameType=R`).then(r=>r.json()).catch(()=>({})),
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}/stats?stats=careerStatSplits&group=${group}&sitCodes=vl,vr&gameType=R&leagueListId=milb_all`).then(r=>r.json()).catch(()=>({})),
    ]).then(([situData,milbSituData,gameLogData,milbGameLogData,careerSituData,careerMilbSituData])=>{
      const mlbSitu=situData.stats?.[0]?.splits??[]
      const milbSitu=milbSituData.stats?.[0]?.splits??[]
      const mergedSitu=mlbSitu.length>0?mlbSitu:milbSitu
      setSituSplits(mergedSitu)
      const mlbCareerSitu=careerSituData?.stats?.[0]?.splits??[]
      const milbCareerSitu=careerMilbSituData?.stats?.[0]?.splits??[]
      // merge by adding counting stats from both, prefer MLB for rate stats
      const mergeSitu=(mlb:any[],milb:any[])=>{
        const codes=['vl','vr']
        return codes.map(code=>{
          const m=mlb.find((s:any)=>s.split?.code===code)
          const n=milb.find((s:any)=>s.split?.code===code)
          if(!m&&!n)return null
          if(!m)return n
          if(!n)return m
          const ms=m.stat, ns=n.stat
          const totPA=(ms.plateAppearances??0)+(ns.plateAppearances??0)
          const totAB=(ms.atBats??0)+(ns.atBats??0)
          const totH=(ms.hits??0)+(ns.hits??0)
          const totBB=(ms.baseOnBalls??0)+(ns.baseOnBalls??0)
          const totSO=(ms.strikeOuts??0)+(ns.strikeOuts??0)
          const totHR=(ms.homeRuns??0)+(ns.homeRuns??0)
          const tot2B=(ms.doubles??0)+(ns.doubles??0)
          const tot3B=(ms.triples??0)+(ns.triples??0)
          const totTB=(ms.totalBases??0)+(ns.totalBases??0)
          const totG=(ms.gamesPlayed??0)+(ns.gamesPlayed??0)
          const totBF=(ms.battersFaced??0)+(ns.battersFaced??0)
          const totIP=((parseFloat(ms.inningsPitched??'0')||0)+(parseFloat(ns.inningsPitched??'0')||0)).toFixed(1)
          const totER=(ms.earnedRuns??0)+(ns.earnedRuns??0)
          const avg=totAB>0?(totH/totAB).toFixed(3).replace(/^0/,''):null
          const obp=totPA>0?((totH+totBB+(ms.hitByPitch??0)+(ns.hitByPitch??0))/totPA).toFixed(3).replace(/^0/,''):null
          const slg=totAB>0?(totTB/totAB).toFixed(3).replace(/^0/,''):null
          const ops=(obp&&slg)?(parseFloat('0'+obp)+parseFloat('0'+slg)).toFixed(3).replace(/^0/,''):null
          return {...m,stat:{...ms,gamesPlayed:totG,plateAppearances:totPA,atBats:totAB,hits:totH,baseOnBalls:totBB,strikeOuts:totSO,homeRuns:totHR,doubles:tot2B,triples:tot3B,totalBases:totTB,battersFaced:totBF,inningsPitched:totIP,earnedRuns:totER,avg,obp,slg,ops}}
        }).filter(Boolean)
      }
      setCareerSituSplits(mergeSitu(mlbCareerSitu,milbCareerSitu))
      const mlbLogs=gameLogData.stats?.[0]?.splits??[]
      const milbLogs=milbGameLogData.stats?.[0]?.splits??[]
      const logs=[...mlbLogs,...milbLogs]
      const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-90)
      const recent=logs.filter((g:any)=>g.date&&new Date(g.date)>=cutoff)
      recent.sort((a:any,b:any)=>(b.date??'').localeCompare(a.date??''))
      setGameLogs(recent); setExtraLoading(false)
    }).catch(()=>setExtraLoading(false))
    fetch(`https://baseballsavant.mlb.com/statcast_search/csv?player_type=${playerType}&player_id=${mlbamId}&season=${season}&type=details&game_type=R`)
      .then(r=>r.text()).then(csv=>{setStatcastRows(parseStatcastCSV(csv));setStatcastLoading(false)}).catch(()=>setStatcastLoading(false))
  }, [mlbamId, pitch, drawerLoading])

  const lWindows = useMemo(() => {
    if (!gameLogs.length) return null
    const now=new Date()
    function cutoff(days:number){const d=new Date(now);d.setDate(d.getDate()-days);return d}
    const l7=gameLogs.filter(g=>new Date(g.date)>=cutoff(7)).map(g=>({stat:g.stat}))
    const l30=gameLogs.filter(g=>new Date(g.date)>=cutoff(30)).map(g=>({stat:g.stat}))
    const l90=gameLogs.map(g=>({stat:g.stat}))
    const sum=pitch?sumPitchStats:sumBatStats
    return {l7:l7.length?sum(l7):null,l30:l30.length?sum(l30):null,l90:l90.length?sum(l90):null}
  }, [gameLogs, pitch])

  const enriched=allSplits.map(s=>({...s,_level:s._level??sportAbbrToLevel(s.sport?.abbreviation??'',s.sport?.id)}))
  const visibleSplits=showMinors?enriched:enriched.filter(s=>isMlbLevel(s._level))
  const mlbRows=enriched.filter(s=>isMlbLevel(s._level))
  const milbRows=enriched.filter(s=>!isMlbLevel(s._level))
  const mlbTotal=mlbRows.length>0?(pitch?sumPitchStats(mlbRows):sumBatStats(mlbRows)):null
  const minorsTotal=milbRows.length>0?(pitch?sumPitchStats(milbRows):sumBatStats(milbRows)):null

  const yearGroups=useMemo(()=>{
    const map:Record<string,any[]>={}
    for(const s of visibleSplits){const yr=s.season??'Unknown';if(!map[yr])map[yr]=[];map[yr].push(s)}
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b))
  },[visibleSplits])

  const batHeaders=['Year','Team','Lev','G','BA','OBP','SLG','OPS','SO','BB','PA','AB','H','2B','3B','HR','R','RBI','SB','CS','ISO','K%','BB%','XBH%']
  const pitchHeaders=['Year','Team','Lev','G','W-L','IP','BAA','ERA','WHIP','H','R','ER','HR','BB','SO','K%','BB%','K-BB%']
  const headers=pitch?pitchHeaders:batHeaders
  const splitLabels:Record<string,string>=pitch?{vl:'vs LHB',vr:'vs RHB',h:'Home',a:'Away'}:{vl:'vs LHP',vr:'vs RHP',h:'Home',a:'Away'}

  function calcISO(st:any){if(!st?.slg||!st?.avg)return '—';return(parseFloat('0'+st.slg)-parseFloat('0'+st.avg)).toFixed(3).replace(/^0\./,'.')}
  function calcXBHPct(st:any){if(!st?.atBats)return '—';return(((st.doubles??0)+(st.triples??0)+(st.homeRuns??0))/st.atBats*100).toFixed(1)+'%'}
  function calcKBBPct(st:any){const bf=st?.battersFaced||((st?.atBats??0)+(st?.baseOnBalls??0)+(st?.hitByPitch??0));return bf?((st.strikeOuts-st.baseOnBalls)/bf*100).toFixed(1)+'%':'—'}
  function fmtWL(st:any){return(st?.wins!=null&&st?.losses!=null)?`${st.wins}-${st.losses}`:'—'}

  function renderBatRow(s:any,key:string,indent?:boolean){const st=s.stat;const isMR=!isMlbLevel(s._level);return(<tr key={key} style={{borderBottom:'1px solid rgba(48,54,61,0.3)',background:isMR?'rgba(99,102,241,0.04)':'transparent'}}><LabelCell label={indent?'':s.season}/><LabelCell label={s.team?.abbreviation??s.team?.name??'—'} muted/><LabelCell label={fmtLevel(s._level)} muted={!isMR} color={isMR?'rgba(139,92,246,0.7)':undefined}/><StatCell val={st?.gamesPlayed}/><StatCell val={st?.avg}/><StatCell val={st?.obp}/><StatCell val={st?.slg}/><StatCell val={st?.ops}/><StatCell val={st?.strikeOuts}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.plateAppearances}/><StatCell val={st?.atBats}/><StatCell val={st?.hits}/><StatCell val={st?.doubles}/><StatCell val={st?.triples}/><StatCell val={st?.homeRuns}/><StatCell val={st?.runs}/><StatCell val={st?.rbi}/><StatCell val={st?.stolenBases}/><StatCell val={st?.caughtStealing}/><StatCell val={calcISO(st)}/><StatCell val={calcKPct(st,false)}/><StatCell val={calcBBPct(st,false)}/><StatCell val={calcXBHPct(st)}/></tr>)}
  function renderPitchRow(s:any,key:string,indent?:boolean){const st=s.stat;const isMR=!isMlbLevel(s._level);return(<tr key={key} style={{borderBottom:'1px solid rgba(48,54,61,0.3)',background:isMR?'rgba(99,102,241,0.04)':'transparent'}}><LabelCell label={indent?'':s.season}/><LabelCell label={s.team?.abbreviation??s.team?.name??'—'} muted/><LabelCell label={fmtLevel(s._level)} muted={!isMR} color={isMR?'rgba(139,92,246,0.7)':undefined}/><StatCell val={st?.gamesPlayed}/><StatCell val={fmtWL(st)}/><StatCell val={st?.inningsPitched}/><StatCell val={st?.oAvg??st?.avg}/><StatCell val={st?.era}/><StatCell val={st?.whip}/><StatCell val={st?.hits}/><StatCell val={st?.runs}/><StatCell val={st?.earnedRuns}/><StatCell val={st?.homeRuns}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={calcKPct(st,true)}/><StatCell val={calcBBPct(st,true)}/><StatCell val={calcKBBPct(st)}/></tr>)}

  // 3-yr peak fantasy-stat projection row — prospects only (career_blend.fantasy_peak3 is
  // never populated for graduated players, see build-scores.js). Counting stats (2B/3B/HR/
  // R/RBI) are shown per a reference 600-PA workload since playing time itself isn't
  // projected — durability testing found no way to predict it, so the row deliberately
  // doesn't imply a specific number of games.
  // Reference workloads used to turn rate projections into counting-stat estimates for
  // display — hitters at a standard everyday-player 600 PA, pitchers at a standard
  // full-starter 150 IP (≈630 BF at ~4.2 BF/inning). G/W-L stay blank on purpose: role
  // and durability were explicitly tested and found unpredictable from this data, so the
  // row never implies a specific number of games or a won-loss record.
  const REF_PA = 600, REF_AB = 522, REF_IP = 150, REF_BF = 630
  function fmtRate3(v:number|null|undefined){return v==null?'—':v.toFixed(3).replace(/^0\./,'.')}
  function fmtPct(v:number|null|undefined){return v==null?'—':(v*100).toFixed(1)+'%'}
  function fmtN(v:number|null|undefined){return v==null?'—':String(Math.round(v))}
  function renderFantasyPeakRow(){
    const fp=(toolGrades as any)?.fantasy_peak3
    if(!fp)return null
    if(pitch){
      if(fp.era==null&&fp.whip==null&&fp.baa==null&&fp.k_bb_pct==null)return null
      const so=fp.k_pct_pit!=null?fp.k_pct_pit*REF_BF:null
      const bb=fp.bb_pct_pit!=null?fp.bb_pct_pit*REF_BF:null
      const bip=(so!=null&&bb!=null)?Math.max(REF_BF-so-bb,0):null
      const h=(fp.baa!=null&&bip!=null)?fp.baa*bip:null
      const er=fp.era!=null?fp.era*REF_IP/9:null
      const r=er!=null?er/0.92:null   // ~92% of runs are earned, league-average split
      const hr=fp.hr_rate_pit!=null?fp.hr_rate_pit*REF_BF:null
      return(<tr style={{borderTop:'2px solid var(--accent)',background:'rgba(245,158,11,0.06)'}}>
        <LabelCell label="3-Yr Peak" bold color="var(--accent)"/><LabelCell label="—" muted/><LabelCell label="—" muted/>
        <StatCell val="—"/><StatCell val="—"/><StatCell val={String(REF_IP)}/>
        <StatCell val={fmtRate3(fp.baa)} bold/><StatCell val={fp.era!=null?fp.era.toFixed(2):'—'} bold/><StatCell val={fp.whip!=null?fp.whip.toFixed(2):'—'} bold/>
        <StatCell val={fmtN(h)} bold/><StatCell val={fmtN(r)} bold/><StatCell val={fmtN(er)} bold/><StatCell val={fmtN(hr)} bold/><StatCell val={fmtN(bb)} bold/><StatCell val={fmtN(so)} bold/>
        <StatCell val={fmtPct(fp.k_pct_pit)} bold/><StatCell val={fmtPct(fp.bb_pct_pit)} bold/><StatCell val={fp.k_bb_pct!=null?(fp.k_bb_pct*100).toFixed(1)+'%':'—'} bold/>
      </tr>)
    }
    if(fp.avg==null&&fp.obp==null&&fp.slg==null&&fp.ops==null)return null
    const so=fp.k_pct_hit!=null?fp.k_pct_hit*REF_PA:null
    const bb=fp.bb_pct_hit!=null?fp.bb_pct_hit*REF_PA:null
    const h=fp.avg!=null?fp.avg*REF_AB:null
    const d2=fp['2b_rate']!=null?fp['2b_rate']*REF_PA:null
    const d3=fp['3b_rate']!=null?fp['3b_rate']*REF_PA:null
    const hr=fp.hr_rate!=null?fp.hr_rate*REF_AB:null
    const singles=(h!=null&&d2!=null&&d3!=null&&hr!=null)?Math.max(h-d2-d3-hr,0):null
    const stealOpps=(singles!=null&&bb!=null)?singles+bb:null   // omits HBP, a minor term
    const sb=(fp.sb_rate!=null&&stealOpps!=null)?fp.sb_rate*stealOpps:null
    const cs=sb!=null?sb/3:null   // assumes league-average ~75% SB success rate
    return(<tr style={{borderTop:'2px solid var(--accent)',background:'rgba(245,158,11,0.06)'}}>
      <LabelCell label="3-Yr Peak" bold color="var(--accent)"/><LabelCell label="—" muted/><LabelCell label="—" muted/>
      <StatCell val="—"/>
      <StatCell val={fmtRate3(fp.avg)} bold/><StatCell val={fmtRate3(fp.obp)} bold/><StatCell val={fmtRate3(fp.slg)} bold/><StatCell val={fmtRate3(fp.ops)} bold/>
      <StatCell val={fmtN(so)} bold/><StatCell val={fmtN(bb)} bold/><StatCell val={String(REF_PA)}/><StatCell val={String(REF_AB)}/><StatCell val={fmtN(h)} bold/>
      <StatCell val={fmtN(d2)} bold/><StatCell val={fmtN(d3)} bold/><StatCell val={fmtN(hr)} bold/>
      <StatCell val={fmtN(fp.r_rate!=null?fp.r_rate*REF_PA:null)} bold/><StatCell val={fmtN(fp.rbi_rate!=null?fp.rbi_rate*REF_PA:null)} bold/>
      <StatCell val={fmtN(sb)} bold/><StatCell val={fmtN(cs)} bold/><StatCell val={fmtRate3(fp.iso)} bold/>
      <StatCell val={fmtPct(fp.k_pct_hit)} bold/><StatCell val={fmtPct(fp.bb_pct_hit)} bold/><StatCell val={fmtPct(fp.xbh_pct)} bold/>
    </tr>)
  }

  function renderBatSumRow(year:string,rows:any[],isExpanded:boolean,onToggle:()=>void){const summed=sumBatStats(rows);const teams=Array.from(new Set(rows.map((s:any)=>s.team?.abbreviation??s.team?.name).filter(Boolean)));const teamLabel=teams.length>1?'mult.':(teams[0]??'—');const levels=Array.from(new Set(rows.map((s:any)=>s._level))).sort((a,b)=>levelSortVal(a)-levelSortVal(b));const hasMinor=rows.some((s:any)=>!isMlbLevel(s._level));return(<tr key={`sum-${year}`} onClick={onToggle} style={{borderBottom:'1px solid rgba(48,54,61,0.5)',background:'rgba(255,255,255,0.02)',cursor:'pointer'}}><td style={{padding:'0.3rem 0.45rem',fontSize:'0.76rem',fontFamily:'var(--font-display)',fontWeight:700,color:'var(--text)',whiteSpace:'nowrap'}}><span style={{marginRight:4,fontSize:'0.6rem',opacity:0.6}}>{isExpanded?'▼':'▶'}</span>{year}</td><LabelCell label={teamLabel} muted/><LabelCell label={levels.join(', ')} muted/><StatCell val={summed?.gamesPlayed} bold/><StatCell val={summed?.avg} bold/><StatCell val={summed?.obp} bold/><StatCell val={summed?.slg} bold/><StatCell val={summed?.ops} bold/><StatCell val={summed?.strikeOuts} bold/><StatCell val={summed?.baseOnBalls} bold/><StatCell val={summed?.plateAppearances} bold/><StatCell val={summed?.atBats} bold/><StatCell val={summed?.hits} bold/><StatCell val={summed?.doubles} bold/><StatCell val={summed?.triples} bold/><StatCell val={summed?.homeRuns} bold/><StatCell val={summed?.runs} bold/><StatCell val={summed?.rbi} bold/><StatCell val={summed?.stolenBases} bold/><StatCell val={summed?.caughtStealing} bold/><StatCell val={calcISO(summed)} bold/><StatCell val={calcKPct(summed,false)} bold/><StatCell val={calcBBPct(summed,false)} bold/><StatCell val={calcXBHPct(summed)} bold/></tr>)}
  function renderPitchSumRow(year:string,rows:any[],isExpanded:boolean,onToggle:()=>void){const summed=sumPitchStats(rows);const teams=Array.from(new Set(rows.map((s:any)=>s.team?.abbreviation??s.team?.name).filter(Boolean)));const teamLabel=teams.length>1?'mult.':(teams[0]??'—');const levels=Array.from(new Set(rows.map((s:any)=>s._level))).sort((a,b)=>levelSortVal(a)-levelSortVal(b));const hasMinor=rows.some((s:any)=>!isMlbLevel(s._level));return(<tr key={`sum-${year}`} onClick={onToggle} style={{borderBottom:'1px solid rgba(48,54,61,0.5)',background:'rgba(255,255,255,0.02)',cursor:'pointer'}}><td style={{padding:'0.3rem 0.45rem',fontSize:'0.76rem',fontFamily:'var(--font-display)',fontWeight:700,color:'var(--text)',whiteSpace:'nowrap'}}><span style={{marginRight:4,fontSize:'0.6rem',opacity:0.6}}>{isExpanded?'▼':'▶'}</span>{year}</td><LabelCell label={teamLabel} muted/><LabelCell label={levels.join(', ')} muted/><StatCell val={summed?.gamesPlayed} bold/><StatCell val={fmtWL(summed)} bold/><StatCell val={summed?.inningsPitched} bold/><StatCell val={summed?.oAvg??summed?.avg} bold/><StatCell val={summed?.era} bold/><StatCell val={summed?.whip} bold/><StatCell val={summed?.hits} bold/><StatCell val={summed?.runs} bold/><StatCell val={summed?.earnedRuns} bold/><StatCell val={summed?.homeRuns} bold/><StatCell val={summed?.baseOnBalls} bold/><StatCell val={summed?.strikeOuts} bold/><StatCell val={calcKPct(summed,true)} bold/><StatCell val={calcBBPct(summed,true)} bold/><StatCell val={calcKBBPct(summed)} bold/></tr>)}
  function renderBatTotalRow(label:string,st:any){return(<tr key={label} style={{background:'rgba(255,255,255,0.03)',borderTop:'1px solid var(--border)'}}><LabelCell label={label} bold/><td/><td/><StatCell val={st?.gamesPlayed} bold/><StatCell val={st?.avg} bold/><StatCell val={st?.obp} bold/><StatCell val={st?.slg} bold/><StatCell val={st?.ops} bold/><StatCell val={st?.strikeOuts} bold/><StatCell val={st?.baseOnBalls} bold/><StatCell val={st?.plateAppearances} bold/><StatCell val={st?.atBats} bold/><StatCell val={st?.hits} bold/><StatCell val={st?.doubles} bold/><StatCell val={st?.triples} bold/><StatCell val={st?.homeRuns} bold/><StatCell val={st?.runs} bold/><StatCell val={st?.rbi} bold/><StatCell val={st?.stolenBases} bold/><StatCell val={st?.caughtStealing} bold/><StatCell val={calcISO(st)} bold/><StatCell val={calcKPct(st,false)} bold/><StatCell val={calcBBPct(st,false)} bold/><StatCell val={calcXBHPct(st)} bold/></tr>)}
  function renderPitchTotalRow(label:string,st:any){return(<tr key={label} style={{background:'rgba(255,255,255,0.03)',borderTop:'1px solid var(--border)'}}><LabelCell label={label} bold/><td/><td/><StatCell val={st?.gamesPlayed} bold/><StatCell val={fmtWL(st)} bold/><StatCell val={st?.inningsPitched} bold/><StatCell val={st?.oAvg??st?.avg} bold/><StatCell val={st?.era} bold/><StatCell val={st?.whip} bold/><StatCell val={st?.hits} bold/><StatCell val={st?.runs} bold/><StatCell val={st?.earnedRuns} bold/><StatCell val={st?.homeRuns} bold/><StatCell val={st?.baseOnBalls} bold/><StatCell val={st?.strikeOuts} bold/><StatCell val={calcKPct(st,true)} bold/><StatCell val={calcBBPct(st,true)} bold/><StatCell val={calcKBBPct(st)} bold/></tr>)}

  function renderRecentTable(){if(!lWindows)return<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No recent games.</div>;const rows=[['L7',lWindows.l7],['L30',lWindows.l30],['L90',lWindows.l90]].filter(([,st])=>st);if(!rows.length)return null;const hdrs=pitch?['Period','G','W-L','IP','ERA','WHIP','BB','SO','K%','BB%','K-BB%']:['Period','G','BA','OBP','SLG','OPS','PA','HR','RBI','R','SB','ISO','K%','BB%'];return(<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',minWidth:'max-content'}}><thead><tr style={{borderBottom:'1px solid var(--border)'}}>{hdrs.map(h=><th key={h} style={{padding:'0.25rem 0.45rem',textAlign:h==='Period'?'left':'right',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.62rem',letterSpacing:'0.08em',color:'var(--muted)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead><tbody>{rows.map(([lbl,st]:any)=>pitch?(<tr key={lbl} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={lbl} bold/><StatCell val={st?.gamesPlayed}/><StatCell val={fmtWL(st)}/><StatCell val={st?.inningsPitched}/><StatCell val={st?.era}/><StatCell val={st?.whip}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={calcKPct(st,true)}/><StatCell val={calcBBPct(st,true)}/><StatCell val={calcKBBPct(st)}/></tr>):(<tr key={lbl} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={lbl} bold/><StatCell val={st?.gamesPlayed}/><StatCell val={st?.avg}/><StatCell val={st?.obp}/><StatCell val={st?.slg}/><StatCell val={st?.ops}/><StatCell val={st?.plateAppearances}/><StatCell val={st?.homeRuns}/><StatCell val={st?.rbi}/><StatCell val={st?.runs}/><StatCell val={st?.stolenBases}/><StatCell val={calcISO(st)}/><StatCell val={calcKPct(st,false)}/><StatCell val={calcBBPct(st,false)}/></tr>))}</tbody></table></div>)}

  function renderSplitTable(){
    const relevant=['vl','vr','h','a'].map(code=>situSplits.find((s:any)=>s.split?.code===code)).filter(Boolean)
    const careerVL=careerSituSplits.find((s:any)=>s.split?.code==='vl')
    const careerVR=careerSituSplits.find((s:any)=>s.split?.code==='vr')
    const hasCareer=careerVL||careerVR
    if(!relevant.length&&!hasCareer)return<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No splits available.</div>
    const hdrs=pitch?['Split','G','W-L','IP','BAA','ERA','WHIP','BF','BB','SO','K%','BB%','K-BB%']:['Split','G','BA','OBP','SLG','OPS','PA','HR','ISO','K%','BB%']
    const careerRowStyle={borderBottom:'1px solid rgba(48,54,61,0.3)',background:'rgba(255,255,255,0.02)'}
    const sepStyle={borderBottom:'1px solid var(--border)'}
    const renderBat=(st:any,lbl:string,style:any,rowKey?:string)=>(<tr key={rowKey} style={style}><LabelCell label={lbl} muted/><StatCell val={st?.gamesPlayed}/><StatCell val={st?.avg}/><StatCell val={st?.obp}/><StatCell val={st?.slg}/><StatCell val={st?.ops}/><StatCell val={st?.plateAppearances}/><StatCell val={st?.homeRuns}/><StatCell val={calcISO(st)}/><StatCell val={calcKPct(st,false)}/><StatCell val={calcBBPct(st,false)}/></tr>)
    const renderPit=(st:any,lbl:string,style:any,rowKey?:string)=>(<tr key={rowKey} style={style}><LabelCell label={lbl} muted/><StatCell val={st?.gamesPlayed}/><StatCell val={fmtWL(st)}/><StatCell val={st?.inningsPitched}/><StatCell val={st?.avg}/><StatCell val={st?.era}/><StatCell val={st?.whip}/><StatCell val={st?.battersFaced}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={calcKPct(st,true)}/><StatCell val={calcBBPct(st,true)}/><StatCell val={calcKBBPct(st)}/></tr>)
    return(<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',minWidth:'max-content'}}><thead><tr style={{borderBottom:'1px solid var(--border)'}}>{hdrs.map(h=><th key={h} style={{padding:'0.25rem 0.45rem',textAlign:h==='Split'?'left':'right',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.62rem',letterSpacing:'0.08em',color:'var(--muted)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead><tbody>
      {hasCareer&&<>{careerVL&&<React.Fragment key="cvl">{pitch?renderPit(careerVL.stat,'Career vs L',careerRowStyle):renderBat(careerVL.stat,'Career vs L',careerRowStyle)}</React.Fragment>}{careerVR&&<React.Fragment key="cvr">{pitch?renderPit(careerVR.stat,'Career vs R',careerRowStyle):renderBat(careerVR.stat,'Career vs R',careerRowStyle)}</React.Fragment>}{relevant.length>0&&<tr key="sep" style={sepStyle}><td colSpan={hdrs.length} style={{padding:'0.15rem 0.45rem',fontSize:'0.58rem',fontFamily:'var(--font-display)',color:'var(--muted)',letterSpacing:'0.08em',textTransform:'uppercase'}}>Current Season</td></tr>}</>}
      {relevant.map((s:any,i)=>{const st=s.stat;const lbl=splitLabels[s.split?.code]??s.split?.description??s.split?.code;return <React.Fragment key={`cur-${i}`}>{pitch?renderPit(st,lbl,{borderBottom:'1px solid rgba(48,54,61,0.3)'}):renderBat(st,lbl,{borderBottom:'1px solid rgba(48,54,61,0.3)'})}</React.Fragment>})}
    </tbody></table></div>)
  }

  function renderGameLog(){if(!gameLogs.length)return<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No games in last 90 days.</div>;const hdrs=pitch?['Date','Opp','Dec','IP','H','R','ER','BB','SO','ERA','WHIP','P','P/IP','STR%','BALL%']:['Date','Opp','Lev','AB','R','H','2B','3B','HR','RBI','SB','BB','SO','BA'];return(<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',minWidth:'max-content'}}><thead><tr style={{borderBottom:'1px solid var(--border)'}}>{hdrs.map(h=><th key={h} style={{padding:'0.25rem 0.45rem',textAlign:h==='Date'||h==='Opp'||h==='Dec'?'left':'right',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.62rem',letterSpacing:'0.08em',color:'var(--muted)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead><tbody>{gameLogs.map((g:any,i)=>{const st=g.stat;const opp=g.opponent?.abbreviation??g.opponent?.name??'—';const oppStr=g.isHome?opp:`@${opp}`;return pitch?(<tr key={i} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={g.date?.slice(0,10)??'—'} muted/><LabelCell label={oppStr} muted/><LabelCell label={st?.note??'—'} muted/><StatCell val={st?.inningsPitched}/><StatCell val={st?.hits}/><StatCell val={st?.runs}/><StatCell val={st?.earnedRuns}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={st?.era}/><StatCell val={st?.whip}/><StatCell val={st?.numberOfPitches}/><StatCell val={st?.pitchesPerInning!=null?parseFloat(st.pitchesPerInning).toFixed(1):null}/><StatCell val={st?.strikePercentage!=null?Math.round(parseFloat(st.strikePercentage)*100)+'%':null}/><StatCell val={st?.strikePercentage!=null?Math.round((1-parseFloat(st.strikePercentage))*100)+'%':null}/></tr>):(<tr key={i} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={g.date?.slice(0,10)??'—'} muted/><LabelCell label={oppStr} muted/><LabelCell label={fmtLevel(sportAbbrToLevel(g.sport?.abbreviation??'',g.sport?.id))} muted/><StatCell val={st?.atBats}/><StatCell val={st?.runs}/><StatCell val={st?.hits}/><StatCell val={st?.doubles}/><StatCell val={st?.triples}/><StatCell val={st?.homeRuns}/><StatCell val={st?.rbi}/><StatCell val={st?.stolenBases}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={st?.avg}/></tr>)})}</tbody></table></div>)}

  const arcPoints = useMemo(() => {
    if (!regression || !norms || !allSplits.length || !poolStats) return []
    const models = regression.models
    const birthDate = player.birthDate ?? null
    const isPit = pitch
    const toolNames = isPit ? ['stuff','control'] : ['hit','power','speed']
    const MILB = new Set(['ACL','FCL','DSL','Complex','Rookie','Single-A','High-A','AA','AAA'])

    // collect all milb rows with year, filtering by type
    const allRows: any[] = []
    for (const row of allSplits) {
      const rowType = row.type ?? 'hitting'
      if (isPit && rowType !== 'pitching') continue
      if (!isPit && rowType === 'pitching') continue
      const lvl = row._level ?? row.level
      if (!lvl || !MILB.has(lvl)) continue
      allRows.push({ ...row, _lvl: lvl, _year: parseInt(row.season ?? '0') })
    }
    if (!allRows.length) return []

    const years = Array.from(new Set(allRows.map(r => r._year))).sort()

    function getAge(year: number): number {
      if (!birthDate) return ARC_AVG_AGES['AA']
      const d = new Date(birthDate)
      let age = year - d.getFullYear()
      if (d.getMonth() > 6 || (d.getMonth() === 6 && d.getDate() > 1)) age--
      return age
    }


    const LVL_RANK: Record<string,number> = {'ACL':0,'FCL':0,'DSL':0,'Complex':1,'Rookie':2,'Single-A':3,'High-A':4,'AA':5,'AAA':6}

    // Canonical bucket shape for lib/score-tools.js. Pulls fields from row.stat (or row directly).
    function rowToBucket(row: any) {
      const s = row.stat ?? row
      const ipParts = String(s.inningsPitched ?? s.ip ?? '0').split('.')
      const ab  = s.atBats ?? s.ab ?? 0
      const slg = parseFloat(s.slg ?? '0') || 0
      return {
        year: row._year, level: row._lvl,
        ab,
        bb:  s.baseOnBalls ?? s.bb ?? 0,
        hbp: s.hitByPitch  ?? s.hbp ?? 0,
        so:  s.strikeOuts  ?? s.so ?? 0,
        h:   s.hits        ?? s.h  ?? 0,
        xbh: (s.doubles ?? 0) + (s.triples ?? 0) + (s.homeRuns ?? s.hr ?? 0),
        sb:  s.stolenBases ?? s.sb ?? 0,
        tb:  s.totalBases  ?? s.tb ?? Math.round(slg * ab),
        bf:  s.battersFaced ?? s.bf ?? 0,
        ipOuts: (parseInt(ipParts[0] || '0') * 3) + parseInt(ipParts[1] || '0'),
      }
    }

    // Canonical scoreToolAtPoint — delegates to shared lib.
    function scoreToolAtPoint(upToYear: number, upToLevel: string, toolName: string): number | null {
      const upToRank = LVL_RANK[upToLevel] ?? 99
      const buckets = allRows.filter(r => {
        if (r._year > upToYear) return false
        if (r._year === upToYear && (LVL_RANK[r._lvl] ?? 99) > upToRank) return false
        return true
      }).map(rowToBucket)
      const { score } = scoreMilbTool(buckets, toolName, {
        models, norms, poolStats,
        isPit, referenceYear: upToYear, getAge,
      })
      return score
    }

    const pts: any[] = []
    for (const year of years) {
      const yearRows = allRows.filter(r => r._year === year)
      const levels = Array.from(new Set(yearRows.map(r => r._lvl)))
        .sort((a: any, b: any) => (LVL_RANK[a]??99) - (LVL_RANK[b]??99))
      for (const lvl of levels) {
        const pt: any = { year, level: lvl }
        for (const t of toolNames) pt[t] = scoreToolAtPoint(year, lvl, t)
        if (isPit) {
          if (pt.stuff != null && pt.control != null) pt.overall = Math.round(pt.stuff*0.70+pt.control*0.30)
        } else {
          if (pt.hit != null && pt.power != null && pt.speed != null) pt.overall = Math.round(pt.hit*0.42+pt.power*0.47+pt.speed*0.11)
        }
        if (Object.values(pt).some((v:any) => typeof v === 'number' && v !== pt.year)) pts.push(pt)
      }
    }

    return pts
  }, [allSplits, regression, norms, poolStats, pitch, player.birthDate])

  // Full career game-by-game arc across all years
  const gameArcPoints = useMemo(() => {
    const hasLogs = Object.values(allGameLogs).some((g:any) => g?.hitting?.length > 0 || g?.pitching?.length > 0)
    if (!regression || !norms || !poolStats || !hasLogs) return []
    const models = regression.models
    const isPit = pitch
    const toolNames = isPit ? ['stuff','control'] : ['hit','power','speed']
    const birthDate = player.birthDate ?? null
    const MILB = new Set(['ACL','FCL','DSL','Complex','Rookie','Single-A','High-A','AA','AAA'])
    function normLevel(l:string, year?: number):string {
      if(l==='A') return 'Single-A'
      if(l==='A+'||l==='High A') return 'High-A'
      if(l==='ROK'||l==='Rookie Advanced') return (year && year >= 2021) ? 'Complex' : 'Rookie'
      if(l==='CPX') return 'Complex'
      if(l==='ACL'||l==='FCL') return 'Complex'
      return l
    }

    // allSplits rows for prior-season context — same structure as arcPoints
    const splitRows: any[] = []
    for (const row of allSplits) {
      const rowType = row.type ?? 'hitting'
      if (isPit && rowType !== 'pitching') continue
      if (!isPit && rowType === 'pitching') continue
      const lvl = row._level ?? row.level
      if (!lvl || !MILB.has(lvl)) continue
      splitRows.push({ ...row, _lvl: lvl, _year: parseInt(row.season ?? '0') })
    }

    const getAge = (yr:number):number => {
      if(!birthDate) return ARC_AVG_AGES['AA']
      const d=new Date(birthDate);let age=yr-d.getFullYear()
      if(d.getMonth()>6||(d.getMonth()===6&&d.getDate()>1))age--; return age
    }

    // Collect all game entries across all years, sorted by date
    const allGames: Array<{date:string,year:number,g:any}> = []
    for (const [yrStr, groups] of Object.entries(allGameLogs)) {
      const yr = parseInt(yrStr)
      const rows = isPit ? (groups as any).pitching : (groups as any).hitting
      if (!rows?.length) continue
      for (const g of (rows as any[])) {
        if (g.date) allGames.push({ date: g.date.slice(0,10), year: yr, g })
      }
    }
    allGames.sort((a,b) => a.date.localeCompare(b.date))
    if (!allGames.length) return []

    const pts: any[] = []
    // Track cumulative totals per season/level — keyed by year|level
    const seasonCum: Record<string,{ab:number,bb:number,hbp:number,so:number,h:number,xbh:number,sb:number,tb:number,bf:number,ipOuts:number,g:number,year:number,lvl:string}> = {}

    // pre-seed seasonCum with allSplits rows for years before first gamelog year
    const firstGameYear = allGames.length > 0 ? allGames[0].year : 9999
    for (const row of allSplits) {
      const rowType = row.type ?? 'hitting'
      if (isPit && rowType !== 'pitching') continue
      if (!isPit && rowType === 'pitching') continue
      const lvl = normLevel(row._level ?? row.level ?? '', parseInt(row.season ?? '0'))
      if (!lvl || !MILB.has(lvl)) continue
      const yr = parseInt(row.season ?? '0')
      if (yr >= firstGameYear) continue
      const s = row.stat ?? row
      const sKey = yr + '|' + lvl
      if (!seasonCum[sKey]) seasonCum[sKey] = {ab:0,bb:0,hbp:0,so:0,h:0,xbh:0,sb:0,tb:0,bf:0,ipOuts:0,g:0,year:yr,lvl}
      const sc = seasonCum[sKey]
      sc.ab += s.atBats ?? s.ab ?? 0
      sc.bb += s.baseOnBalls ?? s.bb ?? 0
      sc.hbp += s.hitByPitch ?? s.hbp ?? 0
      sc.so += s.strikeOuts ?? s.so ?? 0
      sc.h += s.hits ?? s.h ?? 0
      sc.xbh += (s.doubles ?? 0) + (s.triples ?? 0) + (s.homeRuns ?? s.hr ?? 0)
      sc.sb += s.stolenBases ?? s.sb ?? 0
      sc.tb += s.totalBases ?? s.tb ?? 0
      sc.bf += s.battersFaced ?? s.bf ?? 0
      const ipVal = parseFloat(s.inningsPitched ?? s.ip ?? '0') || 0
      sc.ipOuts += Math.round(ipVal * 3)
      sc.g += s.gamesPlayed ?? s.g ?? 0
    }

    // MLB sample K values (same as mlbArcPoints)
    const MLB_K: Record<string,number> = { hit:150, power:120, speed:60, stuff:20, control:40 }
    // Running MLB cumulative — keyed by year, accumulates as we walk allGames in date order
    const mlbGameCum: Record<number,{ab:number,bb:number,hbp:number,so:number,h:number,xbh:number,sb:number,tb:number,bf:number,ipOuts:number,g:number}> = {}

    for (const { date, year, g } of allGames) {
      const isMlbGame = g.level === 'MLB'
      const lvl = normLevel(g.level ?? '', year)
      const displayLvl = (g.level === 'ROK' && year >= 2021) ? 'CPX' : (g.level ?? lvl)

      // Accumulate into the correct bucket
      if (isMlbGame) {
        if (!mlbGameCum[year]) mlbGameCum[year]={ab:0,bb:0,hbp:0,so:0,h:0,xbh:0,sb:0,tb:0,bf:0,ipOuts:0,g:0}
        const ms=mlbGameCum[year]
        ms.ab+=g.atBats??0;ms.bb+=g.baseOnBalls??0;ms.hbp+=g.hitByPitch??0
        ms.so+=g.strikeOuts??0;ms.h+=g.hits??0;ms.sb+=g.stolenBases??0
        ms.xbh+=(g.doubles??0)+(g.triples??0)+(g.homeRuns??0)
        ms.tb+=g.totalBases??0;ms.bf+=g.battersFaced??0
        const ipStr=String(g.inningsPitched??'0');const ipP=ipStr.split('.')
        ms.ipOuts+=(parseInt(ipP[0]||'0')*3)+(parseInt(ipP[1]||'0'))
        ms.g += 1
      } else {
        if(!lvl||!MILB.has(lvl)) continue
        const sKey = `${year}|${lvl}`
        if(!seasonCum[sKey]) seasonCum[sKey]={ab:0,bb:0,hbp:0,so:0,h:0,xbh:0,sb:0,tb:0,bf:0,ipOuts:0,g:0,year,lvl}
        const sc=seasonCum[sKey]
        sc.ab+=g.atBats??0;sc.bb+=g.baseOnBalls??0;sc.hbp+=g.hitByPitch??0
        sc.so+=g.strikeOuts??0;sc.h+=g.hits??0;sc.sb+=g.stolenBases??0
        sc.xbh+=(g.doubles??0)+(g.triples??0)+(g.homeRuns??0)
        sc.tb+=g.totalBases??0;sc.bf+=g.battersFaced??0
        const ipStr=String(g.inningsPitched??'0');const ipP=ipStr.split('.')
        sc.ipOuts+=(parseInt(ipP[0]||'0')*3)+(parseInt(ipP[1]||'0'))
        sc.g += 1
      }

      // Canonical scoring — score pure MiLB + pure MLB tools, then blendCareer.
      // Same path used by row, drawer tile, model-rank. Last point = career_blend.
      const milbBuckets = Object.values(seasonCum).map(st => ({ ...st, level: st.lvl }))
      const mlbBuckets = Object.entries(mlbGameCum).map(([yrStr, ms]) => ({
        ...ms, year: parseInt(yrStr), level: 'MLB',
      }))
      const milbTools: any = { type: isPit ? 'pitcher' : 'hitter', _sample: 0 }
      const mlbTools: any  = { type: isPit ? 'pitcher' : 'hitter' }
      for (const t of toolNames) {
        const milbR = scoreMilbTool(milbBuckets, t, { models, norms, poolStats, isPit, referenceYear: year, getAge })
        milbTools[t] = milbR.score
        if (milbR.totalSample > milbTools._sample) milbTools._sample = milbR.totalSample
        const mlbR = scoreMlbTool(mlbBuckets, t, { norms, isPit, referenceYear: year })
        mlbTools[t] = mlbR.score
        const sampleKey = isPit ? '_ip' : '_pa'
        if ((mlbR.totalSample ?? 0) > (mlbTools[sampleKey] ?? 0)) mlbTools[sampleKey] = mlbR.totalSample
      }
      const hasMilb = milbTools._sample > 0
      const hasMlb = (isPit ? mlbTools._ip : mlbTools._pa) > 0
      // Career IP/G across MiLB + MLB buckets to-date (for starter factor on overall only)
      let careerIPG: number | null = null
      if (isPit) {
        let totIpOuts = 0, totG = 0
        for (const b of Object.values(seasonCum)) { totIpOuts += b.ipOuts; totG += b.g }
        for (const b of Object.values(mlbGameCum)) { totIpOuts += b.ipOuts; totG += b.g }
        if (totG > 0) careerIPG = (totIpOuts / 3) / totG
      }
      const blended = blendCareer(hasMilb ? milbTools : null, hasMlb ? mlbTools : null, { ipg: careerIPG }) ?? {}
      const pt: any = { year, level: isMlbGame ? 'MLB' : displayLvl, date, isMlb: isMlbGame, ...blended }
      if (Object.values(pt).some((v: any) => typeof v === 'number' && v !== pt.year)) pts.push(pt)
    }
    return pts
  }, [allGameLogs, allSplits, regression, norms, poolStats, pitch, player.birthDate])


  // Tiles render the canonical pipeline grade (toolGrades = player.career_blend),
  // i.e. the same value shown on the players-page row. The arc may diverge from this
  // (separate issue) — tiles must NOT follow the arc.
  const tiles = useMemo(() => {
    if (!toolGrades) return []
    const src = toolGrades
    const isBlended = (toolGrades._mlbSample ?? 0) > 0
    const raw = (key: string) => isBlended ? null : (toolGrades._raw?.[key] ?? null)
    const conf = (key: string) => isBlended ? null : (toolGrades._confidence?.[key] ?? null)
    if (toolGrades.type === 'two-way') {
      if (pitch) return [
        src.stuff!=null?{label:'STF+',val:src.stuff,color:toolColor(src.stuff),raw:raw('stuff'),conf:conf('stuff')}:null,
        src.control!=null?{label:'CTL+',val:src.control,color:toolColor(src.control),raw:raw('control'),conf:conf('control')}:null,
        src.overall!=null?{label:'OVR+',val:src.overall,color:toolColor(src.overall)}:null,
      ].filter(Boolean)
      return [
        src.hit!=null?{label:'HIT+',val:src.hit,color:toolColor(src.hit),raw:raw('hit'),conf:conf('hit')}:null,
        src.power!=null?{label:'PWR+',val:src.power,color:toolColor(src.power),raw:raw('power'),conf:conf('power')}:null,
        src.speed!=null?{label:'SPD+',val:src.speed,color:toolColor(src.speed),raw:raw('speed'),conf:conf('speed')}:null,
        src.overall!=null?{label:'OVR+',val:src.overall,color:toolColor(src.overall)}:null,
      ].filter(Boolean)
    }
    if (pitch) return [
      src.stuff!=null?{label:'STF+',val:src.stuff,color:toolColor(src.stuff),raw:raw('stuff'),conf:conf('stuff')}:null,
      src.control!=null?{label:'CTL+',val:src.control,color:toolColor(src.control),raw:raw('control'),conf:conf('control')}:null,
      src.overall!=null?{label:'OVR+',val:src.overall,color:toolColor(src.overall)}:null,
    ].filter(Boolean)
    return [
      src.hit!=null?{label:'HIT+',val:src.hit,color:toolColor(src.hit),raw:raw('hit'),conf:conf('hit')}:null,
      src.power!=null?{label:'PWR+',val:src.power,color:toolColor(src.power),raw:raw('power'),conf:conf('power')}:null,
      src.speed!=null?{label:'SPD+',val:src.speed,color:toolColor(src.speed),raw:raw('speed'),conf:conf('speed')}:null,
      src.overall!=null?{label:'OVR+',val:src.overall,color:toolColor(src.overall)}:null,
    ].filter(Boolean)
  }, [toolGrades, pitch])

  const handednessSplits = useMemo(() => {
    if (!toolGrades || careerSituSplits.length === 0) return null
    const vl = careerSituSplits.find((s:any) => s.split?.code === 'vl')?.stat
    const vr = careerSituSplits.find((s:any) => s.split?.code === 'vr')?.stat
    if (!vl || !vr) return null
    const allRows = allSplits.map(s => ({ stat: s.stat }))
    const career = pitch ? sumPitchStats(allRows) : sumBatStats(allRows)
    if (!career) return null
    const src = toolGrades
    const safeRatio = (splitVal: number, careerVal: number) => careerVal > 0 ? splitVal / careerVal : 1
    if (!pitch) {
      const careerPA = career.plateAppearances ?? 1
      const careerKPct = (career.strikeOuts ?? 0) / careerPA
      const careerBBPct = (career.baseOnBalls ?? 0) / careerPA
      const careerISO = ((career.slg ? parseFloat('0'+career.slg) : 0) - (career.avg ? parseFloat('0'+career.avg) : 0))
      const calc = (st: any) => {
        const pa = st.plateAppearances ?? 1
        const kPct = (st.strikeOuts ?? 0) / pa
        const bbPct = (st.baseOnBalls ?? 0) / pa
        const iso = (parseFloat('0'+(st.slg??'0')) - parseFloat('0'+(st.avg??'0')))
        const kRatio = careerKPct > 0 ? careerKPct / kPct : 1
        const bbRatio = safeRatio(bbPct, careerBBPct)
        return { hitRatio: (kRatio + bbRatio) / 2, pwrRatio: safeRatio(iso, careerISO) }
      }
      const rl = calc(vl), rr = calc(vr)
      const hit = src.hit, pwr = src.power
      const shrink = (base: number, raw: number, pa: number, k: number) => Math.round(base + (raw - base) * (pa / (pa + k)))
      const paVL = vl.plateAppearances ?? 0, paVR = vr.plateAppearances ?? 0
      return {
        hit: { L: hit!=null ? shrink(hit, Math.round(hit*rl.hitRatio), paVL, 60) : null, R: hit!=null ? shrink(hit, Math.round(hit*rr.hitRatio), paVR, 60) : null },
        power: { L: pwr!=null ? shrink(pwr, Math.round(pwr*rl.pwrRatio), paVL, 120) : null, R: pwr!=null ? shrink(pwr, Math.round(pwr*rr.pwrRatio), paVR, 120) : null },
      }
    } else {
      const careerBF = career.battersFaced || ((career.atBats??0)+(career.baseOnBalls??0)+(career.hitByPitch??0)) || 1
      const careerKPct = (career.strikeOuts ?? 0) / careerBF
      const careerBBPct = (career.baseOnBalls ?? 0) / careerBF
      const calc = (st: any) => {
        const bf = st.battersFaced || ((st.atBats??0)+(st.baseOnBalls??0)+(st.hitByPitch??0)) || 1
        const kPct = (st.strikeOuts ?? 0) / bf
        const bbPct = (st.baseOnBalls ?? 0) / bf
        return { stuffRatio: safeRatio(kPct, careerKPct), ctrlRatio: careerBBPct > 0 ? careerBBPct / bbPct : 1 }
      }
      const rl = calc(vl), rr = calc(vr)
      const stuff = src.stuff, ctrl = src.control
      const shrink = (base: number, raw: number, bf: number, k: number) => Math.round(base + (raw - base) * (bf / (bf + k)))
      const bfVL = vl.battersFaced || ((vl.atBats??0)+(vl.baseOnBalls??0)+(vl.hitByPitch??0)) || 0
      const bfVR = vr.battersFaced || ((vr.atBats??0)+(vr.baseOnBalls??0)+(vr.hitByPitch??0)) || 0
      return {
        stuff: { L: stuff!=null ? shrink(stuff, Math.round(stuff*rl.stuffRatio), bfVL, 20) : null, R: stuff!=null ? shrink(stuff, Math.round(stuff*rr.stuffRatio), bfVR, 20) : null },
        control: { L: ctrl!=null ? shrink(ctrl, Math.round(ctrl*rl.ctrlRatio), bfVL, 40) : null, R: ctrl!=null ? shrink(ctrl, Math.round(ctrl*rr.ctrlRatio), bfVR, 40) : null },
      }
    }
  }, [toolGrades, careerSituSplits, allSplits, pitch])

  return (
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:40}}/>
      <div style={{position:'fixed',inset:0,background:'var(--bg-card)',zIndex:50,overflowY:'auto',display:'flex',flexDirection:'column'}}>
        <div style={{position:'sticky',top:0,background:'var(--bg-card)',borderBottom:'1px solid var(--border)',zIndex:10,padding:'1rem 2rem'}}>
          <div style={{maxWidth:1400,margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:'0.5rem',flexWrap:'wrap'}}>
                <span style={{fontSize:'1.4rem',fontWeight:700,color:'var(--text)'}}>{player.name}</span>
                {isMinors&&<span style={{color:'#4ade80',fontFamily:'var(--font-display)',fontWeight:800,fontSize:'0.7rem'}}>M</span>}
                {player.rank&&<span style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.7rem',color:'var(--muted)',background:'rgba(255,255,255,0.05)',padding:'2px 6px',borderRadius:4}}>#{player.rank}{minorsRank?` (${minorsRank})`:''}{posRank?` · ${primaryPos} #${posRank}${minorsPosRank?` (${minorsPosRank})`:''}`:''}</span>}
              </div>
              <div style={{display:'flex',gap:'0.5rem',alignItems:'center',marginTop:'0.25rem',flexWrap:'wrap'}}>
                <span style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.72rem',color:'var(--accent)'}}>{cleanPositions(player.positions)}</span>
                <span style={{color:'var(--muted)',fontSize:'0.8rem'}}>{player.team}</span>
                {player.age&&<span style={{color:'var(--muted)',fontSize:'0.8rem'}}>Age {player.age}</span>}
                <span style={{color:'rgba(100,100,100,0.4)',fontSize:'0.8rem'}}>·</span>
                {LEAGUES.map(league=>{const teamName=pOwnership[league.id];const FRIEND_COLORS:Record<string,string>={'Winston Salem Dash':'#22c55e','Bay Area Bush League':'#a78bfa','Team Colin':'#38bdf8','Team Pat':'#fb923c','The Old Gold and Black':'#e879f9'};const fc=teamName?(league.id==='d3prsagvmgftfdc3'?FRIEND_COLORS[teamName]??null:FRIEND_COLORS[teamName]==='#22c55e'?'#22c55e':null):null;const color=teamName?(fc??'#eab308'):'#ef4444';return(<div key={league.id} style={{display:'flex',alignItems:'center',gap:'0.25rem'}}><div style={{width:'6px',height:'6px',borderRadius:'50%',background:color}}/><span style={{fontSize:'0.7rem',fontFamily:'var(--font-display)',color:'var(--muted)'}}>{league.label}{teamName?` · ${teamName}`:''}</span></div>)})}
              </div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:'1.4rem',lineHeight:1,padding:'0.25rem',flexShrink:0}}>✕</button>
          </div>
          <div style={{maxWidth:1400,margin:'0.75rem auto 0',display:'flex',gap:'0.25rem'}}>
            {isTwoWayPlayer && (
              <div style={{display:'flex',gap:'4px',marginRight:'0.75rem',alignSelf:'center'}}>
                {(['hit','pitch'] as const).map(side=>(
                  <button key={side} onClick={()=>setTwoWaySide(side)} style={{padding:'0.2rem 0.6rem',borderRadius:4,border:'1px solid',borderColor:twoWaySide===side?'var(--accent)':'var(--border)',background:twoWaySide===side?'rgba(34,197,94,0.1)':'transparent',color:twoWaySide===side?'var(--accent)':'var(--muted)',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.65rem',letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer'}}>
                    {side==='hit'?'BAT':'ARM'}
                  </button>
                ))}
              </div>
            )}
            {(['stats','statcast'] as const).map(tab=>(
              <button key={tab} onClick={()=>setActiveTab(tab)} style={{padding:'0.35rem 1rem',borderRadius:'6px 6px 0 0',border:'1px solid',borderBottom:'none',borderColor:activeTab===tab?'var(--border)':'transparent',background:activeTab===tab?'rgba(255,255,255,0.04)':'transparent',color:activeTab===tab?'var(--text)':'var(--muted)',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.72rem',letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer'}}>
                {tab==='stats'?'Stats':`Statcast ${statcastLoading&&mlbamId?'·':''}`}
              </button>
            ))}
          </div>
        </div>

        <div style={{padding:'1.5rem 1rem',maxWidth:1400,margin:'0 auto',width:'100%',boxSizing:'border-box'}}>
          <div style={{display:'flex',flexDirection:'column',gap:'1rem',marginBottom:'1.5rem'}}>
            {rankAppearances.length > 0 && (()=>{
              // Group by normalized sourceName, keep most recent + find prev for delta
              const bySource: Record<string, typeof rankAppearances> = {}
              for (const a of rankAppearances) {
                const key = a.sourceName.toLowerCase().trim()
                if (!bySource[key]) bySource[key] = []
                bySource[key].push(a)
              }
              const rows = Object.values(bySource).map(group => {
                const sorted = [...group].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                const latest = sorted[0]
                const prev = sorted[1] ?? null
                const delta = (latest.rank != null && prev?.rank != null) ? prev.rank - latest.rank : null
                return { ...latest, delta }
              }).sort((a,b) => {
                const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime()
                if (dateDiff !== 0) return dateDiff
                const typeOrder: Record<string,number> = { overall: 0, prospect: 1 }
                return (typeOrder[a.rankType??'overall']??2) - (typeOrder[b.rankType??'overall']??2)
              })
              return (
                <div style={{display:'flex',gap:'0.75rem',flexWrap:'wrap',marginBottom:'1rem'}}>
                  {rows.map((a,i)=>{
                    const d=new Date(a.date);const mon=d.toLocaleString('en-US',{month:'short'});const yr=String(d.getFullYear()).slice(2)
                    return (
                      <div key={i} style={{fontSize:'0.72rem',fontFamily:'var(--font-display)',whiteSpace:'nowrap'}}>
                        <span style={{color:'var(--text)',fontWeight:600}}>{a.sourceName}</span>
                        {' '}<span style={{color:'var(--muted)'}}>{mon}'{yr}</span>
                        {a.rank!=null&&<span style={{color:'#7dd3fc',fontWeight:700}}> #{a.rank}</span>}
                        {a.delta!=null&&a.delta!==0&&(
                          <span style={{color:a.delta>0?'#4ade80':'#f87171',fontWeight:600}}>
                            {' '}({a.delta>0?'↑':'↓'}{Math.abs(a.delta)})
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
            {bio&&(<div style={{display:'flex',gap:'1.5rem',flexWrap:'wrap'}}>{[{label:'B/T',val:`${bio.batSide?.code??'?'}/${bio.pitchHand?.code??'?'}`},{label:'HT/WT',val:bio.height&&bio.weight?`${bio.height} · ${bio.weight} lbs`:null},{label:'Born',val:bio.birthDate?`${bio.birthDate}${bio.birthCity?` · ${bio.birthCity}${bio.birthStateProvince?`, ${bio.birthStateProvince}`:''}`:''} `:null},{label:'Debut',val:bio.mlbDebutDate??null},{label:'Draft',val:bio.draftYear?`${bio.draftYear}`:null}].filter(x=>x.val).map(({label,val})=>(<div key={label}><div style={{fontSize:'0.62rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'2px'}}>{label}</div><div style={{fontSize:'0.78rem',color:'var(--text)'}}>{val}</div></div>))}</div>)}
            {tiles&&(tiles as any[]).length>0&&(<div style={{display:'flex',gap:'0.75rem',width:'100%',maxWidth:480}}>{(tiles as any[]).map((tile:any)=>(<div key={tile.label} style={{background:'rgba(255,255,255,0.04)',border:'1px solid var(--border)',borderRadius:8,padding:'0.4rem 0.6rem',flex:1,textAlign:'center'}}>
  <div style={{fontSize:'0.6rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--muted)',marginBottom:'0.25rem'}}>{tile.label}</div>
  <div style={{fontSize:'1.1rem',fontWeight:700,color:tile.color??'var(--accent)',fontFamily:'var(--font-display)'}}>{tile.val}</div>
  {(tile.raw!=null||tile.conf!=null)&&(
    <div style={{display:'flex',justifyContent:'center',gap:'0.5rem',marginTop:'0.3rem'}}>
      {tile.raw!=null&&<div style={{fontSize:'0.6rem',fontFamily:'var(--font-display)',color:'rgba(150,150,150,0.7)'}} title="Raw (ceiling)">▲{Math.round(tile.raw)}</div>}
      {tile.conf!=null&&<div style={{fontSize:'0.6rem',fontFamily:'var(--font-display)',color:'rgba(150,150,150,0.7)'}} title="Confidence">{tile.conf}%</div>}
    </div>
  )}
  {(()=>{
    const key = tile.label==='HIT+'?'hit':tile.label==='PWR+'?'power':tile.label==='STF+'||tile.label==='Stuff+'?'stuff':tile.label==='CTL+'||tile.label==='Ctrl+'?'control':null
    const hs = key && handednessSplits ? (handednessSplits as any)[key] : null
    if (!hs) return null
    const lLabel = pitch ? 'L' : 'L'
    const rLabel = pitch ? 'R' : 'R'
    return (
      <div style={{display:'flex',justifyContent:'center',gap:'0.4rem',marginTop:'0.3rem',fontSize:'0.6rem',fontFamily:'var(--font-display)'}}>
        <span style={{color:'rgba(150,150,150,0.5)'}}>{lLabel}</span>
        <span style={{fontWeight:700,color:hs.L!=null?toolColor(hs.L):'var(--muted)'}}>{hs.L??'—'}</span>
        <span style={{color:'rgba(150,150,150,0.3)'}}>·</span>
        <span style={{color:'rgba(150,150,150,0.5)'}}>{rLabel}</span>
        <span style={{fontWeight:700,color:hs.R!=null?toolColor(hs.R):'var(--muted)'}}>{hs.R??'—'}</span>
      </div>
    )
  })()}
  {tile.label==='HIT+'&&toolGrades?.hit_approach&&(
    <div style={{fontSize:'0.6rem',fontFamily:'var(--font-display)',color:'rgba(150,150,150,0.7)',marginTop:'0.3rem'}} title="Plate-approach qualifier: contact half (AVG+K%) vs. discipline half (BB%) of the Hit+ grade diverge notably">{toolGrades.hit_approach}</div>
  )}
</div>))}</div>)}
            {toolGrades&&(toolGrades.archetype!=null||toolGrades.peak3!=null||toolGrades.worthy_pct!=null||toolGrades.worthy_actual!=null||toolGrades.comp_ceiling!=null||toolGrades.comp_floor!=null)&&(
              <div style={{display:'flex',gap:'1.5rem',flexWrap:'wrap'}}>
                {toolGrades.archetype!=null&&(
                  <div>
                    <div style={{fontSize:'0.62rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'2px'}} title="Descriptive profile from the tool grades above (Below Avg ≤92 / Average 93-107 / Plus 108-122 / Plus-Plus 123+)">Archetype</div>
                    <div style={{fontSize:'0.78rem',color:'var(--text)',fontWeight:700}}>{toolGrades.archetype}</div>
                  </div>
                )}
                {toolGrades.peak3!=null&&(
                  <div>
                    <div style={{fontSize:'0.62rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'2px'}} title="Best rolling 3-year MLB window (actual for graduated players, projected from MiLB record otherwise)">Peak (3yr)</div>
                    <div style={{fontSize:'0.78rem',color:toolColor(toolGrades.peak3),fontWeight:700}}>{toolGrades.peak3}</div>
                  </div>
                )}
                {toolGrades.worthy_pct!=null&&(
                  <div>
                    <div style={{fontSize:'0.62rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'2px'}} title="Projected probability of an above-average MLB career (>=1500 PA / 300 IP at league-average or better), calibrated against past prospects">MLB Odds</div>
                    <div style={{fontSize:'0.78rem',color:'var(--text)',fontWeight:700}}>{toolGrades.worthy_pct}%</div>
                  </div>
                )}
                {toolGrades.worthy_actual!=null&&(
                  <div>
                    <div style={{fontSize:'0.62rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'2px'}} title="Realized: did this player's MLB career clear >=1500 PA / 300 IP at league-average or better">MLB Odds</div>
                    <div style={{fontSize:'0.78rem',color:toolGrades.worthy_actual===1?'#4ade80':'#f87171',fontWeight:700}}>{toolGrades.worthy_actual===1?'Yes':'No'}</div>
                  </div>
                )}
                {toolGrades.comp_ceiling!=null&&(
                  <div>
                    <div style={{fontSize:'0.62rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'2px'}} title="Nearest real MLB comps by tool grade (same role, weighted by tool importance) — the one whose realized peak (3yr) sits closest to the 90th percentile of that comp pool">Ceiling Comp</div>
                    <div style={{fontSize:'0.78rem',color:'#4ade80',fontWeight:700}}>{toolGrades.comp_ceiling.name}</div>
                  </div>
                )}
                {toolGrades.comp_floor!=null&&(
                  <div>
                    <div style={{fontSize:'0.62rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'2px'}} title="Nearest real MLB comps by tool grade (same role, weighted by tool importance) — the one whose realized career overall sits closest to the 25th percentile of that comp pool">Floor Comp</div>
                    <div style={{fontSize:'0.78rem',color:'#f87171',fontWeight:700}}>{toolGrades.comp_floor.name}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {activeTab==='stats'&&(<>
            <SectionHeader title={`${pitch?'Pitching':'Hitting'} — Career`} extra={milbRows.length>0?(<label style={{display:'flex',alignItems:'center',gap:'0.4rem',cursor:'pointer',fontSize:'0.75rem',fontFamily:'var(--font-display)',color:'var(--muted)'}}><input type="checkbox" checked={showMinors} onChange={e=>setShowMinors(e.target.checked)} style={{accentColor:'var(--accent)',cursor:'pointer'}}/>Show Minors</label>):undefined}/>
            {!mlbamId&&<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No MLB ID linked — run Link Player IDs on the Sync page.</div>}
            {mlbamId&&drawerLoading&&<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>Loading...</div>}
            {mlbamId&&error&&<div style={{color:'#ef4444',fontSize:'0.85rem'}}>{error}</div>}
            {mlbamId&&!drawerLoading&&allSplits.length===0&&<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No stats available.</div>}
            {mlbamId&&!drawerLoading&&allSplits.length>0&&(
              <div style={{overflowX:'auto',marginBottom:'0.5rem'}}>
                <table style={{borderCollapse:'collapse',minWidth:'max-content'}}>
                  <thead><tr style={{borderBottom:'1px solid var(--border)'}}>{headers.map(h=><th key={h} style={{padding:'0.25rem 0.45rem',textAlign:h==='Year'||h==='Team'||h==='Lev'?'left':'right',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.62rem',letterSpacing:'0.08em',color:'var(--muted)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {yearGroups.map(([year,yRows])=>{const isExpanded=expandedYears.has(year);const toggle=()=>setExpandedYears(prev=>{const next=new Set(prev);if(next.has(year))next.delete(year);else next.add(year);return next});if(yRows.length===1)return pitch?renderPitchRow(yRows[0],`row-${year}-0`):renderBatRow(yRows[0],`row-${year}-0`);return(<React.Fragment key={year}>{pitch?renderPitchSumRow(year,yRows,isExpanded,toggle):renderBatSumRow(year,yRows,isExpanded,toggle)}{isExpanded&&[...yRows].sort((a,b)=>levelSortVal(a._level)-levelSortVal(b._level)).map((s,i)=>pitch?renderPitchRow(s,`row-${year}-${i}`,true):renderBatRow(s,`row-${year}-${i}`,true))}</React.Fragment>)})}
                    {mlbTotal&&(pitch?renderPitchTotalRow('MLB Total',mlbTotal):renderBatTotalRow('MLB Total',mlbTotal))}
                    {showMinors&&minorsTotal&&(pitch?renderPitchTotalRow('Minors Total',minorsTotal):renderBatTotalRow('Minors Total',minorsTotal))}
                    {renderFantasyPeakRow()}
                  </tbody>
                </table>
              </div>
            )}
            {(gameArcPoints.length>0||arcPoints.length>0)&&(()=>{
              // Prepend yearly arc points for years not covered by per-game arc
              const gameYears = new Set(gameArcPoints.map((p:any)=>p.year))
              const prefix = arcPoints.filter((p:any)=>!gameYears.has(p.year))
              const unifiedPts = gameArcPoints.length>0 ? [...prefix, ...gameArcPoints] : arcPoints
              const hasMlb = gameArcPoints.some((p:any) => p.isMlb)
              const visiblePts = (() => {
                if (!hasMlb || arcMode==='full') return unifiedPts
                if (arcMode==='milb') return unifiedPts.filter((p:any) => !p.isMlb)
                // mlb mode: MLB points only, with last MiLB as anchor for continuity
                const mlbOnly = unifiedPts.filter((p:any) => p.isMlb)
                const lastMilb = [...unifiedPts].reverse().find((p:any) => !p.isMlb)
                return lastMilb ? [lastMilb, ...mlbOnly] : mlbOnly
              })()
              const inDateMode = gameArcPoints.length>0
              const toggleExtra = hasMlb ? (
                <div style={{display:'flex',gap:'0.25rem'}}>
                  {(['milb','mlb','full'] as const).map(m=>(
                    <button key={m} onClick={()=>setArcMode(m)} style={{
                      padding:'0.2rem 0.45rem',fontSize:'0.6rem',fontFamily:'var(--font-display)',
                      fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',
                      background:arcMode===m?'var(--accent)':'transparent',
                      color:arcMode===m?'#000':'var(--muted)',
                      border:`1px solid ${arcMode===m?'var(--accent)':'var(--border)'}`,
                      borderRadius:4,cursor:'pointer'
                    }}>{m==='milb'?'MiLB':m==='mlb'?'MLB':'Full'}</button>
                  ))}
                </div>
              ) : undefined
              return <>
                <SectionHeader title="Tool Arc — Career Trajectory" extra={toggleExtra}/>
                <ToolArcChart points={visiblePts} isPitcher={pitch} dateMode={inDateMode}/>
              </>
            })()}
            {mlbamId&&!drawerLoading&&(<><SectionHeader title="Recent — L7 / L30 / L90"/>{extraLoading?<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>Loading...</div>:renderRecentTable()}<SectionHeader title={pitch?"Splits — vs LHB/RHB · Home/Away":"Splits — vs LHP/RHP · Home/Away"}/>{extraLoading?<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>Loading...</div>:renderSplitTable()}<SectionHeader title="Game Log — Last 90 Days"/>{extraLoading?<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>Loading...</div>:renderGameLog()}</>)}
          </>)}

          {activeTab==='statcast'&&(
            <StatcastPanel rows={statcastRows} loading={statcastLoading} isPitcher={pitch} stand={bio?.batSide?.code??'R'}/>
          )}
        </div>
      </div>
    </>
  )
}
