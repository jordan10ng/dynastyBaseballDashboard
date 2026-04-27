const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_GL = path.join(os.homedir(), 'Desktop/fantasy-baseball-gamelogs');
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN) { console.error('BLOB_READ_WRITE_TOKEN not set'); process.exit(1); }

process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
const { put } = require('@vercel/blob');

const CONCURRENCY = 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const years = fs.readdirSync(BASE_GL).filter(f => /^\d{4}$/.test(f)).sort();
  let done = 0, skipped = 0, errors = 0, total = 0;
  for (const year of years) total += fs.readdirSync(path.join(BASE_GL, year)).filter(f => f.endsWith('.json')).length;
  console.log(`Total files: ${total}`);

  for (const year of years) {
    const yearDir = path.join(BASE_GL, year);
    const files = fs.readdirSync(yearDir).filter(f => f.endsWith('.json'));
    console.log(`\n${year}: ${files.length} files`);

    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async file => {
        const mlbamId = file.replace('.json', '');
        try {
          const raw = fs.readFileSync(path.join(yearDir, file), 'utf8');
          const data = JSON.parse(raw);
          if (!(data.hitting?.length > 0) && !(data.pitching?.length > 0)) { skipped++; return; }
          await put(`gamelogs/${year}/${mlbamId}.json`, raw, { access: 'public', allowOverwrite: true, contentType: 'application/json' });
          done++;
          if (done % 500 === 0) console.log(`  ${done}/${total} uploaded, ${skipped} skipped, ${errors} errors`);
        } catch (e) {
          errors++;
          if (errors <= 3) console.error(`  Error ${mlbamId}:`, e.message);
        }
      }));
      await sleep(100);
    }
  }
  console.log(`\nDone. ${done} uploaded, ${skipped} skipped, ${errors} errors`);
}

run();
