# Traccia v0.1 — the external map

**Date:** 2026-08-01
**Status:** design agreed with the author. Not yet planned.
**Narrows:** `2026-07-30-data-flow-mapper-design.md` §10, per
`docs/decisions/2026-08-01-narrowing-v1-to-the-external-map.md`.
**Builds on:** Phase 1 (merged, `main` at `7318e37`) and the Tauri shell port.

---

## 1. What this release is

One sentence: **you type a website address, and a minute later there is a printable map of
every third party that site hands data to.**

Nothing else. No documents, no editing, no consent handling. Those are named in §11.

## 2. The scenario it serves

A consultant sits with a client for a first check. They ask for the client's online
touchpoints — the website, usually, sometimes a web app. They enter the first one, watch the
map build, and talk through it with the client in the room. Then the next one. At the end they
print a PDF and leave it behind.

Two consequences of "first check" that license most of the design:

- **Accuracy is not the bar.** The author's words: *"the map shouldn't be super accurate, but
  nice to watch and where you can get a first understanding at the data process."* A missing
  vendor is acceptable. A vendor shown as something it is not is not.
- **Speed and legibility beat completeness.** The map is a conversation prop, not a filing.

## 3. What a scan can and cannot see — stated on the sheet, not just here

A scan observes what a **browser** contacts while loading pages. It sees analytics, ad-tech,
tag managers, chat widgets, CDNs, embedded payment frames, fonts, and anything else the page's
own code reaches for.

It does not see:

- **Anything server-side.** A contact form that posts to the client's own server, which then
  forwards to a CRM, appears as one flow to the client's own domain. The CRM is invisible.
- **Anything behind a login.** Spec §7.5 forbids the scanner from authenticating, submitting
  forms or entering credentials, and that stays. A web app is scannable at its public surface —
  marketing pages, the login page itself — and no further. This is a deliberate limit: the tool
  cannot leak a client's account because it never holds one.
- **Anything off the web.** Payroll, accounting, HR, backup, device management. That is the
  internal map, and it is v0.2.

The exported PDF must carry a short, plain statement of these limits. A map that implies it is
the whole picture is worse than no map, because the consultant would have to defend it.

## 4. The scan pipeline

Six stages. Each is independently testable.

### 4.1 Discover a browser

Search known install locations for **Chrome, then Edge**, in that order, on macOS and Windows.
If neither is found, fail with a named error that **lists every path searched** — not a generic
"no browser". Exit distinctly from the case where a browser is found but never opens its
debugging port (bounded timeout, distinct message). Neither case may hang, panic, or report an
empty scan as a clean one.

### 4.2 Arm the proxy

The loopback proxy from Phase 1 already exists, is deny-by-default, and is audited. Before the
browser starts, set its scan origins from the URL the user entered. Nothing else is ever
admitted, for the whole life of the scan.

The proxy is the enforcement point for spec §7.1. Everything downstream of it observes; only it
decides.

**New in this release: plain-HTTP forwarding.** Phase 1 deliberately shipped CONNECT only. A
client site typed as `http://`, or one that redirects through plain HTTP, would otherwise fail
silently. This is the one genuinely new security-sensitive surface in v0.1 and it gets its own
audit, on the same terms as the admission decision did in Phase 1 Task 10.

### 4.3 Launch the browser

Headless. No window appears at any point.

- Ephemeral profile in a temp directory, removed when the scan ends — including on failure.
  Chrome refuses remote debugging against the default profile anyway, so this is not merely
  hygiene.
- All traffic through the proxy. Proxy-side name resolution, so no DNS leaves by construction —
  and that must be **asserted**, not assumed.
- `--disable-background-networking`, with an assertion. During the spike a built-in component
  extension made requests even in a fresh profile until this flag was passed.
- Whatever flags are required to satisfy §9.2's `file://` requirement.

### 4.4 Attach and observe

`chromiumoxide` drives CDP. Two properties from the spike are requirements, not preferences,
because they are what closed a startup race and an iframe blind spot:

- `Target.setAutoAttach` with `flatten: true`, **reapplied recursively in every new session**,
  so cross-origin iframes and their trackers are seen.
- `waitForDebuggerOnStart`, with interception armed in the new session **before**
  `Runtime.runIfWaitingForDebugger`.

The plan's preflight must confirm `chromiumoxide` exposes both. If it does not, that part drops
to raw CDP alongside it; the library is a convenience, not a dependency the design rests on.

### 4.5 Walk

