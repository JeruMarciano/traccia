# Extraction steps 5–8 — acceptance baseline (spec §11)

**Recorded:** 2026-08-03, v0.2.1 build (main @ 1df5e3e), before any step 5–8 code.
**Method:** one real scan plus one real informativa, ingested and accepted in the app by the
user; counts computed from the saved project file, not by eye. The project file itself is not
committed — it names a real organisation.

**Inputs:** one real small-business site scanned (4 third-party domains observed), one real
informativa added, suggestions accepted.

**Resulting project:** 16 places (1 collection, 6 processors, 9 internal), 5 subject groups
(Website visitors, Customers, Suppliers, Job applicants, Members), 4 flows.

## The number the release is judged against

**59 "not yet identified" lines** in the detail panel:

| Panel field | Lines | What would fill it |
|---|---|---|
| WHERE | 16 | jurisdiction/EEA facts (documents already read these; none present here) |
| RETENTION | 14 | document retention extraction (shipped in v0.2.1; this document yielded 2) |
| WHAT IS HELD | 13 | dataCategories (same) |
| TRACKERS OBSERVED | 16 | **cookies — Tasks 5–6 of this plan** |
| PURPOSE | 0 | already filled by dictionary + documents |

Steps 5–8 primarily attack the TRACKERS OBSERVED column (16 lines) and add collection points,
consent presence and storage keys that today do not exist at all (counted as 0 here because the
panel has no line for them yet). The re-measure in Task 11 runs the same site and document on
the finished build and records the surviving count next to this one.

## Correction to the before-count (2026-08-03, Task 11)

The 59 above was counted by eye. Re-counted by running the panel's own `placeDetails` over the
saved baseline project file, the true before-count is **55**. The count is valid at both ends of the
branch: `git diff c169aae..HEAD` touches neither `placeDetails.ts`, nor `DetailPanel.tsx`, nor
`vendors.json` — the only change on the whole counting path is nine added lines in `strings.ts`,
all of them new scan-notice sentences.

| Panel field | Recorded by eye | Counted from the project file |
|---|---|---|
| WHERE | 16 | 16 |
| RETENTION | 14 | 14 |
| WHAT IS HELD | 13 | 13 |
| TRACKERS OBSERVED | 16 | **12** |
| PURPOSE | 0 | 0 |
| **Total** | **59** | **55** |

TRACKERS was recorded as one line per place. Four places do show their observations
(`cdn.iubenda.com`, `d22gljo6lgdm1z.cloudfront.net`, the scanned host itself, `www.googletagmanager.com`),
so twelve lines read "not yet identified", not sixteen. 55 is the number this release is judged against.

## After (Task 11, 2026-08-03, extraction-depth-scan @ dd4a7b6)

Same site, same informativa, current build. **55 — unchanged.**

Same 16 places, 5 subject groups, 4 flows, 4 observations as the baseline; the same 12/16/14/13/0
breakdown. The rescan's captures landed empty in the project: `cookies: []`, `collectionPoints: []`.

Two separate reasons, and the second is the one that matters:

1. The scan captured no cookies and no collection points on this site. Cookies are stored whether or
   not they attach to a place, so this is the site's own behaviour (nothing set before consent),
   not a dropped capture.
2. **The detail panel does not render the captures at all.** `DetailPanel.tsx` is unchanged across
   this branch: it shows purpose, where, retention, what-is-held and observations. Cookies,
   collection points, storage keys and consent presence surface only in the scan-result sentence.
   The TRACKERS column is fed by `observations`, so no quantity of captured cookies could have moved
   this count in this release.

So spec §11's acceptance number cannot discriminate on steps 5–8 as they shipped. What steps 5–8
deliver is the capture and the model: cookies and collection points now persist in the project file,
storage keys and consent presence now reach the user as a stated fact. Surfacing them in the panel —
and with it any movement in this count — belongs to the map-redesign plan, which is where the
number should next be measured.
