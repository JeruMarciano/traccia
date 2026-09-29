# Scanner baseline — what v0.3.0 finds against what a visitor triggers

**Recorded:** 2026-09-29, v0.3.0 (main @ 685bbbe), before any scanner change.
**Purpose:** the number the scanner work is judged against. Re-run the same harness on the same
sites after each change and put the new figures next to these.

## Method

55 live sites of small Italian organisations across 12 sectors (dental/medical, hotels,
e-commerce, restaurants, professional firms, manufacturing, gyms, schools, real estate,
associations, beauty, other), chosen by search, not by the user — a selection bias stated here.
The list and every raw result live outside the repo (`~/Documents/Claude/traccia-fixtures/
scanner-baseline-2026-09-29-v2/`) because they name real organisations.

Each site gets two passes, both in a fresh headless Chrome profile:

1. **Scanner:** today's scanner, unchanged, driven through `scan::run` by
   `spike/scanner-baseline/scanrun`.
2. **Reference:** `spike/scanner-baseline/reference.mjs` — lets all traffic through, waits 8 s on
   the home page, clicks a visible "accept" control if it finds one by text, then visits up to 12
   key pages (contacts, careers, shop, booking, newsletter, login, privacy) found among the home
   page's links. It records every request host from every frame, cookies (name/domain/expiry,
   never a value), visible form fields and iframes.

The reference is an automated heuristic. Five sites were then checked by hand (below) and the
reference fixed where it was wrong; the figures here are from the fixed reference (`-v2` data).
Treat them as a floor on what a visitor triggers, not as ground truth.

50 of 55 sites completed both passes. The scanner failed outright on 4 (`SCAN_FAILED`, cause not
reported by a release build); the reference crashed on 1.

## What the scanner finds

| Measure | Scanner | Reference | Note |
|---|---|---|---|
| Third-party hosts, all sites | 281 | 783 | median site: scanner sees **35%** |
| — of which before any consent | — | 535 | scanner missed 305 of these |
| — only after accept / on key pages | — | 248 | |
| Cookies | **0** | 271 before consent, 503 at end | |
| Consent manager recognised | 14 sites | 29 sites (+ an accept button on 41) | |
| Key pages with a form, excluding home | 62 reached | 136 | **74 missed**, on 21 sites; 17 are contact pages |
| Third-party organisations with a name | — | 323 of 479 (67%) | 57 get a purpose hint, 99 nothing |
| Scan failed | 4 of 55 | — | 7% |

Recall does not depend much on the sector: 0.28–0.46 by category.

## Why — five causes, in order of weight

1. **Every third-party request is refused.** `admission::decide` admits only the scan target and
   its subdomains; everything else gets a 403 and is recorded as an attempt. So a script is seen
   but never runs, and nothing it would load ever happens: Tag Manager is seen, the Analytics,
   Ads and Meta Pixel it loads are not; the consent banner's script never renders, so there is
   nothing to accept. This alone explains most of the 300 missed pre-consent hosts and makes the
   before/after-consent comparison impossible by construction. **Decided 2026-09-29: the scan
   lets third-party traffic through, like a real visitor.** Private ranges, IP literals and port
   rules stay.
2. **Cookie capture has never worked on current Chrome.** `fetch_cookies` sends
   `Network.getAllCookies` on the browser-level session; Chrome answers "wasn't found", the error
   is swallowed into zero cookies plus a possible-gap note. `Storage.getCookies` on the browser
   session (or `Network.getAllCookies` on the page session) returns them. The August measurement's
   "nothing set before consent" was this bug, not the site.
3. **Pages are the first nine same-origin links in document order.** That is usually the menu,
   so contact, careers, shop and booking pages are reached by luck: 72 of 137 form pages missed.
4. **The consent probe knows four vendors.** Iubenda and Cookiebot account for all 13 hits;
   CookieYes, Complianz, CookieLawInfo and Moove (8 sites) are never named. Some Iubenda misses are
   cause 1 (the script was refused).
5. **The dictionary misses common hosts.** Most frequent unnamed organisations: `google.it`
   (26 sites), `google.com` (18 — reCAPTCHA, Maps), Italiaonline's site-builder hosts
   (`iol.it`, `italiaonline.it`, `paginegialle.it`, 8 each), Duda (`cdn-website.com`,
   `multiscreensite.com`, 8), Brevo (`sibautomation.com`), Trustindex, Elfsight, Simplebooking,
   Mapbox, Jimdo, Wix.

## Hand check (5 sites, playwright, 2026-09-29)

The reference's host and form capture matched a manual session on all five. Its *labelling* was
wrong in three ways, all fixed before the figures above were taken:

- **Wrong accept click.** On one school site "CONTINUA" was a blog "read more" link, not the banner
  button ("Accept"). Bare "Ok"/"Continua"/"Ho capito" now count only inside a consent container;
  a click that navigates is recorded.
- **Off-site key pages.** `/facebook` matched "book" and redirected to facebook.com, inflating one
  hotel's after-consent hosts from 24 to 31. Page keywords now need a word boundary, off-site
  redirects are dropped, PDFs and print views skipped.
- **False CMP.** Iubenda's privacy-policy badge defines `window._iub` without any banner. Iubenda
  now needs `_iub.csConfiguration` or the banner element. The scanner's own `CONSENT_PROBE`
  has the same false positive.

Two things the hand check found that neither pass records: sign-up and booking that leave the site
(a gym's registration on another domain, a hotel's booking engine on simplebooking.it). The site's
own pages show only the link.

## What this does not measure

- Whether each observed host is labelled with the *right* purpose — only whether it is named.
- Embeds as collection points: the reference saw Google Maps/reCAPTCHA iframes on 27 sites,
  YouTube on 5, Stripe on 2; the scanner has no notion of an embed.
- A hand check of any site. Recommended before the spec: five sites, opened by hand, to confirm
  the reference is not itself wrong in a way that flatters or hurts the scanner.
