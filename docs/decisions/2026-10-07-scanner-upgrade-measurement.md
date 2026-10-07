# Scanner upgrade — measured against the baseline

**Date:** 2026-10-07
**Scanner:** measured at 623cc50 (R5); Tasks 14 and 15 landed after (3aa2def, 710a27a).
**Judged against:** `docs/decisions/2026-09-29-scanner-baseline.md`, with the targets of spec §10
(`docs/design/2026-09-29-scanner-upgrade-design.md`).
**Method:** the same harness (`spike/scanner-baseline/`) on the same 55 sites, outside the repo
because the fixture names real organisations. Sites are named here by their number in `sites.tsv`,
never by name. The reference is itself a heuristic: these are floors, not ground truth.
This note replaces `2026-09-29-scanner-failures.md`, which it absorbs.

Result: every §10 line passes at R5 on the figures below, two of them after a gate was re-based
with the user (stated in section 2). Nothing here rounds a miss into a pass; where a number
differs from the spec's by a rounding or a re-basing, both are given.

## 1. Every §10 line

R1 = after Task 4, R2 = after Task 7 (R2b is the re-run after the fix), R3 = after Task 8 (R3b
after the review round), R4 = after Task 10, R5 = final, 2026-10-07, 55 sites, 55 both-ok, 0 scan
errors. "—" = that point did not gate or report the line.

| Measure | Baseline | R1 | R2 (R2b) | R3 (R3b) | R4 | R5 | Target | Pass / miss |
|---|---|---|---|---|---|---|---|---|
| Third-party hosts seen, median `recallAll` | 0.35 | 0.77 | 0.94 | 0.96 | 0.96 | 0.95 | ≥ 0.80 | pass |
| Pre-consent hosts missed, `scanMissPre` | 305 | 21 | 17 | — | — | 18 | ≤ 60 | pass |
| Cookies at end | 0 of 503 | 354 of 595 (59.5%) | 555 of 595 (93.3%) | 557 of 587 | 545 of 591 | 618 of 646 = 96% | ≥ 80% | pass (R1 missed; gate moved to R2, see section 3) |
| Cookies before consent | 0 of 271 | 302 of 317 (95.3%) | — | — | — | 331 of 342 = 97% | ≥ 80% | pass |
| CMP recognised | 14 sites | — | 33 of 33 | — | — | 34 of the reference's 34; the scanner names 5 more the reference does not (07, 08, 18 PrimeBox CookieBar; 14 ckies; 44 ct-ultimate-gdpr); badge sites 02 and 32: none; 14: a real `ckies` banner | ≥ 27 of 29, no Iubenda from the badge | pass |
| Accept clicked | — | — | 42 of 45 (93.3%) | 42 | 41 | 42 of the reference's 45 = 93% | ≥ 38 of 41 = 93% | pass (misses below) |
| Key pages with a form missed | 74 of 136 | — | — | 50 of 153 (R3); 38 of 144 (R3b); holding a field seen nowhere: 10 (R3b) | holding a field seen nowhere: 13 (plain 42 of 143) | holding a field seen nowhere: 11 (10 on site 38, 1 on site 13); plain count 39 of 148 | ≤ 15 (re-based 2026-10-07, section 2) | pass on the re-based gate; plain count not met |
| — of which contact pages | 17 | — | — | 1 (R3); 0 (R3b) | 1 | 0 | ≤ 3 | pass |
| Sites with an embed door | 0 | — | — | — | 35 of 43 as reported; the true figure was 32 of 43 | 32 of the 34 where the reference saw a maps/video/captcha/payments iframe = 94%; 33 of the 44 where it saw any third-party iframe = 75% | ≥ 90% (re-based 2026-10-07, section 2) | pass on the re-based gate; 75% on the any-iframe count |
| Third-party organisations with a name | 323 of 479 (67%) | — | — | — | 498 of 541 = 92% | 528 of 579 = 91% | ≥ 85% | pass |
| `SCAN_FAILED` without a stated cause | 4 of 55 | 0 | 0 | 0 after one re-run | — | 0 of 55 | 0 | pass |
| Scan time p90 | ~1 min | 53.7 s | 64.6 s | 83 s (R3); 78 s (R3b) | 77 s | 82.2 s on the first pass (max 104.8 s) | ≤ 2 min | pass |

