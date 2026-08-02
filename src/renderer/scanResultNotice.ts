import type { ScanResult } from '../core/types'
import { STRINGS } from './strings'

/**
 * Which notice, if any, to show after a scan completes without throwing.
 *
 * A stopped scan is presented first and distinctly: the user chose to stop it, which is not the
 * same situation as a scan that ran to completion and still could not answer everything. The two
 * must never share a sentence, so `possibleGaps` alone never decides this on its own — whether
 * the scan was stopped is checked first, every time.
 */
export function scanResultNotice(result: ScanResult): string | null {
  if (result.stoppedEarly) return STRINGS.scanStopped(result.possibleGaps)
  if (result.hosts.length <= 1) return STRINGS.scanFoundNothing
  if (result.possibleGaps > 0) return STRINGS.scanIncomplete(result.possibleGaps)
  return null
}
