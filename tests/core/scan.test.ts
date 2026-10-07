import { describe, it, expect } from 'vitest'
import { ingestScan } from '../../src/core/scan'
import { emptyProject } from '../fixtures/projects'
import type { CookiePlatformRow, ScanResult, VendorDictionary } from '../../src/core/types'

const DICT: VendorDictionary = {
  'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Marketing' },
  'doubleclick.net': { owner: 'Google', category: 'ads', purposeGroup: 'Marketing' },
  'stripe.com': { owner: 'Stripe', category: 'payments', purposeGroup: 'Payments' },
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

  it('adds nothing for a scan whose page did not load: no site, no visitors, no cookie', () => {
    const before = emptyProject()
    const notLoaded = result({ pagesVisited: 0, possibleGaps: 1, hosts: [], cookies: [GA_COOKIE] })
    expect(ingestScan(before, notLoaded, DICT, IDS)).toBe(before)
  })

  it('still seeds the site for a scan the user stopped before any page loaded', () => {
    const p = ingestScan(emptyProject(), result({ pagesVisited: 0, stoppedEarly: true }), DICT, IDS)
    expect(p.places.map((pl) => pl.name)).toEqual(['rossi-editore.it'])
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
      'cloudflare.com': { owner: 'Cloudflare', category: 'cdn', purposeGroup: 'Systems' },
      'hubspot.com': { owner: 'HubSpot', category: 'crm', purposeGroup: 'Sales' },
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
        { page: 'https://rossi-editore.it/contatti', name: 'nome', type: 'text', autocomplete: '', label: '' },
        { page: 'https://rossi-editore.it/contatti', name: 'csrf', type: 'hidden', autocomplete: '', label: '' },
      ]})
      const after = ingestScan(emptyProject(), result, DICT, { prefix: 's1' })
      expect(after.collectionPoints).toEqual([
        { id: 's1-cp-1', page: 'https://rossi-editore.it/contatti', fields: [{ name: 'email', kind: 'email' }, { name: 'nome', kind: 'name' }], sources: [], confidence: 'observed' },
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
    it('a page seen again keeps the id it already had', () => {
      // The same door, not a new one. Its id is what the map selects on and what door colour is
      // assigned by, so renumbering on rescan repaints the sheet and drops the selection. A
      // length check alone does not catch that -- this one asserts identity.
      const r = scanResultWith({ formFields: [{ page: 'https://x.it/c', name: 'email', type: 'email', autocomplete: '', label: '' }] })
      const once = ingestScan(emptyProject(), r, DICT, { prefix: 's1' })
      const twice = ingestScan(once, r, DICT, { prefix: 's2' })
      expect(twice.collectionPoints?.[0]?.id).toBe(once.collectionPoints?.[0]?.id)
    })
    it('a page seen again takes the fresh capture’s fields', () => {
      // Two fields from the start: a lone email field is a newsletter door, not this form's.
      const first = scanResultWith({ formFields: [
        { page: 'https://x.it/c', name: 'email', type: 'email', autocomplete: '', label: '' },
        { page: 'https://x.it/c', name: 'nome', type: 'text', autocomplete: '', label: '' },
      ] })
      const second = scanResultWith({ formFields: [
        { page: 'https://x.it/c', name: 'email', type: 'email', autocomplete: '', label: '' },
        { page: 'https://x.it/c', name: 'nome', type: 'text', autocomplete: '', label: '' },
        { page: 'https://x.it/c', name: 'tel', type: 'tel', autocomplete: '', label: '' },
      ]})
      const twice = ingestScan(ingestScan(emptyProject(), first, DICT, { prefix: 's1' }), second, DICT, { prefix: 's2' })
      expect(twice.collectionPoints?.[0]?.fields.map((f) => f.name)).toEqual(['email', 'nome', 'tel'])
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

describe('ingestScan names by host and segment', () => {
  const D: VendorDictionary = {
    'www.google.com/recaptcha': { owner: 'Google', category: 'captcha', purposeGroup: 'Systems' },
    'www.google.com/maps': { owner: 'Google', category: 'maps', purposeGroup: 'Systems' },
  }
  const scan = (paths: string[]) =>
    result({ hosts: [{ host: 'www.google.com', requestCount: 4, paths }] })
  it('two listed segments are two places; the bare host appears only for a segment nothing matched', () => {
    const two = ingestScan(emptyProject(), scan(['maps', 'recaptcha']), D, IDS)
    expect(two.places.map((p) => p.name).sort()).toEqual(['Google Captcha', 'Google Maps', 'rossi-editore.it'])
    const three = ingestScan(emptyProject(), scan(['maps', 'search']), D, IDS)
    expect(three.places.map((p) => p.name).sort()).toEqual(['Google Maps', 'rossi-editore.it', 'www.google.com'])
    expect(three.observations.find((o) => o.domain === 'www.google.com')?.paths).toEqual(['maps', 'search'])
  })
})

describe('ingestScan names cookies by platform', () => {
  const TABLE: CookiePlatformRow[] = [['_ga', 'Google Analytics', 'Analytics', 0], ['_fbp', 'Meta Pixel', 'Marketing', 0]]
  const cookie = (name: string) => ({ name, domain: 'rossi-editore.it', session: false, expiresEpochSeconds: CAPTURED_AT + 86_400 * 400 })
  it('attaches to a place of that name, and invents no place when there is none', () => {
    const scan = scanResultWith({ hosts: [{ host: 'www.google-analytics.com', requestCount: 1 }], cookies: [cookie('_ga'), cookie('_fbp')] })
    const p = ingestScan(emptyProject(), scan, DICT, IDS, TABLE)
    const ga = p.places.find((pl) => pl.name === 'Google Analytics')
    expect(p.cookies?.find((c) => c.name === '_ga')).toMatchObject({ platform: 'Google Analytics', placeId: ga?.id })
    expect(p.cookies?.find((c) => c.name === '_fbp')).toMatchObject({ platform: 'Meta Pixel', placeId: undefined })
    expect(p.places.map((pl) => pl.name).sort()).toEqual(['Google Analytics', 'rossi-editore.it'])
  })
})

describe('ingestScan consent phase', () => {
  it('marks an observation before consent only when its host was first seen before', () => {
    const p = ingestScan(emptyProject(), { ...result(), hosts: [
      { host: 'site.it', requestCount: 3, phase: 'before' },
      { host: 'pre.example', requestCount: 1, phase: 'before' },
      { host: 'post.example', requestCount: 1, phase: 'after' },
    ] }, DICT, { prefix: 's1' })
    const by = Object.fromEntries(p.observations.map((o) => [o.domain, o.beforeConsent]))
    expect(by['pre.example']).toBe(true)
    expect(by['post.example']).toBe(false)
  })

  it('treats a host without a phase as before consent (a v0.3 payload)', () => {
    const p = ingestScan(emptyProject(), { ...result(), hosts: [
      { host: 'old.example', requestCount: 1 },
    ] }, DICT, { prefix: 's1' })
    expect(p.observations.find((o) => o.domain === 'old.example')?.beforeConsent).toBe(true)
  })

  it('leaves the phase unknown for a host without one when the scan has a consent record', () => {
    const consent = { cmp: null, clicked: false, rule: null, ruleName: '', matchedText: '', clickNavigated: false } as const
    const p = ingestScan(emptyProject(), { ...result(), consent, hosts: [
      { host: 'unsure.example', requestCount: 1 },
      { host: 'pre.example', requestCount: 1, phase: 'before' },
      { host: 'post.example', requestCount: 1, phase: 'after' },
    ] }, DICT, { prefix: 's1' })
    const by = Object.fromEntries(p.observations.map((o) => [o.domain, o.beforeConsent]))
    expect(by['unsure.example']).toBeUndefined()
    expect('beforeConsent' in (p.observations.find((o) => o.domain === 'unsure.example') ?? {})).toBe(false)
    expect(by['pre.example']).toBe(true)
    expect(by['post.example']).toBe(false)
  })

  describe('on a rescan the latest scan wins', () => {
    const consent = { cmp: null, clicked: true, rule: 'text', ruleName: '', matchedText: 'accetta', clickNavigated: false } as const
    const first = (phase: 'before' | 'after') =>
      ingestScan(emptyProject(), { ...result(), consent, hosts: [{ host: 't.example', requestCount: 1, phase }] }, DICT, { prefix: 's1' })
    const again = (project: ReturnType<typeof first>, over: Partial<ScanResult>, phase?: 'before' | 'after') =>
      ingestScan(project, { ...result(), ...over, hosts: [{ host: 't.example', requestCount: 2, ...(phase ? { phase } : {}) }] }, DICT, { prefix: 's2' })
        .observations.find((o) => o.domain === 't.example')

    it('a host recorded before consent that the rescan saw only after is no longer before', () => {
      expect(again(first('before'), { consent }, 'after')).toMatchObject({ requestCount: 2, beforeConsent: false })
    })

    it('a host recorded after consent that the rescan saw before is now before', () => {
      expect(again(first('after'), { consent }, 'before')?.beforeConsent).toBe(true)
    })

    it('a host the rescan has no phase for loses its phase when the rescan has a consent record', () => {
      const o = again(first('before'), { consent })
      expect(o?.requestCount).toBe(2)
      expect('beforeConsent' in (o ?? {})).toBe(false)
    })

    it('a v0.3 payload (no consent record) leaves a known host with the phase it had', () => {
      expect(again(first('after'), {})?.beforeConsent).toBe(false)
      expect(again(first('before'), {})?.beforeConsent).toBe(true)
    })
  })
})

describe('ingestScan doors', () => {
  const DOORS_DICT: VendorDictionary = {
    'sibforms.com': { owner: 'Brevo', category: 'email-marketing', purposeGroup: 'Marketing' },
  }
  const newsletter = (): ScanResult =>
    result({
      formFields: [
        { page: 'https://rossi-editore.it/', name: 'EMAIL', type: 'email', autocomplete: '', label: '', form: 0, actionHost: 'sibforms.com' },
      ],
      offsiteLinks: [{ page: 'https://rossi-editore.it/', host: 'www.simplebooking.it', purpose: 'booking' }],
    })

  it('creates the doors, creates the provider place and points the door at it', () => {
    const p = ingestScan(emptyProject(), newsletter(), DOORS_DICT, IDS)
    const place = (name: string) => p.places.find((x) => x.name === name)
    const booking = p.collectionPoints?.find((c) => c.kind === 'booking')
    expect(booking).toMatchObject({ provider: 'www.simplebooking.it', pages: ['https://rossi-editore.it/'] })
    expect(booking?.destination).toBe(place('www.simplebooking.it')?.id)
    const news = p.collectionPoints?.find((c) => c.kind === 'newsletter')
    expect(news?.provider).toBe('Brevo Email Marketing')
    expect(news?.destination).toBe(place('Brevo Email Marketing')?.id)
    expect(p.places.filter((x) => x.name === 'Brevo Email Marketing')).toHaveLength(1)
  })

  it('a rescanned door keeps its id: a form by page, the others by kind and provider', () => {
    const forms = (): ScanResult =>
      result({
        formFields: [{ page: 'https://rossi-editore.it/c', name: 'nome', type: 'text', autocomplete: '', label: '', form: 0, actionHost: '' }],
        offsiteLinks: [{ page: 'https://rossi-editore.it/', host: 'www.simplebooking.it', purpose: 'booking' }],
      })
    const once = ingestScan(emptyProject(), forms(), DOORS_DICT, IDS)
    const twice = ingestScan(once, forms(), DOORS_DICT, { prefix: 'scan2' })
    expect(twice.collectionPoints).toEqual(once.collectionPoints)
    expect(twice.collectionPoints).toHaveLength(2)
  })
})
