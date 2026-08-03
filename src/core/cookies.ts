import { displayName, isSameSite } from './scan'
import { identify } from './vendors'
import type { CookieLifetime, RawScanCookie, VendorDictionary } from './types'

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
