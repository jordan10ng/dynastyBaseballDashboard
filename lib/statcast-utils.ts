export function parseStatcastCSV(csv: string): any[] {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].replace(/"/g, '').split(',')

  function parseCSVLine(line: string): string[] {
    const result: string[] = []
    let i = 0
    while (i < line.length) {
      if (line[i] === '"') {
        let j = i + 1
        while (j < line.length) {
          if (line[j] === '"' && line[j+1] === '"') { j += 2; continue }
          if (line[j] === '"') break
          j++
        }
        result.push(line.slice(i+1, j).replace(/""/g, '"'))
        i = j + 1
        if (line[i] === ',') i++
      } else {
        const end = line.indexOf(',', i)
        if (end === -1) { result.push(line.slice(i)); break }
        result.push(line.slice(i, end))
        i = end + 1
      }
    }
    return result
  }

  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line)
    const obj: any = {}
    headers.forEach((h, i) => {
      const v = (vals[i] ?? '').trim()
      obj[h] = v === '' ? null : v
    })
    return obj
  }).filter(r => r.pitch_type)
}

export const PITCH_COLORS: Record<string,string> = {
  'FF':'#ef4444','SI':'#f97316','FC':'#eab308',
  'SL':'#22c55e','ST':'#a3e635','CU':'#06b6d4','SW':'#8b5cf6','KC':'#14b8a6','SV':'#6366f1',
  'CH':'#ec4899','FS':'#f43f5e','FO':'#d946ef',
  'CS':'#a78bfa','EP':'#fb923c',
}
export const PITCH_ORDER = ['FF','SI','FC','SL','ST','CU','SW','KC','SV','CH','FS','FO','CS','EP']

export function n(v: any): number { return parseFloat(v) || 0 }
export function pct(num: number, den: number): string { return den ? (num/den*100).toFixed(1)+'%' : '—' }
export function avg(arr: number[]): number { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0 }
export function fmtN(v: number, dec=1): string { return isNaN(v) || v===0 ? '—' : v.toFixed(dec) }

export function getStatColor(val: any, type: string, reverse = false): string {
  if (val === '—' || val == null) return 'rgba(100,100,100,0.3)'
  let v = typeof val === 'string' ? parseFloat(val.replace('%','')) : val
  if (isNaN(v) || v === 0) return 'var(--text)'
  let dr = 0, lr = 0, lb = 0, db = 0
  if (type === 'avgEV') { dr = 92.5; lr = 90.5; lb = 88.0; db = 86.0; }
  else if (type === 'p90EV') { dr = 108.0; lr = 105.5; lb = 102.5; db = 100.0; }
  else if (type === 'maxEV') { dr = 115.0; lr = 112.0; lb = 108.0; db = 105.0; }
  else if (type === 'hardHit') { dr = 48; lr = 43; lb = 35; db = 30; }
  else if (type === 'barrel') { dr = 12; lr = 9; lb = 5; db = 3; }
  else if (type === 'xba') { dr = 0.280; lr = 0.260; lb = 0.235; db = 0.215; }
  else if (type === 'xwoba') { dr = 0.360; lr = 0.335; lb = 0.300; db = 0.280; }
  else if (type === 'xslg') { dr = 0.480; lr = 0.440; lb = 0.390; db = 0.350; }
  else if (type === 'batSpd') { dr = 75; lr = 73; lb = 70; db = 68; }
  else if (type === 'whiff') { dr = 32; lr = 28; lb = 22; db = 18; }
  else if (type === 'zContact') { dr = 90; lr = 87; lb = 84; db = 81; }
  else if (type === 'contact') { dr = 82; lr = 79; lb = 76; db = 73; }
  else if (type === 'oSwing') { dr = 35; lr = 32; lb = 28; db = 25; }
  else return 'rgba(255,255,255,0.65)'
  let color = '#ffffff'
  if (v >= dr) color = '#ef4444'
  else if (v >= lr) color = '#fca5a5'
  else if (v >= lb) color = '#ffffff'
  else if (v >= db) color = '#93c5fd'
  else color = '#3b82f6'
  if (reverse) {
    if (color === '#ef4444') color = '#3b82f6'
    else if (color === '#fca5a5') color = '#93c5fd'
    else if (color === '#93c5fd') color = '#fca5a5'
    else if (color === '#3b82f6') color = '#ef4444'
  }
  return color
}
