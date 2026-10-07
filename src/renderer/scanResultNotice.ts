import { isThirdPartyCookie } from '../core/cookies'
import { isCollectingField } from '../core/forms'
import { isSameSite } from '../core/scan'
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

/**
 * The collection-point count to append, or null when the scan found no page with a collecting
 * field — mirrors `cookieNotice`: a scan that discovered no door says nothing about doors, rather
 * than reporting a hollow "0 collection points discovered".
 */
function collectionPointsNotice(result: ScanResult): string | null {
  const pages = new Set<string>()
  for (const field of result.formFields) {
    if (isCollectingField(field)) pages.add(field.page)
  }
  return pages.size === 0 ? null : STRINGS.collectionPointsDiscovered(pages.size)
}

/**
 * The storage-key count to append, or null when the scan captured none — mirrors `cookieNotice`:
 * a scan that recorded no key says nothing about them, rather than reporting a hollow "0 storage
 * keys recorded".
 */
function storageKeysNotice(result: ScanResult): string | null {
  if (result.storageKeys.length === 0) return null
  return STRINGS.storageKeysRecorded(result.storageKeys.length)
}

/** Joins whichever of several sentences apply, in order, dropping the ones that do not. */
function joinAll(...parts: (string | null)[]): string {
  return parts.filter((p): p is string => p !== null).join(' ')
}

/**
 * What the scan did about consent, when it can say: the click and what it showed, or that none was
 * given and why. Null when `consent` is absent (a v0.3 payload) or says too little, so the older
 * sentence applies. Counts are third-party hosts with a known phase only; none is counted for a
 * scan that gave no consent, and a count of nothing is not stated.
 */
function consentDone(result: ScanResult): string | null {
  const c = result.consent
  if (!c) return null
  if (c.clicked && c.rule !== null) {
    const how =
      c.rule === 'cmp'
        ? STRINGS.consentAcceptedByCmp(c.ruleName)
        : STRINGS.consentAcceptedByText(c.cmp, c.matchedText)
    const third = result.hosts.filter((h) => !isSameSite(h.host, result.scannedHost))
    const before = third.filter((h) => h.phase === 'before').length
    const after = third.filter((h) => h.phase === 'after').length
    return joinAll(
      how,
      before + after === 0 ? null : STRINGS.consentCounts(before, after),
      c.clickNavigated ? STRINGS.consentClickLeftPage : null,
    )
  }
  if (c.clicked || result.stoppedEarly) return null
  if (c.reason !== undefined) return STRINGS.consentNotGiven(c.reason)
  // Detected but no reason: the scan could not tell why. Nothing detected either is a blank.
  return c.cmp ? STRINGS.consentNotGivenNoReason : null
}

/**
 * Whether a consent banner was detected, neutrally stated either way: unlike the cookie count,
 * which says nothing when there is nothing to report, the absence of a known consent-manager
 * marker is itself a fact worth stating — "No consent banner was detected." — never "missing",
 * never "required". `consent.cmp` names the CMP; a v0.3 payload's `consentMarkers[0]` stands in for
 * it. `consent` with no `reason` and no CMP means detection never ran to its end, so no absence is
 * claimed either.
 *
 * A scan stopped early runs its pages in a fixed order, and the consent probe is one step in
 * that order; stopping before it is reached means the probe never ran, which is not the same
 * situation as a probe that ran and found nothing. Absence can only be claimed when the probe
 * actually ran to completion — so when the scan stopped early and no marker was found, this
 * returns null rather than asserting an absence that was never checked. A marker that *was*
 * found before the scan stopped is still a fact regardless of the stop, so presence is always
 * reported.
 */
function consentNotice(result: ScanResult): string | null {
  const done = consentDone(result)
  if (done !== null) return done
  const first = result.consent ? result.consent.cmp : result.consentMarkers?.[0]
  if (first) return STRINGS.consentBannerDetected(first)
  if (result.stoppedEarly) return null
  if (result.consent && result.consent.reason === undefined) return null
  return STRINGS.consentBannerNotDetected
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
 * The cookie count, the collection-point count and the storage-key count, when there is one of
 * each, are appended in that order to whichever sentence above applies — or stand alone when none
 * of them do. The consent-banner sentence is always appended last, one way or the other, except
 * when the scan stopped before the consent probe ever ran and found no marker — there, absence
 * would be a claim about a check that never happened, so the sentence is dropped rather than
 * stated wrongly (see `consentNotice`).
 */
export function scanResultNotice(result: ScanResult): string {
  const cookies = cookieNotice(result)
  const collectionPoints = collectionPointsNotice(result)
  const storageKeys = storageKeysNotice(result)
  const consent = consentNotice(result)
  if (result.stoppedEarly) {
    return joinAll(STRINGS.scanStopped(result.possibleGaps), cookies, collectionPoints, storageKeys, consent)
  }
  if (result.possibleGaps > 0) {
    return joinAll(STRINGS.scanIncomplete(result.possibleGaps), cookies, collectionPoints, storageKeys, consent)
  }
  if (result.hosts.length <= 1)
    return joinAll(STRINGS.scanFoundNothing, cookies, collectionPoints, storageKeys, consent)
  return joinAll(cookies, collectionPoints, storageKeys, consent)
}
