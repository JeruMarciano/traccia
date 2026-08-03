# Extraction depth — design

**Date:** 2026-08-03
**Status:** §5 implemented (branch extraction-depth-scan, 2026-08-03); §11's after-measurement pending one user-run rescan
**Builds on:** `2026-07-30-data-flow-mapper-design.md` (the core model), `2026-08-01-external-map-release-design.md` (v0.1), the v0.2 internal map.

Working title: *stop discarding what we already have*.

---

## 1. The finding this release answers

The detail panel reads "not yet identified" on nearly every line. That is a reporting failure, not
an absence of knowledge. Both halves of the app already receive the missing answers and drop them.

**Documents.** `Place.retention` and `Place.jurisdiction` exist in the model and nothing has ever
written to them. An informativa states both constantly — *"conservati per 24 mesi"*, *"server
ubicati in Irlanda"* — and `extractCandidates` walks past, because it looks only for names.
Subject groups are worse: a scan seeds `Website visitors` and that is the only one that can ever
exist, while the document lists *clienti, dipendenti, fornitori, candidati* in its second paragraph.

**The scan.** `Network.enable` is on and `Network.requestWillBeSent` is already handled
(`src-tauri/src/cdp.rs`). The browser hands over the full URL, the initiator chain, the headers and
the body of every request. All of it collapses into `ObservedHost { host, request_count }` and the
rest is discarded. Cookies are one CDP call away and nobody asks.

Neither half needs a new source of information. Both need to stop throwing away what arrives.

## 2. Scope

**In:**

- Documents read for what they say *about* a system, not only that it is named (§4).
- The scan captures cookies, form fields, storage keys and whether a consent banner exists (§5).

**Out, deliberately:**

- **The map redesign.** The controller-centred map — centre becomes the controlling organisation,
  direction drawn on every line, collection points as doors on the inbound side, one colour per
  door, rings opening on click, EEA no longer drawn — is designed and agreed, and is the *next*
  release. It is better served by having real paths to draw, which this release produces.
- **Any AI or language model**, local or remote. A remote one breaks the first non-negotiable in
  `CONTRIBUTING.md` and would mean uploading a client's processing records to a third party, which is the
  practice this tool exists to examine. A bundled local one keeps the promise and loses the
  download size.
- **ROPA as a separate importer.** A register is one document among others: optional, accepted
  before or after any other document, never a blocker, and useful even when incomplete. The app may
  *invite* one once a map exists. It must never require one.
- **Identifiers in request URLs.** Detecting that a request carried an email hash or a client id
  was considered and cut. "The page contacted Meta" is sufficient for this release, and identifier
  detection is the most likely of the candidates to produce a confident wrong answer — a UUID in a
  URL is not always about a person.
- **Overriding a vendor's purpose group from surrounding prose** (*"per finalità di marketing"*).
  The dictionary is usually right and the prose is usually ambiguous.
- **EEA.** Not removed here. It stops being drawn as part of the map release. `leavesEEA` stays in
  the schema until there is another reason to bump `schemaVersion`; a file-format migration in the
  middle of a redesign costs more than a dead field does.

## 3. The capture rule

**Shape, never values.** This governs everything in §5 without exception.

Record that a cookie named `_ga` exists, is third-party, and lasts two years. Never its value.
Record that a page has a field collecting an email address. Never anything typed into one. Record
that a storage key named `_fbp` exists and its size. Never its contents.

The reason is not squeamishness. A project file is mailed to a client. If it carried captured
identifiers it would carry live tracking identifiers belonging to whoever ran the scan, and the tool
that maps the leak would be the leak.

## 4. Documents read deeper

All of this is `extractCandidates` in `src/core/documents.ts`, which stays pure.

### 4.1 Attributes, not just names

When a dictionary term matches, read the sentence around it for what the document says about it:

- **Retention** — *"conservati per 24 mesi"*, *"kept for 30 days"*, *"per un periodo di 10 anni"*.
  Lands in `Place.retention`.
