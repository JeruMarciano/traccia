# Shell architecture: evaluating Tauri as a replacement for Electron

**Date:** 2026-07-31
**Status:** Decided to evaluate. Not yet ported.
**Fallback:** git tag `electron-phase1`

**Superseded in part, 2026-07-31.** This document names CDP request interception as the mechanism
that carries spec §7.1. It is not sufficient on its own: `<link rel="preconnect">` opens TCP and
completes a TLS handshake without issuing a request, so `Fetch.requestPaused` never fires and no
CDP call can prevent it. Measured on one page load, CDP saw 22 hosts where 37 were contacted, and
the 15 it missed were ad-tech vendors. The enforcing mechanism is a deny-by-default loopback proxy
the Rust process owns (`src-tauri/src/proxy.rs`); CDP is retained for attribution only. See
`docs/decisions/2026-07-31-cdp-spike-findings.md` and
`docs/superpowers/plans/2026-07-31-tauri-shell-port.md`.

---

## Where things stand

Phase 1 is functionally complete on Electron. 139 tests across 20 files, typecheck clean,
both security gates passed, a real installer built and measured:

| | Measured |
|---|---|
| `Traccia-1.0.0-arm64.dmg` | **99,452,988 bytes (94.8 MiB)** |
| Installed `Traccia.app` | 237 MB |
| Locale dirs after stripping | 1 (was 659) |
| Traccia's own code | 504 KB |

For comparison, OpenCode's `.dmg` is ~148 MB. The Electron build is already smaller than that.

## Why we are looking at Tauri anyway

The app is distributed free from GitHub to non-technical users, and the owner's priority is
"the less mb, the better." A Tauri build would be roughly 10-15 MB against 99 MB — about a
**6-8x smaller download**.

The size is almost entirely Chromium:

| Component | Size | Removable? |
|---|---|---|
| `Electron Framework` binary (Blink, V8, network stack, compositor, media) | 184 MB | No — this *is* the engine |
| `libvk_swiftshader.dylib` (software GPU fallback) | 16 MB | Possible, breaks machines without hardware acceleration |
| `icudtl.dat` (Unicode collation, dates, segmentation) | 10 MB | Only via a custom small-ICU Electron build |
| `libGLESv2.dylib` (ANGLE) | 6 MB | No |
| Locale `.pak` files | ~1 MB | Already stripped |

## The argument this overturns

Spec §8 chose Electron for one reason: the Phase 2 scanner must drive a real browser to
observe real outbound requests, and `session.webRequest` gives request interception, cookie
access and storage inspection with no extra dependency.

The gap in that reasoning: **the scanner needs Chromium at scan time; it does not follow that
the whole application must be Chromium.** Phase 1 as built is a local file editor that draws
an SVG — it needs no browser engine at all. Size is never mentioned in the spec, so the
trade was never actually weighed.

## What this decision commits you to

WKWebView on macOS has **no general http/https request interception** — only custom scheme
handlers. So under Tauri the scanner cannot run in-process on macOS. The realistic answer is
to drive the user's already-installed Chrome or Edge over the Chrome DevTools Protocol.

That is not merely a workaround. CDP's `Network` and `Fetch` domains give full request
observation *and* blocking — arguably better interception than Electron's `webRequest`, and
it makes the pre/post-consent distinction (spec §5.1) straightforward.

The cost is real and must be accepted consciously:

- **It breaks spec §7.1's "everything bundled."** The app would depend on a Chromium-family
  browser being installed. Most business clients run Chrome or Edge, both of which speak CDP,
  but this is a spec change and should be recorded as one.
- **The egress guard gets rewritten in Rust.** `src/main/egressGuard.ts` is the executable
  form of the product's central promise. It has been audited twice, and those audits found
  four real defects in it (remote `file://` authority permitted, blank-origin wildcard,
  bare-TLD wildcard, throwing on malformed input). A rewrite restarts that clock. Budget for
  a fresh adversarial audit, not a translation.

## What survives the port

| Area | Fate |
|---|---|
| `src/core/` (10 files, pure TypeScript) | **Untouched.** The no-I/O purity constraint pays off exactly here. |
| `src/renderer/` (6 files incl. `theme.ts`) | Nearly untouched — React in a webview. |
| `tests/core/` | Untouched. |
| `src/main/` (egressGuard, projectFile, ipc, index, log) | **Rewritten in Rust.** |
| `src/preload/` | Deleted — replaced by Tauri's `invoke`. |
| `tests/main/` | Rewritten as Rust tests. |

## Recommended sequence — spike before porting

1. **Do not start rewriting.** Build a throwaway spike that proves, on macOS, that a Tauri
   shell can launch the user's installed Chrome over CDP, observe every request a page makes,
   and block the ones it should. That is the single assumption the whole port rests on.
2. If the spike works, port with confidence and re-audit the guard adversarially.
3. If it does not, `electron-phase1` still ships at 99 MB with both gates passed.

A spike costs a session. A port that discovers this problem late costs the Phase 2 scanner.

## Prerequisites not yet met

- **Rust is not installed** on this machine (`rustc` and `cargo` both absent). Install via
  `rustup` before any Tauri work.
- Windows cross-building is harder under Tauri than under electron-builder. The plan targets
  macOS and Windows as first-class; confirm the Windows story during the spike, not after.

## Still open from Phase 1, regardless of shell

- Dependency licence audit of the shipped artefact. `lightningcss` (MPL-2.0, weak copyleft)
  arrives transitively via vite/vitest marked `"dev": true`; confirm nothing copyleft reaches
  the shipped bundle. Global Constraints allow only MIT/Apache-2.0/BSD/ISC.
- No LICENSE file. A public repo without one means all rights reserved, which contradicts the
  intent to let anyone try the tool.
- No README.
- The design pass was not reviewed before its agent was killed.
- Windows lock-retry path in `projectFile` has no test coverage.