Accept clicked at R5, in detail. Misses: 20 (the button is outside any consent container, refused
by rule), 35 (a banner with only "Ok" and no policy link, refused by rule), 46 (CookieYes,
`click-failed` at R2b, R4 and R5). Hand-checked: 10 (Moove) and 39 (cookie-law-info) were clicked
by a CMP rule; 17 and 35: no click. Zero wrong clicks.

Reported at R3: "accept clicked 42" and cookies at end 557 of 587 are from the failures note's
R3 summary, which does not say which of the two passes they belong to.

## 2. How R5 was run, honestly

- **First pass:** 8 scans came back "thin" (home page only, about 3 requests, about 21 s) and 1
  reference run failed. Cause: this machine's DNS (the router's resolver) failing intermittently;
  `curl` and `dig` answered "could not resolve host" for the same names at the same moments. Not
  the scanner. Each thin site was re-run alone once DNS answered; site 22 needed four attempts.
  Site 53 stays at one page: it redirects off-site, a real result. p90 is read from the first pass
  (the re-runs rewrite `meta.json`). The thin results looked like normal results; that defect is
  Task 14 (section 6).
- **Two gates were re-based with the user, never silently.**
  - Form pages (R3, 2026-10-07): explained in section 3.
  - Embed doors (2026-10-07): the reference counts any third-party iframe; spec §7 calls an iframe
    a door only for maps, video, captcha and payments. Of the 11 reference sites without a door at
    R4: 5 had only the consent manager's own frame (Cookiebot), 2 Wix platform frames, 1 a Facebook
    plugin, 1 a tourism widget. `compare.mjs` had also divided the wrong sets (35 of 43 reported at
    R4; the true figure was 32 of 43, and 31 of 33 on the re-based gate). Both counts are reported
    from now on.
- **The two real embed misses** (24: reCAPTCHA; 25: a map; both on a visited contact page): iframes
  that load only on scroll. The reference scrolls to the bottom; the scanner never scrolls (the only
  interaction is one consent click). Stated limit.

## 3. The four failures, and what each re-measure found

Sites 00, 21, 30, 49 returned `SCAN_FAILED` on the baseline. Each was scanned twice with the harness
built with `test-support`, so `scan_trace` printed the failing stage. Both runs of every site gave
the same line:

| Site | Stage | Detail | Time to fail |
|---|---|---|---|
| 00 | `observe` | `Timeout("Network.enable")` | ~32 s |
| 21 | `observe` | `Timeout("Network.enable")` | ~31 s |
| 30 | `observe` | `Timeout("Network.enable")` | ~31 s |
| 49 | `observe` | `Timeout("Network.enable")` | ~33 s |

One cause, not four, and not a flake: identical on both runs.

**Cause.** All four sites register a service worker. A temporary trace of every
`Target.attachedToTarget` (site 00) showed the same service-worker target attached twice, on two
sessions: once by the browser-level auto-attach, once by the page session's own
`Target.setAutoAttach` (step 3 of `arming_sequence`), both with `waitForDebuggerOnStart`. Chrome
keeps the worker paused until every session that paused it has sent
`Runtime.runIfWaitingForDebugger`, and a worker that has not started answers no command. The driver
keeps one command in flight: it sent `Network.enable` on the first session and waited, while the
second session sat in `pending_attach`, never resumed. Deadlock until the 30 s `COMMAND_TIMEOUT`,
and a timeout during arming is a transport failure, so the whole scan failed.

Evidence, in order:

1. Trace of the failing arm: `type=service_worker`, `waiting=true`, `Timeout("Network.enable")` on
   all four sites.
2. Sending the resume first on a service worker did not help: `Runtime.runIfWaitingForDebugger`
   itself timed out, so the target was held by someone else.
3. The attach trace showed the same target id on two sessions, the second arriving while the first
   was being armed.
4. Excluding `service_worker` from the page-session auto-attach only (filter
   `[{type: service_worker, exclude: true}, {}]`; the browser-level attach is unchanged and still
   attaches every worker): all four sites completed, with 8 to 10 hosts and 3 to 10 pages, in 11 to
   45 s.

**Fix (Task 1).** Session-level `Target.setAutoAttach` carries the service-worker exclusion filter;
the browser-level call does not. Regression test in `cdp.rs` (FakeTransport): the session-level
params exclude service workers, the browser-level ones do not. Verified live on the four sites
(11, 25, 33 and 55 s) and counted again at R1. Nothing is lost from the map: a service worker is a
browser-level target, so it is still attached, armed and observed once, by the browser session.

