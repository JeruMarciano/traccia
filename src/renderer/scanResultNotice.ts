import { isThirdPartyCookie } from '../core/cookies'
import type { ScanResult } from '../core/types'
import { STRINGS } from './strings'

/**
 * The cookie count to append to the notice, or null when the scan captured none — a scan that
 * captured no cookies says nothing about them, rather than reporting a hollow "0 cookies
 * recorded".
 */
function cookieNotice(result: ScanResult): string | null {
  if (result.cookies.length === 0) return null
  const thirdParty = result.cookies.filter((c) => isThirdPartyCookie(c.domain, result.scannedHost)).length
  return STRINGS.cookiesRecorded(result.cookies.length, thirdParty)
}

/** Joins whichever of several sentences apply, in order, dropping the ones that do not. */
function joinAll(...parts: (string | null)[]): string {
  return parts.filter((p): p is string => p !== null).join(' ')
}

/**
 * Whether a consent banner was detected, neutrally stated either way: unlike the cookie count,
 * which says nothing when there is nothing to report, the absence of a known consent-manager
 * marker is itself a fact worth stating — "No consent banner was detected." — never "missing",
 * never "required". `consentMarkers[0]` names the marker when more than one fixed name matched;
 * matching more than one is not expected in practice, and either way it does not change what the
 * sentence should say.
 */
function consentNotice(result: ScanResult): string {
  const [first] = result.consentMarkers
  return first === undefined ? STRINGS.consentBannerNotDetected : STRINGS.consentBannerDetected(first)
}

/**
 * Which notice, if any, to show after a scan completes without throwing.
 *
 * A stopped scan is presented first and distinctly: the user chose to stop it, which is not the
 * same situation as a scan that ran to completion and still could not answer everything. The two
 * must never share a sentence, so `possibleGaps` alone never decides this on its own — whether
 * the scan was stopped is checked first, every time.
 *
 * Among the remaining cases, a completed scan with possible gaps takes precedence over "found no
 * third party": a scan that saw nothing but still could not answer everything is the least
 * trustworthy result, not the cleanest one, and the printed sheet already shows the gap count in
 * that situation — this notice must agree with it rather than say the opposite.
 *
 * The cookie count, when there is one, is appended to whichever sentence above applies — or
 * stands alone when none of them do. The consent-banner sentence is always appended last: it is
 * always a fact, one way or the other, so it never leaves the whole notice empty.
 */
export function scanResultNotice(result: ScanResult): string {
  const cookies = cookieNotice(result)
  const consent = consentNotice(result)
  if (result.stoppedEarly) return joinAll(STRINGS.scanStopped(result.possibleGaps), cookies, consent)
  if (result.possibleGaps > 0) return joinAll(STRINGS.scanIncomplete(result.possibleGaps), cookies, consent)
  if (result.hosts.length <= 1) return joinAll(STRINGS.scanFoundNothing, cookies, consent)
  return joinAll(cookies, consent)
}
