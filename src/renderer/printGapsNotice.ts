import type { ScanResult } from '../core/types'
import { STRINGS } from './strings'

/** What the print sheet knows about the most recent scan, and nothing else it does not need. */
export type LastScan = Pick<ScanResult, 'possibleGaps' | 'stoppedEarly'>

/**
 * Which sentence, if any, the printed sheet adds below the limits statement.
 *
 * `null` when there has been no scan yet this session, or when a scan finished cleanly with
 * nothing left open -- a printed sheet says nothing rather than an empty reassurance. When
 * there is something to say, the wording is `scanResultNotice`'s, unchanged: a stopped scan is
 * never allowed to read as a completed one, on screen or on paper, so `stoppedEarly` is checked
 * first, every time.
 */
export function printGapsNotice(lastScan: LastScan | null): string | null {
  if (lastScan === null) return null
  if (lastScan.stoppedEarly) return STRINGS.scanStopped(lastScan.possibleGaps)
  if (lastScan.possibleGaps > 0) return STRINGS.scanIncomplete(lastScan.possibleGaps)
  return null
}
