import { describe, it, expect } from 'vitest'
import { ingestScan } from '../../src/core/scan'
import { emptyProject } from '../fixtures/projects'
import type { ScanResult, VendorDictionary } from '../../src/core/types'

const DICT: VendorDictionary = {
  'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Marketing' },
  'doubleclick.net': { owner: 'Google', category: 'ads', purposeGroup: 'Marketing' },
  'stripe.com': { owner: 'Stripe', category: 'payments', purposeGroup: 'Getting paid' },
}

const IDS = { prefix: 'scan1' }

const CAPTURED_AT = 1_700_000_000

function result(over: Partial<ScanResult> = {}): ScanResult {
  return {
    scannedHost: 'rossi-editore.it',
    hosts: [{ host: 'rossi-editore.it', requestCount: 12 }],
    pagesVisited: 1,
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

function scanResultWith(over: Partial<ScanResult> = {}): ScanResult {
  return result({ capturedAtEpochSeconds: CAPTURED_AT, ...over })
}

const GA_COOKIE = {
  name: '_ga',
  domain: 'google-analytics.com',
  session: false,
  expiresEpochSeconds: CAPTURED_AT + 86_400 * 400,
}

describe('ingestScan', () => {
  it('seeds a website-visitors subject group', () => {
    const p = ingestScan(emptyProject(), result(), DICT, IDS)
    expect(p.subjectGroups.map((s) => s.name)).toEqual(['Website visitors'])
  })

  it('creates a place for the scanned site, held by the organisation', () => {
    const p = ingestScan(emptyProject(), result(), DICT, IDS)
    const site = p.places.find((pl) => pl.name === 'rossi-editore.it')
    expect(site).toBeDefined()
    expect(site?.kind).toBe('collection')
    expect(site?.holder).toBe('you')
    expect(site?.confidence).toBe('observed')
  })

  it('draws a flow from the visitors to the site', () => {
    const p = ingestScan(emptyProject(), result(), DICT, IDS)
    const visitors = p.subjectGroups[0]?.id
    const site = p.places.find((pl) => pl.name === 'rossi-editore.it')?.id
    expect(p.flows.some((f) => f.from === visitors && f.to === site)).toBe(true)
  })

  it('names a recognised third party by owner and category, and draws a flow to it', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 12 },
          { host: 'www.google-analytics.com', requestCount: 4 },
        ],
      }),
      DICT,
      IDS,
    )
    const ga = p.places.find((pl) => pl.name === 'Google Analytics')
    expect(ga).toBeDefined()
    expect(ga?.purposeGroup).toBe('Marketing')
    expect(ga?.kind).toBe('processor')
    expect(ga?.holder).toBe('supplier')
    const site = p.places.find((pl) => pl.name === 'rossi-editore.it')?.id
    expect(p.flows.some((f) => f.from === site && f.to === ga?.id)).toBe(true)
  })

  it('collapses subdomains of one owner-and-category into a single place', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'www.google-analytics.com', requestCount: 4 },
          { host: 'region1.google-analytics.com', requestCount: 2 },
        ],
      }),
      DICT,
      IDS,
    )
    expect(p.places.filter((pl) => pl.name === 'Google Analytics')).toHaveLength(1)
  })

  it('keeps two categories from one owner as separate places', () => {
    // Collapsing on owner alone would merge these into "Google" and lose the
    // purpose, which is the map's grouping unit — and would stop the analytics
    // expectation matching, producing a false gap on a map that just observed
    // Google Analytics.
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'www.google-analytics.com', requestCount: 4 },
          { host: 'doubleclick.net', requestCount: 9 },
        ],
      }),
      DICT,
      IDS,
    )
    const names = p.places.map((pl) => pl.name)
    expect(names).toContain('Google Analytics')
    expect(names).toContain('Google Ads')
  })

  it('names a place from a kebab-case category in words, not identifiers', () => {
    // Dictionary categories are identifiers; place names are read off a printed
    // map by a consultant sitting with a client. "Google Tag-manager" is not a
    // thing that exists.
    const d: VendorDictionary = {
      ...DICT,
      'googletagmanager.com': { owner: 'Google', category: 'tag-manager', purposeGroup: 'Marketing' },
    }
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'www.googletagmanager.com', requestCount: 3 },
        ],
      }),
      d,
      IDS,
    )
    expect(p.places.map((pl) => pl.name)).toContain('Google Tag Manager')
  })

  it('renders acronym categories as acronyms, not mechanical title-case', () => {
    // "cdn", "crm" and "a-b-testing" are not ordinary words: a mechanical
    // kebab-split would print "Cdn", "Crm" and "A B Testing" on a client-
    // facing map, none of which are things that exist.
    const d: VendorDictionary = {
      ...DICT,
      'cloudflare.com': { owner: 'Cloudflare', category: 'cdn', purposeGroup: 'Running the systems' },
      'hubspot.com': { owner: 'HubSpot', category: 'crm', purposeGroup: 'Selling' },
      'optimizely.com': { owner: 'Optimizely', category: 'a-b-testing', purposeGroup: 'Marketing' },
    }
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'cloudflare.com', requestCount: 2 },
          { host: 'hubspot.com', requestCount: 3 },
          { host: 'optimizely.com', requestCount: 4 },
        ],
      }),
      d,
      IDS,
    )
    const names = p.places.map((pl) => pl.name)
    expect(names).toContain('Cloudflare CDN')
    expect(names).toContain('HubSpot CRM')
    expect(names).toContain('Optimizely A/B Testing')
  })

  it('replaces a stale request count on re-scan rather than keeping the first one', () => {
    // A domain's traffic volume is a fact about the last scan, not the first
    // one — leaving it at the original count after a second scan would make
    // the observation actively wrong, not just outdated.
    const r1 = result({
      hosts: [
        { host: 'rossi-editore.it', requestCount: 1 },
        { host: 'doubleclick.net', requestCount: 2 },
      ],
    })
    const r2 = result({
      hosts: [
        { host: 'rossi-editore.it', requestCount: 1 },
        { host: 'doubleclick.net', requestCount: 77 },
      ],
    })
    const once = ingestScan(emptyProject(), r1, DICT, IDS)
    const twice = ingestScan(once, r2, DICT, { prefix: 'scan2' })
    expect(twice.observations).toEqual([
      { domain: 'rossi-editore.it', requestCount: 1, beforeConsent: true },
      { domain: 'doubleclick.net', requestCount: 77, beforeConsent: true },
    ])
  })

  it('collapses a host listed twice, in different case, into one observation', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'x.com', requestCount: 2 },
          { host: 'X.com', requestCount: 5 },
        ],
      }),
      DICT,
      IDS,
    )
    expect(p.observations.filter((o) => o.domain.toLowerCase() === 'x.com')).toHaveLength(1)
    expect(p.observations.find((o) => o.domain.toLowerCase() === 'x.com')?.requestCount).toBe(5)
  })

  it('shows an unrecognised host in full and does not collapse it', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'segment-data-us-east.zqtk.net', requestCount: 3 },
          { host: 'other.zqtk.net', requestCount: 1 },
        ],
      }),
      DICT,
      IDS,
    )
    const names = p.places.map((pl) => pl.name)
    expect(names).toContain('segment-data-us-east.zqtk.net')
    expect(names).toContain('other.zqtk.net')
    for (const n of ['segment-data-us-east.zqtk.net', 'other.zqtk.net']) {
      // Neither is in the dictionary, so neither is identified -- `kind` stays 'unknown' and
      // the map keeps drawing them as figures nobody has explained.
      expect(p.places.find((pl) => pl.name === n)?.kind).toBe('unknown')
    }
    // The purpose, though, is guessed from the host's own name where it says something:
    // "segment-data-..." reads as audience work, "other..." says nothing at all.
    expect(p.places.find((pl) => pl.name === 'segment-data-us-east.zqtk.net')?.purposeGroup).toBe(
      'Marketing',
    )
    expect(p.places.find((pl) => pl.name === 'other.zqtk.net')?.purposeGroup).toBe(
      'Not yet identified',
    )
  })

  it('records every host as an observation with its request count', () => {
    const p = ingestScan(
      emptyProject(),
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 12 },
          { host: 'doubleclick.net', requestCount: 9 },
        ],
      }),
      DICT,
      IDS,
    )
    expect(p.observations).toEqual([
      { domain: 'rossi-editore.it', requestCount: 12, beforeConsent: true },
      { domain: 'doubleclick.net', requestCount: 9, beforeConsent: true },
    ])
  })

  it('does not duplicate anything when the same site is scanned twice', () => {
    const r = result({
      hosts: [
        { host: 'rossi-editore.it', requestCount: 12 },
        { host: 'doubleclick.net', requestCount: 9 },
      ],
    })
    const once = ingestScan(emptyProject(), r, DICT, IDS)
    const twice = ingestScan(once, r, DICT, { prefix: 'scan2' })
    expect(twice.places).toHaveLength(once.places.length)
    expect(twice.flows).toHaveLength(once.flows.length)
    expect(twice.subjectGroups).toHaveLength(1)
  })

  it('adds a second site alongside the first rather than replacing it', () => {
    const first = ingestScan(emptyProject(), result(), DICT, IDS)
    const second = ingestScan(
      first,
      result({ scannedHost: 'rossi-webapp.it', hosts: [{ host: 'rossi-webapp.it', requestCount: 5 }] }),
      DICT,
      { prefix: 'scan2' },
    )
    expect(second.places.map((p) => p.name)).toContain('rossi-editore.it')
    expect(second.places.map((p) => p.name)).toContain('rossi-webapp.it')
    expect(second.subjectGroups).toHaveLength(1)
  })

  it('is pure — the project passed in is not mutated', () => {
    const before = emptyProject()
    const snapshot = JSON.stringify(before)
    ingestScan(before, result(), DICT, IDS)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('is pure on a second ingest — existing places and subject groups are not edited in place', () => {
    // emptyProject() has no places or subject groups, so the test above
    // cannot catch an in-place edit of an *existing* one. This one gives a
    // second ingest real objects to accidentally mutate.
    const before = ingestScan(emptyProject(), result(), DICT, IDS)
    const snapshot = JSON.stringify(before)
    ingestScan(
      before,
      result({
        hosts: [
          { host: 'rossi-editore.it', requestCount: 1 },
          { host: 'doubleclick.net', requestCount: 9 },
        ],
      }),
      DICT,
      { prefix: 'scan2' },
    )
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('a recognised cookie attaches to the place its domain identifies', () => {
    const result = scanResultWith({
      cookies: [{ name: '_ga', domain: 'google-analytics.com', session: false, expiresEpochSeconds: CAPTURED_AT + 86_400 * 400 }],
    })
    const after = ingestScan(emptyProject(), result, DICT, { prefix: 's1' })
    const ga = after.places.find((p) => p.name === 'Google Analytics')
    expect(after.cookies).toEqual([
      { name: '_ga', domain: 'google-analytics.com', thirdParty: true, lifetime: 'a-year-or-more', placeId: ga?.id },
    ])
  })

  it('an unrecognised cookie is kept and attached to nothing, not dropped', () => {
    const result = scanResultWith({
      cookies: [{ name: 'sid', domain: 'cdn.example-widget.com', session: true, expiresEpochSeconds: -1 }],
    })
    const after = ingestScan(emptyProject(), result, DICT, { prefix: 's1' })
    expect(after.cookies).toHaveLength(1)
    expect(after.cookies?.[0]?.placeId).toBeUndefined()
  })

  it('rescanning replaces cookie facts rather than duplicating them', () => {
    const once = ingestScan(emptyProject(), scanResultWith({ cookies: [GA_COOKIE] }), DICT, { prefix: 's1' })
    const twice = ingestScan(once, scanResultWith({ cookies: [GA_COOKIE] }), DICT, { prefix: 's2' })
    expect(twice.cookies).toHaveLength(1)
  })

  it('a first-party session cookie is recorded as exactly that', () => {
    const result = scanResultWith({
      scannedHost: 'rossi-editore.it',
      cookies: [{ name: 'lang', domain: 'rossi-editore.it', session: true, expiresEpochSeconds: -1 }],
    })
    const after = ingestScan(emptyProject(), result, DICT, { prefix: 's1' })
    expect(after.cookies?.[0]).toMatchObject({ thirdParty: false, lifetime: 'session' })
  })

  describe('own-subdomain skipping', () => {
    // Rust admission (src-tauri/src/scan.rs, src-tauri/src/admission.rs)
    // deliberately admits label-boundary subdomains of the scan origin as
    // part of the site itself, not as a third party. ingestScan must mirror
    // that rule exactly, or a site served from a subdomain (e.g.
    // www.rossi-editore.it) turns its own delivery host into a fabricated
    // third-party supplier.
    it('skips an observed host equal to the scanned host', () => {
      const p = ingestScan(
        emptyProject(),
        result({
          scannedHost: 'rossi-editore.it',
          hosts: [{ host: 'rossi-editore.it', requestCount: 12 }],
        }),
        DICT,
        IDS,
      )
      expect(p.places.some((pl) => pl.holder === 'supplier')).toBe(false)
    })

    it('skips a www. subdomain of the scanned host', () => {
      const p = ingestScan(
        emptyProject(),
        result({
          scannedHost: 'rossi-editore.it',
          hosts: [
            { host: 'rossi-editore.it', requestCount: 12 },
            { host: 'www.rossi-editore.it', requestCount: 4 },
          ],
        }),
        DICT,
        IDS,
      )
      expect(p.places.some((pl) => pl.holder === 'supplier')).toBe(false)
      expect(p.places.some((pl) => pl.name === 'www.rossi-editore.it')).toBe(false)
    })

    it('skips a deeper subdomain of the scanned host', () => {
      const p = ingestScan(
        emptyProject(),
        result({
          scannedHost: 'rossi-editore.it',
          hosts: [
            { host: 'rossi-editore.it', requestCount: 12 },
            { host: 'static.assets.rossi-editore.it', requestCount: 2 },
          ],
        }),
        DICT,
        IDS,
      )
      expect(p.places.some((pl) => pl.holder === 'supplier')).toBe(false)
    })

    it('does NOT skip a host that merely contains the scanned host without a label boundary', () => {
      const p = ingestScan(
        emptyProject(),
        result({
          scannedHost: 'rossi-editore.it',
          hosts: [
            { host: 'rossi-editore.it', requestCount: 12 },
            { host: 'evil-rossi-editore.it', requestCount: 2 },
          ],
        }),
        DICT,
        IDS,
      )
      const supplier = p.places.find((pl) => pl.name === 'evil-rossi-editore.it')
      expect(supplier).toBeDefined()
      expect(supplier?.holder).toBe('supplier')
    })

  })

  describe('collection points', () => {
    it('a page with collecting fields becomes one collection point', () => {
      const result = scanResultWith({ formFields: [
        { page: 'https://rossi-editore.it/contatti', name: 'email', type: 'email', autocomplete: '', label: '' },
        { page: 'https://rossi-editore.it/contatti', name: 'csrf', type: 'hidden', autocomplete: '', label: '' },
      ]})
      const after = ingestScan(emptyProject(), result, DICT, { prefix: 's1' })
      expect(after.collectionPoints).toEqual([
        { id: 's1-cp-1', page: 'https://rossi-editore.it/contatti', fields: [{ name: 'email', kind: 'email' }], sources: [], confidence: 'observed' },
      ])
    })
    it('a page with only non-collecting fields creates no door', () => {
      const result = scanResultWith({ formFields: [{ page: 'https://x.it/', name: 'go', type: 'submit', autocomplete: '', label: '' }] })
      expect(ingestScan(emptyProject(), result, DICT, { prefix: 's1' }).collectionPoints).toEqual([])
    })
    it('rescanning a page replaces its door rather than duplicating it', () => {
      const r = scanResultWith({ formFields: [{ page: 'https://x.it/c', name: 'email', type: 'email', autocomplete: '', label: '' }] })
      const twice = ingestScan(ingestScan(emptyProject(), r, DICT, { prefix: 's1' }), r, DICT, { prefix: 's2' })
      expect(twice.collectionPoints).toHaveLength(1)
    })
  })

  describe('own-subdomain skipping (suffix)', () => {
    it('does NOT skip a suffix-trick host where the scanned host appears as a prefix label chain', () => {
      const p = ingestScan(
        emptyProject(),
        result({
          scannedHost: 'rossi-editore.it',
          hosts: [
            { host: 'rossi-editore.it', requestCount: 12 },
            { host: 'rossi-editore.it.evil.com', requestCount: 2 },
          ],
        }),
        DICT,
        IDS,
      )
      const supplier = p.places.find((pl) => pl.name === 'rossi-editore.it.evil.com')
      expect(supplier).toBeDefined()
      expect(supplier?.holder).toBe('supplier')
    })
  })
})
