const fs = require('fs'), os = require('os')

const HISTORY_DIR = os.homedir() + '/Desktop/fantasy-baseball/data/history/'
const PLAYERS_PATH = os.homedir() + '/Desktop/fantasy-baseball/data/players.json'
const OUT_PATH = os.homedir() + '/Desktop/fantasy-baseball/data/model/mlb-scores.json'

const YEARS = ['2015','2016','2017','2018','2019','2021','2022','2023','2024','2025']
const MIN_PA = 100
const MIN_IP = 40

const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'))

// mlbam_id → player lookup
const playerByMlbam = {}
for (const p of Object.values(players)) {
  if (p.mlbam_id) playerByMlbam[p.mlbam_id] = p
}

// Exact age as of July 1 of that season (baseball age convention)
function exactAge(birthDate, year) {
  if (!birthDate) return null
  const july1 = new Date(`${year}-07-01`)
  const dob = new Date(birthDate)
  let age = july1.getFullYear() - dob.getFullYear()
  const hadBirthday = (dob.getMonth() < 6) || (dob.getMonth() === 6 && dob.getDate() === 1)
  if (!hadBirthday) age--
  return age
}

function hitterFantasyRate(line) {
  const pa = line.pa || 0
  if (pa < MIN_PA) return null

  const h = line.h || 0
  const doubles = line.doubles || 0
  const triples = line.triples || 0
  const hr = line.hr || 0
  const rbi = line.rbi || 0
  const r = line.r || 0
  const bb = line.bb || 0
  const sb = line.sb || 0
  const cs = line.cs || 0
  const hbp = line.hbp || 0
  const so = line.so || 0
  const ab = line.ab || 0
  const tb = h + doubles + triples * 2 + hr * 3

  const pts =
    h * 1 +
    doubles * 1 +
    triples * 2 +
    hr * 5 +
    rbi * 1 +
    r * 1 +
    bb * 1 +
    sb * 4 +
    hbp * 1 +
    tb * 0.25 +
    cs * (-4) +
    so * (-1)

  const onBase = h + bb + hbp
  const avg =     ab > 0 ? h / ab : null
  const obp =     pa > 0 ? onBase / pa : null
  const slg =     ab > 0 ? tb / ab : null
  const iso =     ab > 0 ? (tb - h) / ab : null
  const k_pct =   pa > 0 ? so / pa : null
  const bb_pct =  pa > 0 ? bb / pa : null
  const sb_rate = onBase > 0 ? sb / onBase : null
  const hr_rate = ab > 0 ? hr / ab : null

  return {
    type: 'hitting',
    pts_per_pa: +(pts / pa).toFixed(4),
    total_pts: Math.round(pts),
    pa, h, doubles, triples, hr, rbi, r, bb, sb, cs, so, tb, hbp,
    avg, obp, slg, iso, k_pct, bb_pct, sb_rate, hr_rate,
  }
}

function pitcherFantasyRate(line) {
  const ip = parseFloat(line.ip) || 0
  const gs = line.gs || 0
  if (ip < MIN_IP || gs === 0) return null

  const k =  line.so || 0
  const bb = line.bb || 0
  const h =  line.h  || 0
  const er = line.er || 0
  const hr = line.hr || 0
  const w =  line.w  || 0
  const l =  line.l  || 0

  const pts =
    ip * 2 +
    k  * 1 +
    w  * 10 +
    er * (-1) +
    h  * (-1) +
    bb * (-1) +
    l  * (-10)

  const bf = Math.round(ip * 4.3)
  const era =      ip > 0 ? (er / ip) * 9 : null
  const whip =     ip > 0 ? (bb + h) / ip : null
  const k_pct =    bf > 0 ? k / bf : null
  const bb_pct =   bf > 0 ? bb / bf : null
  const k_bb_pct = bf > 0 ? (k - bb) / bf : null
  const baa =      (bf - bb) > 0 ? h / (bf - bb) : null
  const hr_per_9 = ip > 0 ? (hr / ip) * 9 : null
  const ip_per_gs = gs > 0 ? ip / gs : null
  const win_pct =  (w + l) > 0 ? w / (w + l) : null

  return {
    type: 'pitching',
    pts_per_ip: +(pts / ip).toFixed(4),
    total_pts: Math.round(pts),
    ip, gs, k, bb, h, er, hr, w, l,
    era, whip, k_pct, bb_pct, k_bb_pct, baa, hr_per_9, ip_per_gs, win_pct,
  }
}

