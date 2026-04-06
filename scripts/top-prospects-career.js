const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const PLAYERS = JSON.parse(fs.readFileSync(path.join(BASE, 'players.json'), 'utf8'));
const REGR = JSON.parse(fs.readFileSync(path.join(BASE, 'model/regression.json'), 'utf8').replace(/: NaN/g, ': null'));
const NORMS = JSON.parse(fs.readFileSync(path.join(BASE, 'model/norms.json'), 'utf8'));

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

const AVG_AGES = { 'AAA': 26.5, 'AA': 24.5, 'High-A': 23.0, 'Single-A': 21.5, 'Complex': 19.5, 'DSL': 18.0 };
const LEVEL_RANK = { 'DSL': 1, 'Complex': 2, 'Single-A': 3, 'High-A': 4, 'AA': 5, 'AAA': 6 };

function getAge(dob, year) {
    if (!dob) return null;
    const d = new Date(dob);
    let age = year - d.getFullYear();
    if (d.getMonth() > 6 || (d.getMonth() === 6 && d.getDate() > 1)) age--;
    return age;
}

const ranked = [];

for (const [pid, seasons] of Object.entries(fullHistory)) {
    const p = Object.values(PLAYERS).find(x => x.mlbam_id == pid);
    if (!p) continue;

    const age2025 = getAge(p.birthDate, 2025);
    if (age2025 > 26) continue;

    // 1. ROOKIE ELIGIBILITY CHECK
    const mlb = seasons.filter(s => s.level === 'MLB');
    const totalMlbAB = mlb.reduce((sum, s) => sum + (s.ab || 0), 0);
    const totalMlbIP = mlb.reduce((sum, s) => sum + parseFloat(s.ip || 0), 0);
    if (totalMlbAB > 130 || totalMlbIP > 50) continue;

    const milb = seasons.filter(s => s.level !== 'MLB' && s.team !== '' && [11,12,13,14,16].includes(s.sportId));
    if (milb.length === 0) continue;

    const isP = p.positions.includes('P');
    const typeKey = isP ? 'pitchers' : 'hitters';
    const careerAggregate = {};
    const levelWeights = {};
    let totalVol = 0;
    let highRank = 0;
    let currentLevel = 'DSL';

    milb.forEach(s => {
        const lvl = s.level;
        const lk = lvl.toLowerCase().replace(/-/g, '').replace(/\s/g, '');
        if (!AVG_AGES[lvl]) return;

        const sample = isP ? parseFloat(s.ip || 0) : (s.pa || 0);
        if (sample < 5) return; 

        const age = getAge(p.birthDate, s.year) || AVG_AGES[lvl];
        // Symmetric Scaling: ageDiff > 0 means young for level (Bonus), < 0 means old (Penalty)
        const ageDiff = AVG_AGES[lvl] - age;
        const ageMult = Math.exp(0.12 * ageDiff); 

        totalVol += sample;
        if (s.year === 2025 && sample > 20) currentLevel = lvl;
        if (LEVEL_RANK[lvl] > highRank) highRank = LEVEL_RANK[lvl];

        const recencyWeight = s.year === 2025 ? 3 : (s.year === 2024 ? 2 : 1);
        const n = NORMS[`${lvl}|${s.year}`]?.[typeKey] || NORMS[`${lvl}|2025`]?.[typeKey];
        if (!n) return;

        if (!levelWeights[lk]) levelWeights[lk] = 0;
        levelWeights[lk] += (sample * recencyWeight);

        const stats = isP ? ['k_pct', 'bb_pct', 'baa'] : ['k_pct', 'bb_pct', 'iso'];
        stats.forEach(sk => {
            let raw = s[sk];
            if (raw == null) {
                if (sk === 'k_pct') raw = isP ? s.k/(sample*4.3) : s.so/sample;
                if (sk === 'bb_pct') raw = isP ? s.bb_allowed/(sample*4.3) : s.bb/sample;
                if (sk === 'iso') raw = parseFloat(s.slg||0) - parseFloat(s.avg||0);
                if (sk === 'baa') raw = parseFloat(s.baa || 0);
            }
            if (n[sk]) {
                let z = (parseFloat(raw) - n[sk].mean) / n[sk].stdev;
                if ((isP && ['bb_pct', 'baa'].includes(sk)) || (!isP && sk === 'k_pct')) z = -z;
                const feat = `${lk}_${sk}`;
                if (!careerAggregate[feat]) careerAggregate[feat] = 0;
                careerAggregate[feat] += (z * ageMult * sample * recencyWeight);
            }
        });
    });

    if (totalVol < (isP ? 40 : 120)) continue;

    Object.keys(careerAggregate).forEach(feat => {
        careerAggregate[feat] /= levelWeights[feat.split('_')[0]];
    });

    const tools = {};
    const toolNames = isP ? ['stuff', 'control'] : ['hit', 'power'];
    toolNames.forEach(t => {
        const cfg = REGR[typeKey][t];
        let score = cfg.intercept;
        for (const [feat, info] of Object.entries(cfg.features)) {
            let val = careerAggregate[feat] || 0;
            if (feat === 'meta_years') val = 2025 - firstYear;
            if (feat === 'meta_high_level') val = highRank;
            score += ((val - info.mean) / info.scale) * info.coef;
        }
        tools[t] = score;
    });

    const confidence = Math.min(totalVol, isP ? 200 : 700) / (isP ? 200 : 700);
    const finalScore = (isP ? (tools.stuff * 1.5 + tools.control * 0.5) : (tools.hit * 1.0 + tools.power * 1.3)) * confidence;

    ranked.push({ name: p.name, age: age2025, level: currentLevel, score: finalScore, tools, isP });
}

console.log(`\n=== 2025 CAREER TOOLS+ PROSPECT RANKS (TOP 25) ===`);
console.log(`${'RK'.padEnd(3)} | ${'PLAYER'.padEnd(20)} | ${'AGE'.padEnd(3)} | ${'LEV'.padEnd(8)} | ${'SCORE'.padEnd(5)} | ${'TOOLS'}`);
console.log('-'.repeat(80));

ranked.sort((a, b) => b.score - a.score).slice(0, 25).forEach((p, i) => {
    const ts = p.isP ? `S:${p.tools.stuff.toFixed(2)} C:${p.tools.control.toFixed(2)}` : `H:${p.tools.hit.toFixed(2)} P:${p.tools.power.toFixed(2)}`;
    console.log(`${(i + 1).toString().padEnd(3)} | ${p.name.padEnd(20).slice(0, 20)} | ${p.age.toString().padEnd(3)} | ${p.level.padEnd(8)} | ${p.score.toFixed(2).padEnd(5)} | ${ts}`);
});