**Stated limit.** Any single target that never answers an arming command still fails the whole scan
after 30 s, because a timeout is treated as the browser having stopped talking. The four fixture
failures no longer hit it. Site 14 failed once at `observe` (`Timeout("Network.enable")`) at R2 and
scanned cleanly on three re-runs. A failure now carries its stage in the local log.

### R1 (after Task 4, 2026-09-29)

Reference pass reused from the baseline (as the plan allows for R1 to R3). Scanner at 72757e0.

| Gate (plan R1) | Target | Result | |
|---|---|---|---|
| Cookies matched at end | ≥ 80% of 595 | 354 (59.5%) | **miss** |
| Cookies matched before consent | ≥ 80% of 317 | 302 (95.3%) | pass |
| Pre-consent hosts missed | ≤ 60 | 21 (baseline 305) | pass |
| `SCAN_FAILED` without a named stage | 0 | 0 (scan errors 0 of 55) | pass |
| Scan p90 | ≤ 120,000 ms | 53,655 ms | pass |
| `recallAll` (reported) | expected ≥ 0.6 | 0.77 | — |

Sites 00, 21, 30, 49: all four scanned.

**Why the end-cookie gate missed.** Of the 241 reference end cookies the scanner did not see, 229
appear in the reference only after its accept click; 12 were present before consent. Without a click
(Task 6 adds it) the reachable ceiling is 366 of 595 (61.5%); the scanner had 354 of those 366
(96.7%). The gate was unreachable at R1 by construction. Decided with the user (2026-09-29): the
end-cookie gate moves from R1 to R2, after the click.

### R2 (after Task 7, 2026-09-30)

First run (built at 5818f56) missed the accept gate: 30 of the 45 sites the reference accepted.
Twelve were Cookiebot. The engine's built-in Cookiebot `optIn` clicks two legacy button ids and
reports success whether or not they exist, so the `opt_in_clicks` guard (Task 6) correctly refuses
it; the text fallback then missed the dialog, because `#CybotCookiebotDialog` is camelCase and a
centred modal. Fixed in Task 7 (94dd93f): the container word test splits camelCase and matches at a
word start.

Second run (`R2b`, built at 94dd93f):

| Gate (plan R2) | Target | Result | |
|---|---|---|---|
| Cookies matched at end (moved from R1) | ≥ 80% of 595 | 555 (93.3%) | pass |
| CMP detected on the reference's CMP sites | ≥ 27 of 29 | 33 of 33 | pass |
| No Iubenda from the badge (02, 14, 32) | none | 02 and 32 none; 14 shows a real `ckies` banner the reference also accepted | pass |
| Accept clicked | ≥ 38 of 41 | 42 of 45 (93.3%) | pass |
| Wrong clicks, hand-checked sites | 0 | 0 | pass |
| Median `recallAll` | ≥ 0.80 | 0.94 | pass |

Also: scan errors 0 of 55; p90 64,629 ms; pre-consent hosts missed 17.

The five hand-checked sites could not be identified with certainty from the earlier session, so all
seven candidates were checked (02, 10, 14, 17, 32, 35, 39), plus the two clicks the reference did
not make (44, 53):

- 10 clicks "Accetta" in the Moove cookie bar; 39 clicks "Accept" in the cookie-law-info bar; the
  blog "CONTINUA" link is no longer touched.
- 02, 32: no CMP, no click. 17: no click.
- 35: a real cookie bar (fixed, bottom) whose only control is "Ok" and which has no policy link, so
  the weak-label rule does not click it. Correct by the rule, but its reason `no-banner` overstates;
  the on-screen copy says "no consent banner was recognised".
- 44: a real `ct-ultimate-gdpr` popup with "OK"; the reference missed it. 53: "Accetta tutti"
  inside the cookie-policy wrapper; the click reloads the page, recorded as `clickNavigated`.
- All 19 text clicks matched a strong label ("accept", "accetta tutti", and so on); none used a
  weak one.

