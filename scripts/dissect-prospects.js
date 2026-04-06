const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const PLAYERS = JSON.parse(fs.readFileSync(path.join(BASE, 'players.json'), 'utf8'));
const REGR = JSON.parse(fs.readFileSync(path.join(BASE, 'model/regression.json'), 'utf8').replace(/: NaN/g, ': null'));
const NORMS = JSON.parse(fs.readFileSync(path.join(BASE, 'model/norms.json'), 'utf8'));

const TARGETS = ["kevin mcgonigle", "konnor griffin", "bryce eldridge", "tyson lewis", "thomas white", "andrew painter", "matt wilkinson", "johnny king", "quinn mathews"];
const AVG_AGES = { 'AAA': 26.5, 'AA': 24.5, 'High-A': 23.0, 'Single-A': 21.5, 'Complex': 19.5, 'DSL': 18.0 };
const LEVEL_RANK = { 'DSL': 1, 'Complex': 2, 'Single-A': 3, 'High-A': 4, 'AA': 5, 'AAA': 6 };
const VALID_SPORT_IDS = [11, 12, 13, 14, 16];

const historyDir = path.join(BASE, 'history');
const fullHistory = {};
fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).forEach(file => {
    const yearData = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
    const year = parseInt(file.replace('.json', ''));
    for (const [pid, seasons] of Object.entries(yearData)) {
        if (!fullHistory[pid]) fullHistory[pid] = [];
        if (Array.isArray(seasons)) {
            seasons.forEach(s => { s.year = year; fullHistory[pid].push(s); });
        }
    }
});

function getAge(dob, year) {
    if (!dob) return 22;
    const d = new Date(dob);
    let age = year - d.getFullYear();
    if (d.getMonth() > 6 || (d.getMonth() === 6 && d.getDate() > 1)) age--;
    return age;
}

TARGETS.forEach(name => {
    const p = Object.values(PLAYERS).find(x => x.name.toLowerCase() === name);
    if (!p) return;

    console.log(`\n================================================================================`);
    console.log(`🚀 DISSECTING: ${p.name.toUpperCase()} (${p.team})`);
    console.log(`================================================================================`);

    const seasons = fullHistory[p.mlbam_id] || [];
    const isP = p.positions.includes('P');
    const typeKey = isP ? 'pitchers' : 'hitters';
    const tools = isP ? ['stuff', 'control'] : ['hit', 'power'];

    const careerAggregate = {};
    const levelWeights = {};
    let firstYear = 9999;
    let highRank = 0;

    seasons.filter(s => s.level !== 'MLB' && VALID_SPORT_IDS.includes(s.sportId)).forEach(s => {
        const lvl = s.level;
        const lk = lvl.toLowerCase().replace(/-/g, '').replace(/\s/g, '');
        const y = s.year;
        if (y < firstYear) firstYear = y;
        if (LEVEL_RANK[lvl] > highRank) highRank = LEVEL_RANK[lvl];
        
        const sample = isP ? parseFloat(s.ip || 0) : (s.pa || 0);
        if (sample < 1) return;

        const age = getAge(p.birthDate, y);
        const ageMult = Math.exp(0.10 * (AVG_AGES[lvl] - age));
        const n = NORMS[`${lvl}|${y}`]?.[typeKey] || NORMS[`${lvl}|2025`]?.[typeKey];
        if (!n) return;

        if (!levelWeights[lk]) levelWeights[lk] = 0;
        levelWeights[lk] += sample;

        const stats = isP ? ['k_pct', 'bb_pct', 'baa'] : ['k_pct', 'bb_pct', 'iso'];
        stats.forEach(sk => {
            let rawVal = s[sk];
            if (rawVal == null) {
                if (sk === 'k_pct') rawVal = isP ? s.k/(sample*4.3) : s.so/sample;
                if (sk === 'bb_pct') rawVal = isP ? s.bb_allowed/(sample*4.3) : s.bb/sample;
                if (sk === 'iso') rawVal = parseFloat(s.slg||0) - parseFloat(s.avg||0);
                if (sk === 'baa') rawVal = parseFloat(s.baa || 0);
            }
            if (n[sk]) {
                let z = (parseFloat(rawVal) - n[sk].mean) / n[sk].stdev;
                if ((isP && ['bb_pct', 'baa'].includes(sk)) || (!isP && sk === 'k_pct')) z = -z;
                
                const featureName = `${lk}_${sk}`;
                if (!careerAggregate[featureName]) careerAggregate[featureName] = 0;
                // Accumulate weighted by volume and age
                careerAggregate[featureName] += (z * ageMult * sample);
            }
        });
    });

    // Divide by level volume to get the final feature value for the model
    Object.keys(careerAggregate).forEach(feat => {
        const lk = feat.split('_')[0];
        careerAggregate[feat] /= levelWeights[lk];
    });

    careerAggregate['meta_years'] = 2025 - firstYear;
    careerAggregate['meta_high_level'] = highRank;

    console.log(`\n--- FINAL TOOL CALCULATIONS ---`);
    tools.forEach(tool => {
        const cfg = REGR[typeKey][tool];
        if (!cfg) return;
        let score = cfg.intercept;
        console.log(`\n> ${tool.toUpperCase()} Breakdown:`);
        console.log(`  Intercept: ${score.toFixed(3)}`);

        for (const [feat, info] of Object.entries(cfg.features)) {
            const val = careerAggregate[feat] || 0;
            if (val === 0) continue;

            const contribution = ((val - info.mean) / info.scale) * info.coef;
            console.log(`  ${feat.padEnd(15)}: Val: ${val.toFixed(2)} | Coef: ${info.coef.toFixed(3)} | Contrib: ${contribution.toFixed(3)}`);
            score += contribution;
        }
        console.log(`  RESULT: ${score.toFixed(2)}`);
    });
});