Load the entry page. Settle. Then follow up to **ten** same-origin links found on it, settling
after each. Ten is the spec's default (§5.1). It is a constant in this release — not a UI
setting, and not a new field in the project file, which would be a schema change for no
demonstrated need.

No clicking of anything else. No consent banners, no forms, no buttons.

### 4.6 Collect and close

Produce a list of observed hosts with request counts. Close the browser, delete the profile
directory, and **assert the proxy ledger recorded zero connections outside the scan origins**.

## 5. Naming what was found

A bundled dictionary maps a domain to an owning company and a purpose.

**Source, in order of preference:** DuckDuckGo Tracker Radar, if its licence clears the §8.1
constraint (MIT / Apache-2.0 / BSD / ISC or equivalent). Verification is required before
adoption and is required by §7.6 regardless. **Fallback:** a hand-written dictionary of roughly
150–250 entries covering the third parties that actually appear on business websites. Either is
sufficient for a first checkup; the first is better maintained and far larger.

The dictionary is **data**, shipped as a bundled file. It is never fetched.

**Collapsing.** Known hosts collapse to their owning company, so `www.google-analytics.com`
and `region1.google-analytics.com` become one node, "Google". Unknown hosts **do not collapse**
and are shown in full. This avoids taking a public-suffix-list dependency — note that the
Public Suffix List is MPL-2.0, which touches the open licence decision on the release checklist
— and it is the honest presentation anyway. The cost, accepted: one unknown tracker spread over
several subdomains shows as several nodes. Visible, not hidden.

**Unrecognised hosts appear in full, in a "not yet identified" purpose group**, per the
author's explicit choice and spec §4.4. Copy stays neutral: never "violation", never
"non-compliant".

## 6. From observations to the map

This is where `src/core/` changes, and the changes are named here so they do not arrive
unannounced. Phase 1's constraint — `git diff --stat src/core tests/core` empty at every commit
unless the plan says otherwise — is kept, and the plan says otherwise here, in exactly three
places.

**What already exists and is reused unchanged:** `Observation`, `Project`, `Place`, `Flow`,
`SubjectGroup` in `types.ts`; `addPlace`/`addFlow` in `graph.ts`; `computeGaps`; `computeLayout`;
`history.ts`.

**Change 1 — a pure `ingestScan`.** `mergeObservations` today creates Places and **no Flows**.
It produces the dots and not the lines, and the lines are the product. A new pure function takes
a project plus a scan result plus caller-supplied ids, and returns a project with:

- a `SubjectGroup` "Website visitors" — for a website scan that is factually whose data this is,
  so it is seeded rather than asked for;
- a `Place` for the scanned site itself (`kind: 'collection'`, `holder: 'you'`);
- a `Place` per third party, named and grouped from the dictionary;
- `Flow`s: visitors → the site, and the site → each third party.

`mergeObservations` is kept for what it does correctly — reconciling an observed domain against
a place a document already declared — and will matter again in v0.2.

**Change 2 — purpose group from the dictionary.** `mergeObservations` currently hardcodes
`purposeGroup: 'Running the systems'` for every unknown. The purpose comes from the dictionary,
falling back to "not yet identified".

**Change 3 — a pure `identify(domain, dictionary)` lookup.** Pure, and the dictionary is a
**parameter**, not an import. The data file lives outside `src/core/` and is passed in, exactly
as timestamps and ids already are. Core stays free of large bundled blobs and stays testable
with a three-entry fixture.

`Observation.beforeConsent` is retained and always `true`. Nothing is ever clicked, so nothing
is ever after consent; this is factually correct rather than a placeholder, and v0.2 can begin
setting it `false` without a schema migration.

**Test-count baseline.** `tests/core` moves from 64. The plan states the new number per task and
the reviewer checks against it, replacing "must stay 64" for this release only.

## 7. What the map shows

Unchanged from the existing renderer, which already draws it: centre is the subject group,
outward by distance from the person, grouped by purpose, one level of drill-in, register panel
down the side. Flat and geometric per §6.3; visual direction stays open and does not block.

Two additions:

- A URL field and a scan action.
- Scan progress — which stage, which page of ten — with a working cancel. A scan that cannot be
  stopped is a scan that has to be force-quit in front of a client.

No editing. The map is what the scan found.

## 8. Export

**PDF via the operating system's own print dialog.** macOS's print dialog has Save as PDF built
in; Windows has Microsoft Print to PDF. Both are better than anything reasonable to write, and
both are free.

