# Data Flow Mapper — Design

**Date:** 2026-07-30
**Status:** Draft for review
**Working name:** Traccia (placeholder)

---

## 1. What this is

A desktop application that discovers where an organisation's personal data goes and draws it as a
single picture. It scans a website and reads documents the organisation already has, produces a draft
map, and marks everything it could not work out. A human corrects and completes the map from there.

The output is a diagram plus a list of unanswered questions.

## 2. What this is not

Naming these explicitly, because each was considered and cut during design:

- **Not a compliance tool.** No legal basis, no DPIA, no retention schedules as managed records, no
  Article 30 register generation. Those live in documents the organisation already maintains.
- **Not a document management system.** Documents are fuel. They are read, facts are extracted, and the
  file is referenced. There is no document library UI, no versioning, no evidence browser.
- **Not a scanner-only product.** A scan produces a starting point, never a finished map.
- **Not a SaaS.** No account, no server, no telemetry. See §7.

## 3. Users

One surface serves two people:

| User | Situation | What they need first |
|---|---|---|
| Privacy consultant | Engaged by a client, several concurrent projects | A fast draft from whatever the client can hand over, and a defensible list of gaps that becomes a scope of work |
| In-house DPO or owner | One organisation, revisited over time | A map that improves as documents arrive, and a to-do list of unanswered questions |

Neither is assumed to be technical. The consultant is the power user, not a different user.

## 4. Core model

Five entity types. Everything on screen is one of these.

### 4.1 Subject group

A category of people whose data the organisation holds: customers, employees, visitors, applicants.
The centre of the map. Every flow ultimately originates from one.

```
{ id, name, estimatedCount?, notes? }
```

### 4.2 Place

Anywhere data sits or passes through: an internal system, a supplier, a website, a phone line, a
shared drive.

```
{
  id, name,
  kind: "collection" | "internal" | "processor" | "unknown",
  purposeGroup: string,           // §4.5 — exactly one
  holder: "you" | "supplier" | "unknown",
  jurisdiction?: string,          // free text: "Frankfurt, DE" — a label, not a coordinate
  leavesEEA: boolean | "unknown",
  retention?: string,             // free text: "30 days", "10 years for tax"
  sources: SourceRef[],           // §4.6
  confidence: "observed" | "declared" | "inferred"
}
```

`kind: "unknown"` is a real, first-class value. A place the app knows receives data but cannot identify
is a Place, not an absence.

### 4.3 Flow

A directed edge. What moves, and why.

```
{
  id, from: PlaceId | SubjectGroupId, to: PlaceId,
  dataDescription: string,        // "Name, email, pages viewed"
  purpose: string,                // "Selling books and measuring how people browse"
  sources: SourceRef[],
  confidence: "observed" | "declared" | "inferred"
}
```

### 4.4 Gap

A computed record of something the map cannot yet say. **Gaps are never authored by hand.** They are
derived on every recalculation, so they cannot go stale.

```
{
  id, kind: "attribute" | "existence" | "contradiction",
  subject: PlaceId | FlowId | null,
  question: string,               // "When is a dormant subscriber deleted?"
  why: string,                    // why the app believes this matters
  severity: 1 | 2 | 3
}
```

Three kinds, and the distinction drives the whole detection design:

- **Attribute gap** — the thing exists, a field is empty. *Newsletter has no retention.*
- **Existence gap** — something should be there and no evidence mentions it at all. *Forty employees
  exist; no payroll processor appears anywhere.* Requires expectations (§5.4).
- **Contradiction** — two sources disagree. *The vendor list names 14 processors; the website contacts
  31 third-party domains.* The highest-value gap kind, and it exists only because there are two
  independent evidence streams.

### 4.5 Purpose group

The map's grouping unit. Named for what the organisation does, not how it is built or organised:
Selling, Marketing, Support, Employing people, Getting paid, Running the systems, Delivering orders.

A Place belongs to **exactly one** purpose group. Cross-cutting facts (`leavesEEA`, gap counts) are
**properties**, not groups — rendered as counters on a tile, never as containers. Groups are a flat
list, not a tree.

### 4.6 SourceRef

Thin provenance. Enough to answer "where did this come from", not enough to constitute a document
manager.

```
{ documentId, documentName, locator?: string }   // locator e.g. "p.4" or "row 12"
```

Every Place and Flow carries at least one. A fact with no source is itself a gap.

---

## 5. Subsystems

Four units with clean boundaries. Each is independently testable and knows nothing of the others'
internals.

### 5.1 Website scanner

**Does:** drives a headless browser to a URL, walks the entry page plus up to N same-origin pages
discovered from its links (N configurable, default 10), and captures every outbound request, cookie
and storage write, both before and after consent is accepted.
**Produces:** a list of observed third-party domains with request counts and timing relative to consent.
**Does not:** interpret. It emits observations, not Places.

