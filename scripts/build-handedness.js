/**
 * build-handedness.js
 * Caches bats (batSide.code: R/L/S) and throws (pitchHand.code: R/L) onto players.json
 * from MLB's Stats API, by mlbam_id — needed for build-comp-pool.js's handedness-aware
 * comp matching. Not part of the nightly pipeline; run manually/occasionally, same as
 * build-birthdates.js. Concurrent chunked fetch (unlike build-birthdates.js's serial
 * 80ms-sleep loop) — ~9.5k players at that pace would take way too long.
 */
const fs = require('fs'), os = require('os');

const PLAYERS_PATH = os.homedir() + '/Desktop/fantasy-baseball/data/players.json';
const CHUNK_SIZE = 15;
const SAVE_EVERY = 300;

async function fetchHandedness(mlbamId) {
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people/${mlbamId}?fields=people,id,batSide,code,pitchHand`);
    if (!res.ok) return null;
    const data = await res.json();
    const person = data.people?.[0];
    if (!person) return null;
    return { bats: person.batSide?.code ?? null, throws: person.pitchHand?.code ?? null };
  } catch {
    return null;
  }
}

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'));
  const eligible = Object.values(players).filter(p => p.mlbam_id && !p.bats && !p.throws);
  console.log(`${eligible.length} players to fetch (of ${Object.values(players).filter(p => p.mlbam_id).length} with mlbam_id)`);

  let done = 0, found = 0, missing = 0;
  for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
    const chunk = eligible.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(async (player) => {
      const result = await fetchHandedness(player.mlbam_id);
      if (result && (result.bats || result.throws)) {
        if (result.bats) players[player.id].bats = result.bats;
        if (result.throws) players[player.id].throws = result.throws;
        found++;
      } else {
        missing++;
      }
    }));
    done += chunk.length;

    if (done % SAVE_EVERY < CHUNK_SIZE || done >= eligible.length) {
      fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2));
      console.log(`  ${done}/${eligible.length}  found:${found}  missing:${missing}`);
    }
  }

  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2));
  console.log(`Done. found:${found} missing:${missing}`);
}

main();
