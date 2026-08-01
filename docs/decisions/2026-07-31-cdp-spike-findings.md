# CDP spike — findings

**Date:** 2026-07-31
**Criteria:** `2026-07-31-cdp-spike-falsification.md`
**Verdict: PASS, with one architectural correction that must be adopted.**

The spike answers yes to the question the port rests on — but it also shows that the
mechanism named in the shell-architecture decision, CDP request interception, is **not
sufficient on its own** to carry spec §7.1. The correction is cheap and makes the result
stronger than Electron's, so the port is recommended. It is not optional.

Measured on macOS 24.6.0, Rust 1.97.1, Chrome (installed mid-session) and Brave 1.x.

---

## The correction, stated first

CDP's `Fetch` domain intercepts **requests**. A `<link rel="preconnect">` opens a TCP
connection and completes a TLS handshake **without issuing a request**, so `Fetch.requestPaused`
never fires for it and no CDP call can prevent it. The browser's own service traffic is
likewise invisible, because it does not originate from a page target.

Measured against `edition.cnn.com`, one load:

| | Hosts |
|---|---|
| Reported by CDP | 22 |
| Actually contacted (independent proxy) | **37** |
| Invisible to CDP | **15** |

The invisible fifteen were not incidental. They included `ib.adnxs.com`, `js-sec.indexww.com`,
`cdn.adsafeprotected.com`, `pagead2.googlesyndication.com`, `tpc.googlesyndication.com`,
`www.googletagservices.com`, `config.aps.amazon-adsystem.com` and `segment-data-us-east.zqtk.net`
— ad-tech vendors, which is exactly what the product exists to find. A CDP-only scanner
under-reports by 40%, and under-reporting is the dangerous direction for a compliance tool: a
missed vendor is silently absent from the map rather than visibly uncertain.

Each of those hosts still learns the user's IP address and, through TLS SNI, which host was
being contacted. Under a strict reading of §7.1 that is outbound network traffic.

**Fix, verified:** run the browser behind a loopback proxy the Rust process owns, deny by
default. The proxy sees connection *attempts*, which is the thing §7.1 actually forbids. CDP is
retained for what only it can give: resource type, initiating frame, and consent phase.

With deny-by-default on the same page:

- Allowed through: `edition.cnn.com`, `media.cnn.com`, `lightning.cnn.com`, `fave.api.cnn.io`,
  `registry.api.cnn.io`, `default.any-any.prd.api.bolt.cnn.com`
- Refused: 27 distinct hosts over 43 attempts, every preconnect target among them
- **Egress outside the scan target: 0**
- CDP still supplied 131 attributed requests across 19 hosts

This is a stronger position than Electron. `session.webRequest` has the same blind spot for the
same reason, and the Phase 1 egress guard was never audited against it.

---

## Falsifier results

| | Result |
|---|---|
| **F1** Cross-origin iframe requests observed | **PASS.** The iframe attached as its own target (`[attach] iframe`) and its tracker was both seen and blocked. Requires `Target.setAutoAttach` with `flatten: true`, reapplied recursively in every new session. |
| **F2** No escape through the startup race | **PASS.** 20 cold starts, 20 genuine iframe loads, **0 escapes**. Requires `waitForDebuggerOnStart: true`, arming `Fetch` in the new session, then `Runtime.runIfWaitingForDebugger`. |
| **F3** Blocking confirmed independently | **PASS.** CDP reported blocked; the proxy logged zero connections and the origin server zero hits, against a paired control where the same host *was* contacted. |
| **F4** Ephemeral profile | **PASS.** `--user-data-dir` in a temp directory, removed after the scan, while the user's own browser kept running untouched. Not merely preferred: Chrome refuses remote debugging against the default profile. |
| **F5** Browser's own egress | **FAIL for CDP, PASS for the proxy.** Unhardened Brave made 21 unrequested contacts (`mtalk.google.com:5228`, `clients2.google.com`, `accounts.google.com`, `gvt1.com`). Suppression flags cut it to 11 — **not zero**. Deny-by-default at the proxy takes it to zero. |
| **F6** Pre/post-consent attribution | **PASS.** A request initiated before consent and completed after it is attributed to pre-consent, because the phase is read at `Fetch.requestPaused`, not at completion. Demonstrated with a deliberately slow response straddling the click. |
| **F7** Clear failure with no browser | **PASS.** No browser installed → named error listing every path searched, exit 2. Browser present but never opens the port → bounded 15 s timeout, distinct message. Neither hangs, panics, nor reports an empty scan as clean. |
| **F8** Windows | **PASS at runtime, qualified at build.** See below. |
| **F9** Shipped bytes | **PASS, by a wide margin.** See below. |

---

## F9 — size

Real `tauri build`, release profile, with the full CDP dependency set already added:

| | Bytes |
|---|---|
| Electron `Traccia-1.0.0-arm64.dmg` | 99,452,988 |
| **Tauri `.dmg`** | **1,436,539** |
| Tauri `.app` installed | 2.4 MB |
| Binary | 2,335,056 |

