# The scanner sees what a visitor triggers — design

**Date:** 2026-09-29
**Status:** approved 2026-09-29, not yet planned.
**Builds on:** `docs/decisions/2026-09-29-scanner-baseline.md` (the numbers this is judged
against), `docs/decisions/2026-09-29-scanner-prior-art.md` (what is copied, ported or only learned
from), §5 of `2026-08-03-extraction-depth-design.md` (the captures this extends).
**Out of scope:** document ingestion (a later, separate phase); the map redesign asked for in
`docs/decisions/2026-08-03-map-legibility-at-scale.md` (§8 here only sets a declared limit).

## 1. What this release answers

v0.3.0 sees 35% of the third parties a visitor triggers on the median site, zero cookies, and
misses 74 of 136 pages with a form. The user asked for five things, all in this release:

1. third parties that start after consent;
2. third parties with no name or the wrong one;
3. collection points: forms, newsletters, booking, chat, embedded video and maps;
4. a before/after-consent comparison;
5. the pages that matter reached: contacts, careers, shop, booking.

Each is tied to a number in §10 that must move on the 55-site fixture.

## 2. Decisions already taken (not reopened here)

- **2026-09-29 — the scan behaves like a real visitor.** Third-party traffic is let through.
  IP literals, resolved private/loopback/link-local addresses and ports other than 80/443 stay
  denied. The scan screen says so in one line (§9). The "No outbound network traffic" line in the
  project `CLAUDE.md` is rewritten when this ships. Gated by the security-auditor with authority to
  block.
- **2026-09-29 — DuckDuckGo autoconsent is the sixth declared MPL-2.0 exception.** Extended the
  same day, at the user's decision, from the rules file to the engine that executes it: two
  unmodified files from `@duckduckgo/autoconsent` (§5.2). Recorded in `THIRD-PARTY-LICENSES.md`.
- **No NC/SA data.** Tracker Radar, Disconnect, Ghostery TrackerDB are not bundled. Open Cookie
  Database (Apache-2.0, NOTICE required) is. The IAB CMP list is not bundled; its terms are
  unchecked.
- **2026-09-29 — approach A for consent:** one visit in two phases (§4), not two separate runs.
  The reference measured the same way, so the figures stay comparable. Two-run diffing (B) can be
  added on top later if the measured gap in §4.4 turns out to matter.

## 3. Constraints carried into every task

- **Lightest possible app.** Every added byte is listed in §11 with its reason.
- **`src/core/` pure and rule-based.** No model, no inference. Classification lives there;
  Rust only captures.
- **A blank beats a guess.** Unknown stays "not yet identified"; a missing phase stays missing.
- **Every automatic click records the rule that caused it** — a CMP rule by name, or the generic
  text rule with the text it matched.
- **Never a value.** Cookies, fields and storage keep their current discipline: names, shapes and
  sizes only. Nothing is typed into a page. The only interaction is one consent click.
- **Output from the page is hostile.** Every probe result is capped in the page and filtered
  again in Rust against a fixed vocabulary, as `CONSENT_PROBE` and `FORM_PROBE` already are.

## 4. The scan, step by step (goals 1, 4, 5)

`Driver::run` in `src-tauri/src/cdp.rs` becomes:

1. **Load the home page, wait 8 s, touch nothing.** Snapshot hosts, cookies and storage keys:
   phase `before`.
2. **Detect the consent manager** (§5).
3. **Accept** (§5). Record the rule, or record why no click happened.
4. **Reload the home page**, then visit up to 12 key pages (§6). Phase `after` for everything
   first seen from step 3 on.
5. **On every page:** forms (with the host the form posts to), iframes, and off-site links to
   booking/sign-up (§7).
6. **Snapshot cookies again.** Each host and cookie is tagged by the first phase it was seen in.

### 4.1 Phases

Each `ObservedHost` and `ScanCookie` gains `phase: 'before' | 'after'`. The first phase a host or
cookie is seen in wins. `Observation.beforeConsent`, already in the project model and hard-coded
to `true` today, is set from it.

- *Breaks when:* no click happened. Then there is no `after`. Every phase is `before`, the scan
  records `consent: { clicked: false, reason }`, and the notice says consent was not given. It
  never shows an empty "after" column as if nothing loaded after consent.
- *Breaks when:* a host first seen in `before` also fires after the click. It stays `before`. The
  question answered is "did it start without consent", not "did it also run later".

