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

function result(over: Partial<ScanResult> = {}): ScanResult {
  return {
    scannedHost: 'rossi-editore.it',
    hosts: [{ host: 'rossi-editore.it', requestCount: 12 }],
    pagesVisited: 1,
    ...over,
  }
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
      expect(p.places.find((pl) => pl.name === n)?.purposeGroup).toBe('Not yet identified')
      expect(p.places.find((pl) => pl.name === n)?.kind).toBe('unknown')
    }
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
})
