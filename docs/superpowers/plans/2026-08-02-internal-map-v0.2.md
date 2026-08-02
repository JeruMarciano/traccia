# v0.2 — the internal map (document ingestion)

**Date:** 2026-08-02. **Decided with the author** (extraction flow, document types, language,
process speed) in the session of 2026-08-02.

## What it is

Feed Traccia the documents a client hands over in the first checkup — privacy docs (registro,
policy, DPA), supplier contracts and invoices, system exports/logs, org/process documents — in
PDF, DOCX, XLSX, CSV or TXT/log form. Traccia reads them locally, finds what describes a
data-processing activity, and shows a **suggestion list**. The author ticks what belongs; only
confirmed entries land on the map, as the company's **internal layer** (an inner ring between
the people hub and the external suppliers) or as declared external suppliers. The documents
themselves are read, mined, and forgotten: never stored, never copied, never uploaded.

## Author's rulings (binding)

1. **Suggest first, confirm second.** Nothing lands on the map without a tick.
2. **Documents are not archived.** Extracted text lives only in memory for the session; the
   project file stores only confirmed places/flows and the document's *name* as a source.
3. **English-first extraction.** Italian tolerated where free, not tuned for.
4. **Ship faster.** Controls stay where security needs them — the file-parsing boundary gets
   the full adversarial audit — everything else runs implement → one review, batched.

## Non-negotiables (unchanged from v0.1)

No outbound network traffic, ever; parsing is entirely local. `src/core/` purity holds. Gaps
computed on demand. Neutral copy ("not yet identified"). Size: stay light — parser crates are
chosen by measured cost, no copyleft beyond the five recorded MPL exceptions.

## Shape

- **Rust** gains one command: `extract_text(paths) -> [{name, kind, text, truncated}]` — per
  format: PDF (lopdf-based text extraction; scanned/image PDFs yield an honest "no text found"),
  DOCX (zip + XML), XLSX (calamine, cells to lines), CSV/TXT/log (read with caps). Hard caps on
  file size, entry count, decompressed bytes and text length; zip entries are read as streams,
  never extracted to disk. **This is the audited surface: hostile files must not be able to do
  anything but produce text or a refusal.**
- **Core** gains `extractCandidates(texts, vendorDictionary, internalDictionary)` — rule-based:
  vendor-dictionary domain/name hits, a new hand-authored internal-system dictionary (payroll,
  HR, CRM, accounting, backup, email marketing… by product and generic name), and
  processing-activity keyword rules (English-first). Each candidate: name, internal/external,
  purpose group, evidence snippet, source document name. And `ingestDocument(project,
  confirmed[])` — merges by name, confidence `declared`, source = document name; never
  duplicates a scan-observed place, enriches it instead.
- **Layout**: internal places draw as an inner ring between hub and purpose groups.
- **UI**: an "Add documents" action → native file picker (multi-select) → suggestions panel
  (tick/untick per candidate, evidence shown, source named) → Confirm → map updates. Detail bar
  shows "Declared in <document>" under the place. Print unchanged (the inner ring simply
  appears on the sheet).

## Tasks

- **T1 — Rust extract_text** (crates locked by measured size + licence sweep first; caps;
  refusal per malformed file). **Security-audit gated, adversarial, blocking.**
- **T2 — Core: internal dictionary + extractCandidates + ingestDocument** (pure, test-first;
  reopens src/core under this plan).
- **T3 — Layout inner ring + UI flow** (picker, suggestions, confirm, detail-bar source line).
- **T4 — Close: bundle re-measure, licence sweep re-run, handover update, both platforms green
  in CI.**

Reviews: one per task, fix rounds only for Critical/Important; minors to the ledger. T1 carries
the only security gate. Final: CI green on both platforms is the whole-branch check.
