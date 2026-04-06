const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH = path.join(BASE, 'players.json');
const HISTORY_2025_PATH = path.join(BASE, 'history/2025.json');
const REGR_PATH = path.join(BASE, 'model/regression.json');
const NORMS_PATH = path.join(BASE, 'model/norms.json');

const regrRaw = fs.readFileSync(REGR_PATH, 'utf8').replace(/: NaN/g, ': null');
const regression = JSON.parse(regrRaw);
const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const history2025 = JSON.parse(fs.readFileSync(HISTORY_2025_PATH, 'utf8'));
const norms = JSON.parse(fs.readFileSync(NORMS_PATH, 'utf8'));

// Baseline ages per level (approximate historical averages)
const AVG_AGES = { 'AAA': 26.5, 'AA': 24.5, 'High-A': 23.0, 'Single-A': 21.5, 'Complex': 19.5, 'DSL': 18.0 };

function getJuly1Age(birthDateStr, year) {
    if (!birthDateStr) return null;
    const dob = new Date(birthDateStr);
    let age = year - dob.getFullYear();
    // If born after July 1st, subtract a year for "baseball age"
    if (7 < dob.getMonth() + 1 || (7 === dob.getMonth() + 1 && 1 < dob.getDate())) {
        age--;
    }
    return age;
}

function calculateWeightedScores() {
  const ranked = [];

  for (const [mlbam_id, seasons] of Object.entries(history2025)) {
    const player = Object.values(players).find(p => p.mlbam_id == mlbam_id);
    if (!player) continue;

    const milbSeasons = seasons.filter(s => s.level !== 'MLB');
    if (milbSeasons.length === 0) continue;
    
    // Sort by PA/IP to get the primary 2025 stint
    const bestSeason = milbSeasons.sort((a, b) => (b.pa || b.ip) - (a.pa || a.ip))[0];
    const level = bestSeason.level;
    const isP = player.positions.includes('P');
    const typeKey = isP ? 'pitchers' : 'hitters';
    const normKey = `${level}|2025`;
    
    if (!norms[normKey] || !norms[normKey][typeKey]) continue;
    const n = norms[normKey][typeKey];
    const levelKey = level.toLowerCase().replace(/-/g, '').replace(/\s/g, '');
    
    // Calculate Age and Age Multiplier
    const age2025 = getJuly1Age(player.birthDate, 2025) || (AVG_AGES[level] || 22);
    const avgAge = AVG_AGES[level] || 23.0;
    const ageMult = Math.exp(0.10 * (avgAge - age2025));

    // Calculate Meta Features
    let firstYear = 9999;
    let aaaDebut = 30.0;
    seasons.forEach(s => {
        const y = parseInt(s.year);
        if (y < firstYear) firstYear = y;
        const histAge = getJuly1Age(player.birthDate, y) || 22;
        if (s.level === 'AAA' && histAge < aaaDebut) aaaDebut = histAge;
    });
    const yearsInMinors = firstYear !== 9999 ? (2025 - firstYear) : 0;
    const sampleSize = isP ? parseFloat(bestSeason.ip || 0) : (bestSeason.pa || 0);

    const toolScores = {};

    ['hit', 'power', 'speed', 'stuff', 'control'].forEach(tool => {
      const config = regression[typeKey]?.[tool];
      if (!config) return;
      let score = config.intercept;

      for (const [featName, featInfo] of Object.entries(config.features)) {
        if (featInfo.scale === 0) continue;
        let featureVal = null;

        // Route the Meta Features
        if (featName === 'years_in_minors') featureVal = yearsInMinors;
        else if (featName === 'aaa_debut_age') featureVal = aaaDebut;
        else if (featName.startsWith(levelKey + '_')) {
            const statName = featName.replace(levelKey + '_', '');
            
            if (statName === 'age_mult') featureVal = ageMult;
            else if (statName === 'sample') featureVal = sampleSize;
            else {
                const rawVal = bestSeason[statName];
                if (rawVal != null && n[statName]) {
                    let z = (rawVal - n[statName].mean) / n[statName].stdev;
                    const inverts = isP ? ['bb_pct', 'baa', 'hr_per_9'] : ['k_pct'];
                    if (inverts.includes(statName)) z = -z;
                    // Apply Age Mult to the Z-Score BEFORE feeding to regression
                    featureVal = z * ageMult;
                }
            }
        }

        if (featureVal !== null) {
          score += ((featureVal - featInfo.mean) / featInfo.scale) * featInfo.coef;
        }
      }
      toolScores[tool] = score;
    });

    // Confidence Penalty based on sample size (400 PA / 80 IP ceiling)
    const confidence = Math.min(sampleSize, isP ? 80 : 400) / (isP ? 80 : 400);
    
    // Composite Calculation (No artificial Level Mult, let the regression dictate)
    const rawScore = isP 
        ? (toolScores.stuff * 1.5 + toolScores.control * 0.5) 
        : (toolScores.hit * 1.0 + toolScores.power * 1.3);
    
    const finalScore = rawScore * confidence;

    ranked.push({
      name: player.name,
      age: age2025,
      ageMult: ageMult,
      level,
      score: finalScore,
      tools: toolScores,
      stats: bestSeason,
      isP
    });
  }

  console.log(`${'RK'.padEnd(3)} | ${'PLAYER'.padEnd(18)} | ${'AGE'.padEnd(3)} | ${'LEV'.padEnd(8)} | ${'SCORE'.padEnd(5)} | ${'TOOLS'.padEnd(14)} | ${'INPUTS'}`);
  console.log('-'.repeat(110));

  ranked.sort((a, b) => b.score - a.score).slice(0, 100).forEach((p, i) => {
    const s = p.stats;
    const t = p.tools;
    
    const toolStr = p.isP 
      ? `S:${t.stuff.toFixed(1)} C:${t.control.toFixed(1)}`
      : `H:${t.hit.toFixed(1)} P:${t.power.toFixed(1)}`;

    const k_pct = s.k_pct || (s.so / s.pa) || 0;
    const iso = s.iso || (parseFloat(s.slg) - parseFloat(s.avg)) || 0;

    const inputStr = p.isP 
      ? `K: ${(k_pct*100).toFixed(1)}% BAA: ${parseFloat(s.baa || 0).toFixed(3)} [Mult: ${p.ageMult.toFixed(2)}x]`
      : `K: ${(k_pct*100).toFixed(1)}% ISO: ${iso.toFixed(3)} [Mult: ${p.ageMult.toFixed(2)}x]`;
    
    console.log(
      `${(i + 1).toString().padEnd(3)} | ` +
      `${p.name.padEnd(18).slice(0, 18)} | ` +
      `${p.age.toString().padEnd(3)} | ` +
      `${p.level.padEnd(8)} | ` +
      `${p.score.toFixed(2).padEnd(5)} | ` +
      `${toolStr.padEnd(14)} | ` +
      `${inputStr}`
    );
  });
}

calculateWeightedScores();
