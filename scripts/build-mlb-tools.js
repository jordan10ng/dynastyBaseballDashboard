// build-mlb-tools.js
// Node replacement for build-mlb-tools.py.
// Computes MLB career tool grades (training targets for the prospect regression)
// using the canonical formula in lib/score-tools.js — same logic the arc and
// build-scores.js use, so all surfaces stay in lockstep.
//
// Output: data/model/mlb-tools.json  (same shape as the Python script's output)

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { scoreMlbTool } = require('../lib/score-tools');

const BASE         = process.env.DATA_BASE || path.join(os.homedir(), 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH = path.join(BASE, 'players.json');
const HIST_DIR     = path.join(BASE, 'history');
const NORMS_PATH   = path.join(BASE, 'model/norms.json');
const OUTPUT       = path.join(BASE, 'model/mlb-tools.json');

const VALID_YEARS  = new Set([2015,2016,2017,2018,2019,2021,2022,2023,2024,2025,2026]);
const CURRENT_YEAR = new Date().getFullYear();
const MIN_PA       = 100;
const MIN_IP       = 50.0;

const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const norms   = JSON.parse(fs.readFileSync(NORMS_PATH, 'utf8'));

const history = {};
for (const file of fs.readdirSync(HIST_DIR).sort()) {
  const m = file.match(/^(\d{4})\.json$/);
  if (!m) continue;
  const year = parseInt(m[1]);
  const data = JSON.parse(fs.readFileSync(path.join(HIST_DIR, file), 'utf8'));
  for (const [pid, seasons] of Object.entries(data)) {
    if (!history[pid]) history[pid] = [];
    for (const s of seasons) history[pid].push({ ...s, year });
  }
}

function ipToFloat(ip) {
  const p = String(ip || 0).split('.');
  return parseInt(p[0] || '0') + parseInt(p[1] || '0') / 3;
}

function bucketFromSeason(s) {
  const ipP = String(s.ip || '0').split('.');
  return {
    year: s.year, level: 'MLB',
    ab:  s.ab  || 0, bb: s.bb || 0, hbp: s.hbp || 0,
    so:  s.so  || 0, h:  s.h  || 0,
    xbh: (s.doubles || 0) + (s.triples || 0) + (s.hr || 0),
    sb:  s.sb  || 0,
    tb:  s.tb  || Math.round((parseFloat(s.slg || '0') || 0) * (s.ab || 0)),
    bf:  s.bf  || 0,
    ipOuts: (parseInt(ipP[0] || '0') * 3) + parseInt(ipP[1] || '0'),
  };
}

function careerHitter(pid) {
  const mlb = (history[String(pid)] || []).filter(s =>
    s.level === 'MLB' && s.type === 'hitting' && VALID_YEARS.has(s.year) && (s.pa || 0) >= MIN_PA
  );
  if (!mlb.length) return null;
  const buckets = mlb.map(bucketFromSeason);
  const opts = { norms, isPit: false, referenceYear: CURRENT_YEAR };
  const totalPA = mlb.reduce((sum, s) => sum + (s.pa || 0), 0);
  return {
    type: 'hitter',
    hit:   scoreMlbTool(buckets, 'hit',   opts).score,
    power: scoreMlbTool(buckets, 'power', opts).score,
    speed: scoreMlbTool(buckets, 'speed', opts).score,
    _seasons: mlb.length,
    _pa: Math.round(totalPA),
  };
}

function careerPitcher(pid) {
  const mlb = (history[String(pid)] || []).filter(s =>
    s.level === 'MLB' && s.type === 'pitching' && VALID_YEARS.has(s.year)
  );
  if (!mlb.length) return null;
  const totalIP = mlb.reduce((sum, s) => sum + ipToFloat(s.ip), 0);
  if (totalIP < MIN_IP) return null;
  const buckets = mlb.map(bucketFromSeason).filter(b => b.bf > 0);
  if (!buckets.length) return null;
  const opts = { norms, isPit: true, referenceYear: CURRENT_YEAR };
  return {
    type: 'pitcher',
    stuff:   scoreMlbTool(buckets, 'stuff',   opts).score,
    control: scoreMlbTool(buckets, 'control', opts).score,
    _seasons: mlb.length,
    _ip: Math.round(totalIP),
  };
}

function isTwoWayPositions(positions) {
  const pos = (positions || '').split(',').map(s => s.trim());
  const hasArm = pos.some(p => p === 'SP' || p === 'RP' || p === 'P');
  const hasBat = pos.some(p => p !== 'SP' && p !== 'RP' && p !== 'P');
  return { hasArm, hasBat };
}

const output = {};
let skipped = 0;

for (const [, p] of Object.entries(players)) {
  const mlbam = p.mlbam_id;
  if (!mlbam) continue;
  const { hasArm, hasBat } = isTwoWayPositions(p.positions);

  let result;
  if (hasArm && hasBat) {
    const h   = careerHitter(mlbam);
    const pit = careerPitcher(mlbam);
    if (!h && !pit) { skipped++; continue; }
    result = { type: 'two-way', name: p.name };
    if (h)   { result.hit = h.hit; result.power = h.power; result.speed = h.speed; result._pa = h._pa; }
    if (pit) { result.stuff = pit.stuff; result.control = pit.control; result._ip = pit._ip; }
  } else if (hasArm) {
    result = careerPitcher(mlbam);
    if (!result) { skipped++; continue; }
    result.name = p.name;
  } else {
    result = careerHitter(mlbam);
    if (!result) { skipped++; continue; }
    result.name = p.name;
  }

  output[String(mlbam)] = result;
}

const counts = { hitter: 0, pitcher: 0, 'two-way': 0 };
for (const v of Object.values(output)) counts[v.type] = (counts[v.type] || 0) + 1;
console.log(`Qualifying hitters:  ${counts.hitter}`);
console.log(`Qualifying pitchers: ${counts.pitcher}`);
console.log(`Qualifying two-way:  ${counts['two-way']}`);
console.log(`Skipped (insufficient): ${skipped}`);

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
console.log(`Wrote ${Object.keys(output).length} tool grades → model/mlb-tools.json`);