The consent dimension matters. A tracker firing *before* consent is a materially different finding from
one firing after, and the scanner must distinguish them.

### 5.2 Document reader

**Does:** extracts text from PDF, DOCX, XLSX, CSV, TXT, then runs deterministic extraction over it.
**Produces:** candidate Places and Flows with SourceRefs.
**Does not:** guess with a language model by default (§7.4).

v1 extraction is rule-based: a bundled dictionary of known vendors and their domains, plus pattern
matching for company suffixes, email domains and URLs. Deliberately conservative — a missed vendor
becomes a gap, which is safe; an invented vendor is a false accusation, which is not.

### 5.3 Map model

**Does:** holds the graph, merges observations from both sources into it, computes gaps, computes layout.
**Produces:** the canonical project state.
**Does not:** render, or touch the filesystem.

The only stateful unit and the only one with business rules. It must be pure and fully unit-testable
with no I/O.

**Merge rules:**
- An observed domain matching an existing Place enriches it and raises confidence.
- An observed domain matching nothing becomes a `kind: "unknown"` Place and raises a contradiction gap.
- A human edit always wins over machine inference, and is marked `declared`.

### 5.4 Expectation library

**Does:** holds a small set of near-universal business functions and asserts they should be present.
**Produces:** existence gaps.

v1 scope: exactly these twelve functions, chosen for very low false-positive risk — payroll, email and
productivity, website hosting, website analytics, accounting, backup, customer support, CRM or customer
records, payment processing, order delivery, document storage, staff device management. Each carries a
trigger condition (for example, payroll is expected only when the project records employees as a subject
group). A false gap is more damaging than a missed
one, because the consultant has to defend the map in front of a client. Sector-specific templates are
explicitly deferred.

### 5.5 Renderer

**Does:** draws the map, handles hover isolation, drill-in, and the register panel.
**Does not:** hold state.

---

## 6. Interface

### 6.1 The map

- **Centre:** subject groups. Every line begins with a person.
- **Outward:** collection points, then what the organisation holds, then suppliers and beyond. Distance
  from the centre means "hands the data has passed through".
- **Grouping:** by purpose group. Each tile shows its name, its count, and two counters — how many of
  its places leave the EEA, and how many nobody can explain.
- **Drill-in:** one level. Opening a group keeps the other groups on the sheet, greyed. Flows leaving
  the opened group are drawn through, not cut. There is never a second screen.

### 6.2 The register

A permanent side panel listing gaps, ranked by severity. Linked both ways: hovering an entry isolates
it on the map; clicking opens its detail. This is the "missing documented information" recap, living
continuously rather than appearing at the end.

### 6.3 Visual direction — OPEN

Not settled. Seven directions were explored and rejected. The constraints that *are* settled, and which
any direction must satisfy:

- Flat and geometric. No gradients, glow, drop shadows, or rounded corners by default.
- Every visual device must encode something. No decoration.
- Legible in monochrome and when printed. Colour may reinforce meaning but must never be its only carrier.
- Unknowns must read as *not yet mapped*, never as *violation*. The client is not a suspect.
- No decorative background: no grids, graticules, dot fields, or containing rings.

**This does not block implementation.** Build against these constraints with a minimally styled
renderer, and settle the finish later against real screens, or with a designer.

---

## 7. Privacy and security

The product's central promise is that a map of your data flows never leaves your machine. This is the
one area where a defect is fatal to the product, so it gets hard requirements rather than intentions.

1. **No outbound network traffic**, except requests the scanner makes to the URL the user explicitly
   entered. No telemetry, no crash reporting, no update check in v1, no font or asset CDN. Fonts and
   all assets are bundled.
2. **Enforced by test, not by policy.** An automated check fails the build if egress occurs outside a
   scan. See §9.
3. **Local storage only.** One project file per organisation, in a directory the user picks.
4. **No language model by default.** If LLM-assisted extraction is added later it must be opt-in per
   project, off by default, clearly labelled with where the model runs, and never the path of least
   resistance.
5. **Scan hygiene.** The scanner runs in an ephemeral browser profile, discarded after each scan. It
   never authenticates, never submits forms, and never enters credentials.
6. **Third-party data.** The vendor and domain dictionary is bundled and versioned. Its licence must be
   verified before adoption.

---

## 8. Technical decisions

**Electron + TypeScript + React.**
The decisive argument is the scanner: the app must drive a real browser to observe real requests.
Electron already ships Chromium, and a hidden `BrowserWindow` plus `session.webRequest` gives full
request interception, cookie access and storage inspection with no extra dependency. A non-Chromium
shell would mean bundling a separate browser to do the same job.

**Project file: a single JSON document.**
Not SQLite. At this scale — hundreds of nodes, not millions — query performance is irrelevant, and a
plain file is portable, inspectable, diffable, easy to back up and easy to send to a colleague. It
carries an explicit `schemaVersion` from day one.

