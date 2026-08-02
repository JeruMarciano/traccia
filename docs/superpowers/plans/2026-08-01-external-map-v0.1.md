# Traccia v0.1 — External Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Type a website address, and a minute later there is a printable map of every third party that site hands data to.

**Architecture:** A headless Chrome or Edge runs behind the loopback proxy Phase 1 already built and audited; the proxy is deny-by-default and is the sole enforcement point for the no-egress promise. `chromiumoxide` drives CDP to observe what the pages contact — it observes only, it never enforces. Observed hosts are named and categorised against a bundled dictionary, then folded into the existing pure map model by a new `ingestScan`, which produces the flows the current `mergeObservations` does not. The renderer gains a URL field, a progress line and a cancel; export goes through the operating system's own print dialog.

**Tech Stack:** Rust 1.97 + Tauri 2 + tokio (existing); `chromiumoxide` (new, Task 0 pins the version); TypeScript + React + Vitest (existing); DuckDuckGo Tracker Radar data, with a hand-written fallback.

**Spec:** `docs/superpowers/specs/2026-08-01-external-map-release-design.md`
**Scope decision:** `docs/decisions/2026-08-01-narrowing-v1-to-the-external-map.md`
**Release checklist (out of scope, do not action):** `docs/decisions/2026-08-01-release-checklist.md`

---

## Global Constraints

Every task's requirements implicitly include this section. A reviewer checks all of it on every task.

- **No outbound network traffic except requests to the URL the user explicitly entered.** No telemetry, no crash reporting, no update check, no CDN. Everything bundled. (Spec §7.1.)
- **The proxy is the only enforcement point.** CDP observes. Nothing downstream of the proxy may be relied on to prevent egress.
- **`src/core/` is pure:** no `fs`, no `path`, no `tauri`, no `Date.now()`, no `Math.random()`. Timestamps, ids and the dictionary are parameters.
- **`src/core/` and `tests/core/` change only where this plan says so.** Exactly three tasks touch them: Task 2, Task 3, Task 4. Every other task must leave `git diff --stat src/core tests/core` empty against its own starting commit. Test-count baselines are stated per task, replacing "tests/core stays 64" for this release.
- **Rust: no `unsafe`.** `#![forbid(unsafe_code)]` stays in `lib.rs` and `main.rs`. **No `unwrap`/`expect` outside `#[cfg(test)]`** in boundary modules (`proxy.rs`, `admission.rs`, `browser.rs`, `scan.rs`, `commands.rs`).
- **No test performs name resolution.**
- **Smallest possible download.** Every new dependency is justified in shipped bytes as a comment in `src-tauri/Cargo.toml`, in the existing "Dependency budget" block's style. Baseline to beat or explain: macOS `.dmg` 1,536,327 bytes, Windows NSIS 1,124,383 bytes.
- **Gaps are computed on demand,** never stored in the project file, never edited by a user.
- **Copy about unknowns stays neutral:** "not yet identified", never "violation", never "non-compliant".
- **English only.** All user-facing strings live in `src/renderer/strings.ts`. `tests/renderer/noLooseStrings.test.ts` enforces this; do not weaken it.
- **Commit at every green state.** Every task ends with a commit.
- **Rust is not on PATH non-interactively.** Prefix every cargo invocation: `source "$HOME/.cargo/env" && cargo ...`
- **Security gate.** Tasks 5, 6, 7, 8, 10 and 11 touch the network boundary, the filesystem or IPC. Each must be reviewed by the `security-auditor` agent before commit, which has authority to block. Task 5 additionally requires the full adversarial-audit treatment Phase 1 Task 10 applied to the admission decision. (Task 10 was added to this list after Task 0 found that the print dialog requires a new `core:webview:allow-print` capability.)
- **Test-count baselines are superseded.** Tasks 1, 2 and 3 each added a test beyond their stated baselines under rulings recorded in the SDD ledger. The plan's per-task numbers are stale; the true count after Task 3 is **`tests/core` 91, full suite 123, Rust 67**. Later tasks measure against those.
- **`src/core/` and `tests/core/` are closed.** Tasks 1, 2 and 3 are complete. (The Global Constraints originally read "Task 2, Task 3, Task 4" — an off-by-one; Task 4 is Rust-only.) Every remaining task must leave `git diff --stat src/core tests/core` empty against its own starting commit.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `src/core/vendors.ts` | Pure `identify(host, dictionary)`. The dictionary is a parameter. |
| `src/core/scan.ts` | Pure `ingestScan(project, result, dictionary, ids)`. Produces places **and flows**. |
| `src/data/vendors.json` | The bundled dictionary. Data only. Never fetched. |
| `scripts/build-vendors.mjs` | Dev-only. Converts the upstream source into `vendors.json`. Never shipped. |
| `src-tauri/src/browser.rs` | Discovery, launch flags, ephemeral profile, teardown. |
| `src-tauri/src/scan.rs` | Scan orchestration: arm proxy → launch → attach → walk → collect → tear down. Cancellable. |
| `src-tauri/src/cdp.rs` | The `chromiumoxide` observation loop. Attach, auto-attach recursion, request capture. |
| `src/renderer/components/ScanBar.tsx` | URL field, scan action, progress, cancel. |
| `src/renderer/print.css` | Print stylesheet. Monochrome-legible; carries the limits statement. |
| `tests/core/vendors.test.ts` | |
| `tests/core/scan.test.ts` | |
| `tests/renderer/scanBar.test.ts` | |
| `tests/build/vendorsData.test.ts` | The shipped dictionary is well-formed and contains no URLs to fetch. |

**Modified:**

| File | Change |
|---|---|
| `src/core/expectations.ts` | Gate the five untriggered expectations; widen `hasSite`. Task 3. |
| `src/core/types.ts` | Add `ScanResult`, `ObservedHost`, `VendorEntry`, `VendorDictionary`. Task 2. |
| `src/renderer/App.tsx` | Mount `ScanBar`, hold scan state, call `ingestScan`. Task 9. |
| `src/renderer/strings.ts` | New user-facing strings. Tasks 9, 10. |
| `src/renderer/bridge.ts` | `startScan`, `cancelScan`, scan-progress subscription. Task 9. |
| `src-tauri/src/proxy.rs` | Plain-HTTP forwarding. Task 5. |
| `src-tauri/src/commands.rs` | `start_scan`, `cancel_scan`. Task 8. |
| `src-tauri/src/lib.rs` | Register new modules and commands. Tasks 4–8. |
| `src-tauri/Cargo.toml` | `chromiumoxide` plus its justification. Task 0. |
| `src-tauri/capabilities/default.json` | Only if a new permission is genuinely required. Task 8. |
| `tests/build/bundleClean.test.ts` | Extend over the new dependency set. Task 12. |

**Deliberately not created:** any editing UI, any document parser, any PNG exporter, any consent-banner detection.

---

## Task 0: Preflight — answer the four unknowns before anything depends on them

Phase 1 established this pattern: a spike answers the question before the plan rests on it. Four answers are needed. This task writes no product code.

**Files:**
- Create: `docs/decisions/2026-08-01-v0.1-preflight.md`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: a pinned `chromiumoxide` version; a decision on the dictionary source; a decision on the PDF mechanism; a measured byte cost. Tasks 1, 7 and 10 each branch on one of these.

- [ ] **Step 1: Pin `chromiumoxide` and confirm it exposes the two behaviours the spike proved necessary**

Add to `src-tauri/Cargo.toml` under `[dependencies]`, then confirm both capabilities exist in the pinned version's API:

```toml
chromiumoxide = { version = "0.7", default-features = false, features = ["tokio-runtime"] }
```

The two behaviours, from `docs/decisions/2026-07-31-cdp-spike-findings.md` F1 and F2:

1. `Target.setAutoAttach` with `flatten: true`, reapplied recursively in every new session.
2. `waitForDebuggerOnStart: true`, with `Fetch`/`Network` armed in the new session **before** `Runtime.runIfWaitingForDebugger`.

Search the crate's API for these. `chromiumoxide` exposes raw CDP commands via its `cdp` module even where it has no high-level wrapper, so the fallback is to send the raw commands over the same connection. Record in the preflight doc which of the two is high-level and which is raw.

**If the crate cannot send raw CDP commands at all, stop and report.** That would make it unfit and the task's outcome is "hand-rolled CDP over `tokio-tungstenite`", which is what the spike used and what the original plan budgeted for.

- [ ] **Step 2: Measure what `chromiumoxide` costs in shipped bytes**

```bash
source "$HOME/.cargo/env" && cd src-tauri && cargo tree -i chromiumoxide --depth 1 && cargo build --release 2>&1 | tail -5
```

Then a real bundle:

```bash
npm run tauri build 2>&1 | tail -20 && ls -l src-tauri/target/release/bundle/dmg/*.dmg
```

Record the delta against 1,536,327 bytes. There is no pass/fail threshold here — the number goes in the doc and in the `Cargo.toml` comment, and Task 12 re-measures at the end.

- [ ] **Step 3: Decide the dictionary source**

Check DuckDuckGo Tracker Radar's licence and shape. Two questions only:

1. Does the licence permit bundling the data in a closed-source commercial application? (The project's own licence is expected to be MIT but is not yet decided; that does not affect this question.)
2. Does each entry carry an owner display name **and** at least one category?

If both are yes, it is the source. If either is no, the source is a hand-written dictionary of 150–250 entries and Task 1 changes only in where `vendors.json` comes from — its schema and every test are identical either way.

Record the answer and the exact upstream URL and revision in the preflight doc.

- [ ] **Step 4: Decide the PDF mechanism**

The question is *not* whether macOS can make a PDF — its print dialog has Save as PDF built in. The question is whether this app can open the print dialog at all, since `window.print()` is unreliable under WKWebView.

Build the app, run it, and try `window.print()` from the running webview on macOS. Two outcomes:

- **Dialog opens:** the mechanism is the system print dialog. Task 10 writes a print stylesheet and a button, and nothing else.
- **Dialog does not open:** the mechanism is Rust-side. Record it, and Task 10 grows a renderer→Rust path that serialises the map SVG and writes a PDF. The map is flat shapes and text — no images, no gradients, no effects — so this is bounded, but it is real work and the plan reader must know which branch they are on.

- [ ] **Step 5: Write the preflight decision doc**

`docs/decisions/2026-08-01-v0.1-preflight.md`, with one section per question above: the question, the method, the measured answer, and which task it unblocks. State plainly anything that could not be determined, in the style of §4 of the admission audit.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/2026-08-01-v0.1-preflight.md src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(preflight): pin chromiumoxide, settle the dictionary, PDF and byte cost"
```

---

## Task 1: The vendor dictionary — pure lookup, data as a parameter

**Files:**
- Create: `src/core/vendors.ts`, `tests/core/vendors.test.ts`, `src/data/vendors.json`, `scripts/build-vendors.mjs`, `tests/build/vendorsData.test.ts`
- Modify: `src/core/types.ts`

**Interfaces:**
- Consumes: the Task 0 dictionary decision.
- Produces:
  ```ts
  export interface VendorEntry { owner: string; category: string; purposeGroup: string }
  export type VendorDictionary = Readonly<Record<string, VendorEntry>>
  export function identify(host: string, dictionary: VendorDictionary): VendorEntry | null
  ```
  Task 2 consumes `identify` and `VendorDictionary`. Task 9 loads `src/data/vendors.json` and passes it in.

**Why the dictionary is a parameter and not an import:** `src/core/` must stay small enough to hold in context and free of large bundled blobs, and its tests must run against a three-entry fixture rather than several thousand real entries. This matches how timestamps and ids are already handled.

**Test-count baseline:** `tests/core` goes from 64 to 71.

- [ ] **Step 1: Add the types**

In `src/core/types.ts`, after the existing `Observation` interface:

```ts
/** One entry in the bundled vendor dictionary. Data only; never fetched. */
export interface VendorEntry {
  /** The company that owns the host, e.g. "Google". */
  owner: string
  /** What it does, e.g. "analytics". Combined with owner to name a place. */
  category: string
  /** Which purpose group the place belongs to, e.g. "Marketing". */
  purposeGroup: string
}

export type VendorDictionary = Readonly<Record<string, VendorEntry>>

/** One host seen during a scan, before it is named. */
export interface ObservedHost {
  host: string
  requestCount: number
}

/** What one completed scan produced. Consumed by ingestScan. */
export interface ScanResult {
  /** The origin host the user asked to scan, e.g. "rossi-editore.it". */
  scannedHost: string
  /** Every host contacted, including the scanned host itself. */
  hosts: ObservedHost[]
  /** How many pages were loaded, entry page included. */
  pagesVisited: number
}
```

- [ ] **Step 2: Write the failing tests**

`tests/core/vendors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { identify } from '../../src/core/vendors'
import type { VendorDictionary } from '../../src/core/types'

const DICT: VendorDictionary = {
  'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Marketing' },
  'doubleclick.net': { owner: 'Google', category: 'advertising', purposeGroup: 'Marketing' },
  'stripe.com': { owner: 'Stripe', category: 'payments', purposeGroup: 'Getting paid' },
}

