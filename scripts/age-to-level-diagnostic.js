const fs = require('fs');
const path = require('path');

const BASE = path.join(process.env.HOME, 'Desktop/fantasy-baseball/data');
const PLAYERS_PATH = path.join(BASE, 'players.json');
const HISTORY_2025_PATH = path.join(BASE, 'history/2025.json');

const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
const history2025 = JSON.parse(fs.readFileSync(HISTORY_2025_PATH, 'utf8'));

const AVG_AGES = { 'AAA': 26.5, 'AA': 24.5, 'High-A': 23.0, 'Single-A': 21.5, 'Complex': 19.5, 'DSL': 18.0 };
const LEVEL_RANK = { 'AAA': 6, 'AA': 5, 'High-A': 4, 'Single-A': 3, 'Complex': 2, 'DSL': 1 };

// Valid MiLB Sport IDs (11=AAA, 12=AA, 13=A+, 14=A, 16=Rookie/Complex, 17=Winter, but 16/17 can be messy. 11-14 are pure)
const VALID_SPORT_IDS = [11, 12, 13, 14, 16]; 

function getJuly1Age(birthDateStr, year) {
    if (!birthDateStr) return null;
    const dob = new Date(birthDateStr);
    let age = year - dob.getFullYear();
    if (7 < dob.getMonth() + 1 || (7 === dob.getMonth() + 1 && 1 < dob.getDate())) {
        age--;
    }
    return age;
}

function runDiagnostic() {
  const results = [];

  for (const [mlbam_id, seasons] of Object.entries(history2025)) {
    const player = Object.values(players).find(p => p.mlbam_id == mlbam_id);
    if (!player) continue;

    const mlbStats = seasons.find(s => s.level === 'MLB');
    if (mlbStats) {
      if ((mlbStats.ab || 0) > 100 || (parseFloat(mlbStats.ip) || 0) > 30) continue;
    }

    // FILTER OUT THE WINTER LEAGUE GHOST STATS
    const milbSeasons = seasons.filter(s => 
        s.level !== 'MLB' && 
        s.team !== '' && // Winter leagues often have blank teams
        VALID_SPORT_IDS.includes(s.sportId)
    );
    
    if (milbSeasons.length === 0) continue;
    
    const bestSeason = milbSeasons.sort((a, b) => (b.pa || b.ip) - (a.pa || a.ip))[0];
    const level = bestSeason.level;
    const isP = player.positions.includes('P');
    
    const age2025 = getJuly1Age(player.birthDate, 2025);
    if (!age2025) continue;

    const avgAge = AVG_AGES[level] || 23.0;
    const ageDiff = avgAge - age2025; 

    const sample = isP ? parseFloat(bestSeason.ip || 0) : (bestSeason.pa || 0);
    if ((isP && sample < 15) || (!isP && sample < 50)) continue;

    let statStr = '';
    if (isP) {
        const k_pct = bestSeason.k_pct || (bestSeason.k / (bestSeason.ip * 4.3)) || 0;
        const bb_pct = bestSeason.bb_pct || (bestSeason.bb_allowed / (bestSeason.ip * 4.3)) || 0;
        const baa = parseFloat(bestSeason.baa || 0);
        statStr = `K: ${(k_pct*100).toFixed(1)}% | BB: ${(bb_pct*100).toFixed(1)}% | BAA: ${baa.toFixed(3)}`;
    } else {
        const k_pct = bestSeason.k_pct || (bestSeason.so / bestSeason.pa) || 0;
        const bb_pct = bestSeason.bb_pct || (bestSeason.bb / bestSeason.pa) || 0;
        const iso = bestSeason.iso || (parseFloat(bestSeason.slg || 0) - parseFloat(bestSeason.avg || 0)) || 0;
        statStr = `K: ${(k_pct*100).toFixed(1)}% | BB: ${(bb_pct*100).toFixed(1)}% | ISO: ${iso.toFixed(3)}`;
    }

    results.push({
        name: player.name,
        age: age2025,
        ageDiff: ageDiff,
        level: level,
        levelRank: LEVEL_RANK[level] || 0,
        sample: sample,
        isP: isP,
        stats: statStr
    });
  }

  results.sort((a, b) => {
      if (b.levelRank !== a.levelRank) return b.levelRank - a.levelRank;
      return b.ageDiff - a.ageDiff;
  });

  console.log(`\n=== 2025 CLEAN AGE-TO-LEVEL DIAGNOSTIC ===`);
  console.log(`${'PLAYER'.padEnd(20)} | ${'LEV'.padEnd(8)} | ${'AGE'.padEnd(3)} | ${'DELTA'.padEnd(5)} | ${'VOL'.padEnd(7)} | ${'RAW STATS'}`);
  console.log('-'.repeat(95));

  let currentLevel = '';
  results.forEach(p => {
      if (p.level !== currentLevel) {
          console.log(`\n--- ${p.level} ---`);
          currentLevel = p.level;
      }
      const deltaStr = p.ageDiff >= 0 ? `+${p.ageDiff.toFixed(1)}` : p.ageDiff.toFixed(1);
      const volStr = p.isP ? `${p.sample} IP` : `${p.sample} PA`;
      console.log(`${p.name.padEnd(20).slice(0, 20)} | ${p.level.padEnd(8)} | ${p.age.toString().padEnd(3)} | ${deltaStr.padEnd(5)} | ${volStr.padEnd(7)} | ${p.stats}`);
  });
}

runDiagnostic();