**Document parsing:** `pdfjs-dist`, `mammoth` (DOCX), `sheetjs` (XLSX and CSV). All pure JavaScript,
no native build step.

**Rendering:** SVG. The graph is small; canvas and WebGL are unnecessary complexity. Layout is computed
by the map model, not by a force simulation — deterministic positions matter, because a map that
rearranges itself between sessions is not trustworthy.

### 8.1 Platforms, language and distribution

**Platforms: macOS and Windows.** Linux is not a target. Most business clients run Windows, so it
cannot be deferred, and the two platforms differ in one place that matters — see the file-write note
below.

**Language: English only.** All user-facing strings live in a single module (`src/renderer/strings.ts`)
so that adding Italian later is a translation, not a refactor. No i18n library in v1.

**Distribution: free, from GitHub releases**, with an optional direct download. No paid tier, no
account, no licence key.

**Not signed in v1, and the cost of that is real.** Unsigned builds mean macOS Gatekeeper refuses to
open the app until the user right-clicks and confirms, and Windows SmartScreen shows a warning. For a
tool whose pitch is trustworthiness this is a genuine adoption problem, and it should be revisited
before the app is put in front of anyone non-technical. Signing needs an Apple Developer account and a
Windows certificate; the build configuration leaves a documented place for both.

**Updates are manual.** §7 forbids an update check, so the app never contacts a server to look for a
new version. Users learn about releases from the GitHub repository. The consequence to accept: a
security fix reaches only the people who go looking. Any future change here must keep the check
opt-in and off by default.

**Dependency licences must permit both commercial and closed-source use**, because the licence for
this project is undecided. In practice that means MIT, Apache-2.0, BSD, ISC or equivalent. Anything
copyleft is excluded — which rules out several otherwise-suitable public tracker lists for the vendor
dictionary in Phase 3.

**Windows file writes.** `rename` over an existing file is atomic on both platforms, but on Windows it
can fail transiently with `EPERM` or `EBUSY` when antivirus or another program holds the target open.
Saving must retry with a short backoff rather than surfacing an error the user cannot act on.

---

## 9. Testing strategy

Test-driven throughout. Beyond ordinary unit coverage, three suites carry particular weight:

1. **Gap computation.** The highest-value logic in the product. Fixture graphs in, expected gap sets
   out. Every gap kind, plus the case that matters most: a gap that closes when new evidence arrives
   must disappear, and one that reopens must come back.
2. **Merge rules.** Observation meets declaration. Human edits beat inference. Contradictions surface
   rather than silently resolving.
3. **Network egress.** An integration test that runs the app behind a proxy which fails the suite on
   any request not addressed to the scan target. A correctness test, not a nicety — it is the
   executable form of the product's central promise.

---

## 10. Scope

**In, for v1**

- Project create, open, save (single JSON file)
- Website scan with pre- and post-consent capture
- Document ingest: PDF, DOCX, XLSX, CSV, TXT
- Rule-based extraction against a bundled vendor dictionary
- The map: radial, grouped by purpose, one level of drill-in
- Manual editing of every entity
- Gap computation, all three kinds
- Register panel
- Export: PDF and PNG of the map, plus the gap list

**Out, explicitly deferred**

- SaaS admin API connectors (Google Workspace, M365, Okta)
- Configuration and code scanning
- Network-level observation (proxy, DNS logs)
- Sector-specific expectation templates
- LLM-assisted extraction
- Multi-user collaboration, comments, approvals
- Article 30 register generation, or any compliance output
- Regulatory regimes outside the EEA

---

## 11. Open questions

1. **Vendor dictionary source and licence.** Public tracker lists exist and their licences differ.
   Must permit commercial and closed-source use per §8.1, which excludes copyleft lists. Settle
   before Phase 3 extraction work begins.
2. **Project file encryption.** A file describing every data flow in a business is sensitive. Optional
   passphrase encryption is probably right; deferred until the file format is stable.
3. **Code signing.** Deferred, with the consequences recorded in §8.1. Revisit before the app goes to
   anyone non-technical, since Gatekeeper and SmartScreen warnings undercut the product's own pitch.
4. **Naming.** "Traccia" is a placeholder.
5. **Visual direction.** Open, per §6.3. Does not block implementation.

## 11.1 Deliberately not open

Recorded so nobody reopens them mid-build: performance (hundreds of nodes, not millions), database
choice (there is no database), state management library (React's own state holds one project object),
CSS framework (the visual direction is unsettled, so no framework is chosen), and auto-update
(forbidden by §7).

---

## 12. Glossary

- **Place** — anywhere data sits or passes through.
- **Flow** — a directed movement of data between two places.
- **Gap** — something the map cannot yet say. Computed, never authored.
- **Purpose group** — what the data is used for. The map's grouping unit.
- **Subject group** — a category of people whose data is held.
- **Observed / declared / inferred** — the three confidence levels. Observed comes from a scan,
  declared from a human or a document, inferred from an expectation.
