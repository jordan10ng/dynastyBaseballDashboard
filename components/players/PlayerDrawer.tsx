'use client'
import { fmtLevel } from '@/lib/players-config'
import React, { useState, useEffect, useMemo } from 'react'
import { StatcastPanel, parseStatcastCSV } from './StatcastPanel'
import { isPitcher, cleanPositions, toolColor, LEAGUES, MY_TEAM } from '../../lib/players-config'
import { sportAbbrToLevel, isMlbLevel, levelSortVal, sumBatStats, sumPitchStats, calcKPct, calcBBPct, stripLeadingZero } from '../../lib/drawer-utils'

const LEVEL_ORDER = ['ROK','A','A+','AA','AAA','MLB','Other']

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

export function PlayerDrawer({ player, onClose, globalOwnership, minorsIds, mlbToolsMap, statsMap, allPlayers }: {
  player: any; onClose: () => void; globalOwnership: Record<string, Record<string, string>>
  minorsIds: Set<string>; mlbToolsMap: Record<string, any>; statsMap: Record<string, any>; allPlayers: any[]
}) {
  const [bio, setBio] = useState<any>(null)
  const [allSplits, setAllSplits] = useState<any[]>([])
  const [situSplits, setSituSplits] = useState<any[]>([])
  const [gameLogs, setGameLogs] = useState<any[]>([])
  const [statcastRows, setStatcastRows] = useState<any[]>([])
  const [drawerLoading, setDrawerLoading] = useState(true)
  const [extraLoading, setExtraLoading] = useState(true)
  const [statcastLoading, setStatcastLoading] = useState(true)
  const [error, setError] = useState('')
  const [showMinors, setShowMinors] = useState(true)
  const [activeTab, setActiveTab] = useState<'stats'|'statcast'>('stats')
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set())

  const pitch = isPitcher(player.positions)
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

  const toolGrades = useMemo(() => {
    const mlbEntry = mlbamId ? mlbToolsMap[String(mlbamId)] : null
    const model = player.model_scores
    const withOvr = (t: any) => {
      if (t.overall != null) return t
      const isPit = t.type === 'pitcher'
      let overall = null
      if (isPit && t.stuff!=null && t.control!=null) overall=Math.round(t.stuff*0.70+t.control*0.30)
      else if (!isPit && t.hit!=null && t.power!=null && t.speed!=null) overall=Math.round(t.hit*0.42+t.power*0.47+t.speed*0.11)
      else if (!isPit && t.hit!=null && t.power!=null) overall=Math.round((t.hit*0.42+t.power*0.47)/0.89)
      return { ...t, overall }
    }
    if (!mlbEntry) return model ?? null
    if (!model) return withOvr(mlbEntry)
    const mlbSample = mlbEntry._pa ?? mlbEntry._bf ?? 0
    const milbSample = model._sample ?? 0
    const total = mlbSample + milbSample
    if (total === 0) return withOvr(mlbEntry)
    const mlbW = mlbSample / total
    const milbW = milbSample / total
    const bv = (a: any, b: any) => a == null && b == null ? null : a == null ? b : b == null ? a : Math.round(a*mlbW + b*milbW)
    const isPit = mlbEntry.type === 'pitcher'
    if (isPit) {
      const stuff = bv(mlbEntry.stuff, model.stuff)
      const control = bv(mlbEntry.control, model.control)
      const overall = stuff != null && control != null ? Math.round(stuff*0.70+control*0.30) : null
      return { stuff, control, overall, type: 'pitcher', _raw: model._raw, _confidence: model._confidence, _sample: milbSample, _mlbSample: mlbSample }
    } else {
      const hit   = bv(mlbEntry.hit,   model.hit)
      const power = bv(mlbEntry.power, model.power)
      const speed = bv(mlbEntry.speed, model.speed)
      const overall = hit != null && power != null && speed != null ? Math.round(hit*0.42+power*0.47+speed*0.11) : null
      return { hit, power, speed, overall, type: 'hitter', _raw: model._raw, _confidence: model._confidence, _sample: milbSample, _mlbSample: mlbSample }
    }
  }, [mlbamId, mlbToolsMap, player.model_scores])

  const tiles = useMemo(() => {
    if (!toolGrades) return []
    // Hide raw ceiling + confidence for graduated players (blended tools)
    const isBlended = toolGrades._mlbSample != null
    const raw = (key: string) => isBlended ? null : (toolGrades._raw?.[key] ?? null)
    const conf = (key: string) => isBlended ? null : (toolGrades._confidence?.[key] ?? null)
    if (pitch) return [
      toolGrades.stuff!=null?{label:'STF+',val:toolGrades.stuff,color:toolColor(toolGrades.stuff),raw:raw('stuff'),conf:conf('stuff')}:null,
      toolGrades.control!=null?{label:'CTL+',val:toolGrades.control,color:toolColor(toolGrades.control),raw:raw('control'),conf:conf('control')}:null,
      toolGrades.overall!=null?{label:'OVR+',val:toolGrades.overall,color:toolColor(toolGrades.overall)}:null,
    ].filter(Boolean)
    return [
      toolGrades.hit!=null?{label:'HIT+',val:toolGrades.hit,color:toolColor(toolGrades.hit),raw:raw('hit'),conf:conf('hit')}:null,
      toolGrades.power!=null?{label:'PWR+',val:toolGrades.power,color:toolColor(toolGrades.power),raw:raw('power'),conf:conf('power')}:null,
      toolGrades.speed!=null?{label:'SPD+',val:toolGrades.speed,color:toolColor(toolGrades.speed),raw:raw('speed'),conf:conf('speed')}:null,
      toolGrades.overall!=null?{label:'OVR+',val:toolGrades.overall,color:toolColor(toolGrades.overall)}:null,
    ].filter(Boolean)
  }, [toolGrades, pitch])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key==='Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    if (!mlbamId) { setDrawerLoading(false); setExtraLoading(false); return }
    setDrawerLoading(true); setExtraLoading(true); setError('')
    Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}?hydrate=currentTeam`).then(r=>r.json()),
      fetch(`/api/stats/history/${mlbamId}`).then(r=>r.json()),
    ]).then(([peopleData,histData]) => {
      setBio(peopleData.people?.[0]??null)
      const splits = (histData.splits ?? [])
        .filter((s:any) => s.type === (pitch ? 'pitching' : 'hitting'))
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
    ]).then(([situData,milbSituData,gameLogData,milbGameLogData])=>{
      const mlbSitu=situData.stats?.[0]?.splits??[]
      const milbSitu=milbSituData.stats?.[0]?.splits??[]
      const mergedSitu=mlbSitu.length>0?mlbSitu:milbSitu
      setSituSplits(mergedSitu)
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
  function renderPitchRow(s:any,key:string,indent?:boolean){const st=s.stat;const isMR=!isMlbLevel(s._level);return(<tr key={key} style={{borderBottom:'1px solid rgba(48,54,61,0.3)',background:isMR?'rgba(99,102,241,0.04)':'transparent'}}><LabelCell label={indent?'':s.season}/><LabelCell label={s.team?.abbreviation??s.team?.name??'—'} muted/><LabelCell label={fmtLevel(s._level)} muted={!isMR} color={isMR?'rgba(139,92,246,0.7)':undefined}/><StatCell val={st?.gamesPlayed}/><StatCell val={fmtWL(st)}/><StatCell val={st?.inningsPitched}/><StatCell val={st?.avg}/><StatCell val={st?.era}/><StatCell val={st?.whip}/><StatCell val={st?.hits}/><StatCell val={st?.runs}/><StatCell val={st?.earnedRuns}/><StatCell val={st?.homeRuns}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={calcKPct(st,true)}/><StatCell val={calcBBPct(st,true)}/><StatCell val={calcKBBPct(st)}/></tr>)}

  function renderBatSumRow(year:string,rows:any[],isExpanded:boolean,onToggle:()=>void){const summed=sumBatStats(rows);const teams=Array.from(new Set(rows.map((s:any)=>s.team?.abbreviation??s.team?.name).filter(Boolean)));const teamLabel=teams.length>1?'mult.':(teams[0]??'—');const levels=Array.from(new Set(rows.map((s:any)=>s._level))).sort((a,b)=>levelSortVal(a)-levelSortVal(b));const hasMinor=rows.some((s:any)=>!isMlbLevel(s._level));return(<tr key={`sum-${year}`} onClick={onToggle} style={{borderBottom:'1px solid rgba(48,54,61,0.5)',background:'rgba(255,255,255,0.02)',cursor:'pointer'}}><td style={{padding:'0.3rem 0.45rem',fontSize:'0.76rem',fontFamily:'var(--font-display)',fontWeight:700,color:'var(--text)',whiteSpace:'nowrap'}}><span style={{marginRight:4,fontSize:'0.6rem',opacity:0.6}}>{isExpanded?'▼':'▶'}</span>{year}</td><LabelCell label={teamLabel} muted/><LabelCell label={levels.join(', ')} muted/><StatCell val={summed?.gamesPlayed} bold/><StatCell val={summed?.avg} bold/><StatCell val={summed?.obp} bold/><StatCell val={summed?.slg} bold/><StatCell val={summed?.ops} bold/><StatCell val={summed?.strikeOuts} bold/><StatCell val={summed?.baseOnBalls} bold/><StatCell val={summed?.plateAppearances} bold/><StatCell val={summed?.atBats} bold/><StatCell val={summed?.hits} bold/><StatCell val={summed?.doubles} bold/><StatCell val={summed?.triples} bold/><StatCell val={summed?.homeRuns} bold/><StatCell val={summed?.runs} bold/><StatCell val={summed?.rbi} bold/><StatCell val={summed?.stolenBases} bold/><StatCell val={summed?.caughtStealing} bold/><StatCell val={calcISO(summed)} bold/><StatCell val={calcKPct(summed,false)} bold/><StatCell val={calcBBPct(summed,false)} bold/><StatCell val={calcXBHPct(summed)} bold/></tr>)}
  function renderPitchSumRow(year:string,rows:any[],isExpanded:boolean,onToggle:()=>void){const summed=sumPitchStats(rows);const teams=Array.from(new Set(rows.map((s:any)=>s.team?.abbreviation??s.team?.name).filter(Boolean)));const teamLabel=teams.length>1?'mult.':(teams[0]??'—');const levels=Array.from(new Set(rows.map((s:any)=>s._level))).sort((a,b)=>levelSortVal(a)-levelSortVal(b));const hasMinor=rows.some((s:any)=>!isMlbLevel(s._level));return(<tr key={`sum-${year}`} onClick={onToggle} style={{borderBottom:'1px solid rgba(48,54,61,0.5)',background:'rgba(255,255,255,0.02)',cursor:'pointer'}}><td style={{padding:'0.3rem 0.45rem',fontSize:'0.76rem',fontFamily:'var(--font-display)',fontWeight:700,color:'var(--text)',whiteSpace:'nowrap'}}><span style={{marginRight:4,fontSize:'0.6rem',opacity:0.6}}>{isExpanded?'▼':'▶'}</span>{year}</td><LabelCell label={teamLabel} muted/><LabelCell label={levels.join(', ')} muted/><StatCell val={summed?.gamesPlayed} bold/><StatCell val={fmtWL(summed)} bold/><StatCell val={summed?.inningsPitched} bold/><StatCell val={summed?.oAvg??summed?.avg} bold/><StatCell val={summed?.era} bold/><StatCell val={summed?.whip} bold/><StatCell val={summed?.hits} bold/><StatCell val={summed?.runs} bold/><StatCell val={summed?.earnedRuns} bold/><StatCell val={summed?.homeRuns} bold/><StatCell val={summed?.baseOnBalls} bold/><StatCell val={summed?.strikeOuts} bold/><StatCell val={calcKPct(summed,true)} bold/><StatCell val={calcBBPct(summed,true)} bold/><StatCell val={calcKBBPct(summed)} bold/></tr>)}
  function renderBatTotalRow(label:string,st:any){return(<tr key={label} style={{background:'rgba(255,255,255,0.03)',borderTop:'1px solid var(--border)'}}><LabelCell label={label} bold/><td/><td/><StatCell val={st?.gamesPlayed} bold/><StatCell val={st?.avg} bold/><StatCell val={st?.obp} bold/><StatCell val={st?.slg} bold/><StatCell val={st?.ops} bold/><StatCell val={st?.strikeOuts} bold/><StatCell val={st?.baseOnBalls} bold/><StatCell val={st?.plateAppearances} bold/><StatCell val={st?.atBats} bold/><StatCell val={st?.hits} bold/><StatCell val={st?.doubles} bold/><StatCell val={st?.triples} bold/><StatCell val={st?.homeRuns} bold/><StatCell val={st?.runs} bold/><StatCell val={st?.rbi} bold/><StatCell val={st?.stolenBases} bold/><StatCell val={st?.caughtStealing} bold/><StatCell val={calcISO(st)} bold/><StatCell val={calcKPct(st,false)} bold/><StatCell val={calcBBPct(st,false)} bold/><StatCell val={calcXBHPct(st)} bold/></tr>)}
  function renderPitchTotalRow(label:string,st:any){return(<tr key={label} style={{background:'rgba(255,255,255,0.03)',borderTop:'1px solid var(--border)'}}><LabelCell label={label} bold/><td/><td/><StatCell val={st?.gamesPlayed} bold/><StatCell val={fmtWL(st)} bold/><StatCell val={st?.inningsPitched} bold/><StatCell val={st?.oAvg??st?.avg} bold/><StatCell val={st?.era} bold/><StatCell val={st?.whip} bold/><StatCell val={st?.hits} bold/><StatCell val={st?.runs} bold/><StatCell val={st?.earnedRuns} bold/><StatCell val={st?.homeRuns} bold/><StatCell val={st?.baseOnBalls} bold/><StatCell val={st?.strikeOuts} bold/><StatCell val={calcKPct(st,true)} bold/><StatCell val={calcBBPct(st,true)} bold/><StatCell val={calcKBBPct(st)} bold/></tr>)}

  function renderRecentTable(){if(!lWindows)return<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No recent games.</div>;const rows=[['L7',lWindows.l7],['L30',lWindows.l30],['L90',lWindows.l90]].filter(([,st])=>st);if(!rows.length)return null;const hdrs=pitch?['Period','G','W-L','IP','ERA','WHIP','BB','SO','K%','BB%','K-BB%']:['Period','G','BA','OBP','SLG','OPS','PA','HR','RBI','R','SB','K%','BB%'];return(<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',minWidth:'max-content'}}><thead><tr style={{borderBottom:'1px solid var(--border)'}}>{hdrs.map(h=><th key={h} style={{padding:'0.25rem 0.45rem',textAlign:h==='Period'?'left':'right',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.62rem',letterSpacing:'0.08em',color:'var(--muted)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead><tbody>{rows.map(([lbl,st]:any)=>pitch?(<tr key={lbl} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={lbl} bold/><StatCell val={st?.gamesPlayed}/><StatCell val={fmtWL(st)}/><StatCell val={st?.inningsPitched}/><StatCell val={st?.era}/><StatCell val={st?.whip}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={calcKPct(st,true)}/><StatCell val={calcBBPct(st,true)}/><StatCell val={calcKBBPct(st)}/></tr>):(<tr key={lbl} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={lbl} bold/><StatCell val={st?.gamesPlayed}/><StatCell val={st?.avg}/><StatCell val={st?.obp}/><StatCell val={st?.slg}/><StatCell val={st?.ops}/><StatCell val={st?.plateAppearances}/><StatCell val={st?.homeRuns}/><StatCell val={st?.rbi}/><StatCell val={st?.runs}/><StatCell val={st?.stolenBases}/><StatCell val={calcKPct(st,false)}/><StatCell val={calcBBPct(st,false)}/></tr>))}</tbody></table></div>)}

  function renderSplitTable(){const relevant=['vl','vr','h','a'].map(code=>situSplits.find((s:any)=>s.split?.code===code)).filter(Boolean);if(!relevant.length)return<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No splits available for current season.</div>;const hdrs=pitch?['Split','G','W-L','IP','BAA','ERA','WHIP','BB','SO','K%','BB%','K-BB%']:['Split','G','BA','OBP','SLG','OPS','PA','HR','RBI','R','SB','K%','BB%'];return(<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',minWidth:'max-content'}}><thead><tr style={{borderBottom:'1px solid var(--border)'}}>{hdrs.map(h=><th key={h} style={{padding:'0.25rem 0.45rem',textAlign:h==='Split'?'left':'right',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.62rem',letterSpacing:'0.08em',color:'var(--muted)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead><tbody>{relevant.map((s:any,i)=>{const st=s.stat;const lbl=splitLabels[s.split?.code]??s.split?.description??s.split?.code;return pitch?(<tr key={i} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={lbl}/><StatCell val={st?.gamesPlayed}/><StatCell val={fmtWL(st)}/><StatCell val={st?.inningsPitched}/><StatCell val={st?.avg}/><StatCell val={st?.era}/><StatCell val={st?.whip}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={calcKPct(st,true)}/><StatCell val={calcBBPct(st,true)}/><StatCell val={calcKBBPct(st)}/></tr>):(<tr key={i} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={lbl}/><StatCell val={st?.gamesPlayed}/><StatCell val={st?.avg}/><StatCell val={st?.obp}/><StatCell val={st?.slg}/><StatCell val={st?.ops}/><StatCell val={st?.plateAppearances}/><StatCell val={st?.homeRuns}/><StatCell val={st?.rbi}/><StatCell val={st?.runs}/><StatCell val={st?.stolenBases}/><StatCell val={calcKPct(st,false)}/><StatCell val={calcBBPct(st,false)}/></tr>)})}</tbody></table></div>)}

  function renderGameLog(){if(!gameLogs.length)return<div style={{color:'var(--muted)',fontSize:'0.85rem'}}>No games in last 90 days.</div>;const hdrs=pitch?['Date','Opp','Dec','IP','H','R','ER','BB','SO','ERA','WHIP']:['Date','Opp','AB','R','H','2B','3B','HR','RBI','SB','BB','SO','BA'];return(<div style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',minWidth:'max-content'}}><thead><tr style={{borderBottom:'1px solid var(--border)'}}>{hdrs.map(h=><th key={h} style={{padding:'0.25rem 0.45rem',textAlign:h==='Date'||h==='Opp'||h==='Dec'?'left':'right',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.62rem',letterSpacing:'0.08em',color:'var(--muted)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead><tbody>{gameLogs.map((g:any,i)=>{const st=g.stat;const opp=g.opponent?.abbreviation??g.opponent?.name??'—';const oppStr=g.isHome?opp:`@${opp}`;return pitch?(<tr key={i} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={g.date?.slice(0,10)??'—'} muted/><LabelCell label={oppStr} muted/><LabelCell label={st?.note??'—'} muted/><StatCell val={st?.inningsPitched}/><StatCell val={st?.hits}/><StatCell val={st?.runs}/><StatCell val={st?.earnedRuns}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={st?.era}/><StatCell val={st?.whip}/></tr>):(<tr key={i} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><LabelCell label={g.date?.slice(0,10)??'—'} muted/><LabelCell label={oppStr} muted/><StatCell val={st?.atBats}/><StatCell val={st?.runs}/><StatCell val={st?.hits}/><StatCell val={st?.doubles}/><StatCell val={st?.triples}/><StatCell val={st?.homeRuns}/><StatCell val={st?.rbi}/><StatCell val={st?.stolenBases}/><StatCell val={st?.baseOnBalls}/><StatCell val={st?.strikeOuts}/><StatCell val={st?.avg}/></tr>)})}</tbody></table></div>)}

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
                {player.rank&&<span style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.7rem',color:'var(--muted)',background:'rgba(255,255,255,0.05)',padding:'2px 6px',borderRadius:4}}>#{player.rank}{posRank?` · ${primaryPos} #${posRank}`:''}</span>}
              </div>
              <div style={{display:'flex',gap:'0.5rem',alignItems:'center',marginTop:'0.25rem',flexWrap:'wrap'}}>
                <span style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.72rem',color:'var(--accent)'}}>{cleanPositions(player.positions)}</span>
                <span style={{color:'var(--muted)',fontSize:'0.8rem'}}>{player.team}</span>
                {player.age&&<span style={{color:'var(--muted)',fontSize:'0.8rem'}}>Age {player.age}</span>}
                <span style={{color:'rgba(100,100,100,0.4)',fontSize:'0.8rem'}}>·</span>
                {LEAGUES.map(league=>{const teamName=pOwnership[league.id];const FRIEND_COLORS:Record<string,string>={'Winston Salem Dash':'#22c55e','Bay Area Bush League':'#a78bfa','Team Colin':'#38bdf8','Team Pat':'#fb923c','The Old Gold and Black':'#e879f9'};const fc=league.id==='d3prsagvmgftfdc3'?(teamName?FRIEND_COLORS[teamName]??null:null):null;const color=teamName?(fc??'#eab308'):'#ef4444';return(<div key={league.id} style={{display:'flex',alignItems:'center',gap:'0.25rem'}}><div style={{width:'6px',height:'6px',borderRadius:'50%',background:color}}/><span style={{fontSize:'0.7rem',fontFamily:'var(--font-display)',color:'var(--muted)'}}>{league.label}{teamName?` · ${teamName}`:''}</span></div>)})}
              </div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',color:'var(--muted)',cursor:'pointer',fontSize:'1.4rem',lineHeight:1,padding:'0.25rem',flexShrink:0}}>✕</button>
          </div>
          <div style={{maxWidth:1400,margin:'0.75rem auto 0',display:'flex',gap:'0.25rem'}}>
            {(['stats','statcast'] as const).map(tab=>(
              <button key={tab} onClick={()=>setActiveTab(tab)} style={{padding:'0.35rem 1rem',borderRadius:'6px 6px 0 0',border:'1px solid',borderBottom:'none',borderColor:activeTab===tab?'var(--border)':'transparent',background:activeTab===tab?'rgba(255,255,255,0.04)':'transparent',color:activeTab===tab?'var(--text)':'var(--muted)',fontFamily:'var(--font-display)',fontWeight:700,fontSize:'0.72rem',letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer'}}>
                {tab==='stats'?'Stats':`Statcast ${statcastLoading&&mlbamId?'·':''}`}
              </button>
            ))}
          </div>
        </div>

        <div style={{padding:'1.5rem 2rem',maxWidth:1400,margin:'0 auto',width:'100%',boxSizing:'border-box'}}>
          <div style={{display:'flex',gap:'2rem',alignItems:'flex-start',flexWrap:'wrap',marginBottom:'1.5rem'}}>
            {bio&&(<div style={{display:'flex',gap:'1.5rem',flexWrap:'wrap'}}>{[{label:'B/T',val:`${bio.batSide?.code??'?'}/${bio.pitchHand?.code??'?'}`},{label:'HT/WT',val:bio.height&&bio.weight?`${bio.height} · ${bio.weight} lbs`:null},{label:'Born',val:bio.birthDate?`${bio.birthDate}${bio.birthCity?` · ${bio.birthCity}${bio.birthStateProvince?`, ${bio.birthStateProvince}`:''}`:''} `:null},{label:'Debut',val:bio.mlbDebutDate??null},{label:'Draft',val:bio.draftYear?`${bio.draftYear}`:null}].filter(x=>x.val).map(({label,val})=>(<div key={label}><div style={{fontSize:'0.62rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.08em',color:'var(--muted)',textTransform:'uppercase',marginBottom:'2px'}}>{label}</div><div style={{fontSize:'0.78rem',color:'var(--text)'}}>{val}</div></div>))}</div>)}
            {tiles&&(tiles as any[]).length>0&&(<div style={{display:'flex',gap:'0.75rem',marginLeft:'auto'}}>{(tiles as any[]).map((tile:any)=>(<div key={tile.label} style={{background:'rgba(255,255,255,0.04)',border:'1px solid var(--border)',borderRadius:8,padding:'0.6rem 1rem',minWidth:80,textAlign:'center'}}>
  <div style={{fontSize:'0.6rem',fontFamily:'var(--font-display)',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--muted)',marginBottom:'0.25rem'}}>{tile.label}</div>
  <div style={{fontSize:'1.1rem',fontWeight:700,color:tile.color??'var(--accent)',fontFamily:'var(--font-display)'}}>{tile.val}</div>
  {(tile.raw!=null||tile.conf!=null)&&(
    <div style={{display:'flex',justifyContent:'center',gap:'0.5rem',marginTop:'0.3rem'}}>
      {tile.raw!=null&&<div style={{fontSize:'0.6rem',fontFamily:'var(--font-display)',color:'rgba(150,150,150,0.7)'}} title="Raw (ceiling)">▲{Math.round(tile.raw)}</div>}
      {tile.conf!=null&&<div style={{fontSize:'0.6rem',fontFamily:'var(--font-display)',color:'rgba(150,150,150,0.7)'}} title="Confidence">{tile.conf}%</div>}
    </div>
  )}
</div>))}</div>)}
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
                    {yearGroups.map(([year,yRows])=>{const isExpanded=expandedYears.has(year);const toggle=()=>setExpandedYears(prev=>{const next=new Set(prev);if(next.has(year))next.delete(year);else next.add(year);return next});if(yRows.length===1)return pitch?renderPitchRow(yRows[0],`row-${year}-0`):renderBatRow(yRows[0],`row-${year}-0`);return(<React.Fragment key={year}>{pitch?renderPitchSumRow(year,yRows,isExpanded,toggle):renderBatSumRow(year,yRows,isExpanded,toggle)}{isExpanded&&yRows.map((s,i)=>pitch?renderPitchRow(s,`row-${year}-${i}`,true):renderBatRow(s,`row-${year}-${i}`,true))}</React.Fragment>)})}
                    {mlbTotal&&(pitch?renderPitchTotalRow('MLB Total',mlbTotal):renderBatTotalRow('MLB Total',mlbTotal))}
                    {showMinors&&minorsTotal&&(pitch?renderPitchTotalRow('Minors Total',minorsTotal):renderBatTotalRow('Minors Total',minorsTotal))}
                  </tbody>
                </table>
              </div>
            )}
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
