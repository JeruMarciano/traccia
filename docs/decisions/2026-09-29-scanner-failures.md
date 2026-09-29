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
