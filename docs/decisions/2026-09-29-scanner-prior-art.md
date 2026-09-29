# Scanner prior art: what to copy, port or only learn from

Date: 2026-09-29. Licences come from each repo's LICENSE file, and "last push" from the repo, both checked today. Traccia is MIT and bundles its data. NonCommercial (NC) or GPL sources can therefore only teach us a method. NC also conflicts with paid consulting use. ShareAlike (SA) data can ship only as a separate file, attributed and kept under its own licence. MPL-2.0 is file-level copyleft, so its files can ship unmodified.

## Ranked table

| # | Source | Licence | Last push | Size | What to take | Verdict |
|---|---|---|---|---|---|---|
| 1 | DDG autoconsent | MPL-2.0 | 2026-09-29 | rules.json 720 KB / 75 KB gz, 844 rules | Per-CMP JSON rules (`detectCmp`, `detectPopup`, `optIn`, `optOut`), incl. CookieYes, Iubenda, Complianz, Borlabs. OneTrust and Cookiebot are TypeScript classes, not JSON. | PORT RULES |
| 2 | Open Cookie Database | Apache-2.0 | 2026-08-21 | 2,266 rows, 25 KB gz slimmed | Maps cookie name to platform, controller, category and retention, with a wildcard flag | COPY DATA |
| 3 | DDG tracker-radar-collector | Apache-2.0 | 2026-09-22 | code | Puppeteer collectors. The `cookiepopups` collector runs autoconsent `optIn`/`optOut` | PORT CODE PATTERN |
| 4 | IAB TCF CMP list / GVL | no SPDX, IAB terms | 2026-09-24 | 30 KB (269 CMPs) / 933 KB (1,219 vendors) | Call `__tcfapi('ping')`, then map `cmpId` to a CMP name. After consent, the TC string lists the vendors that got consent. | LEARN METHOD (terms unchecked) |
| 5 | EDPB Website Evidence Collector | EUPL-1.2 (EasyList assets GPL-3.0/CC-BY-SA-3.0) | 2026-09-29 | — | `--max`/`--depth` first-party crawl, preset consent cookies, EasyPrivacy beacon matching | LEARN METHOD |
| 6 | AdGuard companiesdb | CC-BY-SA-4.0 | 2026-09-28 | 620 KB, 5,126 domains | Domain-to-company map (from WhoTracks.me). Covers 4 of our 8 named gaps | LEARN (separate file if ever used) |
| 7 | Consent-O-Matic | MIT | 2025-11-07 | 204 rule files | Rules split into `detectors` and `methods` (HIDE, OPEN_OPTIONS, DO_CONSENT, SAVE) | PORT RULES (fallback) |
| 8 | Priv-Accept | GPL-3.0 | 2024-02 | — | Clicks accept by keyword, revisits the page, diffs the results; random internal pages | LEARN METHOD |
| 9 | BannerClick (OpenWPM fork) | GPL-3.0 | 2025-07 | — | Finds the banner by text and position; accept and reject in separate runs, cookies compared | LEARN METHOD |
| 10 | Blacklight collector | GPL-3.0 | 2026-09-03 | — | 3 random same-site pages; key-logging and session-recorder checks | LEARN METHOD |
| 11 | Ghostery TrackerDB / WhoTracks.me | CC-BY-NC-SA-4.0 (db) | 2026-09-24 | 3,536 patterns | Organisation, then pattern, then path-aware adblock filters | LEARN METHOD ONLY |
| 12 | DDG Tracker Radar | CC-BY-NC-SA-4.0 | 2026-09-23 | ~19k entities | Entity and domain metadata | SKIP (NC) |
| 13 | Disconnect list | CC-BY-NC-SA-4.0 | 2026-09-28 | — | Services and entities | SKIP (NC) |
| 14 | OpenWPM | GPL-3.0 | 2026-09-11 | — | JS instrumentation; `browse` follows random internal links | LEARN METHOD |
| 15 | webXray owner list | GPL-3.0 | 2018 (tool repo gone) | 169 KB | Owner, parent, alias and country schema | SKIP |
| 16 | webbkoll / PrivacyScore | MIT / GPL-3.0 | archived 2022 / 2021 | — | Single-page header and third-party report | SKIP |
| 17 | Cookiebot / CookieYes | proprietary | — | — | From vendor docs: crawl sitemap and links up to a page cap, flag cookies set before consent | LEARN METHOD |

## Before/after-consent diffing

Priv-Accept (accept, then revisit) and BannerClick (accept vs reject) diff by design. tracker-radar-collector runs one consent action per crawl, so a diff means comparing two runs. WEC presets consent cookies instead of clicking. Blacklight and OpenWPM do not diff. None of them diffs third-party hosts by consent state.

## Page selection

The tools use one of three strategies:
- a random sample of same-site links (Blacklight, Priv-Accept, OpenWPM);
- breadth-first crawling capped by page count and depth (WEC);
- a sitemap plus crawling up to a page cap (Cookiebot, CookieYes).

None of them picks pages by purpose, so Traccia's contact/careers/booking picker is new work.

## Recommendations

1. Bundle autoconsent's rules.json unmodified (75 KB gz) as the sixth named MPL exception. Use `detectCmp` for banner presence and `optIn` for the accept step. Port the OneTrust and Cookiebot classes separately, as MPL files.
2. First call `__tcfapi('ping')` and map the returned `cmpId`. Verify IAB's terms before shipping the 30 KB CMP list.
3. Copy the Open Cookie Database, slimmed (Apache-2.0, NOTICE required). It names vendors from cookie names even when the cookie is first-party.
4. Add host-plus-path matching to vendors.json (TrackerDB's idea, not its data), so `www.google.com/recaptcha` and Maps/YouTube embeds get their own names.
5. Bundle no Tracker Radar, Disconnect or TrackerDB data.
6. Hand-curate the long tail. No list has Trustindex or Simplebooking, and Italiaonline appears only in the GVL. Measure coverage against the 55-site fixture.
7. Diff two fresh-profile runs (no action, then optIn) across hosts, cookies and storage keys, following tracker-radar-collector's `cookiepopups` collector.
8. Fall back to Priv-Accept-style multilingual accept keywords, and label the result "heuristic click".
9. Pick pages from homepage links plus sitemap.xml, scored by IT/EN path and anchor keywords, capped like WEC's `--max`, always including the homepage.
10. Leave companiesdb out for now. Its gain on our gaps is 4 of 8, and the cost is an SA file.
