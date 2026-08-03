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
  it('reports no consent banner for a scan that finished cleanly with no possible gaps', () => {
    expect(scanResultNotice(result())).toBe(STRINGS.consentBannerNotDetected)
  })

  it('names the gap count for a completed scan that has possible gaps', () => {
    const notice = scanResultNotice(result({ possibleGaps: 3 }))
    expect(notice).toBe(`${STRINGS.scanIncomplete(3)} ${STRINGS.consentBannerNotDetected}`)
  })

  it('presents a stopped scan as stopped first, never as a completed scan with gaps', () => {
    const stopped = scanResultNotice(result({ stoppedEarly: true, possibleGaps: 2 }))
    const completedWithSameGaps = scanResultNotice(result({ stoppedEarly: false, possibleGaps: 2 }))
    expect(stopped).toBe(`${STRINGS.scanStopped(2)} ${STRINGS.consentBannerNotDetected}`)
    expect(stopped).not.toBe(completedWithSameGaps)
  })

  it('reports nothing found when the scan only ever saw the scanned site itself', () => {
    expect(
      scanResultNotice(result({ hosts: [{ host: 'rossi-editore.it', requestCount: 1 }] })),
    ).toBe(`${STRINGS.scanFoundNothing} ${STRINGS.consentBannerNotDetected}`)
  })

  it('reports the gap count, not "found nothing", when no third party was observed but gaps remain', () => {
    // A scan that saw no third party but still counted possible gaps is the least
    // trustworthy map, not the cleanest one -- and the printed sheet does show the
    // gap count in this situation. The renderer notice must agree with it, rather
    // than dropping the incompleteness signal because hosts.length <= 1.
    const notice = scanResultNotice(
      result({ hosts: [{ host: 'rossi-editore.it', requestCount: 1 }], possibleGaps: 2 }),
    )
    expect(notice).toBe(`${STRINGS.scanIncomplete(2)} ${STRINGS.consentBannerNotDetected}`)
    expect(notice).not.toBe(`${STRINGS.scanFoundNothing} ${STRINGS.consentBannerNotDetected}`)
  })

  it('still presents a stopped scan as stopped, even with no third party observed and gaps present', () => {
    const notice = scanResultNotice(
      result({
        hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
        possibleGaps: 2,
        stoppedEarly: true,
      }),
    )
    expect(notice).toBe(`${STRINGS.scanStopped(2)} ${STRINGS.consentBannerNotDetected}`)
  })

  describe('cookie count', () => {
    // scannedHost is 'rossi-editore.it': a cookie on that domain is first-party, a cookie on
    // any other domain is third-party. One of each below, so the count and the third-party
    // subset are never the same number -- a test that used all-first-party or all-third-party
    // cookies could not tell a correct subset count from one that just echoed the total.
    const twoCookies = [
      { name: 'lang', domain: 'rossi-editore.it', session: true, expiresEpochSeconds: -1 },
      { name: 'IDE', domain: 'doubleclick.net', session: false, expiresEpochSeconds: 1_000 },
    ]

    it('stands alone (with the consent sentence) when no other notice applies', () => {
      const notice = scanResultNotice(result({ cookies: twoCookies }))
      expect(notice).toBe(`${STRINGS.cookiesRecorded(2, 1)} ${STRINGS.consentBannerNotDetected}`)
    })

    it('says nothing about cookies when none were captured', () => {
      expect(scanResultNotice(result({ cookies: [] }))).toBe(STRINGS.consentBannerNotDetected)
    })

    it('counts only the third-party subset, not the total, as third-party', () => {
      const notice = scanResultNotice(result({ cookies: twoCookies }))
      expect(notice).not.toBe(`${STRINGS.cookiesRecorded(2, 2)} ${STRINGS.consentBannerNotDetected}`)
      expect(notice).not.toBe(`${STRINGS.cookiesRecorded(2, 0)} ${STRINGS.consentBannerNotDetected}`)
    })

    it('is appended to a base notice rather than replacing it', () => {
      const notice = scanResultNotice(result({ possibleGaps: 3, cookies: twoCookies }))
      expect(notice).toBe(
        `${STRINGS.scanIncomplete(3)} ${STRINGS.cookiesRecorded(2, 1)} ${STRINGS.consentBannerNotDetected}`,
      )
    })

    it('is appended even to a stopped-scan notice', () => {
      const notice = scanResultNotice(result({ stoppedEarly: true, possibleGaps: 1, cookies: twoCookies }))
      expect(notice).toBe(
        `${STRINGS.scanStopped(1)} ${STRINGS.cookiesRecorded(2, 1)} ${STRINGS.consentBannerNotDetected}`,
      )
    })
  })

  describe('consent banner', () => {
    it('names the marker when one was detected', () => {
      const notice = scanResultNotice(result({ consentMarkers: ['OneTrust'] }))
      expect(notice).toBe(STRINGS.consentBannerDetected('OneTrust'))
    })

    it('says neutrally that none was detected, never "missing" or "required"', () => {
      const notice = scanResultNotice(result({ consentMarkers: [] }))
      expect(notice).toBe(STRINGS.consentBannerNotDetected)
      expect(notice.toLowerCase()).not.toContain('missing')
      expect(notice.toLowerCase()).not.toContain('required')
      expect(notice.toLowerCase()).not.toContain('violation')
    })

    it('is appended last, after the gap and cookie sentences', () => {
      const notice = scanResultNotice(
        result({ possibleGaps: 3, cookies: twoCookiesForConsentTest, consentMarkers: ['Cookiebot'] }),
      )
      expect(notice).toBe(
        `${STRINGS.scanIncomplete(3)} ${STRINGS.cookiesRecorded(2, 1)} ${STRINGS.consentBannerDetected('Cookiebot')}`,
      )
    })
  })
})

const twoCookiesForConsentTest = [
  { name: 'lang', domain: 'rossi-editore.it', session: true, expiresEpochSeconds: -1 },
  { name: 'IDE', domain: 'doubleclick.net', session: false, expiresEpochSeconds: 1_000 },
]
