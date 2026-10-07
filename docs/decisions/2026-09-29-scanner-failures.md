# The four `SCAN_FAILED` on the baseline fixture — working note

Plan Task 1 (scanner upgrade). Sites are named by their number in
`~/Documents/Claude/traccia-fixtures/scanner-baseline-2026-09-29-v2/sites.tsv`, never by name.
Task 13 folds this into the final note.

## What failed, and where

Each site was scanned twice with the harness built with `test-support`, so `scan_trace` printed
the failing stage. Both runs of every site gave the same line:

| Site | Stage | Detail | Time to fail |
|---|---|---|---|
| 00 | `observe` | `Timeout("Network.enable")` | ~32 s |
| 21 | `observe` | `Timeout("Network.enable")` | ~31 s |
| 30 | `observe` | `Timeout("Network.enable")` | ~31 s |
| 49 | `observe` | `Timeout("Network.enable")` | ~33 s |

One cause, not four. Not a flake: identical on both runs.

## Cause

All four sites register a **service worker**. A temporary trace of every `Target.attachedToTarget`
(site 00) showed the same service-worker target attached **twice**, on two sessions: once by the
browser-level auto-attach, and once by the page session's own `Target.setAutoAttach` (step 3 of
`arming_sequence`), both with `waitForDebuggerOnStart`.

Chrome keeps the worker paused until *every* session that paused it has sent
`Runtime.runIfWaitingForDebugger`, and a worker that has not started answers no command. The driver
keeps one command in flight: it sent `Network.enable` on the first session and waited for the
answer, while the second session sat in `pending_attach`, never resumed. Deadlock until the 30 s
`COMMAND_TIMEOUT`, and a timeout during arming is a transport failure, so the whole scan failed.

Evidence, in order:

1. Trace of the failing arm: `type=service_worker`, `waiting=true`, `Timeout("Network.enable")` on
   all four sites.
2. Sending the resume first on a service worker did not help: `Runtime.runIfWaitingForDebugger`
   itself timed out — so the session was not merely slow to arm, the target was held by someone else.
3. The attach trace showed the same target id on two sessions, the second arriving while the first
   was being armed.
4. Excluding `service_worker` from the **page-session** auto-attach only (filter
   `[{type: service_worker, exclude: true}, {}]`; the browser-level attach is unchanged and still
   attaches every worker, as the trace shows): all four sites completed — 8 to 10 hosts, 3 to 10
   pages, in 11 to 45 s.

## Fix and owner

- **Fixed in Task 1.** Session-level `Target.setAutoAttach` carries the service-worker exclusion
  filter; the browser-level call does not. Regression test in `cdp.rs` (FakeTransport): the
  session-level params exclude service workers, the browser-level ones do not. Verified live on the
  four sites; counted again at R1.
- Nothing is lost from the map: a service worker is a browser-level target, so it is still attached,
  armed and observed once — by the browser session.

## Stated limit (not fixed here)

Any single target that never answers an arming command still fails the whole scan after 30 s,
because a timeout is treated as the browser having stopped talking. The four fixture failures no
longer hit it. If R1 shows a `SCAN_FAILED` at `observe` again, this is the first place to look; it
now has its stage in the local log.

## R1 (after Task 4, 2026-09-29)

Data dir `scanner-upgrade-R1-2026-09-29`, reference pass reused from v2 (as the plan allows for
R1–R3). Scanner built at 72757e0; the Task 4 fix round (224c0e2) only changes the cookie phase when
snapshot 1 fails *and* a consent attempt succeeded, which cannot happen before Task 6 clicks.

| Gate (plan R1) | Target | Result | |
|---|---|---|---|
| Cookies matched at end | ≥ 80% of 595 | 354 (59.5%) | **miss** |
| Cookies matched before consent | ≥ 80% of 317 | 302 (95.3%) | pass |
| Pre-consent hosts missed | ≤ 60 | 21 (baseline 305) | pass |
| `SCAN_FAILED` without a named stage | 0 | 0 (scan errors 0 of 55) | pass |
| Scan p90 | ≤ 120,000 ms | 53,655 ms | pass |
| `recallAll` (reported) | expected ≥ 0.6 | 0.77 | — |