### 4.2 Cookies — the bug

`fetch_cookies` sends `Network.getAllCookies` on the browser session. Chrome answers "wasn't found"
and the error becomes zero cookies. Replace it with `Storage.getCookies` on the browser session,
which has been verified to work, and call it at both snapshots.

- *Breaks when:* the command fails for another reason. The existing rule stands: a gap is noted,
  never a silent zero. A test must fail if the method string reverts.

### 4.3 Time budget

Settle stays 3 s per page; the home wait is 8 s. Target: ≤ 2 min per site on the fixture (§10),
with the existing cancel honoured at every step.

### 4.4 Known limit, declared

"Before consent" is measured on the home page only. A tracker that an inner page loads without
consent is seen, but tagged `after`, because inner pages are visited after the click. The
notice's wording says "on the home page, before consent".

## 5. Consent manager and the accept click (goals 1, 4)

### 5.1 Order of attempts

1. **autoconsent** (`detectCmp`, then `optIn`). The result is the CMP's rule name, e.g.
   `rule: "iubenda"`.
2. **Generic text, only inside a consent container.** A container is an element whose id/class
   matches `cookie|consent|gdpr|privacy|cmp|banner` on a word boundary, or a fixed/sticky
   positioned element covering the viewport edge. Strong labels ("Accetta tutti", "Accept all",
   "Accetto", "Consenti") are clicked anywhere inside it. Weak labels ("Ok", "Continua", "Ho
   capito", "Chiudi") are clicked only inside a container that also contains a link to a
   privacy/cookie page. Result: `rule: "text"`, plus the matched label.
3. **Nothing.** `clicked: false`, `reason: "no-banner" | "no-button" | "click-failed"`.

- *Breaks when:* on a school site "CONTINUA" was a blog "read more" link, not the banner button.
  Weak labels outside a consent container are never clicked.
- *Breaks when:* the click navigates away (a link, not a button). The navigation is recorded as
  `clickNavigated: true`, the scan returns to the home page, and the notice says the click left
  the page. The result is kept but flagged, not trusted silently.

### 5.2 Running autoconsent

Bundle `dist/autoconsent.playwright.js` (143 KB, 35 KB gz) and the rules
(`rules/rules.json`, 720 KB / 75 KB gz), both unmodified. The compact format
(`rules/compact-rules.json`, 277 KB) was shipped first and dropped: it carries no opt-in steps,
so the engine answers `optIn` with success having clicked nothing (Task 6).

The engine runs in an **isolated world** (`Page.createIsolatedWorld`). It shares the DOM, but the
page cannot patch the engine's globals. It talks to Rust through one `Runtime.addBinding`. Rust
answers only a fixed set of message types (`init`, `cmpDetected`, `popupFound`, `optInResult`,
`evalReq`, `autoconsentDone`, `autoconsentError`) and drops the rest.

- `evalReq` asks Rust to evaluate a snippet **in that same page session**. That runs nothing the
  page could not already run in itself: no browser-session call, no file, nothing outside the
  page.
- The CMP name that reaches the project is filtered against the rule names shipped in the rules
  file. A page that forges a message cannot introduce a name.
- *Breaks when:* the page calls the binding itself and fakes `optInResult: true`. Rust records
  the click only when its own `optIn` request is pending, and the phase switch follows Rust's own
  step, not the page's claim.

### 5.3 The false Iubenda

`CONSENT_PROBE` is retired; detection is autoconsent's. Its Iubenda rule looks for the banner
element, not `window._iub`.

- *Breaks when:* a site shows only Iubenda's privacy-policy badge. `window._iub` exists and there
  is no banner. A fixture page with the badge alone must yield no CMP.

### 5.4 Recorded

`consent: { cmp: string | null, clicked: boolean, rule: 'cmp' | 'text' | null, ruleName: string,
matchedText: string, clickNavigated: boolean, reason?: string }`. `matchedText` is capped at 64
characters in the page. This replaces `consentMarkers`. An old project file that holds
`consentMarkers` still loads.

## 6. Which pages are visited (goal 5)

Score every same-origin link on the home page (up to the existing 500 read) by keywords in the
path and in the anchor text, Italian and English, **whole words only**:

| Purpose | Keywords |
|---|---|
| contacts | contatti, contatto, contattaci, contact, contacts, dove-siamo |
| careers | lavora-con-noi, carriere, careers, jobs, candidature, posizioni-aperte |
| shop | shop, negozio, store, carrello, cart, checkout, prodotti |
| booking | prenota, prenotazione, prenotazioni, booking, book, appuntamento, reservation |
| newsletter | newsletter, iscriviti, subscribe |
| account | login, accedi, registrati, area-riservata, account |

Take the best-scoring link per purpose first, then further matches, up to 12. If fewer than 12
match, fill with the first same-origin links in document order, as today. The home page is always
visited, and does not count toward the 12.

- *Breaks when:* `/facebook` contains "book". Matching is on word boundaries, where `-`, `_`, `/`
  and `.` count as boundaries, so `facebook` is one word and does not match `book`.
- *Breaks when:* a same-origin link redirects off-site. The final URL is checked after load. An
  off-site page is not probed and its hosts are not attributed to the scanned site's pages.
- *Breaks when:* the link is a PDF, a print view or a `mailto:`/`tel:` link. Skipped by extension
  and scheme before scoring.
- *Not done:* sitemap.xml. Add it if the re-measure shows key pages that exist but are not linked
  from the home page.

## 7. Collection points (goal 3)

The door model widens from "a page with a form" to five kinds. Classification is in `src/core`.
Rust only captures three things:

- **Forms**, as today, plus the **action host** of the enclosing `<form>` (host only, never the
  query).
- **Iframes:** the host plus the first path segment of each `src`, per page, capped at 32 per
  page.
- **Off-site links** whose path or anchor text matches the booking/newsletter/account keywords
  in §6: the destination host and the matched purpose. They are never visited.

| Kind | Rule in `src/core` | Breaks when |
|---|---|---|
| `form` | a page with ≥ 1 collecting field (today's rule) | a search box: one `type=search` field alone is not a door |
| `newsletter` | a form whose only collecting field is email, or whose action host is a mailing vendor (dictionary category `email-marketing`) | a login form with email + password is not a newsletter: password excludes it |
| `booking` | a form on a page scored `booking`, or an off-site booking link (door label "on simplebooking.it") | a "book" link to facebook.com is excluded by the word rule in §6 |
| `chat` | a host in dictionary category `chat` seen on any page | a chat vendor's script that only preloads is still a chat door; this is a stated over-count, not a guess about intent |
| `embed` | an iframe host in dictionary category `maps`, `video`, `captcha` or `payment` | a same-site iframe is not an embed door |

- **One door per (kind, provider).** A Google Maps embed on six pages is one door, listing the
  six pages. Forms stay one door per page, because each page's form is a different collection.
- A door whose destination is a third party (a form action host, an embed, an off-site booking
  link) also gets a flow from the door to that third party's place. This is how "the booking form
  sends data to Simplebooking" appears on the map.
- `CollectionPoint` gains `kind`, `provider?` (the place name) and `pages[]`. `page` is kept for
  old files. Existing door ids stay stable: the id rule that keeps a rescanned page's door colour
  holds for `form`.

## 8. Names (goal 2)

1. **Host plus path in the dictionary.** `vendors.json` keys can hold `host/first-segment`, e.g.
   `www.google.com/recaptcha` and `www.google.com/maps`. Rust reports up to 8 distinct first path
   segments per host (sliced to 32 chars in the page, filtered to `[a-z0-9-_]`). `identify` tries
   host+segment before host.
   - *Breaks when:* `google.com/search` or any unlisted path. It falls back to the host entry,
     and if that is also absent, "not yet identified". It is never guessed from the segment.
2. **Hand-curated additions**, each with owner, category and purpose group: `google.it`,
   reCAPTCHA, Maps, YouTube embeds, Italiaonline (`iol.it`, `italiaonline.it`, `paginegialle.it`),
   Duda (`cdn-website.com`, `multiscreensite.com`), Brevo (`sibautomation.com`, `brevo.com`,
   `sendinblue.com`), Trustindex, Elfsight, Simplebooking, Mapbox, Jimdo, Wix. Then the next
   most frequent unnamed hosts from the re-measure's `unnamed` list, until the target in §10 is
   met.
3. **Open Cookie Database, slimmed** to name, platform, category and wildcard flag (~25 KB gz).
   A cookie whose name matches a row names its platform. When that platform is already a place
   on the map, the cookie attaches to it. When it is not (a first-party cookie set by a vendor
   script), the cookie is listed in the panel under the platform's name, and **no new place is
   invented** from a cookie alone.
   - *Breaks when:* a generic name like `session` or `id`. Wildcard rows match only with their
     own prefix, and names shorter than 4 characters are never matched.
4. **Wrong names.** The baseline cannot measure purpose correctness. Until it can, "wrong" is
   covered by one rule: two entries for the same owner may not disagree on purpose group without
   a comment in the data explaining why. A unit test checks it over `vendors.json`.

## 9. What the user sees

- **Scan screen, one line, always visible before starting:** "The scan visits the site like a
  real visitor: third-party services on it receive the visit too." (The app's copy is English;
  the Italian meaning the user approved is "Lo scan visita il sito come un visitatore vero: anche
  i servizi di terzi ricevono la visita.")
- **Notice after the scan**, appended to today's: "12 third parties contacted on the home page
  before consent, 5 only after. Consent manager: Iubenda; accepted by the Iubenda rule." Or: "No
  consent was given: no banner was recognised." Or: "…accepted by matching the text 'Accetta
  tutti'." Copy stays neutral: never "violation", never "non-compliant".
- **Detail panel, per third party:** "Contacted before consent" or "Only after consent". Per
  door: its kind, its pages, and where it sends data.

## 10. Measures — what must move

Re-run `spike/scanner-baseline/` on the same `sites.tsv` into a new `DATA` directory. The
reference is itself a heuristic, so these are floors, not ground truth.

| Goal | Measure (`compare.json` field) | Baseline | Target |
|---|---|---|---|
| 1, 4 | third-party hosts seen, median per site (`recallAll`) | 0.35 | ≥ 0.80 |
| 1, 4 | pre-consent hosts missed, all sites (`scanMissPre`) | 305 | ≤ 60 |
| 4 | cookies at end, all sites (`cookiesScan` vs `cookiesFinal`) | 0 of 503 | ≥ 80% |
| 4 | cookies before consent (`cookiesPre`) matched | 0 of 271 | ≥ 80% |
| 1 | CMP recognised (`cmpScan` vs `cmpRef`) | 14 | ≥ 27 of 29, zero Iubenda from the badge alone |
| 4 | accept clicked (vs `acceptClicked`) | — | ≥ 38 of 41; on the 5 hand-checked sites, zero wrong clicks |
| 5 | key pages with a form missed (`pagesWithForms` vs `scanFormPages`) | 74 of 136 | ≤ 15, of which contacts ≤ 3 |
| 3 | sites with an embed door (vs `embeds`) | 0 | ≥ 90% of the 43 sites where the reference saw one |
| 2 | third-party organisations with a name (`orgsNamed / orgs`) | 67% | ≥ 85% |
| — | `SCAN_FAILED` without a stated cause | 4 of 55 | 0: each fixed, or failing with its stage named |
| — | scan time per site, p90 | ~1 min | ≤ 2 min |

`compare.mjs` gains the columns it lacks (phase per host, the click's rule, doors by kind). The
harness ships zero bytes, as now.

**The four failures** (`00`, `21`, `30`, `49`) are diagnosed first, with the `test-support`
`scan_trace`. A release build keeps the generic `SCAN_FAILED` for the renderer, but writes the
failing stage name (a fixed string, never page data) as one line to the local log file through
`log.rs`'s `write_crash_line`. It is never uploaded. The plan fixes the causes found; a cause that cannot
be fixed is recorded in the decision note with its site number.

## 11. Bytes added

| What | Size (gz) | Why |
|---|---|---|
| autoconsent engine, unmodified | 35 KB | executes the CMP rules; there is no rules-only path |
| autoconsent rules, unmodified | 56 KB (75 KB if compact is refused) | 844 CMPs recognised and accepted by name |
| Open Cookie Database, slimmed | ~25 KB | names vendors from cookie names |
| `vendors.json` additions | < 5 KB | the named gaps in §8 |
| code | small | no new crate and no new npm runtime dependency |

The total is ~120–140 KB on a ~2.3 MB app (+5–6%). It is measured at release, as each version
has been.

## 12. The map at two to three times the points

After this release the median scanned site has ~9 organisations and the p90 ~17 (reference
`orgs`), up from ~5. Purpose groups stay bounded (six dictionary groups plus "not yet
identified"), so the closed rings do not multiply. What grows is **members in one open ring**,
mostly Marketing, and **doors** on the inbound column. The open ring already collides at five
members (legibility note).

Declared limit, not the redesign:

- An open ring draws at most **6 members**. Beyond that it draws 5 and a "+N more" mark. The
  detail panel lists every member (`groupMembers` already feeds both).
- The door column draws at most **8 doors**. Beyond that it draws 7 and "+N more", and the panel
  lists all of them.
- Both caps are constants in `computeLayout`, which stays pure and deterministic. The
  black-and-white print keeps the same marks.
- *Breaks when:* a selected member or door is beyond the cap. The selection comes from the panel,
  and the "+N more" mark is highlighted, so a selection is never drawn nowhere.
- Label collisions between rings, fanning arrows and ring crowding stay as recorded in the
  legibility note, for the redesign.

## 13. Security

The proxy change and the autoconsent bridge are one security-auditor gate each, and the auditor
can block either.

- `admission::decide`: during a scan, any well-formed host on 80/443 is allowed. IP literals,
  bad ports, malformed authorities and "no scan running" stay denied, with their existing tests.
  `proxy.rs`'s resolved-address check (no loopback, private, link-local, CGNAT, and deny if any
  resolved address is bad) is now the main guard against reaching the user's network. Its tests
  must cover a public name that resolves to a private address.
  - *Breaks when:* the page loads a third party on port 8443. Still denied. The host is recorded
    as an attempt, and a gap is noted.
- `ledger_is_consistent` stops requiring every admitted host to be the scan target. It keeps
  `healthy && dropped == 0`, and every admitted entry must still pass `decide` with the scan's
  own rules.
- Third-party JavaScript now runs in the scan's throwaway Chrome profile. The profile is deleted
  as today, and nothing from it reaches the app except the sanitised observation.
- The user's IP address is visible to the third parties, which is the stated trade-off, and
  §9's line says it.

**Accepted risk (security gate, Task 3).** During a scan, Chrome also contacts Google services
the way any Chrome visitor's browser would: Safe Browsing through its privacy gateway (OHTTP), a
device check-in, and `accounts.google.com` / `www.google.com`. From these Google may learn, in
hashed form, that a Chrome instance visited the scanned site. It never receives the map or
anything the scan found. These hosts never appear in the scan's list of hosts the site contacted.

## 14. Units

| Unit | Where | Does one thing |
|---|---|---|
| admission | `admission.rs` | decides a connection; widened as in §13 |
| consent bridge | new `consent.rs` | injects autoconsent into an isolated world, relays the fixed messages, returns `consent` |
| page picker | `cdp.rs` (`pick_pages`, replacing `same_origin_links`) | scores and caps links; pure, unit-tested |
| probes | `cdp.rs` | forms+action host, iframes, off-site links, path segments; all `const`, capped in page and in Rust |
| phases | `cdp.rs` `Driver` | tags first-seen phase; two cookie snapshots |
| identify | `src/core/vendors.ts` | host+segment lookup |
| cookie naming | `src/core/cookies.ts` | Open Cookie Database lookup |
| doors | `src/core/doors.ts`, `scan.ts` | classify kinds, one per (kind, provider), flows to providers |
| layout caps | `src/core/layout.ts` | the §12 limits |

## 15. Testing

- Every rule in §§4–8 has a unit test built on its "breaks when" case: the blog "CONTINUA" link,
  `/facebook`, the badge-only Iubenda page, off-site booking, a search-box-only page, a login
  form, `google.com/search`, a `session` cookie.
- Rust probes and the consent bridge are tested against local fixture pages served by the
  existing egress test setup. No live site is used in `cargo test`.
- **Prove each test can fail:** break the rule, watch that test fail, restore by byte-copy,
  confirm with `git diff`, and say so in the commit.
- **The real fixture decides done:** §10's table, re-measured, is the acceptance. A green suite
  on its own is not.

## 16. Order of work

1. Diagnose the four `SCAN_FAILED` (it may change everything after it).
2. Cookie fix (§4.2): small, and it unlocks goal 4's cookie half.
3. Admission and ledger (§13): security gate.
4. Phases and the 8 s home wait (§4). Re-measure: goal 1 moves here.
5. Consent bridge (§5): security gate. Re-measure: CMP and click figures.
6. Page picker (§6). Re-measure: form pages.
7. Probes and doors (§7).
8. Names (§8). Re-measure: named share.
9. Map caps (§12), notices and panel copy (§9).
10. Final re-measure, bytes (§11), `THIRD-PARTY-LICENSES.md` and NOTICE, the `CLAUDE.md`
    network line, and the decision note with the new figures next to the baseline.
