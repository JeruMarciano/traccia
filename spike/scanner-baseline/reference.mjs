// Reference observer for the scanner baseline. Measurement only, never shipped.
// Drives a fresh headless Chrome over CDP and records, per phase:
//   pre   — homepage, 8 s + scroll, before any consent click
//   post  — after clicking an "accept" control, 8 s
//   pages — up to 12 key pages (contact, careers, shop, booking, newsletter...), 5 s each
// Per phase: every request host (page + all frames/workers), cookies (name/domain/expiry only).
// Per page: forms (field type/name/autocomplete, action host), iframe hosts.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
const out = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-sync', '--window-size=1366,900',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: 'ignore' });

let portFile = path.join(profile, 'DevToolsActivePort');
for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
const handlers = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  for (const h of handlers) h(m);
};
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const i = ++id;
  pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ error: 'timeout' }); } }, 30000);
});

let phase = 'pre';
const hosts = { pre: new Set(), post: new Set(), pages: new Set() };
const hostOf = (u) => { try { const x = new URL(u); return /^(https?|wss?):$/.test(x.protocol) ? x.hostname : null; } catch { return null; } };
// First path segment per host, as the app records it: [a-z0-9-_]{1,32}, at most 8 distinct per host.
const paths = {};
const noteSegment = (u, h) => {
  const seg = (new URL(u).pathname.split('/')[1] ?? '').toLowerCase();
  const set = (paths[h] ??= new Set());
  if (/^[a-z0-9_-]{1,32}$/.test(seg) && set.size < 8) set.add(seg);
};
handlers.push((m) => {
  if (m.method === 'Network.requestWillBeSent') { const h = hostOf(m.params.request.url); if (h) { hosts[phase].add(h); noteSegment(m.params.request.url, h); } }
  if (m.method === 'Network.webSocketCreated') { const h = hostOf(m.params.url); if (h) hosts[phase].add('ws:' + h); }
  if (m.method === 'Target.attachedToTarget') {
    const s = m.params.sessionId;
    send('Network.enable', {}, s);
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s);
    send('Runtime.runIfWaitingForDebugger', {}, s);
  }
});

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId: S } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Network.enable', {}, S);
await send('Page.enable', {}, S);
await send('Runtime.enable', {}, S);
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, S);

const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, S)).result?.result?.value;
const goto = async (u, wait) => {
  const loaded = new Promise((r) => { const h = (m) => { if (m.method === 'Page.loadEventFired' && m.sessionId === S) { handlers.splice(handlers.indexOf(h), 1); r(); } }; handlers.push(h); });
  await send('Page.navigate', { url: u }, S);
  await Promise.race([loaded, sleep(30000)]);
  await evaluate('window.scrollTo(0, document.body.scrollHeight)');
  await sleep(wait);
};
const cookies = async () => ((await send('Storage.getCookies')).result?.cookies ?? []).map((c) => ({ name: c.name, domain: c.domain, session: c.session, days: c.session ? 0 : Math.round((c.expires - Date.now() / 1000) / 86400) }));

const CONSENT_SEL = '#CybotCookiebotDialog,#iubenda-cs-banner,#cookie-law-info-bar,.cky-consent-container,#cmplz-cookiebanner-container,#moove_gdpr_cookie_info_bar,[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=gdpr i],[class*=gdpr i],[id*=cmp i]';
const PROBE = `(() => {
  // body/html excluded: plugins put classes like 'cookies-not-set' on <body>.
  const inConsent = (e) => { const c = e.closest('${CONSENT_SEL}'); return !!c && c !== document.body && c !== document.documentElement; };
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const fields = [...document.querySelectorAll('input,select,textarea')].filter(e => !inConsent(e) && !['hidden','submit','button','image','reset'].includes((e.type||'').toLowerCase()))
    .map(e => ({ type: (e.type||e.tagName).toLowerCase(), name: e.name||e.id||'', ac: e.autocomplete||'', label: (e.labels?.[0]?.innerText || e.placeholder || e.getAttribute('aria-label') || '').trim().slice(0,40), form: e.form ? (e.form.getAttribute('action')||'') : '(none)', visible: vis(e) }));
  const iframes = [...document.querySelectorAll('iframe')].map(f => f.src).filter(Boolean);
  const links = [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (a.innerText||'').trim().slice(0,60) }));
  return { title: document.title, finalUrl: location.href, fields, iframes, links };
})()`;

// Generic accept-button finder (text match in main doc and open shadow roots).
const CLICK_ACCEPT = `(() => {
  // Bare ok/continua/ho capito count only inside a consent container (hand check: a blog "CONTINUA" link was clicked).
  const strong = /^(accetta( tutti| tutto| e continua| e chiudi| i cookies?| tutti i cookies?)?|accetto( tutti)?|acconsento( a tutti)?|sì, accetto|consenti( tutti| tutto)?|accept( all| all cookies| cookies| all and close)?|allow( all)?( cookies)?|agree|i agree|autorizza tutti|accept & close)$/i;
  const weak = /^(ok|ok, ho capito|ho capito|continua)$/i;
  const roots = [document];
  const walk = (n) => { for (const e of n.querySelectorAll('*')) if (e.shadowRoot) { roots.push(e.shadowRoot); walk(e.shadowRoot); } };
  walk(document);
  for (const r of roots) for (const b of r.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit],div[onclick],span[onclick]')) {
    const t = (b.innerText || b.value || '').replace(/\\s+/g,' ').trim();
    const rect = b.getBoundingClientRect();
    const c = b.closest('${CONSENT_SEL}'); const inBanner = !!c && c !== document.body && c !== document.documentElement;
    if (t && t.length < 40 && rect.width > 0 && (strong.test(t) || (inBanner && weak.test(t)))) { b.click(); return t + (inBanner ? '' : ' [outside banner]'); }
  }
  return null;
})()`;