describe('identify', () => {
  it('matches a host exactly', () => {
    expect(identify('stripe.com', DICT)?.owner).toBe('Stripe')
  })

  it('matches a subdomain against its registered entry', () => {
    expect(identify('www.google-analytics.com', DICT)?.category).toBe('analytics')
    expect(identify('region1.google-analytics.com', DICT)?.category).toBe('analytics')
  })

  it('is case-insensitive', () => {
    expect(identify('WWW.Stripe.COM', DICT)?.owner).toBe('Stripe')
  })

  it('returns null for a host it does not know', () => {
    expect(identify('segment-data-us-east.zqtk.net', DICT)).toBeNull()
  })

  it('does not match a host that merely ends with the same letters', () => {
    // "notstripe.com" ends with "stripe.com" as a string but is a different domain.
    expect(identify('notstripe.com', DICT)).toBeNull()
  })

  it('prefers the longest matching entry', () => {
    const d: VendorDictionary = {
      ...DICT,
      'analytics.example.com': { owner: 'Narrow', category: 'analytics', purposeGroup: 'Marketing' },
      'example.com': { owner: 'Broad', category: 'hosting', purposeGroup: 'Running the systems' },
    }
    expect(identify('analytics.example.com', d)?.owner).toBe('Narrow')
    expect(identify('other.example.com', d)?.owner).toBe('Broad')
  })

  it('does not treat a trailing dot as a different host', () => {
    expect(identify('stripe.com.', DICT)?.owner).toBe('Stripe')
  })
})
```

The fifth test is the important one. Substring or `endsWith` matching would pass `notstripe.com` and attribute an unrelated company's traffic to Stripe — naming a vendor as something it is not, which spec §5.2 identifies as the failure that matters.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/core/vendors.test.ts`
Expected: FAIL — cannot resolve `../../src/core/vendors`.

- [ ] **Step 4: Implement**

`src/core/vendors.ts`:

```ts
import type { VendorDictionary, VendorEntry } from './types'

/**
 * Look a host up in the bundled dictionary.
 *
 * Matching walks the host's labels from the left, so `a.b.example.com` tries
 * `a.b.example.com`, then `b.example.com`, then `example.com`. That gives
 * longest-match-wins for free and, unlike `endsWith`, cannot match
 * `notstripe.com` against `stripe.com`: the boundary is always a label
 * boundary, never an arbitrary character offset. Attributing one company's
 * traffic to another is the failure this function exists to avoid.
 *
 * The dictionary is a parameter so that `src/core/` holds no bundled data and
 * so these tests run against three entries instead of several thousand.
 */
export function identify(host: string, dictionary: VendorDictionary): VendorEntry | null {
  const normalised = host.toLowerCase().replace(/\.$/, '')
  if (normalised === '') return null

  const labels = normalised.split('.')
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.')
    const hit = dictionary[candidate]
    if (hit !== undefined) return hit
  }
  return null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/core/vendors.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Produce `src/data/vendors.json` and its generator**

`scripts/build-vendors.mjs` is dev-only and never ships. It reads the source chosen in Task 0 and writes `src/data/vendors.json` in exactly the `VendorDictionary` shape — a flat object keyed by host, values `{ owner, category, purposeGroup }`. It maps the source's categories onto the project's purpose groups; the twelve in use are visible in `src/core/expectations.ts`:

```
Marketing, Running the systems, Getting paid, Employing people,
Support, Selling, Delivering orders
```

Anything the source categorises as something outside that set maps to `Running the systems`, which is the existing default. Record the mapping table as a comment at the top of the script.

The script writes the file; it is not run at build time and not at runtime. `src/data/vendors.json` is committed.

- [ ] **Step 7: Write the failing data test**

`tests/build/vendorsData.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import dictionary from '../../src/data/vendors.json'
import { identify } from '../../src/core/vendors'
import type { VendorDictionary } from '../../src/core/types'

const PURPOSE_GROUPS = new Set([
  'Marketing',
  'Running the systems',
  'Getting paid',
  'Employing people',
  'Support',
  'Selling',
  'Delivering orders',
])

const dict = dictionary as VendorDictionary

