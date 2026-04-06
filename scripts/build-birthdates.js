const fs = require('fs'), os = require('os')
const https = require('https')
const { spawn } = require('child_process')

const PLAYERS_PATH = os.homedir() + '/Desktop/fantasy-baseball/data/players.json'
const PROGRESS_PATH = os.homedir() + '/Desktop/fantasy-baseball/data/birthdates-progress.json'

const caf = spawn('caffeinate', ['-i'], { detached: true, stdio: 'ignore' })
caf.unref()

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch(e) { reject(new Error('parse failed')) }
      })
    }).on('error', reject)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function loadJSON(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf-8')) }
  catch(e) { return fallback }
}

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8'))
  const progress = loadJSON(PROGRESS_PATH, {})

  const eligible = Object.values(players).filter(p => p.mlbam_id && !progress[p.mlbam_id])
  const total = Object.values(players).filter(p => p.mlbam_id).length

  console.log(`Hey human — ${eligible.length} to fetch, ${Object.keys(progress).length} already done\n`)

  let done = 0, found = 0, missing = 0, errors = 0

  for (const player of eligible) {
    try {
      const data = await get(`https://statsapi.mlb.com/api/v1/people/${player.mlbam_id}?fields=people,id,birthDate,currentAge`)
      const person = data.people?.[0]
      const birthDate = person?.birthDate ?? null

      if (birthDate) {
        players[player.id].birthDate = birthDate
        found++
      } else {
        missing++
      }

      progress[player.mlbam_id] = { name: player.name, birthDate, ts: Date.now() }
    } catch(e) {
      errors++
      progress[player.mlbam_id] = { name: player.name, birthDate: null, error: true, ts: Date.now() }
    }

    done++

    if (done === 1) {
      console.log(`Player 1 done — ${player.name} birthDate: ${players[player.id].birthDate ?? 'not found'}`)
    }

    if (done > 1 && (done - 1) % 200 === 0) {
      // Save progress and patch players.json
      fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2))
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress))
      console.log(`Hey human — ${Object.keys(progress).length}/${total} done. Player #${done}: ${player.name}`)
      console.log(`  found:${found}  missing:${missing}  errors:${errors}`)
    }

    await sleep(80) // faster — tiny response
  }

  // Final save
  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(players, null, 2))
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress))

  console.log('\nHey human — all done!')
  console.log(`Found:${found}  Missing:${missing}  Errors:${errors}`)

  // Sanity check
  const withDOB = Object.values(players).filter(p => p.birthDate).length
  console.log(`\nplayers.json now has birthDate on ${withDOB} players`)
  console.log('Sample:')
  Object.values(players).filter(p => p.birthDate).slice(0, 5)
    .forEach(p => console.log(` ${p.name.padEnd(25)} ${p.birthDate}`))
}

main().catch(console.error)