Not clicked: 20 (the reference's button was outside the banner, a correct refusal), 35 (above), 46
(CookieYes "Accetta tutti i cookies": the label is outside the vocabulary and the rule is refused by
the guard).

### R3 (after Task 8, 2026-10-07)

Two passes on the 55 sites, reference reused: R3 (commit 2151dc6) and R3b (commit aef7b82, after
the review round).

| Gate | Target | R3 | R3b |
|---|---|---|---|
| contact pages with a form missed | ≤ 3 | 1 | **0** |
| scan time p90 | ≤ 2 min | 83 s | **78 s** |
| key pages with a form missed | ≤ 15 | 50 of 153 | 38 of 144 |
| of which hold a field seen nowhere on the site | ≤ 15 (gate from 2026-10-07) | — | **10** |

Reported: median `recallAll` 0.96, cookies at end 557 of 587, accept clicked 42, no `SCAN_FAILED`
after one re-run (site 28 timed out once on `Page.navigate` in the observe stage, then scanned in
54 s; a key page that hangs still failed the whole scan, which is Task 14).

What R3 found:

- A real defect: the scan-wide cap of 256 form fields ran out after five to seven pages on four
  shops (12, 13, 49, 51), so later key pages, though visited, returned no fields. The cap is now 64
  per page x 13 pages.
- Two measuring errors in `compare.mjs`: the reference lists the same page with and without a
  trailing slash, and both sides were cut at 40 characters. Paths are now normalised.
- The rest is a difference of choice, not a loss. The reference takes the first twelve links whose
  address or text starts with one of its words, which include `privacy`, `cookie`, `prodott`,
  `iscri`. The picker follows spec §6. On a site with forty product pages each visits a different
  dozen, all carrying the same form. Of the 38 pages still "missed", 28 hold only fields the scan
  captured elsewhere on the same site; the other 10 are course pages of one site (38) with the
  job-application form already captured, differing by one checkbox name.

**Decided with the user (2026-10-07).** The gate "key pages with a form missed <= 15" cannot be met
without making the picker copy the reference's words and order. The gate now counts only missed
pages holding at least one visible field the scan saw nowhere on that site
(`formPagesMissedUnseen` in `compare.json`), same thresholds. The plain count stays printed beside
it, and it is not met (39 of 148 at R5).

**Accepted with Task 8's audit.** A key link that leaves the site is not probed and everything that
visit contacted is rolled back, with one gap note per page; cookies such a page set stay in the jar.
Pages not linked from the home page are not reached (`sitemap.xml` is the spec's follow-up).

### R4 (after Task 10, 2026-10-07)

Fresh reference (it records first path segments), scanner at 66b1341; naming computed by
`compare.mjs` against the dictionary at aa52370.

| Gate | Target | R4 |
|---|---|---|
| third-party organisations with a name | ≥ 85% (baseline 67%) | **498 of 541 = 92%** |

Reported: median `recallAll` 0.96; cookies at end 545 of 591; accept clicked 41; contacts missed
1; form pages with a field seen nowhere 13 (plain count 42 of 143); p90 77 s; sites with an embed
door 35 of 43 = 81% as `compare.mjs` printed it (the true figure was 32 of 43, section 2).

Left unnamed on purpose: Elfsight and WonderPush (no fitting category in the dictionary: widgets,
push), and a tail of hosts seen once.

R4's first pass had 14 sites come back as a home page with three requests and nothing else (about
21 s each). Re-run alone, ten scanned normally; the rest recovered over two more tries except two
(50 and 53). The cause is outside the scanner: name resolution on the measuring machine failed
intermittently. The first pass is kept in `summary.run1.txt` and `run1-short/`. It exposed a
product gap older than this work: when the home page does not load, the scan still returned a
normal-looking result. That is Task 14.

## 4. Decisions and refinements along the way

- **Compact versus full autoconsent rules.** `compact-rules.json` carries no opt-in click steps
  (0 of 844), so the engine would claim an accept without clicking. `rules.json` shipped instead
  (+18.5 KB gz over compact), with the Rust guard that counts a click only when the rule really
  clicks.
- **Cookie names** (refinement of spec §8.3, decided with the user 2026-09-29 at plan approval):
  exact names match from 3 characters (so `_ga` is recognised), wildcard prefixes from 4; `id` is
  still refused; `session` is excluded by the stoplist.
- **Owners entered from the maintainer's knowledge, confirmed by the user 2026-10-07:** Italiaonline
  (`iol.it`, `italiaonline.it`, `paginegialle.it`), Duda (`dwhitelabel.com`), Jimdo (`jimcdn.com`,
  `jimdo.systems`), Tripadvisor (`tripadvisor.*`, `tacdn.com`, `jscache.com`), Google
  (`maps.gstatic.com`, `ggpht.com`, `googleusercontent.com`, `googlevideo.com`). `evnt.iol.it` lost
  the "analytics" purpose guessed from its name. Elfsight and WonderPush stay unnamed (no category).
- **Path segments longer than 32 characters are dropped, not sliced** (stricter than the plan).

## 5. Security verdicts

- Task 2: PASS.
- Task 3 (proxy admission): gate BLOCK, then PASS. Found: NAT64 addresses unchecked; search-domain
  expansion of single-label names.
- Task 4: IPC PASS.
- Tasks 5 and 6 (autoconsent bridge): gate PASS.
- Task 8: IPC PASS.
- Task 9: IPC PASS.
- Task 10: PASS.
- Task 14: PASS. One Important fixed: a failed navigation no longer erases what the live page
  contacted.
- Task 15: gate BLOCK, then PASS on the second round (the download policy lapsed
  between connection close and kill; download directory now seeded inside the throw-away profile).

**Accepted risks, in plain terms.**

- Chrome's own traffic to `www.gstatic.com`, `accounts.google.com` and `www.google.com` still
  leaves during a scan, because real sites use them; Google may learn, in hashed form, that a Chrome
  instance visited the scanned site, and never receives the map or anything the scan found.
  `safebrowsingohttpgateway.googleapis.com`, `android.clients.google.com` and
  `update.googleapis.com` are now refused.
- The Edge fallback's own service hosts are neither listed nor observed.
- A page that itself requests one of the three refused Chrome service names is logged as browser
  service traffic, not as the site's.
- Whether Edge on Windows honours the seeded download directory is unverified; the download policy
  set over the debugging connection is the primary control.
- The user's IP address is visible to every third party the scanned site loads (spec §9 says so on
  screen).