The only unknown is whether the app's webview can open the print dialog at all — `window.print()`
is unreliable under WKWebView on macOS. This is a **half-hour preflight check in the plan**, not
a spike. If it fails, the fallback is generating the PDF from the SVG in Rust, which is more work
but bounded: the map is flat shapes and text, no images, no effects, no gradients.

A print stylesheet is required either way — the map must be legible in monochrome (§6.3), and
the limits statement from §3 must appear on the printed sheet.

PNG is deferred.

## 9. Security requirements

Everything here is enforced by test, not by policy (§7.2).

1. **No egress outside the scan target.** The proxy ledger records every connection attempt; the
   suite fails on any host outside the scan origins. **The test must fail loudly if its own
   observer dies** — during the spike the measuring proxy crashed mid-run and silently reported
   a clean result, caught only because the number looked impossible.
2. **`file://` with a remote authority, and protocols the proxy cannot see.** Carried forward
   from Phase 1 as a requirement, not a retired test. An HTTP CONNECT proxy structurally cannot
   see an SMB fetch to `\\host\share\x`. Enforcement lives in browser launch flags and the
   webview's asset loading. The specification is the two deny cases **and the six paired allow
   controls**, reproduced verbatim in §1 of `docs/decisions/2026-07-31-admission-audit.md`. The
   allow controls are not optional: without them the requirement is satisfied by blocking
   everything and breaking the app. The plan must produce a mechanism and its test, not assume
   one exists.
3. **No DNS leaves the machine.** Proxy-side resolution, asserted rather than assumed.
4. **Browser background networking silenced.** `--disable-background-networking`, asserted.
5. **Ephemeral profile removed**, including on failure and on cancel.
6. **Plain-HTTP forwarding gets its own security audit** before it merges, on the terms Phase 1
   Task 10 set for the admission decision.
7. **No `unsafe`. No `unwrap`/`expect` outside `#[cfg(test)]`** in boundary modules.
8. **No test performs name resolution.**

Carried forward unchanged and **not** closed here: the app's own webview is not behind the
proxy, defended by CSP and a bundle with no remote references. Revisit if Tauri gains a proxy
hook.

Also noted from Phase 1's audit §4: no test poisons the `scan_origins` mutex, so case 31's
fail-closed behaviour remains structural rather than asserted. Deliberately poisoning a mutex
requires a panicking lock holder, which under `panic = "abort"` aborts the test process. This
stays a reading-level assurance and is recorded as such.

## 10. Testing

Beyond ordinary unit coverage:

- **Egress**, per §9.1 — the executable form of the product's promise.
- **`ingestScan`** — fixture scan results in, expected graphs out. Third party matches the
  dictionary; does not match; matches a place a document declared; two subdomains of one known
  owner collapse; two subdomains of one unknown host do not.
- **Gaps after a scan.** The expectation library asserts a business should have payroll, an
  accountant, a CRM. A website scan finds none of them, so the register could open on a wall of
  "not yet identified". The existing trigger conditions appear to handle this — payroll is
  expected only when employees are recorded as a subject group, and a scan records only
  visitors — but the plan **proves** it rather than assuming it. If the register is noisy, that
  is a finding to fix, not to ship.
- **Browser discovery failure paths** — none found, and found-but-port-never-opens.
- **Bundle cleanliness**, extending Phase 1's checks over the new dependency set.

## 11. Explicitly out of this release

Document ingest (v0.2 — the internal map). Manual editing of any entity (v0.2). Consent
detection and pre/post-consent attribution. PNG export. Brave, Vivaldi and bare Chromium.
Automatic multi-URL projects — one scan at a time, run twice for two touchpoints. LLM anything.

## 12. Open questions this release must answer, and one it must not

**Must answer, in the plan's preflight:**

1. Does `chromiumoxide` expose `setAutoAttach{flatten}` and `waitForDebuggerOnStart`? If not,
   raw CDP for those two calls.
2. Does DuckDuckGo Tracker Radar's licence clear §8.1? If not, hand-written fallback.
3. Can the webview open the system print dialog on macOS? If not, Rust-side SVG-to-PDF.
4. What do `chromiumoxide` and the dictionary cost in shipped bytes? Every dependency justifies
   itself in a `Cargo.toml` comment, and the download is re-measured against Phase 1's
   1,536,327-byte `.dmg` and 1,124,383-byte NSIS installer.

**Must not answer:** the MPL-2.0 licence conflict, LICENSE, README, and code signing. All four
are distribution-gated and sit on `docs/decisions/2026-08-01-release-checklist.md` awaiting the
author. They gate publishing, not building. The dependency licence audit in question 2 will
sharpen the MPL question and should feed it, not decide it.