Sites 00, 21, 30, 49: all four scanned (fixed by Task 1, confirmed here).

**Why the end-cookie gate misses.** Of the 241 reference end cookies the scanner did not see, 229
appear in the reference only *after* its accept click; 12 were present before consent. Without a
click — which Task 6 adds — the reachable ceiling is 366 of 595 (61.5%); the scanner has 354 of
those 366 (96.7%). The gate is unreachable at R1 by construction: it belongs where the click exists.

Decided with the user (2026-09-29): the end-cookie gate moves from R1 to R2, after the click. The
other four R1 gates pass, so batch 2 continues.

## R2 (after Task 7, 2026-09-30)

Reference pass reused from v2. First run (`scanner-upgrade-R2-2026-09-29`, built at 5818f56) missed
the accept gate: 30 of the 45 sites the reference accepted. Twelve were Cookiebot. The engine's
built-in Cookiebot `optIn` clicks two legacy button ids and reports success whether or not they
exist, so the `opt_in_clicks` guard (Task 6) correctly refuses it; the text fallback then missed the
dialog, because `#CybotCookiebotDialog` is camelCase and a centred modal. Fixed in Task 7 (94dd93f):
the container word test splits camelCase and matches at a word start. Site 14 failed once at
`observe` (`Timeout("Network.enable")`, the limit stated above); it scanned cleanly on three re-runs.

Second run (`scanner-upgrade-R2b-2026-09-30`, built at 94dd93f):

| Gate (plan R2) | Target | Result | |
|---|---|---|---|
| Cookies matched at end (moved from R1) | ≥ 80% of 595 | 555 (93.3%) | pass |
| CMP detected on the reference's CMP sites | ≥ 27 of 29 | 33 of 33 | pass |
| No Iubenda from the badge (02, 14, 32) | none | 02 and 32 none; 14 shows a real `ckies` banner the reference also accepted | pass |
| Accept clicked | ≥ 38 of 41 | 42 of 45 (93.3%) | pass |
| Wrong clicks, hand-checked sites | 0 | 0 | pass |
| Median `recallAll` | ≥ 0.80 | 0.94 | pass |

Also: scan errors 0 of 55; scan p90 64,629 ms; pre-consent hosts missed 17.

The five hand-checked sites could not be identified with certainty from the earlier session, so all
seven candidates were checked (02, 10, 14, 17, 32, 35, 39), plus the two clicks the reference did
not make (44, 53):
- 10 clicks "Accetta" in the Moove cookie bar; 39 clicks "Accept" in the cookie-law-info bar — the
  blog "CONTINUA" link is no longer touched.
- 02, 32: no CMP, no click. 17: no click.
- 35: a real cookie bar (fixed, bottom) whose only control is "Ok" and which has no policy link, so
  the weak-label rule does not click it. Correct by the rule, but its reason `no-banner` overstates:
  Task 12's copy must say "no consent banner recognised", not "no banner".
- 44: a real `ct-ultimate-gdpr` popup with "OK"; the reference missed it. 53: "Accetta tutti" inside
  the cookie-policy wrapper; the click reloads the page, recorded as `clickNavigated`.
- All 19 text clicks matched a strong label ("accept", "accetta tutti", …); none used a weak one.