- A hostile page's console flooding is not rate-limited (Task 6, S-I3), and Task 6's S-M3 is
  accepted likewise.
- The autoconsent bridge binds an event to its page only by the page session and the context id,
  because `chromiumoxide` reports `session_id` as `None` on real events; own event type proposed as
  a follow-up.
- An unanswered text click is read as blank (nothing claimed). A hostile page could click, then
  return an off-vocabulary label, and the phase would reset to "before" (Task 7 limit).
- Cookies set by a key page that left the site and was rolled back stay in the jar and are shown as
  after-consent; what such a page contacted is hidden behind one gap note per page (Task 8).
- A scanned site can make the map show a third party it never contacted (a form action or a booking
  link becomes a place marked observed): the site can misdescribe itself on the user's own map;
  nothing leaves the machine (Task 9).
- First path segments (lowercase slugs of at most 32 characters) are persisted in the project file
  as name hints (Task 10).
- A home page whose redirect chain ends in a 204, a download or too many redirects reads as "did not
  load" and its hosts are dropped, with one sentence on screen and a gap (Task 14).
- A browser that is connected but hung returns a result with cookies marked as a gap after about 60
  s (Task 14).

## 6. Follow-up tasks done after R5 (Tasks 14 and 15)

Found by the re-measures and audits; decided with the user 2026-10-07 to run before closing.

- **Task 14:** a page that did not load is said so (one sentence on screen, nothing added to the
  project). A key page that does not load, or whose navigation times out, is a gap, not a failed
  scan; a timeout stops the walk. Signal: `Page.navigate`'s `errorText`, with the proxy's ledger
  deciding between a site's own error status and a host the proxy never reached.
