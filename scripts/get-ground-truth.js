const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const PLAYERS = JSON.parse(fs.readFileSync(path.join(BASE, 'players.json'), 'utf8'));

const TARGET_NAMES = [
  "manny machado", "maikel garcia", "zac gallen", "tyler glasnow",
  "thomas white", "jarlin susana", "spencer jones", "zyhir hope"
];

const historyDir = path.join(BASE, 'history');
const fullHistory = {};
fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).forEach(file => {
    const data = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
    const yearStr = file.replace('.json', '');
    if (!/^\d{4}$/.test(yearStr)) return;
    const year = parseInt(yearStr);
    for (const [pid, seasons] of Object.entries(data)) {
        if (!fullHistory[pid]) fullHistory[pid] = [];
        if (Array.isArray(seasons)) seasons.forEach(s => { s.year = year; fullHistory[pid].push(s); });
    }
});

TARGET_NAMES.forEach(name => {
    const p = Object.values(PLAYERS).find(x => x.name && x.name.toLowerCase() === name);
    if (!p) return;

    const pos = Array.isArray(p.positions) ? p.positions.join('/') : (p.positions || '??');
    const isP = pos.includes('P');

    console.log(`\n================================================================================`);
    console.log(`📊 RAW HISTORY: ${p.name.toUpperCase()} (${pos})`);
    console.log(`================================================================================`);
    console.log(`${'YEAR/LEV'.padEnd(14)} | ${'VOL'.padEnd(6)} | ${'AGE'.padEnd(3)} | ${'K%'.padEnd(6)} | ${'BB%'.padEnd(6)} | ${isP ? 'BAA' : 'ISO'}`);
    console.log('-'.repeat(60));

    const seasons = fullHistory[p.mlbam_id] || [];
    seasons.filter(s => s.level !== 'MLB').forEach(s => {
        const vol = isP ? parseFloat(s.ip || 0) : (s.pa || 0);
        if (vol < 1) return;

        let age = '??';
        if (p.birthDate) {
            const dob = new Date(p.birthDate);
            age = s.year - dob.getFullYear();
            if (dob.getMonth() > 6 || (dob.getMonth() === 6 && dob.getDate() > 1)) age--;
        }

        const kPct = isP ? (s.k / (vol * 4.3)) : (s.so / vol);
        const bbPct = isP ? (s.bb_allowed / (vol * 4.3)) : (s.bb / vol);
        const secondary = isP ? parseFloat(s.baa || 0) : (parseFloat(s.slg || 0) - parseFloat(s.avg || 0));

        console.log(`${(s.year + ' ' + s.level).padEnd(14)} | ${vol.toString().padEnd(6)} | ${age.toString().padEnd(3)} | ${(kPct * 100).toFixed(1)}% | ${(bbPct * 100).toFixed(1)}% | ${secondary.toFixed(3)}`);
    });
});