// --- Main ---
console.log('Building MLB fantasy scores...')
const mlbScores = {}

for (const year of YEARS) {
  const path = HISTORY_DIR + year + '.json'
  if (!fs.existsSync(path)) continue
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'))
  let hitters = 0, pitchers = 0

  for (const [mlbamId, lines] of Object.entries(data)) {
    const player = playerByMlbam[mlbamId]
    if (!player) continue
    const age = exactAge(player.birthDate, year)
    const name = player.name

    for (const line of lines) {
      if (line.level !== 'MLB') continue

      let scored = null
      if (line.type === 'hitting') {
        scored = hitterFantasyRate(line)
        if (scored) hitters++
      } else if (line.type === 'pitching') {
        scored = pitcherFantasyRate(line)
        if (scored) pitchers++
      }
      if (!scored) continue

      if (!mlbScores[mlbamId]) mlbScores[mlbamId] = { mlbam_id: mlbamId, name, seasons: [] }
      mlbScores[mlbamId].seasons.push({ year, age, ...scored })
    }
  }
  console.log(`  ${year}: ${hitters} hitters, ${pitchers} pitchers qualified`)
}

fs.mkdirSync(os.homedir() + '/Desktop/fantasy-baseball/data/model', { recursive: true })
fs.writeFileSync(OUT_PATH, JSON.stringify(mlbScores, null, 2))

console.log(`\nDone! ${Object.keys(mlbScores).length} players with MLB fantasy scores`)

// --- Sanity checks ---
console.log('\n=== Top 10 hitters by pts/PA (best season) ===')
const hitterBest = []
for (const p of Object.values(mlbScores)) {
  const seasons = p.seasons.filter(s => s.type === 'hitting')
  if (!seasons.length) continue
  const best = seasons.sort((a, b) => b.pts_per_pa - a.pts_per_pa)[0]
  hitterBest.push({ name: p.name, ...best })
}
hitterBest.sort((a, b) => b.pts_per_pa - a.pts_per_pa).slice(0, 10).forEach(p =>
  console.log(` ${p.name.padEnd(25)} ${p.year} age:${p.age} pts/PA:${p.pts_per_pa} PA:${p.pa} HR:${p.hr} SB:${p.sb}`)
)

console.log('\n=== Top 10 pitchers by pts/IP (best season) ===')
const pitcherBest = []
for (const p of Object.values(mlbScores)) {
  const seasons = p.seasons.filter(s => s.type === 'pitching')
  if (!seasons.length) continue
  const best = seasons.sort((a, b) => b.pts_per_ip - a.pts_per_ip)[0]
  pitcherBest.push({ name: p.name, ...best })
}
pitcherBest.sort((a, b) => b.pts_per_ip - a.pts_per_ip).slice(0, 10).forEach(p =>
  console.log(` ${p.name.padEnd(25)} ${p.year} age:${p.age} pts/IP:${p.pts_per_ip} IP:${p.ip} ERA:${p.era?.toFixed(2)} K%:${p.k_pct?.toFixed(3)}`)
)

console.log('\n=== Sample: Shohei Ohtani ===')
const ohtani = Object.values(mlbScores).find(p => p.name === 'Shohei Ohtani')
if (ohtani) {
  ohtani.seasons.forEach(s => {
    if (s.type === 'hitting')  console.log(` ${s.year} age:${s.age} HIT  pts/PA:${s.pts_per_pa} PA:${s.pa} HR:${s.hr} SB:${s.sb}`)
    if (s.type === 'pitching') console.log(` ${s.year} age:${s.age} PITCH pts/IP:${s.pts_per_ip} IP:${s.ip} ERA:${s.era?.toFixed(2)}`)
  })
}
