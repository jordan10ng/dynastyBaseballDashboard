const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const PLAYERS = JSON.parse(fs.readFileSync(path.join(BASE, 'players.json'), 'utf8'));
const REGR = JSON.parse(fs.readFileSync(path.join(BASE, 'model/regression.json'), 'utf8').replace(/: NaN/g, ': null'));
const NORMS = JSON.parse(fs.readFileSync(path.join(BASE, 'model/norms.json'), 'utf8'));

const CLASH_PAIRS = [
  { p1: "jarlin susana", p2: "thomas white" },
  { p1: "spencer jones", p2: "zyhir hope" }
];

const historyFiles = fs.readdirSync(path.join(BASE, 'history')).filter(f => f.endsWith('.json'));
const fullHistory = {};
historyFiles.forEach(file => {
    const data = JSON.parse(fs.readFileSync(path.join(BASE, 'history', file), 'utf8'));
    const year = parseInt(file.replace('.json', ''));
    for (const [pid, seasons] of Object.entries(data)) {
        if (!fullHistory[pid]) fullHistory[pid] = [];
        if (Array.isArray(seasons)) seasons.forEach(s => { s.year = year; fullHistory[pid].push(s); });
    }
});

function getAge(dob, year) {
    if (!dob) return 22;
    const d = new Date(dob);
    let age = year - d.getFullYear();
    if (d.getMonth() > 6 || (d.getMonth() === 6 && d.getDate() > 1)) age--;
    return age;
}

CLASH_PAIRS.forEach(pair => {
    console.log(`\n================================================================================`);
    console.log(`⚔️  ${pair.p1.toUpperCase()} vs ${pair.p2.toUpperCase()}`);
    console.log(`================================================================================`);

    [pair.p1, pair.p2].forEach(name => {
        const p = Object.values(PLAYERS).find(x => x.name.toLowerCase() === name);
        if (!p) return console.log(`\nPlayer not found: ${name}`);

        const seasons = fullHistory[p.mlbam_id] || [];
        const isP = p.positions.includes('P');
        
        console.log(`\n[ ${p.name.toUpperCase()} - ${isP ? 'PITCHER' : 'HITTER'} ]`);
        console.log(`${'YEAR/LEV'.padEnd(12)} | ${'VOL'.padEnd(6)} | ${'AGE'.padEnd(3)} | ${'K%'.padEnd(6)} | ${'BB%'.padEnd(6)} | ${isP ? 'BAA' : 'ISO'}`);
        console.log('-'.repeat(55));

        seasons.filter(s => s.level !== 'MLB' && [11,12,13,14,16].includes(s.sportId)).forEach(s => {
            const vol = isP ? parseFloat(s.ip || 0) : (s.pa || 0);
            if (vol < 5) return;
            const age = getAge(p.birthDate, s.year);
            const k = isP ? (s.k / (vol * 4.3)) : (s.so / vol);
            const bb = isP ? (s.bb_allowed / (vol * 4.3)) : (s.bb / vol);
            const secondary = isP ? parseFloat(s.baa || 0) : (parseFloat(s.slg||0) - parseFloat(s.avg||0));

            console.log(`${(s.year + ' ' + s.level).padEnd(12)} | ${vol.toString().padEnd(6)} | ${age.toString().padEnd(3)} | ${(k*100).toFixed(1)}% | ${(bb*100).toFixed(1)}% | ${secondary.toFixed(3)}`);
        });
    });
});
