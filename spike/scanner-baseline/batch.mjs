// Runs today's scanner and the reference observer on every site in sites.tsv, 3 at a time.
// Skips sites already done, so it can be re-run after an interruption.
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
const run = promisify(execFile);
const D = process.env.DATA.replace(/\/?$/, '/'); // data dir outside the repo: sites.tsv in, runs/ out
const HERE = fileURLToPath(new URL('.', import.meta.url));
fs.mkdirSync(D + 'runs', { recursive: true });
const sites = fs.readFileSync(D + 'sites.tsv', 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
let next = 0;
async function worker() {
  while (next < sites.length) {
    const i = next++;
    const [cat, url] = sites[i];
    const base = `${D}runs/${String(i).padStart(2, '0')}`;
    if (!fs.existsSync(base + '.scan.json')) {
      try {
        const { stdout } = await run(HERE + 'scanrun/target/release/scanrun', [url], { timeout: 300000, maxBuffer: 1 << 24 });
        fs.writeFileSync(base + '.scan.json', stdout);
      } catch (e) { fs.writeFileSync(base + '.scan.json', JSON.stringify({ error: String(e.stderr || e.message).slice(0, 300) })); }
    }
    if (!fs.existsSync(base + '.ref.json')) {
      try { await run('node', [HERE + 'reference.mjs', url, base + '.ref.json'], { timeout: 400000 }); }
      catch (e) { fs.writeFileSync(base + '.ref.json', JSON.stringify({ url, error: String(e.message).slice(0, 300) })); }
    }
    fs.writeFileSync(base + '.meta.json', JSON.stringify({ cat, url }));
    console.log(i, cat, url, 'done');
  }
}
await Promise.all([worker(), worker(), worker()]);
