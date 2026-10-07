import { displayName, isSameSite } from './scan'
import { identify } from './vendors'
import type { CookieLifetime, CookiePlatformRow, RawScanCookie, VendorDictionary } from './types'

const SECONDS_PER_DAY = 86_400
const SECONDS_PER_YEAR = 31_536_000

/**
 * The session flag wins outright — a cookie the browser reports as
 * session-only is 'session' no matter what its expiry field says. Otherwise,
 * bucket the seconds remaining from `capturedAtEpochSeconds` against a day
 * and a year. Clamped to zero first: an already-expired cookie still
 * buckets as 'under-a-day' rather than surfacing a negative duration.
 */
export function bucketLifetime(cookie: RawScanCookie, capturedAtEpochSeconds: number): CookieLifetime {
  if (cookie.session) return 'session'
  const remaining = Math.max(0, cookie.expiresEpochSeconds - capturedAtEpochSeconds)
  if (remaining < SECONDS_PER_DAY) return 'under-a-day'
  if (remaining < SECONDS_PER_YEAR) return 'under-a-year'
  return 'a-year-or-more'
}

/**
 * A leading dot (the `Set-Cookie` `Domain` attribute's own marker for "this
 * and all subdomains") is stripped before comparing, then the same
 * label-boundary rule `isSameSite` uses for hosts decides first- vs.
 * third-party — so `evilrossi-editore.it` does not pass as first-party for
 * `rossi-editore.it` just because it happens to end with the right letters.
 */
export function isThirdPartyCookie(cookieDomain: string, scannedHost: string): boolean {
  const domain = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain
  return !isSameSite(domain.toLowerCase(), scannedHost.toLowerCase())
}

/**
 * The place name this cookie's domain would produce under `ingestScan`'s
 * naming — calling the exported `displayName` rather than reimplementing it,
 * so the two never drift apart. `null` when the dictionary does not
 * recognise the domain: the caller attaches the cookie to no place, rather
 * than inventing one.
 */
export function cookieOwnerName(cookieDomain: string, dictionary: VendorDictionary): string | null {
  const hit = identify(cookieDomain, dictionary)
  return hit === null ? null : displayName(cookieDomain, dictionary)
}

/** Names too common to say anything about who set them, refused even when a row lists them. */
const GENERIC_COOKIE_NAMES = new Set(['session', 'sessionid', 'token', 'lang', 'language', 'csrftoken', 'test'])

/**
 * The platform the Open Cookie Database names for a cookie, or null. A blank beats a guess, so:
 * an exact name needs 3+ characters and a wildcard row's prefix 4+ (decided with the user: `_ga`
 * matches); a wildcard row matches only a name that starts with its own prefix; a short fixed
 * stoplist of generic names is refused; and a name that two platforms claim is not matched at all.
 * An exact row beats a wildcard one; among wildcards the longest prefix wins.
 */
export function cookiePlatform(
  name: string,
  table: readonly CookiePlatformRow[],
): { platform: string; category: string } | null {
  if (GENERIC_COOKIE_NAMES.has(name.toLowerCase())) return null
  let best: { length: number; exact: boolean; rows: CookiePlatformRow[] } | null = null
  for (const row of table) {
    const [rowName, , , wildcard] = row
    const exact = wildcard === 0
    if (exact ? rowName !== name || rowName.length < 3 : !name.startsWith(rowName) || rowName.length < 4) continue
    if (best === null || (exact && !best.exact) || (!exact && !best.exact && rowName.length > best.length)) {
      best = { length: rowName.length, exact, rows: [row] }
    } else if (exact === best.exact && rowName.length === best.length) {
      best.rows.push(row)
    }
  }
  if (best === null || new Set(best.rows.map((r) => r[1])).size !== 1) return null
  const [, platform, category] = best.rows[0]!
  return platform === '' ? null : { platform, category }
}