**69× smaller**, well inside the 10–15 MB hoped for. Traccia's own code is 504 KB and the
renderer is React in a webview, so a realistic finished build lands in low single-digit MB.

Dependency cost, all already counted in the number above:

- `tokio`, `serde`, `serde_json` — Tauri depends on these regardless; marginal cost ≈ 0.
- `tokio-tungstenite` — unavoidable, CDP is a WebSocket protocol. No TLS features; the endpoint
  is always `127.0.0.1`.
- `futures-util` — required by the above.
- Avoided: `reqwest`/`hyper`, by reading the `DevToolsActivePort` file the browser writes into
  its own profile instead of querying `/json/version`. Avoided: `chromiumoxide`, which would
  own the interception loop the egress guard must own.

The proxy will add an HTTP/CONNECT server. The spike used Node for the oracle, which ships
nothing; the real one must be Rust. Budget for it and re-measure — it is small, but it is not
free, and it is now load-bearing.

**Re-measured after the port, 2026-07-31.** The numbers above are the spike's, taken before the
proxy existed and before `tauri-plugin-dialog` was added. See
`docs/decisions/2026-07-31-tauri-bundle-measurement.md` for the shipped figures.

In short: the `.dmg` is 1,536,327 bytes and the binary 2,436,064 — **64.7×** smaller than
Electron rather than the 69× above, the binary having grown 101,008 bytes net. That figure is net
of the CDP dependency set, which is no longer in the tree and which Phase 2 will pay for again.
Windows, which the spike could not build at all, ships a 1,124,383-byte NSIS installer.

---

## F8 — Windows

**Runtime: fine.** Edge is present on every Windows 10/11 install and speaks the same protocol,
so browser discovery has a guaranteed hit. Per Tauri's docs the WebView2 runtime ships as part
of Windows 10 (April 2018 or later) and Windows 11, so the shell itself needs no extra download.

**Build: cannot be done from this Mac.** Confirmed rather than assumed:

- `rustup target add x86_64-pc-windows-msvc` succeeds — the standard library installs.
- No Windows linker exists on the machine: `lld-link`, `link.exe`, `xwin` and `cargo-xwin` are
  all absent.
- Tauri's own docs: MSI "can only be created on Windows", and cross-compiled NSIS from macOS is
  "not as straight forward… and is not tested as much", to be attempted only as a last resort.

**The answer is a Windows CI runner**, not a local cross-build. The project already distributes
from GitHub, where `windows-latest` runners are free for public repositories. This is a small
amount of CI configuration, not a blocker — but it must be set up before Windows is claimed as
first-class, and `cargo-xwin` should be avoided (it works by fetching Microsoft CRT and SDK
headers, whose redistribution terms do not fit this project's licence constraints).

---

## Other findings worth carrying forward

- **Chrome and Edge were both absent from the development machine**; only Brave was installed
  until Chrome was added mid-session. The decision doc assumes "most business clients run Chrome
  or Edge". That is probably true of business clients, but the discovery list must cover Brave,
  Vivaldi and Chromium, and the not-found message must name what it looked for. It does.
- **Brave Shields make blocking results uninterpretable.** Any future test on Brave needs a
  neutral third-party origin and a paired control, or it measures Brave rather than Traccia.
- **A component extension made requests even in a fresh profile**
  (`chrome-extension://…/craw_background.js` under Brave). `--disable-background-networking`
  removed it. Worth an assertion in the real test suite.
- **The measuring instrument crashed mid-run once** and silently under-reported, because the
  proxy's refusal path returned before attaching a socket error listener. It was caught only
  because the result looked impossible. Any egress test must fail loudly when its own observer
  dies, or it will report success from a dead sensor.

---

## What this changes in the plan

1. **Spec §7.1 stands as written and can be met absolutely** — but by the proxy, not by CDP.
   The amendment permitting an already-installed browser is sound; add that the app owns the
   browser's only route to the network.
2. **The egress guard is no longer only a URL validator.** It becomes the proxy's admission
   decision. That is a larger and more security-sensitive component than
   `src/main/egressGuard.ts`, and the four defects found in that file's two audits argue for
   auditing this one harder, not less. Treat it as new code.
3. **`src/core/` is untouched by any of this**, as intended.
4. **Add a Windows CI runner** before Windows is treated as shipped.

## Reproducing

```bash
node spike/oracle.mjs &                                     # observer only
ORACLE_ALLOW_ONLY=cnn.com,cnn.io node spike/oracle.mjs &    # deny-by-default
cargo build --manifest-path spike/cdp-driver/Cargo.toml
./spike/cdp-driver/target/debug/cdp-driver \
  --url https://edition.cnn.com/ --headless --harden \
  --block doubleclick.net --settle 15000
```

The spike is throwaway. It is kept only as evidence for these numbers and should not be used as
a porting base — in particular its interception loop has had no adversarial review.
