'use client'
import { useState } from 'react'
import { parseStatcastCSV, PITCH_COLORS, PITCH_ORDER, n, pct, avg, fmtN, getStatColor } from '../../lib/statcast-utils'

export { parseStatcastCSV }

const ThCell = ({ children, left }: any) => (
  <th style={{ padding: '0.25rem 0.5rem', textAlign: left ? 'left' : 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.6rem', letterSpacing: '0.08em', color: 'var(--muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{children}</th>
)
const TdC = ({ v, color }: { v: string; color?: string }) => (
  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', fontSize: '0.76rem', fontFamily: 'var(--font-display)', fontWeight: 500, color: color ?? (v === '—' ? 'rgba(100,100,100,0.3)' : 'rgba(255,255,255,0.65)'), whiteSpace: 'nowrap' }}>{v}</td>
)

export function StatcastPanel({ rows, loading, isPitcher, stand }: { rows: any[]; loading: boolean; isPitcher: boolean; stand: string }) {
  const [selectedPitch, setSelectedPitch] = useState<string | null>(null)
  const scSecH = { margin: '2rem 0 0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--muted)' }
  const tileStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.875rem', textAlign: 'center' as const, minWidth: 80 }
  const tileLabel = { fontSize: '0.58rem', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--muted)', marginBottom: '0.2rem' }
  const tileVal = { fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--accent)' }

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: '0.85rem', paddingTop: '1rem' }}>Loading Statcast data...</div>
  if (!rows.length) return <div style={{ color: 'var(--muted)', fontSize: '0.85rem', paddingTop: '1rem' }}>No Statcast data available for current season.</div>

  const pitchGroups: Record<string, any[]> = {}
  for (const r of rows) {
    const pt = r.pitch_type
    if (!pt) continue
    if (!pitchGroups[pt]) pitchGroups[pt] = []
    pitchGroups[pt].push(r)
  }
  const pitchTypes = PITCH_ORDER.filter(pt => pitchGroups[pt])

  const isInZone = (r: any) => { const z = parseInt(r.zone); return z >= 1 && z <= 9 }
  const isSwing = (r: any) => ['hit_into_play','foul','swinging_strike','swinging_strike_blocked','foul_tip'].includes(r.description)
  const isContact = (r: any) => ['hit_into_play','foul','foul_tip'].includes(r.description)
  const isWhiff = (r: any) => ['swinging_strike','swinging_strike_blocked'].includes(r.description)

  const totalPitches = rows.length
  const zRows = rows.filter(isInZone)
  const oRows = rows.filter(r => !isInZone(r))
  const swings = rows.filter(isSwing)
  const zSwings = zRows.filter(isSwing)
  const oSwings = oRows.filter(isSwing)

  const contact = rows.filter(r => r.bb_type && r.launch_speed)
  const evs = contact.map(r => n(r.launch_speed)).filter(v => v > 0)
  evs.sort((a,b) => a-b)
  const avgEV = avg(evs)
  const maxEV = evs.length ? evs[evs.length-1] : 0
  const p90EV = evs.length ? evs[Math.floor(evs.length*0.9)] : 0
  const hardHit = contact.filter(r => n(r.launch_speed) >= 95)
  const barrels = contact.filter(r => r.launch_speed_angle === '6')
  const gb = contact.filter(r => r.bb_type === 'ground_ball')
  const ld = contact.filter(r => r.bb_type === 'line_drive')
  const fb = contact.filter(r => r.bb_type === 'fly_ball')
  const pu = contact.filter(r => r.bb_type === 'popup')
  const laVals = contact.map(r => n(r.launch_angle)).filter(v => !isNaN(v))
  const avgLA = avg(laVals)

  const paEvents = rows.filter(r => r.woba_denom === '1')
  const xbaVals = paEvents.map(r => n(r.estimated_ba_using_speedangle)).filter(v => v > 0)
  const xwoba = paEvents.map(r => n(r.estimated_woba_using_speedangle)).filter(v => v > 0)
  const xslg = paEvents.map(r => n(r.estimated_slg_using_speedangle)).filter(v => v > 0)

  function sprayDir(r: any): 'pull'|'center'|'oppo'|null {
    const hx = parseFloat(r.hc_x), hy = parseFloat(r.hc_y)
    if (isNaN(hx) || isNaN(hy) || hx <= 0 || hy <= 0) return null
    const dx = hx - 125.42, dy = 198.27 - hy
    const deg = Math.atan2(dy, dx) * (180 / Math.PI)
    let side: 'left'|'center'|'right'
    if (deg > 105) side = 'left'
    else if (deg < 75) side = 'right'
    else side = 'center'
    if (side === 'center') return 'center'
    return stand === 'L' ? (side === 'right' ? 'pull' : 'oppo') : (side === 'left' ? 'pull' : 'oppo')
  }

  const withDir = contact.filter(r => sprayDir(r))
  const pull = withDir.filter(r => sprayDir(r)==='pull')
  const center = withDir.filter(r => sprayDir(r)==='center')
  const oppo = withDir.filter(r => sprayDir(r)==='oppo')
  const batSpeeds = rows.map(r => n(r.bat_speed)).filter(v => v > 0)
  const swingLens = rows.map(r => n(r.swing_length)).filter(v => v > 0)

  function calcTunnel(pitchRows: any[]) {
    const ax = avg(rows.map(r => n(r.release_pos_x))), az = avg(rows.map(r => n(r.release_pos_z)))
    const px = avg(pitchRows.map(r => n(r.release_pos_x))), pz = avg(pitchRows.map(r => n(r.release_pos_z)))
    return Math.min(10, Math.sqrt((px-ax)**2 + (pz-az)**2) * 2).toFixed(2)
  }

  function pitchStats(ptRows: any[]) {
    const swingR = ptRows.filter(isSwing), whiffR = ptRows.filter(isWhiff)
    const contactEVs = ptRows.filter(r => r.bb_type && r.launch_speed).map(r => n(r.launch_speed)).filter(v => v > 0)
    contactEVs.sort((a,b) => a-b)
    const hits = ptRows.filter(r => ['single','double','triple','home_run'].includes(r.events))
    const pas = ptRows.filter(r => r.woba_denom === '1')
    const xbaVs = pas.map(r => n(r.estimated_ba_using_speedangle)).filter(v=>v>0)
    return {
      count: ptRows.length,
      velo: avg(ptRows.map(r => n(r.release_speed)).filter(v=>v>0)),
      spin: avg(ptRows.map(r => n(r.release_spin_rate)).filter(v=>v>0)),
      ivb: avg(ptRows.map(r => n(r.pfx_z) * 12).filter(v=>!isNaN(v) && v !== 0)),
      hbreak: avg(ptRows.map(r => n(r.pfx_x) * 12).filter(v=>!isNaN(v) && v !== 0)),
      ext: avg(ptRows.map(r => n(r.release_extension)).filter(v=>v>0)),
      relH: avg(ptRows.map(r => n(r.release_pos_z)).filter(v=>v>0)),
      armAngle: avg(ptRows.map(r => n(r.arm_angle)).filter(v=>!isNaN(v))),
      whiffPct: swingR.length ? whiffR.length/swingR.length*100 : 0,
      avgEV: avg(contactEVs),
      p90EV: contactEVs.length ? contactEVs[Math.floor(contactEVs.length*0.9)] : 0,
      maxEV: contactEVs.length ? contactEVs[contactEVs.length-1] : 0,
      ba: hits.length && pas.length ? hits.length/pas.length : 0,
      xba: xbaVs.length ? avg(xbaVs) : 0,
      tunnel: calcTunnel(ptRows),
      plx: avg(ptRows.map(r => n(r.plate_x)).filter(v=>!isNaN(v))),
      plz: avg(ptRows.map(r => n(r.plate_z)).filter(v=>!isNaN(v))),
    }
  }

  function SprayChart() {
    const W = 310, H = 290, HP_X = W/2, HP_Y = H-20, SC = 250/450
    function toSVG(r: any): [number,number] {
      const hx = parseFloat(r.hc_x), hy = parseFloat(r.hc_y)
      const dx = hx-125.42, dy = 198.27-hy
      const angle = Math.atan2(dy,dx)
      const dist = parseFloat(r.hit_distance_sc)||(Math.sqrt(dx*dx+dy*dy)*2.5)
      return [HP_X+dist*SC*Math.cos(angle), HP_Y-dist*SC*Math.sin(angle)]
    }
    const hitPoints = contact.filter(r => parseFloat(r.hc_x)>0 && parseFloat(r.hc_y)>0)
    const thirds = { pull:[] as any[], center:[] as any[], oppo:[] as any[] }
    hitPoints.forEach(r => { const d=sprayDir(r); if(d) thirds[d].push(r) })
    function thirdStats(pts: any[]) {
      const evs = pts.map(r=>n(r.launch_speed)).filter(v=>v>0)
      const xbs = pts.map(r=>n(r.estimated_ba_using_speedangle)).filter(v=>v>0)
      const evRaw = evs.length ? avg(evs) : 0
      return { evRaw, ev: evs.length?evRaw.toFixed(1):'—', xba: xbs.length?avg(xbs).toFixed(3).replace(/^0\./,'.'):'—', count: pts.length, pct: hitPoints.length?(pts.length/hitPoints.length*100).toFixed(1)+'%':'0%' }
    }
    const pullSt=thirdStats(thirds.pull), centSt=thirdStats(thirds.center), oppoSt=thirdStats(thirds.oppo)
    const rL=140
    const [llx,lly]=[HP_X+rL*Math.cos(Math.PI/2+Math.PI/6), HP_Y-rL*Math.sin(Math.PI/2+Math.PI/6)]
    const [clx,cly]=[HP_X+rL*Math.cos(Math.PI/2), HP_Y-rL*Math.sin(Math.PI/2)]
    const [rlx,rly]=[HP_X+rL*Math.cos(Math.PI/2-Math.PI/6), HP_Y-rL*Math.sin(Math.PI/2-Math.PI/6)]
    function hexToRgba(hex: string, alpha: number) {
      if(!hex||hex.startsWith('var')) return `rgba(255,255,255,${alpha})`
      const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16)
      return `rgba(${r},${g},${b},${alpha})`
    }
    function StatLbl({x,y,label,st}:{x:number;y:number;label:string;st:any}) {
      const color=getStatColor(st.evRaw,'avgEV')
      return <g><text x={x} y={y-14} textAnchor="middle" fill={color} fontSize="9" fontFamily="monospace" fontWeight="bold">{label}</text><text x={x} y={y-2} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="8" fontFamily="monospace" fontWeight="bold">{st.pct} ({st.count})</text><text x={x} y={y+10} textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace" fontWeight="bold">{st.ev} EV <tspan fill="rgba(255,255,255,0.4)">· {st.xba} xBA</tspan></text></g>
    }
    const getFieldPath=(s:number,e:number)=>{const sr=(s*Math.PI)/180,er=(e*Math.PI)/180;const x1=HP_X+400*SC*Math.cos(sr),y1=HP_Y-400*SC*Math.sin(sr),x2=HP_X+400*SC*Math.cos(er),y2=HP_Y-400*SC*Math.sin(er);return `M ${HP_X} ${HP_Y} L ${x1} ${y1} A ${400*SC} ${400*SC} 0 0 1 ${x2} ${y2} Z`}
    const leftSt=stand==='L'?oppoSt:pullSt, rightSt=stand==='L'?pullSt:oppoSt
    function getEvColor(ev:number){if(ev>=105)return '#ef4444';if(ev>=100)return '#fca5a5';if(ev>=95)return '#ffffff';if(ev>=88)return '#93c5fd';return '#3b82f6'}
    return (
      <div>
        <svg width={W} height={H} style={{background:'rgba(0,0,0,0.2)',borderRadius:8,border:'1px solid var(--border)',overflow:'hidden'}}>
          <path d={getFieldPath(105,135)} fill={hexToRgba(getStatColor(leftSt.evRaw,'avgEV'),0.1)} stroke={hexToRgba(getStatColor(leftSt.evRaw,'avgEV'),0.3)} strokeWidth={1}/>
          <path d={getFieldPath(75,105)} fill={hexToRgba(getStatColor(centSt.evRaw,'avgEV'),0.1)} stroke={hexToRgba(getStatColor(centSt.evRaw,'avgEV'),0.3)} strokeWidth={1}/>
          <path d={getFieldPath(45,75)} fill={hexToRgba(getStatColor(rightSt.evRaw,'avgEV'),0.1)} stroke={hexToRgba(getStatColor(rightSt.evRaw,'avgEV'),0.3)} strokeWidth={1}/>
          <path d={`M ${HP_X+300*SC*Math.cos(Math.PI/2+Math.PI/4)} ${HP_Y-300*SC*Math.sin(Math.PI/2+Math.PI/4)} A ${300*SC} ${300*SC} 0 0 1 ${HP_X+300*SC*Math.cos(Math.PI/2-Math.PI/4)} ${HP_Y-300*SC*Math.sin(Math.PI/2-Math.PI/4)}`} stroke="rgba(255,255,255,0.05)" strokeWidth={1} fill="none" strokeDasharray="4,4"/>
          {hitPoints.map((r,i)=>{const[sx,sy]=toSVG(r);if(sx<0||sx>W||sy<0||sy>H)return null;return <circle key={i} cx={sx} cy={sy} r={r.launch_speed_angle==='6'?4:2.5} fill={getEvColor(n(r.launch_speed))} opacity={0.8}/>})}
          <StatLbl x={llx} y={lly} label={stand==='L'?'OPPO':'PULL'} st={leftSt}/>
          <StatLbl x={clx} y={cly} label="CTR" st={centSt}/>
          <StatLbl x={rlx} y={rly} label={stand==='L'?'PULL':'OPPO'} st={rightSt}/>
        </svg>
        <div style={{display:'flex',gap:'0.75rem',marginTop:'0.5rem',flexWrap:'wrap',justifyContent:'center'}}>
          {[['#ef4444','105+'],['#fca5a5','100-104'],['#ffffff','95-99'],['#93c5fd','88-94'],['#3b82f6','<88']].map(([c,l])=>(
            <div key={l} style={{display:'flex',alignItems:'center',gap:'0.25rem'}}><div style={{width:7,height:7,borderRadius:'50%',background:c}}/><span style={{fontSize:'0.62rem',color:'var(--muted)',fontFamily:'var(--font-display)'}}>{l} EV</span></div>
          ))}
        </div>
      </div>
    )
  }

  function LaunchAngleChart() {
    const W=320,H=280,originX=40,originY=180,R=160
    const pts=contact.filter(r=>r.launch_angle!==null&&r.launch_angle!=='')
    const gb2=pts.filter(r=>n(r.launch_angle)<10), ld2=pts.filter(r=>n(r.launch_angle)>=10&&n(r.launch_angle)<=25), fb2=pts.filter(r=>n(r.launch_angle)>25)
    function sliceStats(sl:any[]){const evs=sl.map(r=>n(r.launch_speed)).filter(v=>v>0);const xbs=sl.map(r=>n(r.estimated_ba_using_speedangle)).filter(v=>v>0);const evRaw=evs.length?avg(evs):0;return{evRaw,ev:evs.length?evRaw.toFixed(1):'—',xba:xbs.length?avg(xbs).toFixed(3).replace(/^0\./,'.'):'—',count:sl.length,pct:pts.length?(sl.length/pts.length*100).toFixed(1)+'%':'0%'}}
    const gbSt=sliceStats(gb2),ldSt=sliceStats(ld2),fbSt=sliceStats(fb2)
    const toRad=(deg:number)=>-(deg*Math.PI)/180
    function getPath(s:number,e:number){const sr=toRad(s),er=toRad(e);const x1=originX+R*Math.cos(sr),y1=originY+R*Math.sin(sr),x2=originX+R*Math.cos(er),y2=originY+R*Math.sin(er);return `M ${originX} ${originY} L ${x1} ${y1} A ${R} ${R} 0 0 0 ${x2} ${y2} Z`}
    function hexToRgba2(hex:string,alpha:number){if(!hex||hex.startsWith('var'))return `rgba(255,255,255,${alpha})`;const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return `rgba(${r},${g},${b},${alpha})`}
    function SliceLabel({midDeg,label,st}:{midDeg:number;label:string;st:any}){const rad=toRad(midDeg);const lx=originX+(R*0.7)*Math.cos(rad),ly=originY+(R*0.7)*Math.sin(rad);const color=getStatColor(st.evRaw,'avgEV');return <g><text x={lx} y={ly-10} fill={color} fontSize="9" fontWeight="bold" fontFamily="monospace" textAnchor="middle">{label}</text><text x={lx} y={ly+2} fill="rgba(255,255,255,0.7)" fontSize="8" fontFamily="monospace" textAnchor="middle">{st.pct} ({st.count})</text><text x={lx} y={ly+14} fill={color} fontSize="7" fontFamily="monospace" textAnchor="middle">{st.ev} EV <tspan fill="rgba(255,255,255,0.4)">· {st.xba} xBA</tspan></text></g>}
    return (
      <svg width={W} height={H} style={{background:'rgba(0,0,0,0.2)',borderRadius:8,border:'1px solid var(--border)',overflow:'hidden'}}>
        <line x1={originX} y1={originY} x2={originX+R+20} y2={originY} stroke="rgba(255,255,255,0.15)" strokeDasharray="4,4"/>
        <text x={originX+R+5} y={originY+12} fill="rgba(255,255,255,0.3)" fontSize="7" fontFamily="monospace" textAnchor="middle">0°</text>
        <path d={getPath(-25,10)} fill={hexToRgba2(getStatColor(gbSt.evRaw,'avgEV'),0.15)} stroke={hexToRgba2(getStatColor(gbSt.evRaw,'avgEV'),0.4)} strokeWidth="1"/>
        <path d={getPath(10,25)} fill={hexToRgba2(getStatColor(ldSt.evRaw,'avgEV'),0.15)} stroke={hexToRgba2(getStatColor(ldSt.evRaw,'avgEV'),0.4)} strokeWidth="1"/>
        <path d={getPath(25,75)} fill={hexToRgba2(getStatColor(fbSt.evRaw,'avgEV'),0.15)} stroke={hexToRgba2(getStatColor(fbSt.evRaw,'avgEV'),0.4)} strokeWidth="1"/>
        <SliceLabel midDeg={-7} label="GROUNDERS" st={gbSt}/>
        <SliceLabel midDeg={17.5} label="LINE DRIVES" st={ldSt}/>
        <SliceLabel midDeg={50} label="FLY BALLS" st={fbSt}/>
      </svg>
    )
  }

  function PitchPlot() {
    const W=360,H=360,lPad=40,rPad=20,tPad=20,bPad=40,PW=W-lPad-rPad,PH=H-tPad-bPad
    const pitchData=pitchTypes.map(pt=>({pt,ps:pitchStats(pitchGroups[pt]),col:PITCH_COLORS[pt]??'#888'}))
    const allHB=rows.map(r=>n(r.pfx_x)*12).filter(v=>!isNaN(v)&&v!==0)
    const allIVB=rows.map(r=>n(r.pfx_z)*12).filter(v=>!isNaN(v)&&v!==0)
    const maxX=Math.max(20,...allHB.map(Math.abs))*1.1||25
    const maxY=Math.max(20,...allIVB.map(Math.abs))*1.1||25
    function toSVG(hb:number,ivb:number):[number,number]{return[lPad+PW/2-(hb/maxX)*(PW/2),tPad+PH/2-(ivb/maxY)*(PH/2)]}
    return (
      <svg width={W} height={H} style={{background:'rgba(0,0,0,0.2)',borderRadius:8,border:'1px solid var(--border)'}}>
        <line x1={lPad} y1={tPad+PH/2} x2={W-rPad} y2={tPad+PH/2} stroke="rgba(255,255,255,0.15)" strokeDasharray="4,4"/>
        <line x1={lPad+PW/2} y1={tPad} x2={lPad+PW/2} y2={H-bPad} stroke="rgba(255,255,255,0.15)" strokeDasharray="4,4"/>
        <text x={lPad+PW/2} y={H-12} fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace" textAnchor="middle">Horizontal Break (in)</text>
        <text x={14} y={tPad+PH/2} fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace" textAnchor="middle" transform={`rotate(-90,14,${tPad+PH/2})`}>Induced Vertical Break (in)</text>
        <text x={lPad+PW/2+4} y={tPad+PH/2+10} fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace">0</text>
        <text x={lPad} y={tPad+PH/2+10} fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace" textAnchor="middle">{-Math.round(maxX)}</text>
        <text x={W-rPad} y={tPad+PH/2+10} fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace" textAnchor="middle">{Math.round(maxX)}</text>
        <text x={lPad+PW/2+4} y={tPad+6} fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace">{Math.round(maxY)}</text>
        <text x={lPad+PW/2+4} y={H-bPad} fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="monospace">{-Math.round(maxY)}</text>
        {rows.map((r:any,i:number)=>{const hb=n(r.pfx_x)*12,ivb=n(r.pfx_z)*12;if(isNaN(hb)||isNaN(ivb)||(hb===0&&ivb===0))return null;const[x,y]=toSVG(hb,ivb);return <circle key={i} cx={x} cy={y} r={2.5} fill={PITCH_COLORS[r.pitch_type]??'#888'} opacity={0.3} style={{pointerEvents:'none'}}/>})}
        {pitchData.map(d=>{if(isNaN(d.ps.hbreak)||isNaN(d.ps.ivb))return null;const[x,y]=toSVG(d.ps.hbreak,d.ps.ivb);const up=totalPitches>0?(d.ps.count/totalPitches*100).toFixed(0)+'%':'—';const vs=d.ps.velo>0?d.ps.velo.toFixed(1):'—';const lr=x<lPad+PW/2;return <g key={d.pt}><circle cx={x} cy={y} r={10} fill={d.col} stroke="rgba(255,255,255,0.9)" strokeWidth={1}/><text x={x} y={y+0.5} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="8" fontWeight="bold" fontFamily="monospace" style={{pointerEvents:'none'}}>{d.pt}</text><text x={lr?x+14:x-14} y={y-5} textAnchor={lr?'start':'end'} fill={d.col} fontSize="8" fontFamily="monospace" fontWeight="bold" style={{pointerEvents:'none'}}>{vs}</text><text x={lr?x+14:x-14} y={y+7} textAnchor={lr?'start':'end'} fill={d.col} fontSize="7" fontFamily="monospace" style={{pointerEvents:'none'}}>{up}</text></g>})}
      </svg>
    )
  }

  const disciplineRows = [['Zone',zRows,zSwings],['Out of Zone',oRows,oSwings],['Overall',rows,swings]]

  return (
    <div>
      {isPitcher ? (
        <>
          <div style={scSecH}>Exit Velocity Against</div>
          <div style={{display:'flex',gap:'0.75rem',flexWrap:'wrap'}}>
            {[{label:'Avg EV',val:fmtN(avgEV),c:getStatColor(avgEV,'avgEV')},{label:'90th EV',val:fmtN(p90EV),c:getStatColor(p90EV,'p90EV')},{label:'Max EV',val:fmtN(maxEV),c:getStatColor(maxEV,'maxEV')},{label:'Hard Hit%',val:pct(hardHit.length,contact.length)},{label:'Barrel%',val:pct(barrels.length,contact.length)},{label:'xBA Against',val:xbaVals.length?avg(xbaVals).toFixed(3).replace(/^0\./,'.'):'—'},{label:'xwOBA Against',val:xwoba.length?avg(xwoba).toFixed(3).replace(/^0\./,'.'):'—'}].map((t:any)=>(
              <div key={t.label} style={tileStyle}><div style={tileLabel}>{t.label}</div><div style={{...tileVal,color:t.c||'rgba(255,255,255,0.65)'}}>{t.val}</div></div>
            ))}
          </div>
          <div style={scSecH}>Pitch Mix & Movement</div>
          <div style={{display:'flex',gap:'1.5rem',alignItems:'flex-start',flexWrap:'wrap'}}>
            <div style={{flex:'0 0 auto'}}><PitchPlot/></div>
            <div style={{flex:'1 1 auto',overflowX:'auto'}}>
              <table style={{borderCollapse:'collapse',minWidth:'max-content',width:'100%'}}>
                <thead><tr>{['Pitch','Count','%','Velo','Spin','iVB','H-Brk','Ext','Rel H','Arm°','Tunnel','Whiff%','Avg EV','90th EV','Max EV','BA','xBA'].map(h=><ThCell key={h} left={h==='Pitch'}>{h}</ThCell>)}</tr></thead>
                <tbody>
                  {pitchTypes.map(pt=>{const ps=pitchStats(pitchGroups[pt]);const col=PITCH_COLORS[pt]??'#888';const name=pitchGroups[pt][0]?.pitch_name??pt;const isSel=selectedPitch===pt;return(
                    <tr key={pt} onClick={e=>{e.stopPropagation();setSelectedPitch(isSel?null:pt)}} style={{borderBottom:'1px solid rgba(48,54,61,0.3)',cursor:'pointer',background:isSel?'rgba(255,255,255,0.08)':'transparent',transition:'background 0.2s'}}>
                      <td style={{padding:'0.3rem 0.5rem',whiteSpace:'nowrap'}}><span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:col,marginRight:6}}/><span style={{fontSize:'0.76rem',fontFamily:'var(--font-display)',fontWeight:600}}>{name}</span></td>
                      <TdC v={String(ps.count)}/><TdC v={pct(ps.count,totalPitches)}/><TdC v={fmtN(ps.velo)}/><TdC v={fmtN(ps.spin,0)}/><TdC v={fmtN(ps.ivb)}/><TdC v={fmtN(ps.hbreak)}/><TdC v={fmtN(ps.ext)}/><TdC v={fmtN(ps.relH)}/><TdC v={fmtN(ps.armAngle)}/><TdC v={ps.tunnel}/><TdC v={fmtN(ps.whiffPct)}/>
                      <TdC v={ps.avgEV>0?fmtN(ps.avgEV):'—'} color={ps.avgEV>0?getStatColor(ps.avgEV,'avgEV'):undefined}/>
                      <TdC v={ps.p90EV>0?fmtN(ps.p90EV):'—'} color={ps.p90EV>0?getStatColor(ps.p90EV,'p90EV'):undefined}/>
                      <TdC v={ps.maxEV>0?fmtN(ps.maxEV):'—'} color={ps.maxEV>0?getStatColor(ps.maxEV,'maxEV'):undefined}/>
                      <TdC v={ps.ba>0?ps.ba.toFixed(3).replace(/^0./,'.'):'—'}/><TdC v={ps.xba>0?ps.xba.toFixed(3).replace(/^0./,'.'):'—'}/>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
          <div style={scSecH}>Plate Discipline</div>
          <table style={{borderCollapse:'collapse'}}>
            <thead><tr>{['','Pitches','Swing%','Contact%','Whiff%'].map(h=><ThCell key={h} left={h===''}>{h}</ThCell>)}</tr></thead>
            <tbody>
              {disciplineRows.map(([lbl,all,sw]:any)=>{const cont=sw.filter(isContact),wh=sw.filter(isWhiff);const sVal=all.length?(sw.length/all.length*100):0,cVal=sw.length?(cont.length/sw.length*100):0,wVal=sw.length?(wh.length/sw.length*100):0;let sCol=undefined,cCol=undefined;const wCol=wVal>0?getStatColor(wVal,'whiff',!isPitcher):undefined;if(lbl==='Zone'&&cVal>0)cCol=getStatColor(cVal,'zContact',isPitcher);if(lbl==='Out of Zone'&&sVal>0)sCol=getStatColor(sVal,'oSwing',!isPitcher);if(lbl==='Overall'&&cVal>0)cCol=getStatColor(cVal,'contact',isPitcher);return(<tr key={lbl} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><td style={{padding:'0.3rem 0.5rem',fontSize:'0.76rem',fontFamily:'var(--font-display)',fontWeight:600,color:'var(--text)',whiteSpace:'nowrap'}}>{lbl}</td><TdC v={String(all.length)}/><TdC v={pct(sw.length,all.length)} color={sCol}/><TdC v={pct(cont.length,sw.length)} color={cCol}/><TdC v={pct(wh.length,sw.length)} color={wCol}/></tr>)})}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <div style={scSecH}>Exit Velocity</div>
          <div style={{display:'flex',gap:'0.75rem',flexWrap:'wrap'}}>
            {[{label:'Avg EV',val:fmtN(avgEV),c:getStatColor(avgEV,'avgEV')},{label:'90th EV',val:fmtN(p90EV),c:getStatColor(p90EV,'p90EV')},{label:'Max EV',val:fmtN(maxEV),c:getStatColor(maxEV,'maxEV')},{label:'Hard Hit%',val:pct(hardHit.length,contact.length),c:getStatColor(contact.length?hardHit.length/contact.length*100:0,'hardHit')},{label:'Barrel%',val:pct(barrels.length,contact.length),c:getStatColor(contact.length?barrels.length/contact.length*100:0,'barrel')},{label:'Avg LA',val:fmtN(avgLA)+'°'}].map((t:any)=>(
              <div key={t.label} style={tileStyle}><div style={tileLabel}>{t.label}</div><div style={{...tileVal,color:t.c||'rgba(255,255,255,0.65)'}}>{t.val}</div></div>
            ))}
          </div>
          <div style={scSecH}>Expected Stats</div>
          <div style={{display:'flex',gap:'0.75rem',flexWrap:'wrap'}}>
            {[{label:'xBA',val:xbaVals.length?avg(xbaVals).toFixed(3).replace(/^0\./,'.'):'—',c:getStatColor(avg(xbaVals),'xba')},{label:'xwOBA',val:xwoba.length?avg(xwoba).toFixed(3).replace(/^0\./,'.'):'—',c:getStatColor(avg(xwoba),'xwoba')},{label:'xSLG',val:xslg.length?avg(xslg).toFixed(3).replace(/^0\./,'.'):'—',c:getStatColor(avg(xslg),'xslg')}].map((t:any)=>(
              <div key={t.label} style={tileStyle}><div style={tileLabel}>{t.label}</div><div style={{...tileVal,color:t.c||'rgba(255,255,255,0.65)'}}>{t.val}</div></div>
            ))}
          </div>
          <div style={scSecH}>Batted Ball Profile</div>
          <div style={{display:'flex',gap:'0.75rem',flexWrap:'wrap'}}>
            {[{label:'GB%',val:pct(gb.length,contact.length)},{label:'LD%',val:pct(ld.length,contact.length)},{label:'FB%',val:pct(fb.length,contact.length)},{label:'PU%',val:pct(pu.length,contact.length)},{label:'Pull%',val:pct(pull.length,withDir.length)},{label:'Cent%',val:pct(center.length,withDir.length)},{label:'Oppo%',val:pct(oppo.length,withDir.length)},...(batSpeeds.length?[{label:'Bat Spd',val:fmtN(avg(batSpeeds)),c:getStatColor(avg(batSpeeds),'batSpd')}]:[]),...(swingLens.length?[{label:'Swng Len',val:fmtN(avg(swingLens))}]:[])].map((t:any)=>(
              <div key={t.label} style={tileStyle}><div style={tileLabel}>{t.label}</div><div style={{...tileVal,color:t.c||'rgba(255,255,255,0.65)'}}>{t.val}</div></div>
            ))}
          </div>
          <div style={scSecH}>Plate Discipline</div>
          <table style={{borderCollapse:'collapse'}}>
            <thead><tr>{['','Pitches','Swing%','Contact%','Whiff%'].map(h=><ThCell key={h} left={h===''}>{h}</ThCell>)}</tr></thead>
            <tbody>
              {disciplineRows.map(([lbl,all,sw]:any)=>{const cont=sw.filter(isContact),wh=sw.filter(isWhiff);const sVal=all.length?(sw.length/all.length*100):0,cVal=sw.length?(cont.length/sw.length*100):0,wVal=sw.length?(wh.length/sw.length*100):0;let sCol=undefined,cCol=undefined;const wCol=wVal>0?getStatColor(wVal,'whiff',!isPitcher):undefined;if(lbl==='Zone'&&cVal>0)cCol=getStatColor(cVal,'zContact',isPitcher);if(lbl==='Out of Zone'&&sVal>0)sCol=getStatColor(sVal,'oSwing',!isPitcher);if(lbl==='Overall'&&cVal>0)cCol=getStatColor(cVal,'contact',isPitcher);return(<tr key={lbl} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}><td style={{padding:'0.3rem 0.5rem',fontSize:'0.76rem',fontFamily:'var(--font-display)',fontWeight:600,color:'var(--text)',whiteSpace:'nowrap'}}>{lbl}</td><TdC v={String(all.length)}/><TdC v={pct(sw.length,all.length)} color={sCol}/><TdC v={pct(cont.length,sw.length)} color={cCol}/><TdC v={pct(wh.length,sw.length)} color={wCol}/></tr>)})}
            </tbody>
          </table>
          <div style={scSecH}>Spray Chart & Launch Angle Profile</div>
          <div style={{display:'flex',gap:'1.5rem',flexWrap:'wrap',alignItems:'flex-start'}}>
            <SprayChart/>
            <div><div style={{fontSize:'0.62rem',color:'var(--muted)',fontFamily:'var(--font-display)',marginBottom:'0.4rem'}}>Launch Angle Slices · Breakdown by GB / LD / FB</div><LaunchAngleChart/></div>
          </div>
          <div style={scSecH}>vs. Pitch Type</div>
          <div style={{overflowX:'auto'}}>
            <table style={{borderCollapse:'collapse',minWidth:'max-content'}}>
              <thead><tr>{['Pitch','Count','%','Avg EV','90th EV','Max EV','Whiff%','BA','xBA'].map(h=><ThCell key={h} left={h==='Pitch'}>{h}</ThCell>)}</tr></thead>
              <tbody>
                {pitchTypes.map(pt=>{const ps=pitchStats(pitchGroups[pt]);const col=PITCH_COLORS[pt]??'#888';const name=pitchGroups[pt][0]?.pitch_name??pt;return(
                  <tr key={pt} style={{borderBottom:'1px solid rgba(48,54,61,0.3)'}}>
                    <td style={{padding:'0.3rem 0.5rem',whiteSpace:'nowrap'}}><span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:col,marginRight:6}}/><span style={{fontSize:'0.76rem',fontFamily:'var(--font-display)',fontWeight:600}}>{name}</span></td>
                    <TdC v={String(ps.count)}/><TdC v={pct(ps.count,totalPitches)}/>
                    <TdC v={ps.avgEV>0?fmtN(ps.avgEV):'—'} color={ps.avgEV>0?getStatColor(ps.avgEV,'avgEV'):undefined}/>
                    <TdC v={ps.p90EV>0?fmtN(ps.p90EV):'—'} color={ps.p90EV>0?getStatColor(ps.p90EV,'p90EV'):undefined}/>
                    <TdC v={ps.maxEV>0?fmtN(ps.maxEV):'—'} color={ps.maxEV>0?getStatColor(ps.maxEV,'maxEV'):undefined}/>
                    <TdC v={fmtN(ps.whiffPct)} color={ps.whiffPct>0?getStatColor(ps.whiffPct,'whiff',true):undefined}/>
                    <TdC v={ps.ba>0?ps.ba.toFixed(3).replace(/^0\./,'.'):'—'}/>
                    <TdC v={ps.xba>0?ps.xba.toFixed(3).replace(/^0\./,'.'):'—'} color={ps.xba>0?getStatColor(ps.xba,'xba'):undefined}/>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
