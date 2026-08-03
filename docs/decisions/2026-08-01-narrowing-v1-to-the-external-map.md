# Narrowing spec §10 v1 to "the external map"

**Date:** 2026-08-01
**Status:** decided, with the author, in the brainstorming session of 2026-08-01.
**Amends:** `docs/design/2026-07-30-data-flow-mapper-design.md` §5.1, §8.1, §10.
**Superseded by nothing yet.** The deferrals below are deferrals, not cancellations.

Spec §10 lists nine items as "in, for v1". The first release ships four of them, one of
them altered. This is a real change to a stated scope, so it is written down rather than
left as an omission.

---

## The framing that drives it

The author's own words, and they are clearer than anything in the spec:

> The website scan is just a feature to have a map of the external data flow. The document
> ingestion feature is the one that gives me the company's internal data flow.

So v1 splits along that seam:

- **v0.1 — the external map.** What leaves the client's website, and where it goes. Built
  from scans.
- **v0.2 — the internal map.** What moves inside the company — payroll, accounting, CRM,
  HR, backup. Built from uploaded documents.

The use is a first checkup, in the room, with the client present. The author was explicit
that accuracy is not the bar: *"the map shouldn't be super accurate, but nice to watch and
where you can get a first understanding at the data process."* That single sentence is what
licenses most of the reductions below.

---

## What ships, and what moves

| Spec §10 item | v0.1 | Note |
|---|---|---|
| Project create, open, save | **In** | Already built in Phase 1. |
| Website scan with pre- and post-consent capture | **Altered** — scan in, consent capture **out** | See "The consent removal" below. |
| Document ingest: PDF, DOCX, XLSX, CSV, TXT | **v0.2** | The internal map. |
| Rule-based extraction against a bundled vendor dictionary | **Repurposed** | A dictionary ships in v0.1, but it names *observed domains*, it does not extract from documents. Document extraction is v0.2. |
| The map: radial, grouped by purpose, one level of drill-in | **In** | Already built. |
| Manual editing of every entity | **v0.2** | See "The editing removal". |
| Gap computation, all three kinds | **In** | Already built. |
| Register panel | **In** | Already built. |
| Export: PDF and PNG of the map, plus the gap list | **PDF only** | PNG deferred. The author asked for print-to-PDF; PNG was never requested. |

---

## The consent removal — the largest deviation, stated plainly

Spec §5.1 does not merely list consent capture, it argues for it:

> The consent dimension matters. A tracker firing *before* consent is a materially different
> finding from one firing after, and the scanner must distinguish them.

**v0.1 does not distinguish them, and does not click consent banners at all.** The author's
instruction:

> The tool should only control connections for third parties/vendors, cookies and any sort
> of trackers. I don't need to know at this stage if something injects before I consent to
> the cookie banner, I just want to know that a connection with a third party is there.

What this buys, and it is not small: no consent-management-platform detection, no selector
list to maintain, no per-vendor breakage, no operator interaction during a scan, and — because
nothing needs watching — a fully headless browser. The scan becomes *type a URL, wait, read
the map*.

What it costs: the highest-value finding in a real checkup is silently absent. This is
recorded as a deferral, not a cancellation, and §5.1 stands as the target for a later release.

**The honest consequence to carry.** Because Traccia never accepts anything, every connection
v0.1 observes is one that fired **without consent having been given**. That is a property of
the scan, not an inference. It was offered as a footnote line on the PDF and the author
declined it, so no such claim appears in the UI or the export. The property is recorded here
so that a later release does not have to rediscover it, and so that nobody mistakes v0.1's
output for a post-consent picture — it is the opposite.

**Type consequence.** `Observation.beforeConsent: boolean` in `src/core/types.ts` is retained
and always set `true`. This is factually correct rather than a placeholder: nothing is ever
clicked, so nothing is ever after consent. No core type change is needed, and v0.2 can begin
setting it `false` without a schema migration.

## The editing removal

Spec §10 has "manual editing of every entity". v0.1 has none: the map is what the scan found.
The author was direct that hand-authoring is not the product — a map you have to draw yourself
is a different tool. Editing returns in v0.2, where documents produce candidates that a human
has to correct, and where spec §5.3's rule ("a human edit always wins over machine inference")
becomes load-bearing.

---

## Two further narrowings, against carried-forward Phase 1 requirements

### Browser discovery: Chrome and Edge, not five browsers

The Tauri port plan's carried-forward table requires discovery across Chrome, Edge, Brave,
Vivaldi and Chromium. v0.1 does **Chrome and Edge**.

Reasoning: Edge is present on every Windows 10/11 install, so it is the guaranteed hit that
makes Windows work; Chrome covers macOS and most Windows machines. Together they reach
effectively every target user. Brave is excluded for a substantive reason rather than effort —
its built-in blocker removes trackers before Traccia can observe them, so a Brave scan reports
a clean site that is not clean. That is a **wrong** answer, not a missing one, and it is the
dangerous direction for this tool. Brave needs the neutral-origin-plus-paired-control handling
the CDP spike identified, which is real work and belongs with the release that does it
properly. Vivaldi and bare Chromium are long tail.

The not-found message must still name every path searched, per the carried-forward requirement.

### Vendor dictionary: direction changed, source still open

Spec §11.1 open question 1 blocks extraction on the dictionary's licence, excluding copyleft
lists. v0.1 needs a dictionary for a narrower job — naming and categorising *observed domains*,
not extracting from documents.

The plan of record is now to evaluate **DuckDuckGo Tracker Radar** (thousands of domains mapped
to owning company and category) rather than hand-writing 150–250 entries. Its licence must be
verified against the §8.1 constraint before adoption, which §7.6 requires regardless. If it
does not clear, the hand-written dictionary is the fallback and is sufficient for a first
checkup. Unrecognised domains appear on the map in full, labelled "not yet identified", per
§4.4 and the author's explicit choice.

---

## One reversal of a Phase 1 decision: `chromiumoxide` is adopted

The CDP spike rejected `chromiumoxide` on a stated ground:

> Avoided: `chromiumoxide`, which would own the interception loop the egress guard must own.

That objection was correct **when interception was the guarantee**. It no longer is. The same
spike's central finding moved enforcement to the loopback proxy, because CDP structurally
cannot see preconnects or browser service traffic — it under-reported by 40%. With the proxy
holding the promise, `chromiumoxide` only observes; it does not enforce, and it cannot weaken
a guarantee it is not part of.

The alternative considered and rejected was **Playwright**, which would be easier still and
which the author was offered explicitly. It requires Node.js in the shipped app, taking the
download from ~1.5 MB back above ~60 MB and undoing the thirteen-task Tauri port. The author
chose `chromiumoxide`.

Its licence and shipped byte cost must both be measured in the plan's preflight, per the
Global Constraint that every dependency justifies itself in bytes.

---

## What is explicitly still true

- Spec §7's no-egress promise is unchanged and unrelaxed. The author noted it should not be
  treated as a blocker; it is not one, because the enforcing proxy is already built, tested
  and audited. Keeping it costs nothing at this point.
- Spec §7.5 scan hygiene is unchanged: ephemeral profile, never authenticates, never submits
  forms. This is what limits a web-app scan to its public surface, and that limit is intended.
- Spec §6.3 visual direction remains open and does not block.
- `src/core/` remains pure. v0.1 does change it — see the release spec — and those changes are
  named there rather than arriving unannounced.