- **Task 15:** downloads are refused (CDP policy plus a download directory inside the throw-away
  profile; the break-and-watch showed that without them Chrome wrote the fixture file into the
  user's Downloads folder). Installers and archives are never a key page. Three Chrome service hosts
  are refused by exact name. The egress test that was red on this machine (Chrome's updater) is
  green.
- These landed after R5. They were checked by their own tests and by a spot re-scan of ten sites
  plus a non-existent address: seven of the ten sites could be scanned with the final code (05, 10,
  13, 28, 38, 46, 53) and agree with R5 — same pages visited, cookies, fields and click on each;
  hosts within ±3; site 46 now reads `no-button` instead of `click-failed`, as the final review
  asked. Sites 00, 22 and 24 did not resolve on this machine during the check (the same DNS fault as
  in §2) and were not compared. The non-existent https address, and every site while it did not
  resolve, returned in about 10 s with zero pages, no hosts, a blank consent record and one gap —
  the HTTPS path of Task 14, which no local test exercises, seen live. Site 13's gap count moved
  between 0 and 9 over five runs of the same build (it carries about 30 frames; a frame that
  attaches late is a counted gap), so a gap count is not comparable run to run. No file reached the
  Downloads folder. R5 itself was not re-run.

## 6b. The final whole-branch review (2026-10-07)

One review of the whole range (`e0c2bd9..be836ba`) on the most capable model, pointed at the
ledger's deferred minors. No Critical finding; none of the deferred minors had to be fixed before
merge. It found three places, invisible to any per-task review, where the app could say an untrue
thing about consent. All three were fixed in one wave (`d03ad79`, `47ba2e2`), re-reviewed and
audited (PASS):

- **A rescan kept the old consent phase.** For a service already in the project only the request
  count was refreshed, so a tracker first recorded "before consent" — every observation in a v0.3
  project — kept that label after a rescan saw it only after the accept click. The latest scan now
  wins, blank included.
- **"The click did not complete" when no click was tried.** A consent manager whose rule the click
  guard refuses, with no label to press, is now `no-button` (site 46).
- **An unknown click outcome was shown as "before consent" and "No consent was given".** When a
  click was sent and never answered, the phase of everything since the attempt is now blank (host
  and cookie phase omitted, reason blank) and the notice says "Whether consent was given could not
  be established." Services seen before the attempt stay "before".

The same wave fixed the doc comments later tasks had left stale, capped the matched label at 64 in
the renderer as in Rust, removed the profile on a failed Preferences seed, and pinned the seed call
with a test.

Left open by ruling (one fix wave, no second), both small and neither load-bearing — the first two
entries of §10:

- the opt-in budget running out blanks the phases without counting a gap;
- a text click that answers "clicked" with a label outside the fixed vocabulary still reads as "not
  clicked, before" (unreachable unless the isolated world is compromised).

Accepted limits from the same review: when the consent engine answers "failed" after the first
click of a multi-step rule has landed, the result is "click failed" and "before"; a page can stall
the consent engine for its 10 s budget and so blank the phase of what loads afterwards (information
is lost; services seen before the attempt are untouched).

## 7. Known limits

- Before-consent is measured on the home page only.
- CMPs inside iframes are not driven (the engine runs in the top frame).
- The chat door over-counts: a vendor script that only preloads is a door.
- The sitemap is not read; pages not linked from the home page are not reached.
- R1 to R3 reused the baseline's reference (live-site drift of days, accepted); R4 and R5 used a
  fresh one.
- Lazy iframes need a scroll the scanner never makes (2 of 34 sites: 24, 25).
- CookieYes on site 46 is detected but its click fails.
- A banner whose only button is "Ok" with no policy link is not clicked (site 35) and reads as "no
  consent banner was recognised"; a button outside any consent container is not clicked (site 20).
- `_fbp` and similar cookies attach to a place only when the place name equals the platform name;
  otherwise they are listed under the platform.
- A home whose redirect chain ends in a download or a 204 reads as "did not load".
- A single target that never answers an arming command still fails the scan after 30 s.
- The reference is itself a heuristic: these are floors, not ground truth.

**Deferred minors from the ledger**, one line each, grouped. "Fixed" marks the ones a later task
closed, where the ledger says so; the rest are open.

Transport and scan driver (Tasks 1, 4, 5)

- Task 1: `LOG_DIR` `OnceLock` wiring untested; a cancelled scan may log "observe"; the regression
  test covers the top-page session only. The typed filter was re-verified live on the four sites
  (fixed).
- Task 4: M2, `HOME_WAIT` placement untested (R1 covers it); N1, `compare.mjs` read a missing cookie
  phase as "before", inflating pre-consent from R2 (fixed: it reads "unknown"; the same for a host
  phase since the final review); N2, `types.ts:195` comment (accurate today); M5 `dead_code`
  attributes (removed with Task 6).
- Task 5: `Runtime.enable` never disabled; raw rule names in the old notice (until Task 6); vendor
  CRLF on Windows; context-filter unit test missing.
- Task 6: M1 queued `optInResult` before opt-in counts; M2 reload untested; 50 generated rule names
  contain `+`, which `known_cmp` rejected (carried to Task 7); matched-text cap 128 in Rust.

Proxy and admission (Tasks 2, 3)

- Task 2: `connector()` knew only `(host, 80)` (Task 3 extended it); `request_path` keeps the query
  string; crate-wide `allow(dead_code)` in the test `common` module; no HttpOnly/session cookie
  test; `rustfmt` not installed; `Storage.getCookies` has no `browserContextId` (wrong context if a
  separate browser context is ever opened); the test fixture server reads without a size or time
  limit.
- Task 3: M1 non-canonical IPv4 forms pass `decide` as names; M2 the ledger records "allowed"
  before the address check; M3 the resolver has no timeout; M4 the NAT64 connector test dials once
  on a broken build; M5 `lookup_name` test does not prove `system_resolver` uses it. The
  recommended denial of `safebrowsingohttpgateway.googleapis.com` and `android.clients.google.com`
  was done in Task 15 (fixed).

Click and consent (Tasks 6, 7)

- Task 7: no test for the weak-label policy-link rule; the 65-character case adds nothing.

Pages and collection points (Tasks 8, 9)

- Task 8: bridge `isVisitedPage` has no Vitest case; an unreadable navigation history is treated as
  on-site; `VisitedPage.page` is the link, not the landed URL; rollback drops in-flight home
  requests; an uncommitted navigation re-attributes the previous document's fields (pre-existing);
  check-then-probe gap; links JSON parsed before the Rust cap (memory only); the history/off-site
  branches and per-page gap keys have no test; `FORM_PROBE` hardcodes 64 apart from
  `FIELDS_PER_PAGE`. "No download policy set, exe/dmg not skipped" was fixed by Task 15.
- Task 9: the Rust `offsite_links` treats the apex of a `www` entry as off-site (the TypeScript
  `isSameSite` filters it); off-site links are not read on a one-page scan; provider-less
  newsletter/booking doors merge under the key `kind|` across pages; a non-form door's key uses the
  place name (a vendor rename makes a new id); newsletter and account off-site links are captured,
  not classified; `IframeSeen.segment` crossed IPC unused until Task 10; the iframe and links probes'
  in-page caps rely on overridable `Array` methods (memory only); no boundary test for exactly 13
  pages or 2048 characters.

Names (Task 10)

- The 8-segment cap keeps the first seen (tokens can crowd out names); no break-and-watch for the
  8-segment cap, the stoplist or `isPaths`; the Google note string repeats; the `iol.it` purposes
  rest on the maintainer's judgement; the maps assertion in `vendors.test` uses `not.toBe('ads')`
  on null (should be `toBeNull`); the segment regex is duplicated in Rust, `validateProject` and
  the vendors key test.

Map and screens (Tasks 11, 12)

- Task 11: highlight weight in print; the "+N more" label is built in core; `at()` computed twice;
  a hidden selection is not isolation-dimmed (accepted, spec §12); renderer tests walk `MapView` as
  a plain function (breaks if it gains hooks).
- Task 12: the scan-visitor line has no CSS (judged at the show-it step; the layout was fixed in
  cb996f2); stale comment at `scan.ts:199` (fixed by the final review's wave); no test pins severity 2 for the unknown-phase
  contradiction gap; the notice door count could exceed the map if two candidates share a kind and
  provider name (untraced); no notice test with a vendor dictionary and a non-form door; the
  scan-visitor test pins source order only.

Page-did-not-load (Task 14)

- An empty-bodied 404 home carries one pre-existing gap (the storage probe throws on Chrome's error
  document); `history.push` ignores a same-object push for every caller; the 404 test pins
  `possible_gaps == 1` to that defect (assert on the gap key instead); after a reload that draws an
  error page the walk still reads links from it (wasted work); the unreachable-home real-Chrome host
  assertion is vacuous on an empty list (the unit test covers it); `lastScan` records `possibleGaps`
  1 beside the single sentence.

Downloads and service hosts (Task 15)

- The real-Chrome download test reads `$HOME/Downloads` (meaningful on macOS only; vacuous elsewhere
  and panics if `HOME` is unset; a `USERPROFILE` fallback was added in the fix round); `possible_gaps
  >= 1` is loose; the egress denied-half is conditional and its assertions are vacuous when the host
  is never attempted; the name `KNOWN_DENIED_BROWSER_SERVICE_HOSTS` is now misleading (3 admitted,
  3 denied); removing only the seed call from launch failed no test (pinned by the final review's wave); a seed failure left an
  empty profile dir and made the comment at `scan.rs:424` false (fixed by the same wave; untested); a non-UTF-8 profile path panics in
  `json!` (fails closed); the `egress.rs` module header carried the old wording (fixed).

## 8. Bytes

Measured 2026-10-07 on macOS aarch64 with `npm run tauri build`, v0.3.0 (tag) and this branch
(`4939655`) built on the same machine, one after the other. The published v0.3.0 `.dmg` is a
universal build (5,414,002 bytes) and is not the comparison.

| Artefact | v0.3.0 | this branch | Delta |
|---|---|---|---|
| macOS `.dmg`, aarch64 | 2,762,251 | 2,948,209 | **+185,958 (+6.7%)** |
| release binary, aarch64 | 4,822,560 | 5,797,296 | +974,736 (+20.2%) |

Spec §11 expected +120–140 KB (+5–6%). The `.dmg` grew by 186 KB: **above the estimate**. The data
files account for 128 KB of it at `gzip -9`; the rest is code (the consent bridge, the page picker,
the probes, the phases) and the `.dmg`'s own compression of the same files.

| §11 item | Estimate (gz) | Measured (`gzip -9`) |
|---|---|---|
| autoconsent engine, unmodified (`autoconsent.playwright.js`, 142,886 raw) | 35 KB | 35,292 |
| autoconsent rules, unmodified (`rules.json`, 719,973 raw — the full file; compact was refused, §4) | 56 KB, 75 KB if compact is refused | 73,823 |
| Open Cookie Database, slimmed (`cookie-platforms.json`, 96,185 raw) | ~25 KB | 18,515 |
| `vendors.json` additions (34,720 raw; 2,602 → 3,280 gz) | < 5 KB | 678 |
| code | small | not separated |
| **data total** | | **128,308** |

No new crate and no new npm runtime dependency. Windows: to be read from the `report the shipped
size` step of `bundle (windows-latest)` on this branch's CI run once it is pushed. Not estimated
here.

## 9. Test counts at the end

At `4939655` (2026-10-07), each suite run on that tree:

| Suite | At the branch point (`e0c2bd9`) | At the end |
|---|---|---|
| Rust unit (`cargo test --lib`) | 234 | **295** |
| Rust `scan_pages` (real Chrome, local fixtures) | — (created by Task 2) | **15** |
| Rust `egress` (real Chrome) | 8 integration in all, 1 ignored | **5** + 1 ignored |
| `tests/core` | 366 | **413** |
| all Vitest | 520 (515 passed + 5 skipped) | **597 passed** with `dist/` built (594 + 5 skipped without it: the bundle checks need a build) |

`cargo clippy --all-targets -- -D warnings` and `npm run typecheck` are clean. The egress test
`the_browsers_own_background_traffic_never_becomes_a_site_host`, red on this machine since before
batch 3 (Chrome's updater), is green since Task 15.

`tests/core` by task: 366 at the branch point; 368 after batch 2 (phases); 380 after batch 3
(doors); 406 after batch 4 (names +11 and +3, map caps +9, notices +1, two live-app fixes +2);
409 after Task 14 (a scan that saw no page adds nothing; history); 413 after the final review
(rescan phase).

## 10. Follow-ups, in order

Not done here; each is small. From the final review's triage and the audits:

1. Count a gap when the opt-in budget runs out (`consent:timeout`).
2. A text click answering "clicked" with an off-vocabulary label → unknown, not "before".
3. When the consent engine answers "failed", treat the phase as unknown rather than "before".
4. The seed-failure path and a non-UTF-8 profile path in `browser::launch` (tests).
5. Remove what only tests feed: `consentMarkers` and the v0.3-payload paths; the cookie phase the
   renderer never reads (or show it).
6. One shared source for the caps Rust and TypeScript both hold (13 pages, 12 visited, 416
   iframes, 64 characters, the segment pattern in three places).
7. `removePlace` would leave a door's `destination` dangling (no caller yet).
8. Read the session id on CDP events (own event type), so the consent binding is filtered by
   session.
9. Tests: weak label without a policy link is not clicked; `HOME_WAIT` placement; HttpOnly and
   session cookies; history and off-site branches of the page walk; the 13-page boundary.
10. Rename `KNOWN_DENIED_BROWSER_SERVICE_HOSTS`; a `.gitattributes` rule so the vendored files are
    not rewritten with CRLF on Windows.
11. Scroll before probing, if lazy iframes turn out to matter (2 of 34 sites) — reopens the "one
    interaction" rule, so it is a spec decision, not a patch.
12. Edge as the fallback browser: list and observe its own service hosts.
