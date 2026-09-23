// Shared Statcast CSV fetch/parse/reduce logic for scripts/backfill-statcast.js
// and scripts/sync-statcast-gha.js. Both are plain Node (CommonJS) scripts.
const https = require('https')

function fetchCSV(url, tries = 4, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const fail = (msg) => {
        if (n > 1) { setTimeout(() => attempt(n - 1), 1500); return }
        reject(new Error(msg))
      }
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        if (res.statusCode !== 200) { res.resume(); fail(`HTTP ${res.statusCode}`); return }
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => {
          if (!data.toLowerCase().includes('pitch_type')) { fail('malformed/empty response'); return }
          resolve(data)
        })
      })
      req.on('error', err => fail(err.message))
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    }
    attempt(tries)
  })
}

function parseCSVLine(line) {
  const result = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let j = i + 1
      while (j < line.length) {
        if (line[j] === '"' && line[j + 1] === '"') { j += 2; continue }
        if (line[j] === '"') break
        j++
      }
      result.push(line.slice(i + 1, j).replace(/""/g, '"'))
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

function parseStatcastCSV(csv) {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].replace(/^﻿/, '').replace(/"/g, '').split(',')
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line)
    const obj = {}
    headers.forEach((h, i) => { const v = (vals[i] ?? '').trim(); obj[h] = v === '' ? null : v })
    return obj
  }).filter(r => r.pitch_type)
}

function n(v) { const x = parseFloat(v); return isNaN(x) ? null : x }

function sprayDir(row) {
  const hx = parseFloat(row.hc_x), hy = parseFloat(row.hc_y)
  if (isNaN(hx) || isNaN(hy) || hx <= 0 || hy <= 0) return null
  const dx = hx - 125.42, dy = 198.27 - hy
  const deg = Math.atan2(dy, dx) * (180 / Math.PI)
  let side
  if (deg > 105) side = 'left'
  else if (deg < 75) side = 'right'
  else side = 'center'
  if (side === 'center') return 'center'
  return row.stand === 'L' ? (side === 'right' ? 'pull' : 'oppo') : (side === 'left' ? 'pull' : 'oppo')
}

function emptyBucket() {
  return {
    count: 0,
    sum_ev: 0, contact_count: 0, maxEV: 0, evHistogram: {},
    hardHit_count: 0, barrel_count: 0,
    swings: 0, whiffs: 0,
    pa_count: 0, hits_count: 0,
    sum_xba: 0, xba_n: 0, sum_xwoba: 0, xwoba_n: 0, sum_xslg: 0, xslg_n: 0,
    sum_velo: 0, velo_n: 0, sum_spin: 0, spin_n: 0, sum_ivb: 0, ivb_n: 0,
    sum_hbreak: 0, hbreak_n: 0, sum_ext: 0, ext_n: 0, sum_relH: 0, relH_n: 0,
    sum_armAngle: 0, armAngle_n: 0, sum_batSpeed: 0, batSpeed_n: 0, sum_swingLen: 0, swingLen_n: 0,
    gb: 0, ld: 0, fb: 0, pu: 0, pull: 0, center: 0, oppo: 0,
    strikes: 0, balls: 0, called_strikes: 0, zone_count: 0, o_pitches: 0, o_swings: 0,
    k_count: 0, bb_count: 0,
  }
}

