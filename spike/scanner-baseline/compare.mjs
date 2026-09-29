// Compares scanner output against the reference observer, per site and in aggregate.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const D = process.env.DATA.replace(/\/?$/, '/'); // data dir outside the repo: sites.tsv in, runs/ out
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = process.argv[2];
const { identify, classifyHost } = await import(REPO + '/src/core/vendors.ts');
const { isSameSite } = await import(REPO + '/src/core/scan.ts').catch(() => ({}));
const dict = JSON.parse(fs.readFileSync(REPO + '/src/data/vendors.json', 'utf8'));

const SLD2 = /\.(co|com|gov|ac|org|net)\.[a-z]{2}$/;
const reg = (h) => { h = h.replace(/^ws:/, '').toLowerCase(); const n = SLD2.test(h) ? 3 : 2; return h.split('.').slice(-n).join('.'); };
const sameSite = isSameSite ?? ((h, o) => h === o || h.endsWith('.' + o));

const rows = [];
const unnamed = new Map();
for (const f of fs.readdirSync(D + 'runs').filter((f) => f.endsWith('.meta.json')).sort()) {
  const n = f.slice(0, 2);
  const meta = JSON.parse(fs.readFileSync(`${D}runs/${f}`));
  const scan = JSON.parse(fs.readFileSync(`${D}runs/${n}.scan.json`));
  const ref = JSON.parse(fs.readFileSync(`${D}runs/${n}.ref.json`));
  const r = { n, cat: meta.cat, url: meta.url };
  if (ref.error || !ref.home?.finalUrl) { r.refError = ref.error ?? 'no home'; }
  if (scan.error) r.scanError = scan.error;
  const site = ref.home?.finalUrl ? reg(new URL(ref.home.finalUrl).hostname) : reg(new URL(meta.url).hostname);
  const third = (hs) => new Set((hs ?? []).map((h) => h.replace(/^ws:/, '')).filter((h) => reg(h) !== site));
  const pre = third(ref.hosts?.pre), post = third(ref.hosts?.post), pages = third(ref.hosts?.pages);
  const all = new Set([...pre, ...post, ...pages]);
  const afterOnly = [...all].filter((h) => !pre.has(h));
  const scanHosts = (scan.hosts ?? []).map((h) => h.host);
  const scan3 = scanHosts.filter((h) => !sameSite(h, scan.scannedHost ?? ''));
  const scanPhase = new Map((scan.hosts ?? []).map((h) => [h.host, h.phase ?? 'before']));
  r.scanPre3 = scan3.filter((h) => scanPhase.get(h) === 'before').length;
  r.scanAfter3 = scan3.filter((h) => scanPhase.get(h) === 'after').length;
  r.scanMissPreByPhase = [...pre].filter((h) => scanPhase.get(h) !== 'before').length;
  const ck = (c) => c.name + '|' + c.domain.replace(/^\./, '');
  const scanCk = new Map((scan.cookies ?? []).map((c) => [ck(c), c.phase ?? 'unknown']));
  r.cookiesFinalMatched = (ref.cookiesFinal ?? []).filter((c) => scanCk.has(ck(c))).length;
  r.cookiesPreMatched = (ref.cookiesPre ?? []).filter((c) => scanCk.get(ck(c)) === 'before').length;
  r.scanMs = meta.scanMs ?? null;
  r.redirected = ref.home?.finalUrl ? new URL(ref.home.finalUrl).hostname !== new URL(meta.url).hostname : null;
  r.pagesVisited = scan.pagesVisited;
  r.scan3 = scan3.length;
  r.scanFalse3 = scan3.filter((h) => reg(h) === site).length; // own-site hosts shown as third parties
  r.pre3 = pre.size; r.all3 = all.size; r.afterConsentOnly = afterOnly.length;
  r.scanMissPre = [...pre].filter((h) => !scan3.includes(h)).length;
  r.recallAll = all.size ? +(scan3.filter((h) => all.has(h)).length / all.size).toFixed(2) : null;
  // Naming by owning organisation (registrable domain), not per host.
  const orgs = new Map();
  for (const h of all) { const k = reg(h); const hit = identify(h, dict); orgs.set(k, orgs.get(k) || (hit ? 'named' : classifyHost(h) ? 'hint' : 'none')); }
  r.orgs = orgs.size; r.orgsNamed = [...orgs.values()].filter((v) => v === 'named').length; r.orgsHint = [...orgs.values()].filter((v) => v === 'hint').length;
  for (const [k, v] of orgs) if (v !== 'named') unnamed.set(k, (unnamed.get(k) || 0) + 1);
  r.cmpRef = (ref.cmp ?? []).filter((c) => c !== 'TCF').join('+') || (ref.cmp?.includes('TCF') ? 'TCF' : '');
  r.cmpScan = scan.consent?.cmp ?? (scan.consentMarkers ?? []).join('+');
  r.clicked = scan.consent?.clicked ?? false; r.clickRule = scan.consent?.rule ?? null; r.clickRuleName = scan.consent?.ruleName ?? '';
  r.matchedText = scan.consent?.matchedText ?? ''; r.clickNavigated = scan.consent?.clickNavigated ?? false; r.noClickReason = scan.consent?.reason ?? null;
  r.acceptClicked = ref.acceptClicked ?? null;
  r.cookiesPre = ref.cookiesPre?.length ?? null; r.cookiesFinal = ref.cookiesFinal?.length ?? null; r.cookiesScan = scan.cookies?.length ?? null;
  r.cookies3Pre = (ref.cookiesPre ?? []).filter((c) => reg(c.domain.replace(/^\./, '')) !== site).length;
  const vf = (fs_) => (fs_ ?? []).filter((x) => x.visible);
  r.fieldsScan = scan.formFields ? new Set(scan.formFields.filter((x) => !['hidden', 'submit', 'button', 'reset'].includes(x.type)).map((x) => x.page + '|' + x.name)).size : null;
  r.scanFormPages = scan.formFields ? [...new Set(scan.formFields.filter((x) => x.type !== 'hidden').map((x) => new URL(x.page).pathname.slice(0, 40)))] : [];
  r.fieldsHome = vf(ref.home?.fields).length;
  r.pagesWithForms = (ref.pages ?? []).filter((p) => vf(p.fields).length).map((p) => new URL(p.url).pathname.slice(0, 40));
  r.fieldsPages = (ref.pages ?? []).reduce((s, p) => s + vf(p.fields).length, 0);
  const ifr = new Set([...(ref.home?.iframes ?? []), ...(ref.pages ?? []).flatMap((p) => p.iframes ?? [])].map((u) => { try { return reg(new URL(u).hostname); } catch { return null; } }).filter((h) => h && h !== site));
  r.embeds = [...ifr];
  r.keyPages = (ref.pages ?? []).length; r.internalLinks = ref.homeInternalLinks; r.sitemap = ref.sitemapLocs;
  rows.push(r);
}
fs.writeFileSync(D + 'compare.json', JSON.stringify({ rows, unnamed: [...unnamed].sort((a, b) => b[1] - a[1]) }, null, 1));
const ok = rows.filter((r) => !r.refError && !r.scanError);
const sum = (k) => ok.reduce((s, r) => s + (r[k] || 0), 0);
const med = (k) => { const v = ok.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
const p90 = (k) => { const v = ok.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.ceil(v.length * 0.9) - 1)]; };
console.log(`sites ${rows.length}, both ok ${ok.length}, refErr ${rows.filter((r) => r.refError).length}, scanErr ${rows.filter((r) => r.scanError).length}`);
console.log(`third-party hosts: scanner ${sum('scan3')}, ref pre ${sum('pre3')}, ref all ${sum('all3')}, after-consent-only ${sum('afterConsentOnly')}; median recall vs all ${med('recallAll')}`);
console.log(`scanner missed pre-consent hosts: ${sum('scanMissPre')} ; own-site hosts shown as 3rd party: ${sum('scanFalse3')} on ${ok.filter((r) => r.scanFalse3).length} sites`);
console.log(`orgs ${sum('orgs')}: named ${sum('orgsNamed')}, hint ${sum('orgsHint')}, nothing ${sum('orgs') - sum('orgsNamed') - sum('orgsHint')}`);
console.log(`pagesVisited<=1: ${ok.filter((r) => r.pagesVisited <= 1).length} (redirected: ${ok.filter((r) => r.redirected).length})`);
console.log(`consent: ref detected ${ok.filter((r) => r.cmpRef).length}, scanner detected ${ok.filter((r) => r.cmpScan).length}, accept clicked ${ok.filter((r) => r.acceptClicked).length}`);
const clickedRows = ok.filter((r) => r.clicked);
console.log(`accept clicked: scanner ${clickedRows.length} of ${ok.length} (cmp ${clickedRows.filter((r) => r.clickRule === 'cmp').length}, text ${clickedRows.filter((r) => r.clickRule === 'text').length})`);
for (const r of clickedRows) console.log(`  ${r.n} ${r.clickRule} ${r.clickRule === 'text' ? r.matchedText : r.clickRuleName}`);
console.log(`cookies: ref pre ${sum('cookiesPre')} (3rd-party ${sum('cookies3Pre')}), ref final ${sum('cookiesFinal')}, scanner ${sum('cookiesScan')}`);
console.log(`cookies matched at end ${sum('cookiesFinalMatched')}/${sum('cookiesFinal')}, before consent ${sum('cookiesPreMatched')}/${sum('cookiesPre')}`);
console.log(`scanner third parties by phase: before ${sum('scanPre3')}, after ${sum('scanAfter3')}; ref pre-consent hosts not tagged before: ${sum('scanMissPreByPhase')}`);
console.log(`scan p90 ${p90('scanMs') ?? 'n/a'}${p90('scanMs') == null ? '' : ' ms'}`);
console.log(`form fields: scanner ${sum('fieldsScan')}, ref home ${sum('fieldsHome')}, ref key pages ${sum('fieldsPages')}; sites with forms only off-home: ${ok.filter((r) => !r.fieldsHome && r.fieldsPages).length}`);
console.log(`embeds: ${ok.filter((r) => r.embeds.length).length} sites`);
console.log('top unnamed orgs:', [...unnamed].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${k}(${v})`).join(' '));
