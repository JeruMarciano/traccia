# CDP spike — what would falsify it

**Date:** 2026-07-31
**Status:** Spike design. Throwaway code, permanent findings.
**Question under test:** On macOS, can a Tauri (Rust) shell drive an already-installed
Chromium-family browser over the Chrome DevTools Protocol and (a) observe every request a page
makes, (b) block the ones it should, (c) distinguish requests fired before consent from those
after?

---

## The trap this design exists to avoid

The obvious spike is: launch Chrome with `--remote-debugging-port`, enable `Network`, load a
page, print the request list, call `Fetch.failRequest` on a tracker, observe that the tracker
does not appear. That spike passes almost regardless of the truth, because **every observation
in it comes from CDP itself**. It asks the defendant to testify.

So the spike carries an **independent oracle**: the browser is launched behind a local logging
proxy that records every host the browser attempts to reach, on a channel CDP does not control.
A claim of "blocked" is only accepted when the proxy log agrees.

---

## Falsifiers

Each of these, if true, breaks the port. Each must be actively provoked, not merely not-observed.

### F1 — "Every request" is false: cross-origin iframes are invisible

A session attached to the page target does not see requests from out-of-process iframes,
workers, or service workers. Third-party trackers commonly load inside cross-origin iframes,
which is precisely the case the product exists to catch.

**Provoke:** serve a page whose only tracker request is issued from inside a cross-origin
iframe. If it is absent from the observed set, FAIL.
**Expected mechanism:** `Target.setAutoAttach` with `flatten: true`, applied recursively to
each newly attached session.

### F2 — Blocking has a startup race: requests escape before the interceptor is armed

An auto-attached target begins executing the moment it exists. If `Fetch.enable` for that
session lands after the target's first request, the request leaves. "Usually blocked" is not
blocked; a single escape breaks §7.1.

**Provoke:** make the iframe's first act a tracker request, run it repeatedly (≥20 loads).
**Expected mechanism:** `waitForDebuggerOnStart: true`, arm `Fetch` in the new session, then
`Runtime.runIfWaitingForDebugger`. Any nonzero escape count is FAIL.

### F3 — "Blocked" means only "CDP said blocked"

`Fetch.failRequest` may report success while a connection was already made.

**Provoke:** proxy log must show **zero** connections to the blocked host. Disagreement between
CDP and the proxy is FAIL, and is the single most important check in the spike.

### F4 — The scan cannot use a clean profile

Spec §7.5 requires an ephemeral profile: no cookies, no extensions, no logged-in sessions.
Recent Chrome refuses `--remote-debugging-port` against the default user-data-dir.

**Provoke:** launch with `--user-data-dir` in a temp directory *while the user's own browser is
running*, and confirm the user's session is untouched. If the only way to get a CDP endpoint is
to attach to the user's live browser, FAIL.

### F5 — The browser generates egress the app never asked for

**This is the falsifier the shell-architecture decision does not mention, and the one most
likely to sink the approach.** Electron's Chromium was configured by us. A user's Chrome
launches with component updater, variations, Safe Browsing, OCSP and domain-reliability
traffic of its own. §7.1 reads "no outbound network traffic except requests the scanner makes
to the URL the user explicitly entered" — absolute.

**Provoke:** launch the browser with the intended flag set, navigate nowhere, and read the
proxy log. Every host that is not the scan target is a violation candidate.
**Outcome is not binary:** measure the residue, then measure it again with suppression flags.
If it cannot be driven to zero, the spike does not fail — but §7.1 needs an honest amendment,
and that must be reported, not quietly absorbed.

### F6 — The pre/post-consent split is decoration

Wall-clock timestamps alone do not survive a request initiated before consent and completing
after.

**Provoke:** a beacon on a timer that straddles the consent click. Attribution must be by
initiation, and must be stable across repeats.

### F7 — Failure when no Chromium-family browser exists is silent

**Provoke:** point discovery at a machine state with no browser, and separately at a browser
that never opens the port. Both must produce a clear typed error within a bounded timeout.
A hang, a panic, or an empty result presented as a clean scan is FAIL.

### F8 — Windows

Edge is present on every Windows 10/11 install and speaks the same protocol, so the runtime
story is expected to hold. The build story is the risk: Tauri's own docs state MSI can only be
produced on Windows, and cross-compiled NSIS from macOS is "not tested as much" and a last
resort. Confirm the intended answer (a Windows CI runner) rather than assuming a local
cross-build.

### F9 — Shipped bytes

The entire reason for the port. Measure the real bundle, not an estimate, and account for each
Rust dependency added. A Tauri build that lands near Electron's 99,452,988 bytes is a FAIL on
the only axis that motivated the exercise.

---

## Confounds to control

- **Brave Shields** block trackers independently. Any "it did not load" result on a
  Shields-enabled browser is uninterpretable. Use a neutral third-party origin the browser has
  no opinion about, and always run the paired control.
- **The control condition is mandatory.** For every block claim: interceptor off → the host is
  contacted (proves the test can detect contact); interceptor on → it is not. A single-armed
  test proves nothing.
- **QUIC/UDP bypasses an HTTP proxy.** Disable it, or the oracle has blind spots it does not
  report.

---

## Method

Two stages, because they answer different questions.

**Stage A — mechanics.** A plain Rust binary drives the browser over CDP against the oracle.
Rust, not JavaScript: the egress guard must live in the same process that owns the connection,
and this also measures the dependency set that would ship.

**Stage B — shell.** The same code inside a real Tauri app, bundled, launched from the built
`.app`, and weighed. Stage A alone would not catch a macOS packaging or entitlement problem,
and would not produce the byte count that justifies the port.

The oracle (proxy + synthetic site) is throwaway harness written in Node. It ships zero bytes.

## Verdict rule

PASS requires F1–F4, F6 and F7 all clear, F9 materially better than Electron, and F5 either
clear or reported with an explicit spec amendment. Anything else is reported as NO, and
`electron-phase1` ships.
