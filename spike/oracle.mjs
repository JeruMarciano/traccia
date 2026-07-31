// Throwaway spike harness. Ships zero bytes; never imported by the app.
//
// Two servers, one process:
//
//   :8080  a logging HTTP/CONNECT proxy. Every host the browser tries to reach
//          passes through here and is appended to a JSONL log. This is the
//          spike's *independent oracle* — it observes the browser on a channel
//          the Chrome DevTools Protocol does not control, so a CDP claim of
//          "blocked" can be checked against it rather than taken on trust.
//
//   :8081  a synthetic site with deliberately awkward tracker placement:
//          a cross-origin iframe whose first parse-blocking subresource is a
//          third-party script, and a slow request that starts before consent
//          and finishes after it.
//
// Hostnames ending in .test are resolved by the proxy itself to 127.0.0.1:8081,
// so the synthetic origins are genuinely cross-origin (distinct sites, so Chrome
// site-isolates them into separate processes) without touching DNS or /etc/hosts.

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const SITE_PORT = 8081;
const PROXY_PORT = 8080;
const LOG_PATH = process.env.ORACLE_LOG ?? 'spike/artifacts/proxy.jsonl';

fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.writeFileSync(LOG_PATH, '');
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

function record(entry) {
  logStream.write(JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
}

// ---------------------------------------------------------------- synthetic site

const PAGES = {
  // First party. Everything else it pulls in is a different site.
  'first.test': () => ({
    type: 'text/html',
    body: `<!doctype html>
<meta charset="utf-8">
<title>Spike first party</title>
<h1>First party</h1>

<!-- F1/F3: an ordinary third-party pixel from the top-level document -->
<img src="http://tracker.test:8081/px.gif?from=toplevel" width="1" height="1" alt="">

<!-- F1/F2: a cross-origin iframe. Its first act is a third-party request.
     A session attached only to the page target cannot see this. -->
<iframe src="http://iframe3p.test:8081/frame.html" width="200" height="60"></iframe>

<!-- F6: starts before consent, finishes after it. Attribution must follow
     initiation, not completion. -->
<script>
  fetch('http://straddle.test:8081/slow.gif', { mode: 'no-cors' });

  window.__consented = false;
  function accept() {
    window.__consented = true;
    fetch('http://postconsent.test:8081/after.gif', { mode: 'no-cors' });
    document.getElementById('state').textContent = 'accepted';
  }
</script>

<button id="accept" onclick="accept()">Accept</button>
<span id="state">pending</span>
`,
  }),

  // A different site, so Chrome puts it in its own process.
  'iframe3p.test': () => ({
    type: 'text/html',
    body: `<!doctype html>
<meta charset="utf-8">
<!-- parse-blocking, issued before anything else in this frame runs -->
<script src="http://deeptracker.test:8081/deep.js"></script>
<p>third-party frame</p>
`,
  }),
};

const siteServer = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  const url = `http://${req.headers.host}${req.url}`;
  record({ kind: 'site-hit', host, url });

  const page = PAGES[host];
  if (page) {
    const { type, body } = page();
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  // Everything else is a "tracker" endpoint. Arriving here at all is the fact
  // the spike measures: the request was not blocked.
  const finish = () => {
    res.writeHead(200, {
      'content-type': req.url.endsWith('.js') ? 'application/javascript' : 'image/gif',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(req.url.endsWith('.js') ? '/* tracker */' : '');
  };

  // The straddling request responds slowly on purpose.
  if (req.url.startsWith('/slow.gif')) setTimeout(finish, 3000);
  else finish();
});

// --------------------------------------------------------------------- proxy

function routeFor(host, port) {
  // .test names are the synthetic site; anything else is the real internet.
  return host.endsWith('.test')
    ? { host: '127.0.0.1', port: SITE_PORT }
    : { host, port };
}

const proxy = http.createServer((req, res) => {
  let target;
  try {
    target = new URL(req.url);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const port = Number(target.port || 80);
  record({ kind: 'http', host: target.hostname, port, url: req.url });

  const route = routeFor(target.hostname, port);
  const upstream = http.request(
    {
      host: route.host,
      port: route.port,
      method: req.method,
      path: target.pathname + target.search,
      headers: { ...req.headers, host: target.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => res.writeHead(502).end());
  req.pipe(upstream);
});

// HTTPS and anything else the browser tunnels.
proxy.on('connect', (req, clientSocket, head) => {
  const [host, rawPort] = req.url.split(':');
  const port = Number(rawPort || 443);
  record({ kind: 'connect', host, port, url: req.url });

  const route = routeFor(host, port);
  const upstream = net.connect(route.port, route.host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

siteServer.listen(SITE_PORT, '127.0.0.1', () => {
  proxy.listen(PROXY_PORT, '127.0.0.1', () => {
    console.log(`oracle: site :${SITE_PORT}  proxy :${PROXY_PORT}  log ${LOG_PATH}`);
  });
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logStream.end(() => process.exit(0));
  });
}
