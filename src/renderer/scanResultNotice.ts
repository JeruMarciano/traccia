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

function join(base: string, extra: string | null): string {
  return extra === null ? base : `${base} ${extra}`
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
 * stands alone when none of them do.
 */
export function scanResultNotice(result: ScanResult): string | null {
  const cookies = cookieNotice(result)
  if (result.stoppedEarly) return join(STRINGS.scanStopped(result.possibleGaps), cookies)
  if (result.possibleGaps > 0) return join(STRINGS.scanIncomplete(result.possibleGaps), cookies)
  if (result.hosts.length <= 1) return join(STRINGS.scanFoundNothing, cookies)
  return cookies
}