const CMP = `(() => { const w = window; const f = [];
  const g = { OneTrust: w.OneTrust||w.OptanonActiveGroups, Cookiebot: w.Cookiebot||w.CookieConsent?.consentUTC!==undefined, Iubenda: w._iub?.csConfiguration || document.querySelector('#iubenda-cs-banner'), Usercentrics: w.UC_UI||w.__ucCmp,
    CookieYes: w.getCkyConsent||document.querySelector('.cky-consent-container'), Complianz: w.complianz||document.querySelector('#cmplz-cookiebanner-container'),
    Didomi: w.Didomi, Quantcast: w.__tcfapi&&document.querySelector('.qc-cmp2-container'), CookieLawInfo: document.querySelector('#cookie-law-info-bar'),
    Borlabs: w.BorlabsCookie, Klaro: w.klaro, Tarteaucitron: w.tarteaucitron, CookieScript: w.CookieScript, Axeptio: w.axeptioSDK||w._axcb, TrustArc: w.truste,
    Osano: w.Osano, Termly: w.Termly, CookieHub: w.cookiehub, Moove: document.querySelector('#moove_gdpr_cookie_info_bar'), CookieNotice: document.querySelector('#cookie-notice'),
    RealCookieBanner: document.querySelector('[id^=real-cookie-banner]'), TCF: w.__tcfapi };
  for (const [k,v] of Object.entries(g)) if (v) f.push(k); return f; })()`;

const KEY = /\b(contatt|contact|lavora|careers?|jobs?|candidat|newsletter|shop|negozio|store|prodott|product|carrello|cart|prenot|book|reserv|appuntament|preventiv|quote|area-riservata|login|account|registr|iscri|dona|donate|privacy|cookie)/i;
const SKIP = /\.pdf($|\?)|[?&](print|tmpl)=/i;

const result = { url, startedAt: new Date().toISOString() };
try {
  await goto(url, 8000);
  const home = await evaluate(PROBE);
  result.home = { finalUrl: home?.finalUrl, title: home?.title, fields: home?.fields, iframes: home?.iframes };
  result.cmp = await evaluate(CMP);
  result.cookiesPre = await cookies();
  phase = 'post';
  result.acceptClicked = await evaluate(CLICK_ACCEPT);
  await sleep(8000);
  result.acceptNavigated = (await evaluate('location.href')) !== home.finalUrl;
  result.cookiesPost = await cookies();
  phase = 'pages';
  const origin = new URL(home.finalUrl).hostname.replace(/^www\./, '');
  const internal = [...new Map((home.links || []).filter((l) => { try { return new URL(l.href).hostname.replace(/^www\./, '') === origin; } catch { return false; } })
    .map((l) => [l.href.split('#')[0], l])).values()];
  result.homeInternalLinks = internal.length;
  result.homeLinksInOrder = internal.slice(0, 12).map((l) => l.href);
  const key = internal.filter((l) => KEY.test(l.href + ' ' + l.text) && !SKIP.test(l.href)).slice(0, 12);
  result.pages = [];
  for (const l of key) {
    phase = 'page';
    hosts.page = new Set();
    await goto(l.href, 5000);
    const p = await evaluate(PROBE);
    phase = 'pages';
    // A key link that redirects off-site (hand check: /facebook -> facebook.com) is not the site's page.
    if (!p?.finalUrl || new URL(p.finalUrl).hostname.replace(/^www\./, '') !== origin) { result.offsite = (result.offsite || 0) + 1; continue; }
    for (const h of hosts.page) hosts.pages.add(h);
    result.pages.push({ url: l.href, text: l.text, fields: p?.fields, iframes: p?.iframes });
  }
  result.cookiesFinal = await cookies();
  try {
    const sm = await fetch(new URL('/sitemap.xml', home.finalUrl), { signal: AbortSignal.timeout(10000) });
    const body = sm.ok ? await sm.text() : '';
    result.sitemapLocs = (body.match(/<loc>/g) || []).length;
  } catch { result.sitemapLocs = null; }
} catch (e) { result.error = String(e); }
delete hosts.page;
result.hosts = Object.fromEntries(Object.entries(hosts).map(([k, v]) => [k, [...v].sort()]));
result.paths = Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, [...v].sort()]));
fs.writeFileSync(out, JSON.stringify(result, null, 1));
chrome.kill('SIGKILL');
await sleep(500);
fs.rmSync(profile, { recursive: true, force: true });
process.exit(0);