- **Jurisdiction** — *"server ubicati in Irlanda"*, *"hosted in Frankfurt"*. Lands in
  `Place.jurisdiction`, which the spec already defines as free text — a label, not a coordinate.

Attribution is the risk: a retention phrase near "Salesforce" may not be about Salesforce. Two rules
contain it. Matching is **same-sentence only** — a phrase across a sentence boundary is not
attributed. And the attribute is shown inside the evidence snippet the user already ticks, so a
wrong reading is visible before it reaches the map. That is what the confirm step is for.

### 4.2 Subject groups from documents

A new extractor for categories of data subjects, in both languages: *clienti, dipendenti, fornitori,
candidati, utenti del sito, pazienti, minori* and their English counterparts. These produce
`SubjectGroup` candidates, offered in the same tick-to-confirm list as places.

Today the only subject group that can exist is the one the scanner seeds. This is the "whose data is
this" half of the model, and it is the input the parked map redesign needs for its inbound side.

### 4.3 Controller and processor

*"Titolare del trattamento"* and *"responsabile del trattamento"* appear in near-fixed positions in
an Italian informativa. Recognising them sets `Place.holder` correctly and identifies the
controlling organisation **by name** — which is what the next release needs at the centre of the
map. This release supplies it as a by-product.

### 4.4 A negation guard

*"Non utilizziamo cookie di profilazione"* currently produces a `Cookies` place: the map would show
the opposite of what the document says. A negation appearing **before the term and within the same
sentence** suppresses the candidate — the same sentence boundary §4.1 uses, so there is one rule
about how far a statement reaches rather than two. Suppression is per occurrence: a term negated in
one sentence and asserted in another is still a candidate, carrying the asserting sentence as its
evidence.

This is a correctness fix, not a feature. One confident false positive costs more trust than ten
honest blanks, and the whole register of this tool is that an unanswered question is work to do
rather than an accusation.

### 4.5 Terms that survive a line break

A multi-word term is matched on one literal space, so `"buste paga"` fails whenever a PDF wrapped
the line between the two words. This already affects `"access control"` and `"google workspace"` and
has since v0.2. Matching on flexible whitespace fixes the entire class.

### 4.6 Vocabulary breadth

More terms in both languages, bounded deliberately to what a typical Italian SME informativa and
register use. Not an open-ended dictionary project.

### 4.7 Categories of personal data

`Place` gains `dataCategories?: string[]` — *nome, email, dati di navigazione, dati di pagamento*.
This is the question a client asks first and the model has nowhere to put the answer.

## 5. The scan captures more

Everything here comes from CDP, inside the browser Traccia already launches. **No new egress.** The
proxy's promise that it never decrypts anything is untouched: CDP reads plaintext the browser
already holds.

### 5.1 Cookies

One `Network.getAllCookies` at the end of the scan returns the whole jar — no event plumbing. Per
cookie: name, domain, first- or third-party relative to the scanned host, and lifetime as one of
four buckets — session, under a day, under a year, a year or more. Buckets rather than an exact
expiry because the exact figure is noise on a printed sheet and the distinction that matters to a
reader is whether this thing follows somebody around. Matching the cookie's domain through the
vendor dictionary attaches it to the place it belongs to; a cookie whose domain matches no known
vendor is kept and attached to nothing, rather than dropped.

Highest value of anything here, because declaring exactly this is a legal obligation — so it is the
first thing a document's claims can be checked against.

### 5.2 Whether a consent banner exists

Traccia never clicks, so everything it observes is pre-consent by construction, and
`beforeConsent: true` is honest but says nothing on its own. Detecting whether a CMP is present at
all (OneTrust, Cookiebot, Iubenda, Usercentrics) turns one flat fact into two useful ones: trackers
fired with a banner present and unanswered, versus trackers fired and there is no banner.

### 5.3 Form fields

