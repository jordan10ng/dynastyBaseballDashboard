const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH = path.join(BASE, 'players.json');
const HISTORY_2025_PATH = path.join(BASE, 'history/2025.json');
const REGR_PATH = path.join(BASE, 'model/regression.json');
const NORMS_PATH = path.join(BASE, 'model/norms.json');

const regression = JSON.parse(fs.readFileSync(REGR_PATH, 'utf8').replace(/: NaN/g, ': null'));
const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const history = JSON.parse(fs.readFileSync(HISTORY_2025_PATH, 'utf8'));
const norms = JSON.parse(fs.readFileSync(NORMS_PATH, 'utf8'));

const AVG_AGES = { 'AAA': 26.5, 'AA': 24.5, 'High-A': 23.0, 'Single-A': 21.5, 'Complex': 19.5, 'DSL': 18.0 };
const VALID_SPORT_IDS = [11, 12, 13, 14, 16];
const LEVEL_RANK = { 'DSL': 1, 'Complex': 2, 'Single-A': 3, 'High-A': 4, 'AA': 5, 'AAA': 6 };

const TARGETS = [
  "kevin mcgonigle", "konnor griffin", "bryce eldridge", "tyson lewis",
  "thomas white", "andrew painter", "matt wilkinson", "johnny king", "quinn mathews"
];

function getJuly1Age(birthDateStr, year) {
    if (!birthDateStr) return null;
    const dob = new Date(birthDateStr);
    let age = year - dob.getFullYear();
    if (7 < dob.getMonth() + 1 || (7 === dob.getMonth() + 1 && 1 < dob.getDate())) { age--; }
    return age;
}

TARGETS.forEach(targetName => {
    const player = Object.values(players).find(p => p.name.toLowerCase() === targetName);
    if (!player) return;

    const seasons = history[player.mlbam_id];
    if (!seasons) return;

    const milbSeasons = seasons.filter(s => s.level !== 'MLB' && s.team !== '' && VALID_SPORT_IDS.includes(s.sportId));
    if (milbSeasons.length === 0) return;
    
    const isP = player.positions.includes('P');
    const typeKey = isP ? 'pitchers' : 'hitters';

    const levelStats = { aaa: {}, aa: {}, higha: {}, singlea: {}, complex: {}, dsl: {} };
    const levelWeights = { aaa: 0, aa: 0, higha: 0, singlea: 0, complex: 0, dsl: 0 };
    
    let firstYear = 9999;
    let highLevel = 0;
    let totalSample = 0;
    let currentLevel = 'DSL';

    milbSeasons.forEach(s => {
        const y = parseInt(s.year || 2025);
        const lvl = s.level;
        const lk = lvl.toLowerCase().replace(/-/g, '').replace(/\s/g, '');
        if (levelWeights[lk] === undefined) return;

        if (y < firstYear) firstYear = y;
        if (LEVEL_RANK[lvl] > highLevel) highLevel = LEVEL_RANK[lvl];
        
        const sample = isP ? parseFloat(s.ip || 0) : (s.pa || 0);
        if (sample <= 0) return;
        
        if (y === 2025 && sample > 30) currentLevel = lvl;

        const histAge = getJuly1Age(player.birthDate, y) || AVG_AGES[lvl] || 22;
        const ageMult = Math.exp(0.10 * (AVG_AGES[lvl] - histAge));
        
        const n = norms[`${lvl}|${y}`]?.[typeKey] || norms[`${lvl}|2025`]?.[typeKey];
        if (!n) return;

        totalSample += sample;
        levelWeights[lk] += sample;

        ['k_pct', 'bb_pct', 'iso', 'baa'].forEach(sk => {
            let raw = s[sk];
            if (raw == null) {
                if (sk === 'k_pct') raw = isP ? s.k/(sample*4.3) : s.so/sample;
                if (sk === 'bb_pct') raw = isP ? s.bb_allowed/(sample*4.3) : s.bb/sample;
                if (sk === 'baa') raw = parseFloat(s.baa || 0);
                if (sk === 'iso') raw = parseFloat(s.slg||0) - parseFloat(s.avg||0);
            }
            if (raw != null && n[sk] && n[sk].stdev > 0) {
                let z = (raw - n[sk].mean) / n[sk].stdev;
                if ((isP && ['bb_pct', 'baa'].includes(sk)) || (!isP && sk === 'k_pct')) z = -z;
                
                if (!levelStats[lk][sk]) levelStats[lk][sk] = 0;
                levelStats[lk][sk] += (z * ageMult * sample);
            }
        });
    });

    for (const lk in levelStats) {
        if (levelWeights[lk] > 0) {
            for (const stat in levelStats[lk]) {
                levelStats[lk][stat] /= levelWeights[lk];
            }
        }
    }

    const toolScores = {};
    ['hit', 'power', 'speed', 'stuff', 'control'].forEach(tool => {
      const config = regression[typeKey]?.[tool];
      if (!config) return;
      let score = config.intercept;

      for (const [featName, featInfo] of Object.entries(config.features)) {
        if (featInfo.scale === 0) continue;
        let val = 0;

        if (featName === 'meta_years') val = 2025 - firstYear;
        else if (featName === 'meta_high_level') val = highLevel;
        else {
            const parts = featName.split('_');
            const lk = parts[0];
            const stat = parts.slice(1).join('_');
            if (levelStats[lk]?.[stat] !== undefined) val = levelStats[lk][stat];
        }
        score += ((val - featInfo.mean) / featInfo.scale) * featInfo.coef;
      }
      toolScores[tool] = score;
    });

    const confidenceMax = isP ? 200 : 800;
    const confidence = Math.min(totalSample, confidenceMax) / confidenceMax;
    const rawScore = isP ? (toolScores.stuff * 1.5 + toolScores.control * 0.5) : (toolScores.hit * 1.0 + toolScores.power * 1.3);
    const finalScore = rawScore * confidence;

    console.log(`\n=== ${player.name.toUpperCase()} ===`);
    console.log(`Total Volume: ${totalSample.toFixed(1)} ${isP ? 'IP' : 'PA'} | Confidence Mult: ${confidence.toFixed(3)}x`);
    console.log(`Raw Base Score: ${rawScore.toFixed(3)} | FINAL SCORE: ${finalScore.toFixed(3)}`);
    if (isP) {
        console.log(`Stuff: ${toolScores.stuff?.toFixed(2) || 0} | Control: ${toolScores.control?.toFixed(2) || 0}`);
    } else {
        console.log(`Hit: ${toolScores.hit?.toFixed(2) || 0} | Power: ${toolScores.power?.toFixed(2) || 0}`);
    }
});
