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

const TARGET_YEAR = '2025';

function calculate2025Scores() {
  const ranked = [];

  for (const [mlbam_id, seasons] of Object.entries(history2025)) {
    const player = Object.values(players).find(p => p.mlbam_id == mlbam_id);
    if (!player) continue;

    // Filter for prospects only: < 100 MLB AB or < 30 MLB IP
    const mlbStats = seasons.find(s => s.level === 'MLB');
    if (mlbStats) {
      if ((mlbStats.ab || 0) > 100 || (parseFloat(mlbStats.ip) || 0) > 30) continue;
    }

    // Get highest MiLB level from 2025
    const milbSeasons = seasons.filter(s => s.level !== 'MLB');
    if (milbSeasons.length === 0) continue;
    
    const bestSeason = milbSeasons.sort((a, b) => (b.pa || b.ip) - (a.pa || a.ip))[0];
    const level = bestSeason.level;
    const isP = player.positions.includes('P');
    const typeKey = isP ? 'pitchers' : 'hitters';
    const normKey = `${level}|${TARGET_YEAR}`;
    
    if (!norms[normKey] || !norms[normKey][typeKey]) continue;

    const levelNorms = norms[normKey][typeKey];
    const levelKey = level.toLowerCase().replace(/-/g, '').replace(/\s/g, '');
    const tools = isP ? ['stuff', 'control'] : ['hit', 'power', 'speed'];
    const toolScores = {};

    tools.forEach(tool => {
      const config = regression[typeKey][tool];
      let score = config.intercept;

      for (const [featName, featInfo] of Object.entries(config.features)) {
        if (!featName.startsWith(levelKey + '_')) continue;
        const statName = featName.replace(levelKey + '_', '');
        const rawVal = bestSeason[statName];
        const n = levelNorms[statName];

        if (rawVal != null && n && featInfo.scale !== 0) {
          let z = (rawVal - n.mean) / n.stdev;
          const inverts = isP ? ['bb_pct', 'baa', 'hr_per_9'] : ['k_pct'];
          if (inverts.includes(statName)) z = -z;
          score += ((z - featInfo.mean) / featInfo.scale) * featInfo.coef;
        }
      }
      toolScores[tool] = score;
    });

    const composite = isP ? (toolScores.stuff * 1.5 + toolScores.control * 0.5) : (toolScores.hit + toolScores.power * 1.2);

    ranked.push({
      name: player.name,
      team: player.team,
      level: level,
      score: composite,
      tools: toolScores,
      isP
    });
  }

  ranked.sort((a, b) => b.score - a.score).slice(0, 250).forEach((p, i) => {
    const t = p.tools;
    const toolStr = p.isP ? `STF: ${t.stuff.toFixed(2)} CTL: ${t.control.toFixed(2)}` : `HIT: ${t.hit.toFixed(2)} PWR: ${t.power.toFixed(2)} SPD: ${t.speed.toFixed(2)}`;
    console.log(`${(i + 1).toString().padEnd(3)} | ${p.name.padEnd(22)} | ${p.team.padEnd(15)} | ${p.level.padEnd(5)} | ${toolStr}`);
  });
}

calculate2025Scores();