describe('the shipped vendor dictionary', () => {
  it('is not empty', () => {
    expect(Object.keys(dict).length).toBeGreaterThan(100)
  })

  it('gives every entry an owner, a category and a known purpose group', () => {
    for (const [host, entry] of Object.entries(dict)) {
      expect(entry.owner, host).toBeTruthy()
      expect(entry.category, host).toBeTruthy()
      expect(PURPOSE_GROUPS.has(entry.purposeGroup), `${host} → ${entry.purposeGroup}`).toBe(true)
    }
  })

  it('keys every entry by a bare lowercase host with no scheme, port or path', () => {
    for (const host of Object.keys(dict)) {
      expect(host, host).toBe(host.toLowerCase())
      expect(host, host).not.toMatch(/[:/?#]/)
      expect(host, host).toContain('.')
    }
  })

  it('carries nothing that could be fetched at runtime', () => {
    // The dictionary is data. A URL in it would be an invitation for some later
    // change to go and get it, which §7.1 forbids absolutely.
    expect(JSON.stringify(dict)).not.toMatch(/https?:\/\//)
  })

  it('recognises the third parties a real scan is most likely to find', () => {
    for (const host of [
      'www.google-analytics.com',
      'www.googletagmanager.com',
      'connect.facebook.net',
      'js.stripe.com',
      'static.hotjar.com',
    ]) {
      expect(identify(host, dict), host).not.toBeNull()
    }
  })
})
```

- [ ] **Step 8: Run it, generate the data, run it again**

Run: `npx vitest run tests/build/vendorsData.test.ts`
Expected: FAIL — `src/data/vendors.json` does not exist.

Then: `node scripts/build-vendors.mjs`

Run: `npx vitest run tests/build/vendorsData.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `tests/core` is now 71.

- [ ] **Step 10: Commit**

```bash
git add src/core/vendors.ts src/core/types.ts src/data/vendors.json scripts/build-vendors.mjs tests/core/vendors.test.ts tests/build/vendorsData.test.ts
git commit -m "feat(core): name observed hosts from a bundled dictionary

Label-boundary matching rather than endsWith, so notstripe.com is never
attributed to Stripe. The dictionary is a parameter, so core holds no
bundled data and its tests run against three entries."
```

---

## Task 2: `ingestScan` — the lines, not just the dots

**Files:**
- Create: `src/core/scan.ts`, `tests/core/scan.test.ts`
- Modify: none. `mergeObservations` is left alone.

**Interfaces:**
- Consumes: `identify`, `VendorDictionary`, `ScanResult`, `ObservedHost` from Task 1. `addPlace`, `addFlow` from `src/core/graph.ts`. `Project`, `Place`, `Flow`, `SubjectGroup`, `Observation` from `src/core/types.ts`.
- Produces:
  ```ts
  export interface IngestIds {
    /** Prefix for generated ids, e.g. "scan1". Callers pass a fresh one per scan. */
    prefix: string
  }
  export function ingestScan(
    project: Project,
    result: ScanResult,
    dictionary: VendorDictionary,
    ids: IngestIds,
  ): Project
  ```
  Task 9 calls this from `App.tsx`.

**Why a new function rather than changing `mergeObservations`:** `mergeObservations` does one thing correctly — reconciling an observed domain against a place a document already declared — and v0.2 needs it for exactly that. What it does not do is create flows, and flows are this release's product. Extending it would tangle two jobs in one function; adding `ingestScan` alongside keeps both small.

**Test-count baseline:** `tests/core` goes from 71 to 82.

- [ ] **Step 1: Write the failing tests**

`tests/core/scan.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ingestScan } from '../../src/core/scan'
import { emptyProject } from '../fixtures/projects'
import type { ScanResult, VendorDictionary } from '../../src/core/types'

const DICT: VendorDictionary = {
  'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Marketing' },
  'doubleclick.net': { owner: 'Google', category: 'advertising', purposeGroup: 'Marketing' },
  'stripe.com': { owner: 'Stripe', category: 'payments', purposeGroup: 'Getting paid' },
}

const IDS = { prefix: 'scan1' }

function result(over: Partial<ScanResult> = {}): ScanResult {
  return {
    scannedHost: 'rossi-editore.it',
    hosts: [{ host: 'rossi-editore.it', requestCount: 12 }],
    pagesVisited: 1,
    ...over,
  }
}

describe('ingestScan', () => {
  it('seeds a website-visitors subject group', () => {
    const p = ingestScan(emptyProject(), result(), DICT, IDS)
    expect(p.subjectGroups.map((s) => s.name)).toEqual(['Website visitors'])
  })

  it('creates a place for the scanned site, held by the organisation', () => {
    const p = ingestScan(emptyProject(), result(), DICT, IDS)
    const site = p.places.find((pl) => pl.name === 'rossi-editore.it')
    expect(site).toBeDefined()
    expect(site?.kind).toBe('collection')
    expect(site?.holder).toBe('you')
    expect(site?.confidence).toBe('observed')
  })

  it('draws a flow from the visitors to the site', () => {
    const p = ingestScan(emptyProject(), result(), DICT, IDS)
    const visitors = p.subjectGroups[0].id
    const site = p.places.find((pl) => pl.name === 'rossi-editore.it')?.id
    expect(p.flows.some((f) => f.from === visitors && f.to === site)).toBe(true)
  })

  it('names a recognised third party by owner and category, and draws a flow to it', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 12 },
          { host: 'www.google-analytics.com', requestCount: 4 },
        ],
      }),
      DICT,
      IDS,
    )
    const ga = p.places.find((pl) => pl.name === 'Google Analytics')
    expect(ga).toBeDefined()
    expect(ga?.purposeGroup).toBe('Marketing')
    expect(ga?.kind).toBe('processor')
    expect(ga?.holder).toBe('supplier')
    const site = p.places.find((pl) => pl.name === 'rossi-editore.it')?.id
    expect(p.flows.some((f) => f.from === site && f.to === ga?.id)).toBe(true)
  })

  it('collapses subdomains of one owner-and-category into a single place', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'www.google-analytics.com', requestCount: 4 },
          { host: 'region1.google-analytics.com', requestCount: 2 },
        ],
      }),
      DICT,
      IDS,
    )
    expect(p.places.filter((pl) => pl.name === 'Google Analytics')).toHaveLength(1)
  })

  it('keeps two categories from one owner as separate places', () => {
    // Collapsing on owner alone would merge these into "Google" and lose the
    // purpose, which is the map's grouping unit — and would stop the analytics
    // expectation matching, producing a false gap on a map that just observed
    // Google Analytics.
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'www.google-analytics.com', requestCount: 4 },
          { host: 'doubleclick.net', requestCount: 9 },
        ],
      }),
      DICT,
      IDS,
    )
    const names = p.places.map((pl) => pl.name)
    expect(names).toContain('Google Analytics')
    expect(names).toContain('Google Ads')
  })

  it('shows an unrecognised host in full and does not collapse it', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'segment-data-us-east.zqtk.net', requestCount: 3 },
          { host: 'other.zqtk.net', requestCount: 1 },
        ],
      }),
      DICT,
      IDS,
    )
    const names = p.places.map((pl) => pl.name)
    expect(names).toContain('segment-data-us-east.zqtk.net')
    expect(names).toContain('other.zqtk.net')
    for (const n of ['segment-data-us-east.zqtk.net', 'other.zqtk.net']) {
      expect(p.places.find((pl) => pl.name === n)?.purposeGroup).toBe('Not yet identified')
      expect(p.places.find((pl) => pl.name === n)?.kind).toBe('unknown')
    }
  })

  it('records every host as an observation with its request count', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 12 },
          { host: 'doubleclick.net', requestCount: 9 },
        ],
      }),
      DICT,
      IDS,
    )
    expect(p.observations).toEqual([
      { domain: 'rossi-editore.it', requestCount: 12, beforeConsent: true },
      { domain: 'doubleclick.net', requestCount: 9, beforeConsent: true },
    ])
  })

  it('does not duplicate anything when the same site is scanned twice', () => {
    const r = result({
      hosts: [
        { host: 'rossi-editore.it', requestCount: 12 },
        { host: 'doubleclick.net', requestCount: 9 },
      ],
    })
    const once = ingestScan(emptyProject(), r, DICT, IDS)
    const twice = ingestScan(once, r, DICT, { prefix: 'scan2' })
    expect(twice.places).toHaveLength(once.places.length)
    expect(twice.flows).toHaveLength(once.flows.length)
    expect(twice.subjectGroups).toHaveLength(1)
  })

  it('adds a second site alongside the first rather than replacing it', () => {
    const first = ingestScan(emptyProject(), result(), DICT, IDS)
    const second = ingestScan(
      first,
      result({ scannedHost: 'rossi-webapp.it', hosts: [{ host: 'rossi-webapp.it', requestCount: 5 }] }),
      DICT,
      { prefix: 'scan2' },
    )
    expect(second.places.map((p) => p.name)).toContain('rossi-editore.it')
    expect(second.places.map((p) => p.name)).toContain('rossi-webapp.it')
    expect(second.subjectGroups).toHaveLength(1)
  })

  it('is pure — the project passed in is not mutated', () => {
    const before = emptyProject()
    const snapshot = JSON.stringify(before)
    ingestScan(before, result(), DICT, IDS)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/scan.test.ts`
Expected: FAIL — cannot resolve `../../src/core/scan`.

- [ ] **Step 3: Implement**

`src/core/scan.ts`:

```ts
import { addFlow, addPlace } from './graph'
import { identify } from './vendors'
import type { Flow, Place, Project, ScanResult, VendorDictionary } from './types'

export interface IngestIds {
  /** Prefix for generated ids, e.g. "scan1". Callers pass a fresh one per scan. */
  prefix: string
}

/** Shown for a host the dictionary does not recognise. Neutral by requirement. */
const NOT_IDENTIFIED = 'Not yet identified'

const VISITORS = 'Website visitors'

/**
 * A recognised host becomes a place named "<owner> <category>", e.g. "Google
 * Analytics". Collapsing on owner alone would merge Google Analytics and
 * Google Ads into one "Google" node, losing the purpose group — which is what
 * the map groups by — and breaking the substring match the analytics
 * expectation uses, producing a false gap on a map that just observed Google
 * Analytics. An unrecognised host keeps its full name and collapses with
 * nothing.
 */
function displayName(host: string, dictionary: VendorDictionary): string {
  const hit = identify(host, dictionary)
  return hit === null ? host : `${hit.owner} ${titleCase(hit.category)}`
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

function findPlaceByName(project: Project, name: string): Place | undefined {
  return project.places.find((p) => p.name.toLowerCase() === name.toLowerCase())
}

function nextId(taken: Set<string>, prefix: string, kind: string): string {
  let n = 1
  while (taken.has(`${prefix}-${kind}-${n}`)) n += 1
  const id = `${prefix}-${kind}-${n}`
  taken.add(id)
  return id
}

function hasFlow(project: Project, from: string, to: string): boolean {
  return project.flows.some((f) => f.from === from && f.to === to)
}

export function ingestScan(
  project: Project,
  result: ScanResult,
  dictionary: VendorDictionary,
  ids: IngestIds,
): Project {
  let working = project

  const taken = new Set<string>([
    ...project.places.map((p) => p.id),
    ...project.subjectGroups.map((s) => s.id),
    ...project.flows.map((f) => f.id),
  ])

  // 1. Whose data this is. For a website scan the answer is not in doubt, so it
  //    is seeded rather than asked for. Seeded once, however many scans run.
  let visitors = working.subjectGroups.find((s) => s.name === VISITORS)
  if (visitors === undefined) {
    visitors = { id: nextId(taken, ids.prefix, 'sg'), name: VISITORS }
    working = { ...working, subjectGroups: [...working.subjectGroups, visitors] }
  }

  // 2. The site itself. Held by the organisation, and where collection happens.
  let site = findPlaceByName(working, result.scannedHost)
  if (site === undefined) {
    const id = nextId(taken, ids.prefix, 'pl')
    working = addPlace(
      working,
      {
        name: result.scannedHost,
        kind: 'collection',
        purposeGroup: 'Running the systems',
        holder: 'you',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'observed',
      },
      id,
    )
    site = working.places[working.places.length - 1]
  }

  if (!hasFlow(working, visitors.id, site.id)) {
    working = addFlow(working, visitorFlow(visitors.id, site.id), nextId(taken, ids.prefix, 'fl'))
  }

  // 3. Every third party, named from the dictionary, each with a flow from the
  //    site. The scanned host itself is skipped — it is the site, not a
  //    recipient of its own data.
  for (const observed of result.hosts) {
    if (observed.host.toLowerCase() === result.scannedHost.toLowerCase()) continue

    const name = displayName(observed.host, dictionary)
    const hit = identify(observed.host, dictionary)

    let place = findPlaceByName(working, name)
    if (place === undefined) {
      const id = nextId(taken, ids.prefix, 'pl')
      working = addPlace(
        working,
        {
          name,
          kind: hit === null ? 'unknown' : 'processor',
          purposeGroup: hit === null ? NOT_IDENTIFIED : hit.purposeGroup,
          holder: 'supplier',
          leavesEEA: 'unknown',
          sources: [],
          confidence: 'observed',
        },
        id,
      )
      place = working.places[working.places.length - 1]
    }

    if (!hasFlow(working, site.id, place.id)) {
      working = addFlow(working, thirdPartyFlow(site.id, place.id), nextId(taken, ids.prefix, 'fl'))
    }
  }

  // 4. The raw observations, so the map can always be traced back to what was
  //    seen. beforeConsent is always true: Traccia never clicks anything, so
  //    nothing it records happened after consent was given.
  const seen = new Set(working.observations.map((o) => o.domain))
  const fresh = result.hosts
    .filter((h) => !seen.has(h.host))
    .map((h) => ({ domain: h.host, requestCount: h.requestCount, beforeConsent: true }))

  return { ...working, observations: [...working.observations, ...fresh] }
}

function visitorFlow(from: string, to: string): Omit<Flow, 'id'> {
  return {
    from,
    to,
    dataDescription: 'Whatever a visitor sends by loading the site',
    purpose: 'Running the systems',
    sources: [],
    confidence: 'observed',
  }
}

function thirdPartyFlow(from: string, to: string): Omit<Flow, 'id'> {
  return {
    from,
    to,
    dataDescription: 'Whatever the page hands to this third party',
    purpose: 'Running the systems',
    sources: [],
    confidence: 'observed',
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/scan.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Confirm the purpose group appears on the map**

`Not yet identified` is a new purpose group value. Check `createEmptyProject` in `src/core/project.ts` and `computeLayout` in `src/core/layout.ts`: if either works from a fixed `purposeGroups` list rather than deriving groups from the places present, add `Not yet identified` to it and add a test asserting a place in that group is laid out rather than dropped. If layout derives groups from places, no change is needed — record which it was in the commit message.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `tests/core` is now 82.

- [ ] **Step 7: Commit**

```bash
git add src/core/scan.ts tests/core/scan.test.ts
git commit -m "feat(core): ingestScan turns a scan into places and the flows between them

mergeObservations produced the dots and not the lines. This produces both,
and is left alongside it because reconciling an observed domain against a
declared place is a different job that v0.2 still needs."
```

---

## Task 3: Stop the register opening on five false gaps

**Files:**
- Modify: `src/core/expectations.ts`, `tests/core/gaps-existence.test.ts`

**Interfaces:**
- Consumes: `Project` from `src/core/types.ts`.
- Produces: no new exported names. `EXPECTATIONS` keeps its length of 12 and its ids.

**The defect, measured rather than assumed.** `existenceGaps` stays silent only when a project has no places *and* no subject groups (`src/core/gaps/existence.ts:14`). After any scan it has both. Five of the twelve expectations — `email`, `accounting`, `backup`, `delivery`, `storage` — pass `always` as their trigger, so all five fire on every scan-only project. That is five gaps asking who does the client's accounting, on a map that never looked inside the business. Spec §5.4: *"A false gap is more damaging than a missed one, because the consultant has to defend the map in front of a client."*

**The fix.** Those five are claims about the organisation's internals. A website scan is not evidence about internals — it is evidence about a website. Gate them on the project holding at least one **declared** place, which is what a document produces and what a scan never produces. They stay silent through v0.1 and switch on by themselves in v0.2.

**Test-count baseline:** `tests/core` goes from 82 to 85.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/gaps-existence.test.ts`, inside `describe('existenceGaps')`:

```ts
  it('asserts no internal-function expectations against a scan-only project', () => {
    // A website scan produces observed places and a visitors subject group and
    // nothing else. It is not evidence about payroll, accounting or backups,
    // and a first-checkup map must not ask about them as if it were.
    const scanOnly = {
      ...emptyProject(),
      subjectGroups: [{ id: 'sg-1', name: 'Website visitors' }],
      places: [
        { ...place({ name: 'rossi-editore.it', confidence: 'observed', holder: 'you' }), id: 'pl-1' },
        { ...place({ name: 'Google Analytics', confidence: 'observed' }), id: 'pl-2' },
      ],
    }
    const ids = existenceGaps(scanOnly).map((g) => g.id)
    for (const id of ['exist:email', 'exist:accounting', 'exist:backup', 'exist:delivery', 'exist:storage']) {
      expect(ids, id).not.toContain(id)
    }
  })

  it('asserts them again once a document has declared something', () => {
    const withDocument = {
      ...emptyProject(),
      subjectGroups: [{ id: 'sg-1', name: 'Website visitors' }],
      places: [
        { ...place({ name: 'rossi-editore.it', confidence: 'observed', holder: 'you' }), id: 'pl-1' },
        { ...place({ name: 'Acme Srl', confidence: 'declared' }), id: 'pl-2' },
      ],
    }
    expect(existenceGaps(withDocument).map((g) => g.id)).toContain('exist:accounting')
  })

  it('still expects website analytics once a site has been observed', () => {
    // The scanned site is a collection point the organisation holds. That is a
    // website whatever it is named, so the site-triggered expectations apply.
    const scanOnly = {
      ...emptyProject(),
      subjectGroups: [{ id: 'sg-1', name: 'Website visitors' }],
      places: [
        { ...place({ name: 'rossi-editore.it', kind: 'collection', holder: 'you', confidence: 'observed' }), id: 'pl-1' },
      ],
    }
    expect(existenceGaps(scanOnly).map((g) => g.id)).toContain('exist:analytics')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/gaps-existence.test.ts`
Expected: FAIL on the first two — the five gaps are present. The third fails because `hasSite` matches on place *name* and `rossi-editore.it` contains none of `website`, `site`, `shop`.

- [ ] **Step 3: Implement**

In `src/core/expectations.ts`, add two predicates next to the existing ones:

```ts
// A place a human or a document put there. A scan never produces one, so this
// is false for a scan-only project and true as soon as documents land.
const hasDeclared = (p: Project): boolean => p.places.some((pl) => pl.confidence === 'declared')

// Expectations about the organisation's internal functions. A website scan is
// evidence about a website, not about payroll or accounting, and asking after
// them on a scan-only map produces gaps the consultant would have to defend.
const looksInside = hasDeclared
```

Widen `hasSite` so an observed collection point the organisation holds counts as a website, whatever it is named:

```ts
const hasSite = (p: Project): boolean =>
  hasPlaceMatching(p, ['website', 'site', 'shop']) ||
  p.places.some((pl) => pl.kind === 'collection' && pl.holder === 'you')
```

Then pass `looksInside` as the trigger for the five that currently default to `always`:

```ts
  fn('email', 'email and productivity', 'Running the systems', ['mail', 'workspace', '365', 'outlook'], looksInside),
  fn('accounting', 'accounting', 'Getting paid', ['account', 'bookkeep', 'ledger'], looksInside),
  fn('backup', 'backup', 'Running the systems', ['backup', 'archive', 'snapshot'], looksInside),
  fn('delivery', 'order delivery', 'Delivering orders', ['courier', 'shipping', 'delivery', 'post'], looksInside),
  fn('storage', 'document storage', 'Running the systems', ['drive', 'storage', 'sharepoint', 'dropbox'], looksInside),
```

`always` is now unused. Delete it, or TypeScript's `noUnusedLocals` will fail the typecheck.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/gaps-existence.test.ts`
Expected: PASS.

Some pre-existing tests in this file may now fail, and if they do it is informative rather than incidental: they were relying on an expectation firing against a project with no declared place. The fixture in `tests/fixtures/projects.ts` sets `confidence: 'declared'` by default, so most will be unaffected. Where one is affected, add a declared place rather than weakening the assertion, and say so in the commit message.

- [ ] **Step 5: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `tests/core` is now 85.

- [ ] **Step 6: Commit**

```bash
git add src/core/expectations.ts tests/core/gaps-existence.test.ts
git commit -m "fix(core): do not ask who does the accounting on a website-only map

Five expectations had no trigger, so every scan-only project opened the
register on five gaps about internals the scan never looked at. Gate them on
the project holding a declared place — which documents produce and scans do
not — so they stay silent in v0.1 and switch on by themselves in v0.2."
```

---

## Task 4: Browser discovery

**Files:**
- Create: `src-tauri/src/browser.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```rust
  pub enum Browser { Chrome, Edge }
  pub struct Found { pub browser: Browser, pub path: PathBuf }
  pub enum DiscoveryError { NoneFound { searched: Vec<PathBuf> } }
  pub fn discover() -> Result<Found, DiscoveryError>
  pub fn candidate_paths() -> Vec<(Browser, PathBuf)>
  ```
  Tasks 6 and 8 consume `discover` and `Found`.

Chrome first, then Edge. Edge is the guaranteed hit on Windows; Chrome covers macOS. Brave, Vivaldi and bare Chromium are out of this release per the scope decision — Brave's blocker would make a scan report a clean site that is not clean, which is a wrong answer rather than a missing one.

- [ ] **Step 1: Write the failing tests**

At the bottom of `src-tauri/src/browser.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn searches_chrome_before_edge() {
        let paths = candidate_paths();
        let first_chrome = paths.iter().position(|(b, _)| matches!(b, Browser::Chrome));
        let first_edge = paths.iter().position(|(b, _)| matches!(b, Browser::Edge));
        assert!(first_chrome.is_some(), "no Chrome candidate on this platform");
        assert!(first_edge.is_some(), "no Edge candidate on this platform");
        assert!(first_chrome < first_edge);
    }

    #[test]
    fn offers_at_least_one_absolute_candidate_per_browser() {
        for (_, p) in candidate_paths() {
            assert!(p.is_absolute(), "candidate is not absolute: {}", p.display());
        }
    }

    #[test]
    fn names_every_path_it_searched_when_nothing_is_found() {
        // The failure a user actually hits is "I have a browser and it says I
        // don't". A bare "no browser found" is unactionable; the list is what
        // lets them see it looked in the wrong place.
        let err = discover_in(&[]);
        match err {
            Err(DiscoveryError::NoneFound { searched }) => {
                assert_eq!(searched.len(), candidate_paths().len());
                assert!(!searched.is_empty());
            }
            Ok(_) => panic!("found a browser among no candidates"),
        }
    }

    #[test]
    fn returns_the_first_candidate_that_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let second = dir.path().join("second");
        std::fs::write(&second, b"x").expect("write");
        let missing = dir.path().join("first");
        let found = discover_in(&[
            (Browser::Chrome, missing),
            (Browser::Edge, second.clone()),
        ])
        .expect("should find the second");
        assert_eq!(found.path, second);
        assert!(matches!(found.browser, Browser::Edge));
    }

    #[test]
    fn never_panics_on_a_candidate_list_full_of_nonsense() {
        for bad in ["", " ", "\0not-a-path", "relative/path"] {
            let _ = discover_in(&[(Browser::Chrome, PathBuf::from(bad))]);
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test browser`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`src-tauri/src/browser.rs`:

```rust
//! Finding a Chromium-family browser already installed on the machine.
//!
//! Chrome first, then Edge. Edge ships with every Windows 10/11 install, so it
//! is the guaranteed hit that makes Windows work at all; Chrome covers macOS
//! and most Windows machines. Brave is deliberately absent: its built-in
//! blocker removes trackers before Traccia can observe them, so a Brave scan
//! reports a clean site that is not clean — a wrong answer, and the dangerous
//! direction for this tool.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Browser {
    Chrome,
    Edge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub browser: Browser,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryError {
    /// Carries every path that was looked at, so the message can name them.
    NoneFound { searched: Vec<PathBuf> },
}

#[cfg(target_os = "macos")]
pub fn candidate_paths() -> Vec<(Browser, PathBuf)> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut out = vec![
        (
            Browser::Chrome,
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ),
    ];
    if let Some(h) = home.as_ref() {
        out.push((
            Browser::Chrome,
            h.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ));
    }
    out.push((
        Browser::Edge,
        PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ));
    if let Some(h) = home.as_ref() {
        out.push((
            Browser::Edge,
            h.join("Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        ));
    }
    out
}

#[cfg(target_os = "windows")]
pub fn candidate_paths() -> Vec<(Browser, PathBuf)> {
    let mut out = Vec::new();
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
            out.push((
                Browser::Chrome,
                base.join(r"Google\Chrome\Application\chrome.exe"),
            ));
        }
    }
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
            out.push((
                Browser::Edge,
                base.join(r"Microsoft\Edge\Application\msedge.exe"),
            ));
        }
    }
    out
}

pub fn discover() -> Result<Found, DiscoveryError> {
    discover_in(&candidate_paths())
}

/// Split out so tests can drive it with paths they control. Never resolves a
/// name and never executes anything — it only asks whether a file is there.
fn discover_in(candidates: &[(Browser, PathBuf)]) -> Result<Found, DiscoveryError> {
    for (browser, path) in candidates {
        if is_executable_file(path) {
            return Ok(Found {
                browser: *browser,
                path: path.clone(),
            });
        }
    }
    Err(DiscoveryError::NoneFound {
        searched: candidate_paths().iter().map(|(_, p)| p.clone()).collect(),
    })
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}
```

Register it in `src-tauri/src/lib.rs` alongside the existing modules:

```rust
pub mod browser;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test browser`
Expected: PASS, 5 tests.

- [ ] **Step 5: Clippy**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/browser.rs src-tauri/src/lib.rs
git commit -m "feat(browser): find Chrome then Edge, and name every path when neither is there"
```

---

## Task 5: Plain-HTTP forwarding through the proxy — **security-gated**

**Files:**
- Modify: `src-tauri/src/proxy.rs`
- Create: `docs/decisions/2026-08-01-plain-http-audit.md`

**Interfaces:**
- Consumes: `decide`, `Decision`, `DenyReason` from `admission.rs`, unchanged.
- Produces: no new public names. `proxy::start` gains behaviour, not signature.

**Why this exists.** Phase 1 shipped CONNECT only, deliberately. A client site typed as `http://`, or one that redirects through plain HTTP before reaching HTTPS, currently fails — and fails silently, which for this tool is the worst failure mode. The Tauri port plan lists it as *"Deliberately absent. Phase 2, under its own audit."* This is that audit.

**This task is the highest-risk change in the release.** It adds an absolute-form HTTP request parser to the one component whose job is to be small enough to audit by reading. Treat it as new security code.

**Non-negotiables for this task:**
- No HTTP client crate. No `hyper`, no `reqwest`, no `h2`. Parse the request line, apply `decide`, forward or refuse. The existing `Cargo.toml` comment states why, and that reasoning is unchanged.
- The admission decision is `admission::decide`, unchanged and not re-implemented. Phase 1's audit found that the predecessor's defects came from having the guard's rules in two places.
- Bounded reads. An oversized header block is refused rather than read forever — `proxy.rs` already has this for CONNECT; plain HTTP uses the same bound.
- Every deny is recorded in the ledger with a reason, exactly as CONNECT denials are.

- [ ] **Step 1: Write the failing tests**

Add to the existing `#[cfg(test)] mod tests` in `src-tauri/src/proxy.rs`:

```rust
    #[tokio::test]
    async fn forwards_a_plain_http_request_to_a_permitted_host() {
        // Absolute-form request line, which is what a browser sends to a proxy.
        let (handle, ledger) = start_test_proxy(&["rossi-editore.it"]).await;
        let response = send_raw(
            &handle,
            "GET http://rossi-editore.it/index.html HTTP/1.1\r\nHost: rossi-editore.it\r\n\r\n",
        )
        .await;
        assert!(response.is_ok());
        assert_eq!(ledger.allowed(), vec![("rossi-editore.it".to_string(), 80)]);
    }

    #[tokio::test]
    async fn refuses_a_plain_http_request_to_a_host_outside_the_scan() {
        let (handle, ledger) = start_test_proxy(&["rossi-editore.it"]).await;
        let _ = send_raw(
            &handle,
            "GET http://doubleclick.net/pixel.gif HTTP/1.1\r\nHost: doubleclick.net\r\n\r\n",
        )
        .await;
        assert!(ledger.allowed().is_empty());
        assert_eq!(ledger.denied().len(), 1);
    }

    #[tokio::test]
    async fn refuses_an_origin_form_request_line() {
        // "GET /x HTTP/1.1" carries no authority. A proxy that trusted the Host
        // header here would be trusting a value the page controls.
        let (handle, ledger) = start_test_proxy(&["rossi-editore.it"]).await;
        let _ = send_raw(
            &handle,
            "GET /index.html HTTP/1.1\r\nHost: rossi-editore.it\r\n\r\n",
        )
        .await;
        assert!(ledger.allowed().is_empty());
        assert_eq!(ledger.denied().len(), 1);
    }

    #[tokio::test]
    async fn ignores_the_host_header_when_it_disagrees_with_the_request_line() {
        // Request-line authority wins. Otherwise a request to an allowed host
        // with a forged Host header, or the reverse, decides on the wrong name.
        let (handle, ledger) = start_test_proxy(&["rossi-editore.it"]).await;
        let _ = send_raw(
            &handle,
            "GET http://doubleclick.net/p.gif HTTP/1.1\r\nHost: rossi-editore.it\r\n\r\n",
        )
        .await;
        assert!(ledger.allowed().is_empty());
        assert_eq!(ledger.denied().len(), 1);
    }

    #[tokio::test]
    async fn refuses_a_plain_http_request_to_a_non_http_port() {
        let (handle, ledger) = start_test_proxy(&["rossi-editore.it"]).await;
        let _ = send_raw(
            &handle,
            "GET http://rossi-editore.it:445/share HTTP/1.1\r\nHost: rossi-editore.it\r\n\r\n",
        )
        .await;
        assert!(ledger.allowed().is_empty());
        assert_eq!(ledger.denied().len(), 1);
    }

    #[tokio::test]
    async fn refuses_an_oversized_plain_http_header_block_instead_of_reading_forever() {
        let (handle, ledger) = start_test_proxy(&["rossi-editore.it"]).await;
        let mut req = String::from("GET http://rossi-editore.it/ HTTP/1.1\r\n");
        for i in 0..100_000 {
            req.push_str(&format!("X-Pad-{i}: 0123456789\r\n"));
        }
        let _ = send_raw(&handle, &req).await;
        assert!(ledger.allowed().is_empty());
    }

    #[tokio::test]
    async fn never_panics_on_a_hostile_plain_http_request_line() {
        let (handle, _ledger) = start_test_proxy(&["rossi-editore.it"]).await;
        for line in [
            "GET http:// HTTP/1.1\r\n\r\n",
            "GET http://:80/ HTTP/1.1\r\n\r\n",
            "GET http://[::1]:80/ HTTP/1.1\r\n\r\n",
            "GET http://user@rossi-editore.it@evil.example/ HTTP/1.1\r\n\r\n",
            "GET http://rossi-editore.it:99999/ HTTP/1.1\r\n\r\n",
            "GET http://rossi-editore.it:/ HTTP/1.1\r\n\r\n",
            "GET  http://rossi-editore.it/ HTTP/1.1\r\n\r\n",
            "\r\n\r\n",
        ] {
            let _ = send_raw(&handle, line).await;
        }
        // Reaching here without the process aborting is the assertion; under
        // panic = "abort" a panic in the spawned task would take the suite with it.
    }
```

`start_test_proxy` and `send_raw` are test helpers. If equivalents already exist in the module's test block under different names, reuse them rather than adding duplicates — read the existing tests first.

- [ ] **Step 2: Run tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test proxy`
Expected: FAIL — plain HTTP is refused wholesale today, so the forwarding tests fail while the refusal tests pass for the wrong reason. Note in the commit message which failed and which passed vacuously.

- [ ] **Step 3: Implement**

In `proxy.rs`, where the request line is currently matched for `CONNECT`:

1. Read the request line under the existing byte bound. Reject non-UTF-8, as CONNECT already does.
2. If the method is `CONNECT`, the existing path is unchanged.
3. Otherwise the target must be **absolute-form**: `scheme://authority/path`. Anything else — origin-form, authority-form, asterisk-form — is denied. Never read the authority from the `Host` header.
4. The scheme must be `http`. `https` in absolute form is not a thing a browser sends to a proxy; deny it rather than guessing.
5. Split the authority into host and port, defaulting to 80. Reject an authority containing `@`, more than one `:`, or a port outside `1..=65535`.
6. Call `admission::decide(host, port, &scan_origins)` — the same call CONNECT makes, with the same `scan_origins`.
7. On `Deny`, record it in the ledger with its reason and answer `403` with a fixed, short body. Do not echo the request.
8. On `Allow`, dial the vetted host string from `Decision::Allow { host, .. }` — never the raw request text — then forward the request bytes and splice the response, using the same splice the CONNECT path uses.

- [ ] **Step 4: Run tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test proxy`
Expected: PASS, all existing proxy tests plus the 7 new ones.

- [ ] **Step 5: Clippy and the full Rust suite**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: no warnings; all tests pass.

- [ ] **Step 6: Security audit — blocking**

Dispatch the `security-auditor` agent with this brief:

> Audit the plain-HTTP forwarding path added to `src-tauri/src/proxy.rs` against spec §7.1 (no outbound traffic except to the URL the user entered). Record the blob hash you audit at. The predecessor of this component, `src/main/egressGuard.ts`, had four defects found across two audits; `docs/decisions/2026-07-31-admission-audit.md` records them and how each maps to the proxy. Treat this as new security code, not as an extension of audited code.
>
> Specifically probe: request-line parsing against malformed, oversized and non-UTF-8 input; whether the `Host` header can influence the decision anywhere; whether the host dialled is always the string `decide` vetted rather than any other copy of it; whether any deny path can fall through to a forward; whether request smuggling via `Content-Length`/`Transfer-Encoding` disagreement can put a second request on an admitted connection; whether a redirect response can move the connection to a host that was never admitted; whether panics in the spawned task are possible and what they would do under `panic = "abort"`; and whether the ledger records every outcome.
>
> Verify empirically, not by reading alone, where a test can be written. Confirm each finding's test fails against the current code before it is fixed. You have authority to block the commit.

Fix every blocking finding. Re-run the auditor until it passes.

- [ ] **Step 7: Write the audit decision doc**

`docs/decisions/2026-08-01-plain-http-audit.md`, following the shape of `2026-07-31-admission-audit.md`: files audited with blob hashes before and after, findings with severity and disposition, and a section titled "What this audit could not determine" naming anything left unverified.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/proxy.rs docs/decisions/2026-08-01-plain-http-audit.md
git commit -m "feat(proxy): forward plain HTTP, absolute-form only, under its own audit

Request-line authority decides; the Host header never does. Same
admission::decide call the CONNECT path makes, so the rules stay in one place
— having them in two is how the predecessor's defects happened."
```

---

## Task 6: Launch the browser — ephemeral profile, hardened flags, and the `file://` requirement

**Files:**
- Modify: `src-tauri/src/browser.rs`

**Interfaces:**
- Consumes: `Found` from Task 4.
- Produces:
  ```rust
  pub struct Launched { pub child: std::process::Child, pub profile_dir: PathBuf, pub devtools_port: u16 }
  pub fn launch_flags(profile_dir: &Path, proxy_port: u16) -> Vec<String>
  pub fn launch(found: &Found, profile_dir: PathBuf, proxy_port: u16) -> Result<Launched, LaunchError>
  pub fn tear_down(launched: Launched) -> Result<(), LaunchError>
  ```
  Task 8 consumes `launch` and `tear_down`.

**The `file://` requirement, carried forward from Phase 1 and closed here.** From §1 of `docs/decisions/2026-07-31-admission-audit.md`: an HTTP CONNECT proxy structurally cannot see an SMB fetch to `\\host\share\x`, so enforcement must live in the browser's launch flags. The requirement has two halves and **both** must be met — the deny cases alone are satisfied by blocking everything and breaking the app.

MUST DENY:
- `file://attacker.example/share/x.png`
- `file://rossi-editore.it/share/x.png` — denied *even though the authority is the scan target*, because a remote file authority is an SMB fetch, not a fetch of the thing the user asked to scan.

MUST STILL ALLOW:
- `file:///app/index.html`
- `file://localhost/app/index.html`
- `devtools://devtools/bundled/x.js`
- `data:text/css,body{}`
- `blob:https://evil.example/uuid`
- `chrome-extension://abc/x.js`

- [ ] **Step 1: Write the failing tests**

```rust
    #[test]
    fn every_launch_carries_the_flags_that_silence_the_browsers_own_traffic() {
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        for required in [
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-component-update",
            "--disable-sync",
            "--headless=new",
        ] {
            assert!(
                flags.iter().any(|f| f == required),
                "missing {required}: {flags:?}"
            );
        }
    }

    #[test]
    fn routes_everything_through_the_proxy_including_localhost() {
        // Without the bypass override Chrome exempts loopback and private
        // addresses from the proxy, which would put a whole class of target
        // outside the one component that enforces §7.1.
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        assert!(flags.iter().any(|f| f == "--proxy-server=http://127.0.0.1:8123"));
        assert!(flags
            .iter()
            .any(|f| f.starts_with("--proxy-bypass-list=") && f.contains("<-loopback>")));
    }

    #[test]
    fn uses_an_ephemeral_profile_and_never_the_users_own() {
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        assert!(flags.iter().any(|f| f == "--user-data-dir=/tmp/p"));
    }

    #[test]
    fn denies_a_remote_file_authority_including_the_scan_target() {
        // Both are SMB fetches, not fetches of the page the user asked for.
        for url in [
            "file://attacker.example/share/x.png",
            "file://rossi-editore.it/share/x.png",
        ] {
            assert!(!url_is_permitted(url), "should have been denied: {url}");
        }
    }

    #[test]
    fn still_permits_the_six_paired_controls() {
        // Without these the requirement above is met by blocking everything and
        // breaking the app, which is not the requirement.
        for url in [
            "file:///app/index.html",
            "file://localhost/app/index.html",
            "devtools://devtools/bundled/x.js",
            "data:text/css,body{}",
            "blob:https://evil.example/uuid",
            "chrome-extension://abc/x.js",
        ] {
            assert!(url_is_permitted(url), "should have been permitted: {url}");
        }
    }

    #[test]
    fn tear_down_removes_the_profile_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = dir.path().join("profile");
        std::fs::create_dir_all(profile.join("Default")).expect("mkdir");
        remove_profile(&profile).expect("remove");
        assert!(!profile.exists());
    }

    #[test]
    fn tear_down_of_a_missing_profile_is_not_an_error() {
        // Teardown runs on the failure path too, where the directory may never
        // have been created. It must not turn one failure into two.
        assert!(remove_profile(Path::new("/tmp/traccia-does-not-exist-xyz")).is_ok());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test browser`
Expected: FAIL — `launch_flags`, `url_is_permitted` and `remove_profile` do not exist.

- [ ] **Step 3: Implement `launch_flags` and `remove_profile`**

`launch_flags` returns the argument vector. Beyond the flags asserted above it must include `--remote-debugging-port=0` — Chrome then writes the chosen port into `DevToolsActivePort` in the profile directory, which is read back in Task 7. Avoiding a fixed port avoids a collision that would silently attach to something else.

`remove_profile` removes the directory tree and treats "not found" as success.

- [ ] **Step 4: Implement `url_is_permitted`, and decide where it is enforced**

`url_is_permitted` is the **specification** of the requirement in executable form: it encodes the two deny cases and the six allow cases and nothing else. It is pure and takes a `&str`.

Its enforcement point is a launch flag. Determine which mechanism the pinned browser versions actually honour, and **write down which one you chose and why** in a comment above the function. Candidates, in order of preference:

1. A command-line flag that disallows a remote `file://` authority while leaving local `file://`, `data:`, `blob:`, `devtools:` and `chrome-extension:` working.
2. Blocking the URL pattern via CDP at attach time, in Task 7, accepting that CDP is not a security boundary and that this is defence in depth on top of the proxy rather than the guarantee itself.
3. If neither holds: record it plainly as an unmet requirement in the Task 13 handover doc, with the mechanism attempted and why it failed. **Do not** claim it is met.

Whichever is chosen, `url_is_permitted` and its two tests stay: they are what stops the requirement being quietly satisfied by blocking everything.

- [ ] **Step 5: Run tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test browser`
Expected: PASS.

- [ ] **Step 6: Clippy**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 7: Security audit — blocking**

Dispatch `security-auditor`:

> Audit `src-tauri/src/browser.rs` launch flags and teardown. Does any flag combination leave a route to the network that does not pass through the loopback proxy — proxy bypass for loopback or private addresses, PAC or auto-detect settings, QUIC, DNS prefetch, WebRTC? Is the profile directory removed on every path including panic and cancel, and is it created somewhere an unprivileged local process cannot pre-create as a symlink? Does `--remote-debugging-port=0` plus the `DevToolsActivePort` read admit a race where another process supplies the port?
>
> Separately, judge the `file://` remote-authority requirement in §1 of `docs/decisions/2026-07-31-admission-audit.md`: is the chosen mechanism real enforcement or a comment claiming enforcement? Both halves must hold — two deny cases and six paired allow controls. You have authority to block.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/browser.rs
git commit -m "feat(browser): headless launch, ephemeral profile, no route around the proxy

Closes the file:// remote-authority requirement carried forward from Phase 1,
with the six paired allow controls that stop it being met by blocking
everything."
```

---

## Task 7: Observe with CDP — attach, recurse, capture

**Files:**
- Create: `src-tauri/src/cdp.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `Launched` from Task 6.
- Produces:
  ```rust
  pub struct ObservedHost { pub host: String, pub request_count: u32 }
  pub struct Observation { pub hosts: Vec<ObservedHost>, pub pages_visited: u32 }
  pub async fn observe(launched: &Launched, entry_url: &str, max_pages: u32, cancel: CancellationToken) -> Result<Observation, CdpError>
  ```
  Task 8 consumes `observe`. The JSON shape it serialises to must match `ScanResult` from Task 1 exactly: `scannedHost`, `hosts[].host`, `hosts[].requestCount`, `pagesVisited`.

**Two properties are requirements, not preferences.** From the CDP spike, F1 and F2:

1. `Target.setAutoAttach` with `flatten: true`, **reapplied recursively in every new session**. Without it a cross-origin iframe's trackers are invisible — and iframes are where a great deal of ad-tech lives.
2. `waitForDebuggerOnStart: true`, with interception armed in the new session **before** `Runtime.runIfWaitingForDebugger`. This is what closed the startup race; the spike measured 20 cold starts with 0 escapes only once this was in place.

### The architecture this task must use — settled by Task 0, not open

Task 0 read `chromiumoxide` 0.7.0's source and compile-checked every claim below. Its finding
(`docs/decisions/2026-08-01-v0.1-preflight.md` §1) changes this task's shape, so read that section
before writing code.

**Property 1 is available. Property 2 is not — not through `chromiumoxide::Browser`, by any route.**

`Target::on_event` (`chromiumoxide-0.7.0/src/handler/target.rs:258–268`) handles
`Target.attachedToTarget` by queueing `Runtime.runIfWaitingForDebugger` **immediately and
unconditionally**, with nothing armed in the child session. That is precisely the startup race F2
exists to close. There is no hook, config flag or callback between the two. Nor can the arming be
raced from outside:

- `Browser::execute` hardcodes `session_id: None` (`src/cmd.rs:48`) — browser session only.
- `Page::execute` addresses its own page's session, and a `Page` exists only after that target has
  finished initialising, i.e. after the resume.
- `CommandMessage::with_session` is the right shape but `mod cmd` is `pub(crate)` — confirmed by
  rustc **E0603**. `HandlerMessage` is `pub(crate)` too.

**Therefore:**

> Use `chromiumoxide::cdp` for the protocol types — it re-exports the whole generated protocol, so
> every command is a typed params struct. Use **`chromiumoxide::conn::Connection`** for the
> transport: `Connection::connect(debug_ws_url)` and
> `Connection::submit_command(method, Option<SessionId>, params)` (`src/conn.rs:42`, `:77`) are
> both public, and `submit_command` is the only public API in the crate that can address an
> **arbitrary** session — which is exactly what arming a child session before resuming it requires.
>
> **Do not construct `Browser` or `Handler` in this module.** Delegating the attach/resume sequence
> to them reintroduces the race. This is also what keeps `reqwest`/`hyper`/`tower` unreachable:
> they enter the graph only via `Browser::connect_with_config`, which fetches `/json/version` over
> HTTP — a call this project already avoids by reading `DevToolsActivePort` out of the profile.
> Task 0 measured that reachability at 200,480 binary bytes / 117,956 `.dmg` bytes, and Task 12
> re-measures. Constructing `Browser` here would spend those bytes and put an HTTP client on a live
> path in an app whose whole claim is that it makes no outbound request.
>
> If `Connection`'s surface turns out to be insufficient in practice, the fallback is
> `tokio-tungstenite` driving the same generated types — which is what the spike itself used. Take
> that fallback rather than reaching for `Browser`. Report it if you do.

**One property must be asserted, not assumed.** Task 0 found that `chromiumoxide`'s own recursion
is the *browser's*, driven by `setDiscoverTargets`, not something re-driven per attach: a `Target`
is created only from `Target.targetCreated`, and `on_attached_to_target` binds a session to an
existing `Target` rather than creating one. Since this task owns the loop directly, that machinery
is not in play — but it means the recursive re-issue in step 4 below is **your** responsibility and
there is no library behaviour to fall back on. Write it explicitly and test it.

Under-arming fails in the dangerous direction: a missed vendor is silently absent from the map
rather than visibly uncertain. A scan that reports a clean site that is not clean is the wrong
answer this whole release is built to avoid.

**CDP observes. It does not enforce.** The proxy already refused anything outside the scan origins before CDP saw it. What CDP adds is attribution — which host, how many requests — and that is all it is trusted for. The spike measured CDP missing 15 of 37 real hosts; a scan that trusted CDP alone would under-report by 40%.

- [ ] **Step 1: Write the failing tests**

Unit tests only — a test that drives a real browser is Task 11's job and needs the whole pipeline.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_repeat_requests_to_one_host_once_as_a_host() {
        let mut acc = HostAccumulator::new();
        acc.record("https://www.google-analytics.com/collect?v=1");
        acc.record("https://www.google-analytics.com/collect?v=2");
        acc.record("https://doubleclick.net/pixel.gif");
        let hosts = acc.finish();
        assert_eq!(hosts.len(), 2);
        let ga = hosts.iter().find(|h| h.host == "www.google-analytics.com").expect("ga");
        assert_eq!(ga.request_count, 2);
    }

    #[test]
    fn lowercases_hosts_so_one_host_is_not_counted_twice() {
        let mut acc = HostAccumulator::new();
        acc.record("https://WWW.Example.COM/a");
        acc.record("https://www.example.com/b");
        assert_eq!(acc.finish().len(), 1);
    }

    #[test]
    fn ignores_a_url_with_no_host() {
        let mut acc = HostAccumulator::new();
        for u in ["data:text/css,body{}", "about:blank", "", "not a url", "blob:https://x/y"] {
            acc.record(u);
        }
        assert!(acc.finish().is_empty());
    }

    #[test]
    fn strips_the_port_and_userinfo_from_a_host() {
        let mut acc = HostAccumulator::new();
        acc.record("https://user:pw@example.com:8443/x");
        let hosts = acc.finish();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host, "example.com");
    }

    #[test]
    fn returns_hosts_in_a_stable_order() {
        // A map that reorders itself between runs is not trustworthy, and the
        // same is true of the list it is built from.
        let mut a = HostAccumulator::new();
        for u in ["https://b.example/1", "https://a.example/1", "https://c.example/1"] {
            a.record(u);
        }
        let mut b = HostAccumulator::new();
        for u in ["https://c.example/1", "https://a.example/1", "https://b.example/1"] {
            b.record(u);
        }
        let names_a: Vec<_> = a.finish().into_iter().map(|h| h.host).collect();
        let names_b: Vec<_> = b.finish().into_iter().map(|h| h.host).collect();
        assert_eq!(names_a, names_b);
    }

    #[test]
    fn same_origin_links_are_followed_and_others_are_not() {
        let links = [
            "https://rossi-editore.it/about",
            "https://rossi-editore.it/contact",
            "https://www.rossi-editore.it/other",
            "https://facebook.com/rossi",
            "mailto:info@rossi-editore.it",
            "javascript:void(0)",
            "#anchor",
        ];
        let next = same_origin_links("https://rossi-editore.it/", &links, 10);
        assert_eq!(next, vec!["https://rossi-editore.it/about", "https://rossi-editore.it/contact"]);
    }

    #[test]
    fn never_follows_more_than_the_page_limit() {
        let links: Vec<String> = (0..50).map(|i| format!("https://rossi-editore.it/{i}")).collect();
        let refs: Vec<&str> = links.iter().map(|s| s.as_str()).collect();
        assert_eq!(same_origin_links("https://rossi-editore.it/", &refs, 10).len(), 10);
    }

    #[test]
    fn does_not_follow_the_entry_page_again() {
        let next = same_origin_links(
            "https://rossi-editore.it/",
            &["https://rossi-editore.it/", "https://rossi-editore.it/a"],
            10,
        );
        assert_eq!(next, vec!["https://rossi-editore.it/a"]);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test cdp`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `HostAccumulator` and `same_origin_links`**

Both are pure and are where the tests above live. `HostAccumulator` keeps an ordered map from lowercased host to count and returns entries sorted by host name, so the output does not depend on network timing. `same_origin_links` compares scheme and host exactly — `www.rossi-editore.it` is a different host from `rossi-editore.it` and is not followed — drops non-`http(s)` schemes and fragments, drops the entry URL, and truncates to the limit.

- [ ] **Step 4: Implement `observe`**

The sequence, in this order:

1. Read `DevToolsActivePort` from the profile directory, with a bounded timeout — 15 s, matching the spike's F7. The file's first line is the port; the second is the browser-level WebSocket path. Distinguish "browser never opened the port" from "no browser found" with a different error; neither may hang or report an empty scan as a clean one.
2. Connect: `Connection::connect(ws_url)` from `chromiumoxide::conn`. No `Browser`, no `Handler` — see the architecture note above.
3. `Target.setAutoAttach { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }` on the browser target — `submit_command(..., None, params)`, session `None` being the browser session.
4. On every `Target.attachedToTarget`, in this order and addressed to the **new** `sessionId` via `submit_command(..., Some(session_id), ...)`:
   a. arm request observation (`Network.enable`, and `Fetch.enable` if interception is used);
   b. re-issue `setAutoAttach` with the same three arguments **on that session**, so nested frames are covered — this recursion is yours to drive, there is no library behaviour behind it;
   c. only then `Runtime.runIfWaitingForDebugger`.

   Steps (a) and (b) must both complete before (c). Awaiting each command's response before sending the next is the straightforward way to guarantee it; do not fire and forget.
5. Navigate to the entry URL. Settle.
6. Collect same-origin links from the entry page, take up to `max_pages`, navigate each, settle.
7. Check `cancel` between every page and before every settle. On cancel, return what has been collected so far and let the caller tear down.
8. Return the accumulated hosts and the page count.

`observe` returns `Result`; it never panics. No `unwrap`/`expect` outside `#[cfg(test)]`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test cdp`
Expected: PASS, 8 tests.

- [ ] **Step 6: Clippy and full Rust suite**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: no warnings; all pass.

- [ ] **Step 7: Security audit — blocking**

Dispatch `security-auditor`:

> Audit `src-tauri/src/cdp.rs`. Confirm nothing here is relied on to prevent egress — the proxy is the enforcement point and CDP is attribution only. Then confirm the two properties the CDP spike proved necessary are actually present and actually recursive: `Target.setAutoAttach` with `flatten: true` reapplied in every attached session, and interception armed before `Runtime.runIfWaitingForDebugger`. A comment claiming them is not evidence — trace the actual send order in the code, and confirm each command's response is awaited rather than fired and forgotten, since the ordering guarantee is what closes the race.
>
> Task 0 established that `chromiumoxide::Browser` resumes a child session immediately on attach with nothing armed, which is the race itself. **Confirm this module constructs no `Browser` and no `Handler`** — grep for both — and drives `chromiumoxide::conn::Connection` (or `tokio-tungstenite`) directly. If `Browser` appears anywhere on a live path, that is a blocking finding regardless of what the surrounding comments say. Confirm also that `reqwest`/`hyper` remain unreachable from `main`, since `Browser::connect_with_config` is the only thing that pulls them onto a live path.
>
> Check that the `DevToolsActivePort` read cannot be satisfied by a file another local process wrote, that the bounded timeout cannot be extended indefinitely by a slow write, and that cancellation cannot leave a browser process running.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/cdp.rs src-tauri/src/lib.rs
git commit -m "feat(cdp): observe requests across frames, with the attach order the spike proved

flatten auto-attach reapplied recursively and interception armed before
runIfWaitingForDebugger — 20 cold starts, 0 escapes, only with both."
```

---

## Task 8: The scan command — orchestration, cancellation, and the ledger assertion

**Files:**
- Create: `src-tauri/src/scan.rs`
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` (only if required)

**Interfaces:**
- Consumes: `discover`, `launch`, `tear_down` (Task 4, 6); `observe` (Task 7); `proxy::start`, `Ledger` (existing).
- Produces:
  ```rust
  #[tauri::command] pub async fn start_scan(app: AppHandle, url: String) -> Result<String, String>
  #[tauri::command] pub async fn cancel_scan(app: AppHandle) -> Result<(), String>
  pub const SCAN_NO_BROWSER: &str = ...;
  pub const SCAN_FAILED: &str = ...;
  pub const SCAN_BAD_URL: &str = ...;
  ```
  `start_scan` returns a JSON string matching `ScanResult` from Task 1. Task 9 consumes all three constants and both commands.

**The order matters and is not negotiable:** validate the URL → set the proxy's scan origins → start the proxy → launch the browser → observe → tear down → **assert the ledger** → return. The proxy is armed before anything can make a request. Teardown happens on every path, including error and cancel.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plain_https_url_and_extracts_its_host() {
        let target = parse_target("https://rossi-editore.it/").expect("valid");
        assert_eq!(target.host, "rossi-editore.it");
        assert_eq!(target.origins, vec!["rossi-editore.it".to_string()]);
    }

    #[test]
    fn accepts_a_url_the_user_typed_without_a_scheme() {
        let target = parse_target("rossi-editore.it").expect("valid");
        assert_eq!(target.host, "rossi-editore.it");
        assert_eq!(target.url, "https://rossi-editore.it/");
    }

    #[test]
    fn accepts_plain_http_because_some_client_sites_are_still_on_it() {
        let target = parse_target("http://rossi-editore.it/").expect("valid");
        assert_eq!(target.url, "http://rossi-editore.it/");
    }

    #[test]
    fn refuses_anything_that_is_not_a_web_url() {
        for bad in [
            "file:///etc/passwd",
            "file://attacker.example/share/x",
            "smb://host/share",
            "javascript:alert(1)",
            "data:text/html,<script>",
            "chrome://settings",
            "",
            "   ",
            "http://",
            "https://",
            "http://[::1]:99999/",
        ] {
            assert!(parse_target(bad).is_err(), "should have been refused: {bad}");
        }
    }

    #[test]
    fn refuses_a_url_whose_host_is_a_loopback_or_private_address() {
        // The user asked to scan a website. A scan of 127.0.0.1 or 192.168.0.1
        // is a scan of their own machine or their own network, which is not
        // what "the URL the user explicitly entered" is meant to authorise.
        for bad in [
            "http://127.0.0.1/",
            "http://localhost/",
            "http://[::1]/",
            "http://192.168.1.1/",
            "http://10.0.0.1/",
            "http://169.254.169.254/",
        ] {
            assert!(parse_target(bad).is_err(), "should have been refused: {bad}");
        }
    }

    #[test]
    fn the_scan_origin_is_the_typed_host_and_nothing_else() {
        // Not the registrable domain, not a wildcard. Widening here would widen
        // what the proxy admits, and the proxy is the whole guarantee.
        let target = parse_target("https://shop.rossi-editore.it/").expect("valid");
        assert_eq!(target.origins, vec!["shop.rossi-editore.it".to_string()]);
    }

    #[test]
    fn serialises_a_result_in_the_shape_the_renderer_expects() {
        let json = serde_json::to_string(&ScanOutput {
            scanned_host: "rossi-editore.it".into(),
            hosts: vec![HostCount { host: "doubleclick.net".into(), request_count: 3 }],
            pages_visited: 4,
        })
        .expect("serialise");
        assert!(json.contains("\"scannedHost\""));
        assert!(json.contains("\"requestCount\""));
        assert!(json.contains("\"pagesVisited\""));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test scan`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `parse_target` and `ScanOutput`**

`parse_target` normalises a bare host to `https://`, requires scheme `http` or `https`, rejects everything in the tests above including loopback and private-range literals, and returns `{ url, host, origins }` where `origins` is exactly `[host]`.

`ScanOutput` and `HostCount` are `serde::Serialize` with `#[serde(rename_all = "camelCase")]` so the JSON matches `ScanResult` in `src/core/types.ts` exactly. A mismatch here fails silently in the renderer, which is why Step 1 asserts on the key names.

- [ ] **Step 4: Implement the orchestration**

```
parse_target
  → set proxy scan_origins to target.origins
  → start proxy on an ephemeral loopback port
  → discover() browser            (on Err: SCAN_NO_BROWSER, naming every path searched)
  → create profile dir in the OS temp dir
  → launch(found, profile_dir, proxy_port)
  → observe(launched, target.url, 10, cancel)
  → tear_down(launched)           (runs on every path, including error and cancel)
  → assert ledger                 (see Step 5)
  → clear scan_origins            (so nothing is admitted between scans)
  → serialise ScanOutput
```

Errors returned to the renderer are short, neutral sentences carrying no filesystem path and nothing from the map — the same rule `commands.rs` already follows for `OPEN_FAILED`. `SCAN_NO_BROWSER` is the one exception and it carries only the paths searched, which are constants, not user data.

`cancel_scan` sets the cancellation token. A scan already stopped is not an error.

- [ ] **Step 5: Assert the ledger before returning**

After teardown and before returning success:

```
if !ledger.healthy() { return Err(SCAN_FAILED) }
for (host, _port) in ledger.allowed() {
    if !target.origins.contains(&host) { return Err(SCAN_FAILED) }
}
```

`ledger.healthy()` is the sensor check. The spike's measuring proxy crashed mid-run and silently reported a clean result; a scan that returns success from a dead ledger is the same failure with the same consequence. **A dropped record is a failed scan, not a clean one.**

- [ ] **Step 6: Run tests to verify they pass**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test scan`
Expected: PASS, 7 tests.

- [ ] **Step 7: Register the commands**

Add `start_scan` and `cancel_scan` to the `invoke_handler` in `src-tauri/src/lib.rs`. Check `src-tauri/capabilities/default.json`: add a permission **only** if one is genuinely required, and if you add one, say in the commit message exactly what it grants. Phase 1's `bundleClean` and `capabilities` tests exist to catch this surface growing quietly.

- [ ] **Step 8: Clippy and full Rust suite**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: no warnings; all pass.

- [ ] **Step 9: Security audit — blocking**

Dispatch `security-auditor`:

> Audit `src-tauri/src/scan.rs` and the two new commands in `src-tauri/src/commands.rs` against spec §7.1 and §7.5. Is the proxy armed before any request can be made, on every path? Are `scan_origins` cleared afterwards on every path including error and cancel, so nothing is admitted between scans? Can two concurrent `start_scan` calls interleave and widen the origins one scan admits? Is the profile directory always removed? Can `parse_target` be made to admit a host the user did not type — via userinfo, a trailing dot, IDN or percent-encoding, uppercase, or a redirect the browser follows? Does any error string carry a filesystem path or anything from the map? Is the ledger assertion reachable on every success path, and does a dropped record fail the scan rather than pass it?

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/scan.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(scan): orchestrate a scan, cancel it, and refuse to call it clean on a dead sensor

Proxy armed before launch, torn down on every path, origins cleared after. A
dropped ledger record fails the scan — the spike's observer died mid-run once
and reported success, and that must not be possible here."
```

---

## Task 9: The renderer — a URL field, progress, cancel, and the map

**Files:**
- Create: `src/renderer/components/ScanBar.tsx`, `tests/renderer/scanBar.test.ts`
- Modify: `src/renderer/App.tsx`, `src/renderer/strings.ts`, `src/renderer/bridge.ts`

**Interfaces:**
- Consumes: `ingestScan`, `IngestIds` (Task 2); `VendorDictionary` (Task 1); `start_scan`, `cancel_scan`, `SCAN_NO_BROWSER`, `SCAN_FAILED`, `SCAN_BAD_URL` (Task 8).
- Produces:
  ```ts
  export async function startScan(url: string): Promise<ScanResult>
  export async function cancelScan(): Promise<void>
  export function scanNotice(error: unknown): string
  ```

**Strings.** Every user-facing string goes in `src/renderer/strings.ts`. `tests/renderer/noLooseStrings.test.ts` enforces this and must not be weakened. Copy stays neutral: "not yet identified", never "violation".

- [ ] **Step 1: Write the failing tests**

`tests/renderer/scanBar.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scanNotice } from '../../src/renderer/bridge'
import { STRINGS } from '../../src/renderer/strings'

describe('scanNotice', () => {
  it('names the paths searched when no browser was found', () => {
    const notice = scanNotice(new Error('SCAN_NO_BROWSER:/Applications/Google Chrome.app'))
    expect(notice).toContain(STRINGS.scanNoBrowser)
  })

  it('uses the neutral failure sentence for anything else', () => {
    expect(scanNotice(new Error('boom'))).toBe(STRINGS.scanFailed)
  })

  it('uses the bad-url sentence when the url was refused', () => {
    expect(scanNotice(new Error('SCAN_BAD_URL'))).toBe(STRINGS.scanBadUrl)
  })

  it('never lets a raw error message through to the user', () => {
    // The renderer shows its own copy of each sentence, exactly as saveNotice
    // already does, so nothing out of the rejection reaches the screen.
    const notice = scanNotice(new Error('/Users/someone/secret/path failed'))
    expect(notice).not.toContain('/Users/someone')
  })
})
```

Follow the shape of the existing `tests/renderer/saveNotice.test.ts` and `src/renderer/saveNotice.ts` — this is the same pattern, and it exists so no filesystem path reaches the screen.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/scanBar.test.ts`
Expected: FAIL — `scanNotice` is not exported.

- [ ] **Step 3: Add the strings**

In `src/renderer/strings.ts`:

```ts
  scanPlaceholder: 'Website address',
  scan: 'Scan',
  scanning: (page: number, of: number) => `Scanning — page ${page} of ${of}`,
  scanCancel: 'Stop',
  scanNoBrowser: 'Traccia could not find Chrome or Edge on this computer.',
  scanBadUrl: 'That does not look like a website address.',
  scanFailed: 'The scan could not be completed.',
  scanFoundNothing: 'The scan finished without observing any third party.',
```

- [ ] **Step 4: Implement the bridge functions**

In `src/renderer/bridge.ts`, following the existing `openProject`/`saveProject` pattern exactly:

```ts
export async function startScan(url: string): Promise<ScanResult> {
  const raw = await invoke<string>('start_scan', { url })
  const parsed: unknown = JSON.parse(raw)
  if (!isScanResult(parsed)) throw new Error(STRINGS.scanFailed)
  return parsed
}

export async function cancelScan(): Promise<void> {
  await invoke<void>('cancel_scan')
}
```

`isScanResult` is a narrow structural check in this file — an object with a string `scannedHost`, an array `hosts` whose entries have a string `host` and a number `requestCount`, and a number `pagesVisited`. Rust checks what protects the machine; this checks what protects the map. That division is already documented at the top of `bridge.ts` and this follows it.

- [ ] **Step 5: Implement `ScanBar` and wire `App.tsx`**

`ScanBar` is presentational: it holds the URL text, calls back on submit, shows progress, and shows a stop button while a scan runs. It holds no project state.

`App.tsx` gains:

```ts
const [scanning, setScanning] = useState(false)

async function runScan(url: string): Promise<void> {
  setScanning(true)
  try {
    const result = await startScan(url)
    setHistory((h) => push(h, ingestScan(h.present, result, VENDORS, { prefix: `scan${h.past.length + 1}` })))
    setNotice(result.hosts.length <= 1 ? STRINGS.scanFoundNothing : null)
  } catch (e) {
    setNotice(scanNotice(e))
  } finally {
    setScanning(false)
  }
}
```

`VENDORS` is `src/data/vendors.json` imported here — in the renderer, not in core. Check `src/core/history.ts` for the actual name of the push-a-new-state function and use it; `push` above is illustrative of the call site, not a guess at the name.

The scan result goes through history, so undo works on a scan. That is the first thing undo has ever had to undo.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/scanBar.test.ts && npm test`
Expected: PASS. Confirm `tests/renderer/noLooseStrings.test.ts` still passes — it will fail if any string was written inline in `ScanBar.tsx`.

- [ ] **Step 7: Run the app and scan something real**

Run: `npm run dev`, enter a real website, and confirm: the map draws, third parties are named and grouped, unrecognised hosts appear in full under "Not yet identified", the register does not open on a wall of gaps, and stop actually stops.

This is the first end-to-end confirmation. Record what you scanned and what it found in the commit message.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/ScanBar.tsx src/renderer/App.tsx src/renderer/strings.ts src/renderer/bridge.ts tests/renderer/scanBar.test.ts
git commit -m "feat(renderer): type a url, watch the map build, stop it if you need to"
```

---

## Task 10: Export — print to PDF

**Files:**
- Create: `src/renderer/print.css`
- Modify: `src/renderer/App.tsx`, `src/renderer/strings.ts`, `src/renderer/theme.ts`

**Interfaces:**
- Consumes: the Task 0 decision on which mechanism works.
- Produces: a print action in the title block.

**Which branch you are on was decided in Task 0.** If the system print dialog opens from the webview, this task is a stylesheet and a button. If it does not, this task additionally needs a renderer→Rust path that serialises the map SVG and writes a PDF; the map is flat shapes and text with no images, gradients or effects, so that is bounded work, but it is work, and the plan reader must check the preflight doc before starting.

- [ ] **Step 1: Add the strings**

```ts
  print: 'Print',
  printLimits:
    'This map shows what this website contacts from a visitor’s browser. ' +
    'It does not show data moving inside the organisation, anything behind a login, ' +
    'or anything that is not on the web.',
```

The limits sentence is a **requirement**, not a nicety. Spec §3: a map that implies it is the whole picture is worse than no map, because the consultant would have to defend it.

- [ ] **Step 2: Write the print stylesheet**

`src/renderer/print.css`, inside `@media print`:

- The map and the register both print. The scan bar, the buttons and the notice do not.
- Legible in monochrome: every distinction the map makes with colour must also be carried by shape, weight or label. Spec §6.3 requires this and it is what makes a printed sheet usable.
- `printLimits` prints below the map. It is present in the DOM at all times but visually hidden on screen, so it cannot drift out of sync with what prints.
- No page-break inside a purpose group.

- [ ] **Step 3: Add the print action**

A `Print` button in the title block next to Open, Save, Undo, Redo. On the print-dialog branch it calls `window.print()`. On the Rust branch it calls the command the preflight doc specifies.

- [ ] **Step 4: Verify by printing**

Run the app, scan a site, print, and save the PDF. Check by eye: the map is on the sheet, the register is readable, the limits sentence is there, nothing is cut off, and it is legible in greyscale. Print on both macOS and Windows if both are available; if only one is, say which in the commit message.

- [ ] **Step 5: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Security audit — blocking**

**Added after Task 0.** The plan originally gated only Tasks 5, 6, 7, 8 and 11. Task 0 established
that the print dialog opens **only** once `core:webview:allow-print` is granted in
`src-tauri/capabilities/default.json` — the first widening of the renderer's authority since the
Tauri port. A capability change is an IPC-surface change, so this task is gated too.

Dispatch `security-auditor`:

> Audit the diff to `src-tauri/capabilities/default.json`. Confirm `core:webview:allow-print` is the
> only permission added and that no `fs:`, `shell:`, `http:` or `dialog:` permission was widened
> alongside it. Confirm the capability file's own description was rewritten to describe what the
> renderer can now do — the previous description asserted a narrower surface than is now true, and
> leaving it stale is how the next reader concludes the file is unmaintained. Then establish what
> `core:webview:allow-print` actually authorises in Tauri 2: whether it can reach anything beyond
> opening the platform print dialog for the current webview, and whether it can be invoked without
> a user gesture. If printing can be triggered programmatically, say what that means for a local-only
> app — a print dialog is not egress, but an unprompted one is a surface the release notes should name.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/print.css src/renderer/App.tsx src/renderer/strings.ts src/renderer/theme.ts src-tauri/capabilities/default.json
git commit -m "feat(export): print the sheet, with what the map cannot see printed on it"
```

---

## Task 11: The egress test — the executable form of the promise

**Files:**
- Create: `src-tauri/tests/egress.rs`

**Interfaces:**
- Consumes: everything. This is the integration test.

**This is the most important test in the product.** Spec §9.3 calls it a correctness test, not a nicety. It is the executable form of "a map of your data flows never leaves your machine."

**It must fail loudly when its own observer dies.** During the spike the measuring proxy crashed mid-run and silently under-reported; it was caught only because the result looked impossible. A test that reports success from a dead sensor is worse than no test.

**No test performs name resolution.** The target is a local fixture server, not a real website.

- [ ] **Step 1: Write the failing test**

```rust
//! The executable form of spec §7.1. If this file passes while the product
//! leaks, the product has no promise left, so every assertion here is written
//! to fail closed.

#[tokio::test]
async fn a_scan_contacts_the_target_and_nothing_else() {
    // A fixture site served from loopback, which links out to three hosts that
    // must never be contacted. No name resolution anywhere.
    let site = fixture_site().await;
    let ledger = run_scan_against(&site).await.expect("scan should complete");

    for (host, _port) in ledger.allowed() {
        assert_eq!(host, site.host, "contacted a host outside the scan target");
    }
    assert!(!ledger.denied().is_empty(), "the fixture's third parties were never attempted — the test is not testing anything");
}

#[tokio::test]
async fn the_scan_fails_rather_than_reporting_clean_when_the_ledger_dropped_records() {
    let site = fixture_site().await;
    let outcome = run_scan_with_poisoned_ledger(&site).await;
    assert!(outcome.is_err(), "a scan whose observer lost records reported success");
}

#[tokio::test]
async fn the_browsers_own_background_traffic_is_silenced() {
    // A component extension made requests even in a fresh profile during the
    // spike, until --disable-background-networking was passed. This asserts the
    // flag is doing its job rather than that it is present in a vector.
    let site = fixture_site().await;
    let ledger = run_scan_against(&site).await.expect("scan should complete");
    let google_service_hosts: Vec<_> = ledger
        .denied()
        .into_iter()
        .filter(|(h, _, _)| {
            h.ends_with("gvt1.com") || h.contains("clients2.google.com") || h.contains("mtalk.google.com")
        })
        .collect();
    assert!(
        google_service_hosts.is_empty(),
        "browser service traffic was attempted: {google_service_hosts:?}"
    );
}

#[tokio::test]
async fn no_dns_query_leaves_the_machine() {
    // With an HTTP proxy the browser resolves proxy-side. That is a property of
    // how the browser is launched, so it is asserted rather than assumed.
    let site = fixture_site().await;
    let observer = dns_observer().await;
    let _ = run_scan_against(&site).await.expect("scan should complete");
    assert_eq!(observer.queries_seen(), 0);
    assert!(observer.is_alive(), "the DNS observer died — this result means nothing");
}

#[tokio::test]
async fn the_profile_directory_is_gone_afterwards() {
    let site = fixture_site().await;
    let profile = run_scan_and_return_profile_path(&site).await;
    assert!(!profile.exists(), "ephemeral profile survived the scan");
}

#[tokio::test]
async fn a_cancelled_scan_leaves_no_browser_running_and_no_profile_behind() {
    let site = fixture_site().await;
    let (profile, child_pid) = run_scan_and_cancel_midway(&site).await;
    assert!(!profile.exists());
    assert!(!process_is_alive(child_pid));
}
```

The `is_alive` assertions are the sensor checks. Every observer this file relies on is asked whether it is still alive before its silence is treated as evidence.

- [ ] **Step 2: Run to verify it fails**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test --test egress`
Expected: FAIL — helpers do not exist.

- [ ] **Step 3: Implement the harness**

The fixture site is a minimal loopback listener serving one HTML page that references three off-site hosts by IP literal — again, no name resolution. `run_scan_against` runs the real pipeline from Task 8 against it. `dns_observer` binds a loopback UDP socket and counts datagrams, and reports whether it is still bound.

If a test cannot be implemented portably across macOS and Windows, **do not delete it and do not weaken it**. Mark it `#[ignore]` with a comment saying why, and record it in the Task 13 handover doc under what remains unverified — the same discipline §4 of the admission audit used.

- [ ] **Step 4: Run to verify it passes**

Run: `source "$HOME/.cargo/env" && cd src-tauri && cargo test --test egress`
Expected: PASS.

- [ ] **Step 5: Wire it into CI**

Confirm `.github/workflows/build.yml` runs `cargo test` in a way that includes `--test egress` on both macOS and Windows. If the runners have no browser installed, the scan tests will not run — and a suite that silently skips its most important test is the failure this whole file exists to prevent. Either install a browser in CI, or make the absence of one a **hard failure** on the runner rather than a skip. State which you chose and why in the commit message.

- [ ] **Step 6: Security audit — blocking**

Dispatch `security-auditor`:

> Audit `src-tauri/tests/egress.rs`. This test is the product's central promise in executable form. Can it pass while the product leaks? Specifically: can any assertion pass vacuously — an empty ledger read as clean, an observer that died read as silence, a fixture whose third parties were never attempted read as blocked? Is there any path where the scan errors and the test still passes? Does anything here perform name resolution? Would this test have caught each of the four `egressGuard.ts` defects recorded in `docs/decisions/2026-07-31-admission-audit.md`?

- [ ] **Step 7: Commit**

```bash
git add src-tauri/tests/egress.rs .github/workflows/build.yml
git commit -m "test(egress): assert the promise, and fail loudly when the sensor is dead"
```

---

## Task 12: Re-measure the bundle and justify every new byte

**Files:**
- Modify: `src-tauri/Cargo.toml`, `tests/build/bundleClean.test.ts`
- Create: `docs/decisions/2026-08-01-v0.1-bundle-measurement.md`

- [ ] **Step 1: Extend the bundle-cleanliness test**

`tests/build/bundleClean.test.ts` and `tests/build/noRemoteAssets.test.ts` already assert the shipped bundle has no remote references. Extend them over what this release added: the dictionary must be present in the bundle, and must contain no `http://` or `https://` URL — a URL in the shipped data is an invitation for a later change to fetch it.

- [ ] **Step 2: Build and measure both platforms**

```bash
npm run tauri build 2>&1 | tail -20
ls -l src-tauri/target/release/bundle/dmg/*.dmg
```

Windows comes from the CI runner. Take both numbers from a real build, not an estimate.

- [ ] **Step 3: Write the `Cargo.toml` justification**

Extend the existing "Dependency budget" comment block in its own style — it already explains what each crate is for, whether Tauri pulls it regardless, and what was deliberately not taken. Add `chromiumoxide` with its measured marginal cost, and add to the "Deliberately NOT taken" list: Playwright and a bundled Node runtime, with the reason (roughly 60 MB against a 1.5 MB baseline, and the author chose the smaller download).

- [ ] **Step 4: Write the measurement doc**

`docs/decisions/2026-08-01-v0.1-bundle-measurement.md`, in the shape of `2026-07-31-tauri-bundle-measurement.md`: before and after for both platforms, the delta attributed per component, and the multiple against Electron's 99,452,988 bytes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml tests/build/bundleClean.test.ts docs/decisions/2026-08-01-v0.1-bundle-measurement.md
git commit -m "chore(size): measure what the scan cost in shipped bytes"
```

---

## Task 13: Green everywhere, and an honest handover

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/decisions/2026-08-01-v0.1-handover.md`

- [ ] **Step 1: Full suite, both languages, clean tree**

```bash
npm test && npm run typecheck
source "$HOME/.cargo/env" && cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

Expected: all pass, no warnings.

- [ ] **Step 2: Confirm the core diff is exactly what was authorised**

```bash
git diff --stat 7318e37..HEAD -- src/core tests/core
```

Expected: `src/core/vendors.ts`, `src/core/scan.ts`, `src/core/types.ts`, `src/core/expectations.ts`, and their tests. **Nothing else.** If anything else appears, it was not authorised by this plan and needs either removing or an explicit note in the handover doc saying why it was necessary.

- [ ] **Step 3: Update `CLAUDE.md`**

Replace the "tests/core is 64 and must stay 64" baseline with the new number, and note that it is a baseline rather than a freeze — it moved once, deliberately, and the plan that moved it said so per task.

- [ ] **Step 4: Write the handover doc**

`docs/decisions/2026-08-01-v0.1-handover.md`, and be honest in it. It must contain, by name:

- Every test marked `#[ignore]` in Task 11 and why.
- Whether the `file://` remote-authority requirement was actually enforced or only specified — and if only specified, say so plainly rather than letting a passing `url_is_permitted` test imply otherwise.
- That no test poisons the `scan_origins` mutex, so its fail-closed behaviour remains structural rather than asserted. Carried forward unchanged from §4 of the admission audit.
- That the app's own webview is still not behind the proxy, defended by CSP and a bundle with no remote references.
- Whatever the release actually under-delivered against this plan.

Follow §4 of `2026-07-31-admission-audit.md` as the model: a section titled what could not be determined, written so a reader can see what was checked rather than trusting that it was.

- [ ] **Step 5: Commit and open the pull request**

```bash
git add CLAUDE.md docs/decisions/2026-08-01-v0.1-handover.md
git commit -m "docs(v0.1): record what shipped, and what is still only specified"
```

---

## Self-review notes

Recorded so a reader can see what was checked rather than trusting that it was.

**Spec coverage.** §1 what this release is → Tasks 8, 9. §2 scenario → Tasks 9, 10. §3 what a scan cannot see → Task 10 Step 1, as a printed requirement. §4.1 discovery → Task 4. §4.2 arm the proxy → Task 8; plain HTTP → Task 5. §4.3 launch → Task 6. §4.4 attach and observe → Task 7. §4.5 walk → Task 7 `same_origin_links`. §4.6 collect, close, assert the ledger → Task 8 Step 5. §5 naming and collapsing → Tasks 1, 2. §6 the three core changes → Tasks 1, 2, plus the fourth found by measurement in Task 3. §7 map and progress → Task 9. §8 export → Task 10. §9.1 egress → Task 11. §9.2 `file://` → Task 6. §9.3 DNS → Task 11. §9.4 background networking → Tasks 6, 11. §9.5 profile removal → Tasks 6, 11. §9.6 plain-HTTP audit → Task 5. §9.7 no unsafe/unwrap → Global Constraints. §9.8 no name resolution → Global Constraints, Task 11. §10 testing → Tasks 1, 2, 3, 11. §12 preflight → Task 0.

**One thing the spec said and this plan changed.** §6 named three `src/core` changes. There are four: Task 3 was added after reading `src/core/gaps/existence.ts` and finding that five expectations with no trigger condition fire on every scan-only project. That was a predicted risk in §10 of the spec, stated as "prove it rather than assume it". It was proved, and it is real, so it became a task.

**Type consistency.** `VendorEntry`, `VendorDictionary`, `ObservedHost`, `ScanResult` are produced in Task 1 and consumed in Tasks 2 and 9. `ingestScan`/`IngestIds` are produced in Task 2 and consumed in Task 9. `Browser`/`Found`/`discover` are produced in Task 4 and consumed in Tasks 6 and 8. `Launched`/`launch`/`tear_down` are produced in Task 6 and consumed in Task 8. `observe` is produced in Task 7 and consumed in Task 8. Rust's `ScanOutput` serialises `scannedHost`/`hosts[].host`/`hosts[].requestCount`/`pagesVisited`, matching TypeScript's `ScanResult` exactly — Task 8 Step 1 asserts the key names, because a mismatch here fails silently in the renderer. Rust's `cdp::ObservedHost` and TypeScript's `ObservedHost` describe the same thing across the boundary and must not drift.

**Two things a reviewer should push on.**

1. **Task 6's `file://` mechanism is the weakest point in the plan.** It specifies the requirement precisely and honestly, but it does not know which browser flag enforces it, because that could not be determined without the browser in hand. The task is written to force an answer — including "it is not enforced", recorded as such — rather than to let a passing specification test imply enforcement that is not there. If the reviewer thinks that is too loose, this is the task to reopen.

2. **Task 5 adds an HTTP parser to the component whose whole virtue is being small enough to read.** The alternative is refusing plain HTTP, which breaks any client site still on it and breaks it silently. The trade is argued in the task rather than assumed, and it is why that task carries the heaviest audit brief in the plan. If the reviewer disagrees, the change is confined to Task 5.