Not clicked: 20 (the reference's button was outside the banner — correct refusal), 35 (above), 46
(CookieYes "Accetta tutti i cookies": the label is outside the vocabulary and the rule is refused
by the guard).

## R3 (after Task 8, 2026-10-07)

Two passes on the 55 sites, reference reused: `scanner-upgrade-R3-2026-10-07` (commit 2151dc6) and
`scanner-upgrade-R3b-2026-10-07` (commit aef7b82, after the review round).

| Gate | Target | R3 | R3b |
|---|---|---|---|
| contact pages with a form missed | ≤ 3 | 1 | **0** |
| scan time p90 | ≤ 2 min | 83 s | **78 s** |
| key pages with a form missed | ≤ 15 | 50 of 153 | 38 of 144 |
| …of which hold a field seen nowhere on the site | ≤ 15 (gate from 2026-10-07) | — | **10** |

Reported: median `recallAll` 0.96, cookies at end 557/587, accept clicked 42, no `SCAN_FAILED`
after one re-run (site 28 timed out once on `Page.navigate` in the observe stage, then scanned in
54 s; a key page that hangs still fails the whole scan — proposed follow-up, it should be a gap).

**What R3 found.**

- A real defect: the scan-wide cap of 256 form fields ran out after five to seven pages on four
  shops (12, 13, 49, 51), so later key pages, though visited, returned no fields. The cap is now
  64 per page × 13 pages.
- Two measuring errors in `compare.mjs`: the reference lists the same page with and without a
  trailing slash, and both sides were cut at 40 characters. Paths are now normalised.
- The rest is a difference of choice, not a loss. The reference takes the first twelve links whose
  address or text starts with one of its words, which include `privacy`, `cookie`, `prodott`,
  `iscri`. The picker follows spec §6. On a site with forty product pages each visits a different
  dozen, all carrying the same form. Of the 38 pages still "missed", 28 hold only fields the scan
  captured elsewhere on the same site; the other 10 are course pages of one site (38) with the
  job-application form already captured, differing by one checkbox name.

**Decided with the user (2026-10-07).** The gate "key pages with a form missed ≤ 15" cannot be met
without making the picker copy the reference's words and order. The gate now counts only missed
pages holding at least one visible field the scan saw nowhere on that site (`formPagesMissedUnseen`
in `compare.json`), same thresholds. The old figure stays printed beside it.

**Accepted with Task 8's audit.** A key link that leaves the site is not probed and everything
that visit contacted is rolled back, with one gap note per page; cookies such a page set stay in
the jar. Pages not linked from the home page are not reached (sitemap.xml is the spec's follow-up).

## R4 (after Task 10, 2026-10-07)

`scanner-upgrade-R4-2026-10-07`, **fresh reference** (it records first path segments), scanner
built at 66b1341; naming computed by `compare.mjs` against the dictionary at aa52370.

| Gate | Target | R4 |
|---|---|---|
| third-party organisations with a name | ≥ 85% (baseline 67%) | **498 of 541 = 92%** |

Reported (not gated here): median `recallAll` 0.96; cookies at end 545/591; accept clicked 41;
contacts missed 1; form pages with a field seen nowhere 13 (plain count 42 of 143); p90 77 s;
**sites with an embed door 35 of 43 = 81%** — below the 90% that R5 gates. Task 13 must look at the
eight sites without one before the final re-measure.

Left unnamed on purpose: Elfsight and WonderPush (no fitting category in the dictionary — widgets,
push), and a tail of hosts seen once. Owners of Italiaonline, Duda's white-label domain, Jimdo's
asset hosts, Tripadvisor's and three Google content hosts were assigned from the controller's own
knowledge, not from a page fetched that day; `evnt.iol.it` is classed as analytics from its name,
with a note in the data. To be confirmed by the user.

**What R4 found that is not about names.** In the first pass 14 sites came back as a home page with
three requests and nothing else (about 21 s each). Re-run alone, ten scanned normally; the rest
recovered over two more tries except two. The cause is outside the scanner: name resolution on the
measuring machine failed intermittently (`curl` to the same sites answered "Could not resolve host"
at the same moments). The figures above are after the re-runs; the two sites still short (50, 53)
are in them as they came. The first pass is kept in `summary.run1.txt` and `run1-short/`.

It does expose a product gap, older than this work: **when the home page does not load, the scan
still returns a normal-looking result** — one page, a handful of hosts, "no consent banner was
recognised" — with only "possibly incomplete" to hint at it. Proposed follow-up: a home page that
did not load is said so, and no claim about consent is made.