function addRowToBucket(b, row) {
  // Buckets loaded from older statcast-totals.json predate newer fields -- fill them so
  // `++` never lands on undefined (NaN) during additive nightly syncs.
  for (const [k, v] of Object.entries(emptyBucket())) if (b[k] === undefined) b[k] = v
  b.count++
  if (row.type === 'S' || row.type === 'X') b.strikes++
  else if (row.type === 'B') b.balls++
  if (row.description === 'called_strike') b.called_strikes++
  const isSwing = ['hit_into_play', 'foul', 'swinging_strike', 'swinging_strike_blocked', 'foul_tip'].includes(row.description)
  const isWhiff = ['swinging_strike', 'swinging_strike_blocked'].includes(row.description)
  if (isSwing) b.swings++
  if (isWhiff) b.whiffs++
  const zone = parseInt(row.zone)
  if (zone >= 1 && zone <= 9) b.zone_count++
  else if (zone >= 11 && zone <= 14) { b.o_pitches++; if (isSwing) b.o_swings++ }

  const ev = n(row.launch_speed)
  if (row.bb_type && ev != null) {
    b.contact_count++
    b.sum_ev += ev
    if (ev > b.maxEV) b.maxEV = ev
    const bucket = String(Math.round(ev))
    b.evHistogram[bucket] = (b.evHistogram[bucket] || 0) + 1
    if (ev >= 95) b.hardHit_count++
    if (row.launch_speed_angle === '6') b.barrel_count++
    if (row.bb_type === 'ground_ball') b.gb++
    else if (row.bb_type === 'line_drive') b.ld++
    else if (row.bb_type === 'fly_ball') b.fb++
    else if (row.bb_type === 'popup') b.pu++
    const dir = sprayDir(row)
    if (dir === 'pull') b.pull++
    else if (dir === 'center') b.center++
    else if (dir === 'oppo') b.oppo++
  }

  if (row.woba_denom === '1') {
    b.pa_count++
    if (['single', 'double', 'triple', 'home_run'].includes(row.events)) b.hits_count++
    if (row.events === 'strikeout' || row.events === 'strikeout_double_play') b.k_count++
    else if (row.events === 'walk') b.bb_count++
    const xba = n(row.estimated_ba_using_speedangle)
    if (xba != null) { b.sum_xba += xba; b.xba_n++ }
    const xwoba = n(row.estimated_woba_using_speedangle)
    if (xwoba != null) { b.sum_xwoba += xwoba; b.xwoba_n++ }
    const xslg = n(row.estimated_slg_using_speedangle)
    if (xslg != null) { b.sum_xslg += xslg; b.xslg_n++ }
  }

  const velo = n(row.release_speed); if (velo != null) { b.sum_velo += velo; b.velo_n++ }
  const spin = n(row.release_spin_rate); if (spin != null) { b.sum_spin += spin; b.spin_n++ }
  const pfxZ = n(row.pfx_z); if (pfxZ != null && pfxZ !== 0) { b.sum_ivb += pfxZ * 12; b.ivb_n++ }
  const pfxX = n(row.pfx_x); if (pfxX != null && pfxX !== 0) { b.sum_hbreak += pfxX * 12; b.hbreak_n++ }
  const ext = n(row.release_extension); if (ext != null) { b.sum_ext += ext; b.ext_n++ }
  const relH = n(row.release_pos_z); if (relH != null) { b.sum_relH += relH; b.relH_n++ }
  const armAngle = n(row.arm_angle); if (armAngle != null) { b.sum_armAngle += armAngle; b.armAngle_n++ }
  const batSpeed = n(row.bat_speed); if (batSpeed != null && batSpeed > 0) { b.sum_batSpeed += batSpeed; b.batSpeed_n++ }
  const swingLen = n(row.swing_length); if (swingLen != null && swingLen > 0) { b.sum_swingLen += swingLen; b.swingLen_n++ }
}

function isTwoWayPositions(positions) {
  const pos = (positions || '').split(',').map(s => s.trim())
  const hasArm = pos.some(p => p === 'SP' || p === 'RP' || p === 'P')
  const hasBat = pos.some(p => p !== 'SP' && p !== 'RP' && p !== 'P')
  return { hasArm, hasBat }
}

// League-wide pull for a single calendar day -- everyone who played that day, in one
// request. Savant's game_date_gt/game_date_lt are BOTH inclusive (verified 2026-09-23:
// gt=D-1&lt=D returns D-1 and D), so gt=lt=D is exactly one day. The old gt=D-1 form
// double-counted every day across consecutive pulls. A single day never gets near
// Savant's 25,000-row CSV cap (observed peak ~9.3k on a heavy day); multi-day ranges do.
function dayUrl(dateStr) {
  return `https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&game_date_gt=${dateStr}&game_date_lt=${dateStr}`
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Builds mlbam_id -> {hasArm, hasBat} for every player worth tracking.
function buildPlayerIndex(players) {
  const idx = {}
  for (const p of players) {
    if (!p.mlbam_id) continue
    idx[p.mlbam_id] = isTwoWayPositions(p.positions)
  }
  return idx
}

// Fans a single day's league-wide rows out into `out` (mlbam_id -> {bat, pitch, _meta}),
// only for players present in `playerIndex`. A row updates the batter's bat-side bucket
// and the pitcher's pitch-side bucket independently -- same row, two different players.
function applyDayRows(out, playerIndex, rows) {
  for (const row of rows) {
    const season = row.game_year, gt = row.game_type
    if (!season || !gt || !row.pitch_type) continue

    const bInfo = row.batter && playerIndex[row.batter]
    if (bInfo && bInfo.hasBat) {
      if (!out[row.batter]) out[row.batter] = {}
      if (!out[row.batter].bat) out[row.batter].bat = {}
      const bat = out[row.batter].bat
      if (!bat[season]) bat[season] = {}
      if (!bat[season][gt]) bat[season][gt] = emptyBucket()
      addRowToBucket(bat[season][gt], row)
    }

    const pInfo = row.pitcher && playerIndex[row.pitcher]
    if (pInfo && pInfo.hasArm) {
      if (!out[row.pitcher]) out[row.pitcher] = {}
      if (!out[row.pitcher].pitch) out[row.pitcher].pitch = {}
      const pitch = out[row.pitcher].pitch
      if (!pitch[season]) pitch[season] = {}
      if (!pitch[season][gt]) pitch[season][gt] = {}
      if (!pitch[season][gt][row.pitch_type]) pitch[season][gt][row.pitch_type] = emptyBucket()
      addRowToBucket(pitch[season][gt][row.pitch_type], row)
    }
  }
}

module.exports = {
  fetchCSV, parseStatcastCSV, emptyBucket, addRowToBucket, isTwoWayPositions, n, sprayDir,
  dayUrl, addDays, buildPlayerIndex, applyDayRows,
}
