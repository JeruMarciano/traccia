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
    // consentMarkers non-empty here so the consent sentence still applies on a stopped scan --
    // a stopped scan with no marker found suppresses that sentence entirely (see the "consent
    // banner" describe block below), which would make this test ambiguous about what it checks.
    const stopped = scanResultNotice(result({ stoppedEarly: true, possibleGaps: 2, consentMarkers: ['OneTrust'] }))
    const completedWithSameGaps = scanResultNotice(
      result({ stoppedEarly: false, possibleGaps: 2, consentMarkers: ['OneTrust'] }),
    )
    expect(stopped).toBe(`${STRINGS.scanStopped(2)} ${STRINGS.consentBannerDetected('OneTrust')}`)
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
    // No consentMarkers on a stopped scan: the consent probe never ran, so nothing is claimed
    // about it either way (see the "consent banner" describe block below).
    expect(notice).toBe(STRINGS.scanStopped(2))
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
      // No consentMarkers here: the consent probe never ran on this stopped scan, so the
      // notice ends after the cookie sentence rather than claiming an absence (see below).
      const notice = scanResultNotice(result({ stoppedEarly: true, possibleGaps: 1, cookies: twoCookies }))
      expect(notice).toBe(`${STRINGS.scanStopped(1)} ${STRINGS.cookiesRecorded(2, 1)}`)
    })

    it('uses the singular for exactly one cookie', () => {
      const oneCookie = [{ name: 'lang', domain: 'rossi-editore.it', session: true, expiresEpochSeconds: -1 }]
      const notice = scanResultNotice(result({ cookies: oneCookie }))
      expect(notice).toBe(`${STRINGS.cookiesRecorded(1, 0)} ${STRINGS.consentBannerNotDetected}`)
      expect(STRINGS.cookiesRecorded(1, 0)).toBe('1 cookie recorded (0 third-party).')
    })
  })

  describe('collection points', () => {
    it('names the door count when a collecting field was seen', () => {
      const notice = scanResultNotice(
        result({ formFields: [{ page: 'https://rossi-editore.it/contatti', name: 'email', type: 'email', autocomplete: '', label: '' }] }),
      )
      expect(notice).toBe(`${STRINGS.collectionPointsDiscovered(1)} ${STRINGS.consentBannerNotDetected}`)
    })

    it('says nothing about collection points when no collecting field was seen', () => {
      const notice = scanResultNotice(
        result({ formFields: [{ page: 'https://rossi-editore.it/x', name: 'csrf', type: 'hidden', autocomplete: '', label: '' }] }),
      )
      expect(notice).toBe(STRINGS.consentBannerNotDetected)
    })

    it('uses the singular for exactly one collection point', () => {
      const notice = scanResultNotice(
        result({ formFields: [{ page: 'https://rossi-editore.it/contatti', name: 'email', type: 'email', autocomplete: '', label: '' }] }),
      )
      expect(notice).toBe(`${STRINGS.collectionPointsDiscovered(1)} ${STRINGS.consentBannerNotDetected}`)
      expect(STRINGS.collectionPointsDiscovered(1)).toBe('1 collection point discovered.')
    })
  })

  describe('storage keys', () => {
    it('names the count when storage keys were recorded', () => {
      const notice = scanResultNotice(
        result({ storageKeys: [{ scope: 'local', key: 'auth_token', bytes: 42 }] }),
      )
      expect(notice).toBe(`${STRINGS.storageKeysRecorded(1)} ${STRINGS.consentBannerNotDetected}`)
    })

    it('says nothing about storage keys when none were captured', () => {
      const notice = scanResultNotice(result({ storageKeys: [] }))
      expect(notice).toBe(STRINGS.consentBannerNotDetected)
    })

    it('uses the singular for exactly one storage key', () => {
      const notice = scanResultNotice(
        result({ storageKeys: [{ scope: 'local', key: 'auth_token', bytes: 42 }] }),
      )
      expect(notice).toBe(`${STRINGS.storageKeysRecorded(1)} ${STRINGS.consentBannerNotDetected}`)
      expect(STRINGS.storageKeysRecorded(1)).toBe('1 storage key recorded.')
    })

    it('is appended after the gap and cookie sentences and before the consent sentence', () => {
      const notice = scanResultNotice(
        result({
          possibleGaps: 3,
          cookies: twoCookiesForConsentTest,
          storageKeys: [{ scope: 'session', key: 'cart', bytes: 10 }],
          consentMarkers: ['Cookiebot'],
        }),
      )
      expect(notice).toBe(
        `${STRINGS.scanIncomplete(3)} ${STRINGS.cookiesRecorded(2, 1)} ${STRINGS.storageKeysRecorded(1)} ${STRINGS.consentBannerDetected('Cookiebot')}`,
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

    // A scan stopped early (e.g. after the entry-page visit but before the consent probe ran)
    // must never claim an absence the probe never checked for. Presence found before the stop
    // is still a fact and is still reported either way.
    it('says nothing about consent when the scan stopped early and no marker was found', () => {
      const notice = scanResultNotice(result({ stoppedEarly: true, possibleGaps: 1, consentMarkers: [] }))
      expect(notice).toBe(STRINGS.scanStopped(1))
      expect(notice.toLowerCase()).not.toContain('consent')
    })

    it('still reports presence when a marker was found before a stopped scan', () => {
      const notice = scanResultNotice(
        result({ stoppedEarly: true, possibleGaps: 1, consentMarkers: ['OneTrust'] }),
      )
      expect(notice).toBe(`${STRINGS.scanStopped(1)} ${STRINGS.consentBannerDetected('OneTrust')}`)
    })

    it('still reports absence when a completed scan found no marker', () => {
      const notice = scanResultNotice(result({ stoppedEarly: false, consentMarkers: [] }))
      expect(notice).toBe(STRINGS.consentBannerNotDetected)
    })
  })
})

const twoCookiesForConsentTest = [
  { name: 'lang', domain: 'rossi-editore.it', session: true, expiresEpochSeconds: -1 },
  { name: 'IDE', domain: 'doubleclick.net', session: false, expiresEpochSeconds: 1_000 },
]
