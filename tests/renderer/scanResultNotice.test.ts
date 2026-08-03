// A completed scan and a stopped one must never share a presentation: stopping a scan is a
// deliberate action the user took, not a defect in what the scan found, so it is shown first
// and distinctly. See src/renderer/scanResultNotice.ts.
import { describe, it, expect } from 'vitest'
import { scanResultNotice } from '../../src/renderer/scanResultNotice'
import { STRINGS } from '../../src/renderer/strings'
import type { ScanResult } from '../../src/core/types'

function result(over: Partial<ScanResult> = {}): ScanResult {
  return {
    scannedHost: 'rossi-editore.it',
    hosts: [
      { host: 'rossi-editore.it', requestCount: 12 },
      { host: 'doubleclick.net', requestCount: 4 },
    ],
    pagesVisited: 2,
    possibleGaps: 0,
    stoppedEarly: false,
    cookies: [],
    formFields: [],
    storageKeys: [],
    consentMarkers: [],
    capturedAtEpochSeconds: 0,
    ...over,
  }
}

describe('scanResultNotice', () => {
  it('shows nothing for a scan that finished cleanly with no possible gaps', () => {
    expect(scanResultNotice(result())).toBeNull()
  })

  it('names the gap count for a completed scan that has possible gaps', () => {
    const notice = scanResultNotice(result({ possibleGaps: 3 }))
    expect(notice).toBe(STRINGS.scanIncomplete(3))
  })

  it('presents a stopped scan as stopped first, never as a completed scan with gaps', () => {
    const stopped = scanResultNotice(result({ stoppedEarly: true, possibleGaps: 2 }))
    const completedWithSameGaps = scanResultNotice(result({ stoppedEarly: false, possibleGaps: 2 }))
    expect(stopped).toBe(STRINGS.scanStopped(2))
    expect(stopped).not.toBe(completedWithSameGaps)
  })

  it('reports nothing found when the scan only ever saw the scanned site itself', () => {
    expect(
      scanResultNotice(result({ hosts: [{ host: 'rossi-editore.it', requestCount: 1 }] })),
    ).toBe(STRINGS.scanFoundNothing)
  })

  it('reports the gap count, not "found nothing", when no third party was observed but gaps remain', () => {
    // A scan that saw no third party but still counted possible gaps is the least
    // trustworthy map, not the cleanest one -- and the printed sheet does show the
    // gap count in this situation. The renderer notice must agree with it, rather
    // than dropping the incompleteness signal because hosts.length <= 1.
    const notice = scanResultNotice(
      result({ hosts: [{ host: 'rossi-editore.it', requestCount: 1 }], possibleGaps: 2 }),
    )
    expect(notice).toBe(STRINGS.scanIncomplete(2))
    expect(notice).not.toBe(STRINGS.scanFoundNothing)
  })

  it('still presents a stopped scan as stopped, even with no third party observed and gaps present', () => {
    const notice = scanResultNotice(
      result({
        hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
        possibleGaps: 2,
        stoppedEarly: true,
      }),
    )
    expect(notice).toBe(STRINGS.scanStopped(2))
  })
})