Enumerate `<input>`, `<select>`, `<textarea>` per page: field name, type, `autocomplete`, associated
label. Classify into email, phone, name, address, payment, free text. Never values — nothing is ever
typed.

These are collection points *discovered* rather than declared, which is a stronger claim than a PDF
asserting one exists, and they are the doors the next release draws on the inbound side.

### 5.4 Storage keys

`localStorage` and `sessionStorage`: key names and sizes only. Trackers migrated here when cookies
became difficult, and nothing currently looks.

### 5.5 Two disciplines inherited from the existing Rust

**The page is hostile input.** §5.2, §5.3 and §5.4 need `Runtime.evaluate`, which runs a script in an
untrusted page and reads a result back. The expression must be fixed and never built from anything
the page supplied. The result is untrusted: bounded length, bounded count, validated shape, control
characters stripped. `proxy.rs` already models this — `redact_authority`, the capped ledger,
`dropped_records` never silently zero.

**Everything is capped, and hitting a cap is recorded.** A page can mint cookies and storage keys in
a loop. Truncation must surface as a gap, never as a clean sheet — the same rule the scan already
follows for `possibleGaps`.

## 6. Model changes

Additive only. Nothing existing changes shape, so project files saved today still open, and
`schemaVersion` stays 1.

| Type | Change |
|---|---|
| `Place` | gains `dataCategories?: string[]`; `retention` and `jurisdiction` finally written |
| `Candidate` | gains the attributes above, plus a discriminator — a candidate may now be a subject group rather than a place |
| `Project` | gains `cookies` and `collectionPoints` as new arrays, rather than reshaping `observations`, which several things already read |
| `ScanResult` | gains cookies, form fields, storage keys, consent-banner presence |

## 7. The purity boundary

Unchanged, and load-bearing. Rust captures and hands over raw material. Every judgement is a pure
function in `src/core/`, tested without a browser:

- is this cookie third-party
- is this field collecting an email address
- is this sentence a negation
- does this retention phrase belong to this system
- which place does this cookie attach to

`src/core/` keeps its existing constraints: no `fs`, no `path`, no `electron`, no `Date.now()`, no
`Math.random()`.

## 8. Order of work

Sequenced so the cheap correctness wins land first, and each step ships independently.

| # | Step | Gate |
|---|---|---|
| 1 | Whitespace-flexible terms; negation guard | review |
| 2 | Retention and jurisdiction attributes | review |
| 3 | Subject groups; controller/processor roles | review |
| 4 | `dataCategories`; vocabulary breadth | review |
| 5 | Cookies | review + **security** |
| 6 | Consent-banner presence | review + **security** |
| 7 | Form fields | review + **security** |
| 8 | Storage keys | review + **security** |

Steps 1–4 need no Rust and no security gate, and are where most of the "not yet identified" lines
die.

## 9. Testing

Tests before implementation, per the existing method. `tests/core` goes from 117 toward roughly 150,
accounted for per task in the commit message, as `CONTRIBUTING.md` requires.

Rust gets cases for the caps and for hostile input: a page minting a thousand cookies, a storage key
of a megabyte, control characters in a field name, a cap being hit and surfacing as a gap.

## 10. Gates

Each task is implemented, then reviewed independently; a security review gates any task
touching network, filesystem, IPC or preload — which is steps 5–8, since they touch CDP, script
injection into untrusted pages, and new data crossing IPC into the renderer. The security review is
wanted on the design of those steps before implementation, not only on the diff after.

## 11. Acceptance

Before any code: run a scan of a real site plus a real informativa, and count the "not yet
identified" lines in the detail panel. That number is the baseline.

The release is judged on how few survive. Without the baseline recorded first, the judgement is a
guess.

## 12. Glossary

- **Informativa** — an Italian privacy notice, written as prose.
- **ROPA / register** — record of processing activities. One document among others here.
- **CMP** — consent management platform; the cookie banner and what sits behind it.
- **Door / collection point** — a place where personal data enters the organisation. A `Place` with
  `kind: 'collection'`.
