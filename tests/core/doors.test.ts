import { describe, it, expect } from 'vitest'
import { classifyDoors, deriveDoors, tracePaths } from '../../src/core/doors'
import { ingestScan } from '../../src/core/scan'
import type { RawFormField, ScanResult, VendorDictionary } from '../../src/core/types'
import { rossiEditore } from '../fixtures/rossiEditore'
import { emptyProject } from '../fixtures/projects'

describe('deriveDoors', () => {
  it('finds a door for every collection place and every collection point', () => {
    expect(deriveDoors(rossiEditore()).map((d) => d.id)).toEqual([
      'place:pl-2',
      'place:pl-3',
      'cp:cp-1',
    ])
  })

  it('says which doors were discovered and which were declared', () => {
    const byId = new Map(deriveDoors(rossiEditore()).map((d) => [d.id, d]))
    expect(byId.get('place:pl-2')?.origin).toBe('declared')
    expect(byId.get('cp:cp-1')?.origin).toBe('discovered')
  })

  it('labels a discovered door with its page and a declared one with its place name', () => {
    const byId = new Map(deriveDoors(rossiEditore()).map((d) => [d.id, d]))
    expect(byId.get('place:pl-2')?.label).toBe('Newsletter sign-up')
    expect(byId.get('cp:cp-1')?.label).toBe('https://rossi-editore.it/contatti')
  })

  it('carries the field names asked at a discovered door', () => {
    const cp = deriveDoors(rossiEditore()).find((d) => d.id === 'cp:cp-1')
    expect(cp?.fields).toEqual(['email', 'nome', 'messaggio'])
  })

  it('assigns colours by position and cycles past six', () => {
    const many = emptyProject()
    many.collectionPoints = Array.from({ length: 7 }, (_, i) => ({
      id: `cp-${i + 1}`,
      page: `https://example.test/${i + 1}`,
      fields: [],
      sources: [],
      confidence: 'observed' as const,
    }))
    expect(deriveDoors(many).map((d) => d.colourIndex)).toEqual([0, 1, 2, 3, 4, 5, 0])
  })

  it('returns nothing for a project with no doors', () => {
    expect(deriveDoors(emptyProject())).toEqual([])
  })

  it('is deterministic', () => {
    expect(deriveDoors(rossiEditore())).toEqual(deriveDoors(rossiEditore()))
  })
})

describe('tracePaths', () => {
  const paths = () => {
    const p = rossiEditore()
    return tracePaths(p, deriveDoors(p))
  }

  it('gives every door a path entry, even one nothing flows through', () => {
    expect(paths().map((p) => p.doorId)).toEqual(['place:pl-2', 'place:pl-3', 'cp:cp-1'])
  })

  it('follows a flow out of the door place to its destination', () => {
    expect(paths().find((p) => p.doorId === 'place:pl-2')?.destinationIds).toEqual(['pl-4'])
  })

  it('keeps two doors that feed the same destination separate', () => {
    expect(paths().find((p) => p.doorId === 'place:pl-3')?.destinationIds).toEqual(['pl-5', 'pl-4'])
    expect(paths().find((p) => p.doorId === 'place:pl-2')?.destinationIds).toEqual(['pl-4'])
  })

  it('records who comes through the door', () => {
    expect(paths().find((p) => p.doorId === 'place:pl-2')?.subjectIds).toEqual(['sg-2'])
    expect(paths().find((p) => p.doorId === 'place:pl-3')?.subjectIds).toEqual(['sg-1'])
  })

  it('leaves a discovered door with no flows empty rather than absent', () => {
    const cp = paths().find((p) => p.doorId === 'cp:cp-1')
    expect(cp).toBeDefined()
    expect(cp?.destinationIds).toEqual([])
    expect(cp?.subjectIds).toEqual([])
  })

  it('does not walk a second hop', () => {
    const p = rossiEditore()
    p.flows.push({
      id: 'fl-7',
      from: 'pl-4',
      to: 'pl-5',
      dataDescription: 'x',
      purpose: 'y',
      sources: [],
      confidence: 'inferred',
    })
    expect(tracePaths(p, deriveDoors(p)).find((t) => t.doorId === 'place:pl-2')?.destinationIds).toEqual([
      'pl-4',
    ])
  })

  it('terminates on a cycle between two places', () => {
    const p = rossiEditore()
    p.flows.push({
      id: 'fl-7',
      from: 'pl-4',
      to: 'pl-2',
      dataDescription: 'x',
      purpose: 'y',
      sources: [],
      confidence: 'inferred',
    })
    expect(() => tracePaths(p, deriveDoors(p))).not.toThrow()
  })

  it('counts only subject groups as people coming through, not places', () => {
    // fl-3 runs pl-2 -> pl-4, so pl-4's door would list pl-2 as a person if the filter went.
    const p = rossiEditore()
    const traced = tracePaths(p, deriveDoors(p))
    expect(traced.every((t) => t.subjectIds.every((id) => id.startsWith('sg-')))).toBe(true)
  })
})

// Door colour is keyed off position in project order, so anything that renumbers or reorders
// collection points silently repaints the map. ingestScan matches an existing point by its page
// and updates it in place; this holds that behaviour still, from the door's side, because the
// symptom of losing it appears here and not in scan.ts's own tests.
describe('door colour across a rescan', () => {
  const scan = (pages: string[]): ScanResult => ({
    scannedHost: 'rossi-editore.it',
    hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
    pagesVisited: pages.length,
    possibleGaps: 0,
    stoppedEarly: false,
    cookies: [],
    // Two fields per page: a lone email field would be a newsletter door, merged across pages.
    formFields: pages.flatMap((page) => [
      { page, name: 'email', type: 'email', autocomplete: 'email', label: 'Email' },
      { page, name: 'nome', type: 'text', autocomplete: '', label: 'Nome' },
    ]),
    storageKeys: [],
    consentMarkers: [],
    capturedAtEpochSeconds: 1_770_000_000,
  })

  it('keeps a door its colour when a later scan finds another door', () => {
    const first = ingestScan(emptyProject(), scan(['https://rossi-editore.it/contatti']), {}, {
      prefix: 'scan1',
    })
    // Two doors, not one: ingestScan makes the scanned site itself a collection place, and the
    // page with the form is a collection point on top of it.
    const before = deriveDoors(first)
    expect(before.map((d) => d.label)).toEqual([
      'rossi-editore.it',
      'https://rossi-editore.it/contatti',
    ])

    const second = ingestScan(
      first,
      scan(['https://rossi-editore.it/newsletter', 'https://rossi-editore.it/contatti']),
      {},
      { prefix: 'scan2' },
    )
    const after = deriveDoors(second)
    expect(after).toHaveLength(3)

    const kept = after.find((d) => d.label === 'https://rossi-editore.it/contatti')
    const was = before.find((d) => d.label === 'https://rossi-editore.it/contatti')
    expect(kept?.id).toBe(was?.id)
    expect(kept?.colourIndex).toBe(was?.colourIndex)
  })
})

describe('classifyDoors', () => {
  const DICT: VendorDictionary = {
    'sibforms.com': { owner: 'Brevo', category: 'email-marketing', purposeGroup: 'Marketing' },
    'tawk.to': { owner: 'Tawk.to', category: 'live-chat', purposeGroup: 'Support' },
    'www.google.com': { owner: 'Google', category: 'maps', purposeGroup: 'Systems' },
  }
  const f = (page: string, name: string, type: string, form: number, actionHost = ''): RawFormField => ({
    page, name, type, autocomplete: '', label: '', form, actionHost,
  })
  const result = (over: Partial<ScanResult> = {}): ScanResult => ({
    scannedHost: 'rossi-editore.it',
    hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
    pagesVisited: 1,
    possibleGaps: 0,
    stoppedEarly: false,
    cookies: [],
    formFields: [],
    storageKeys: [],
    capturedAtEpochSeconds: 0,
    ...over,
  })

  it('a lone search box is not a door', () => {
    expect(classifyDoors(result({ formFields: [f('/cerca', 'q', 'search', 0)] }), DICT)).toEqual([])
  })
  it('email + password is a form, not a newsletter', () => {
    const d = classifyDoors(result({ formFields: [f('/login', 'email', 'email', 0), f('/login', 'pw', 'password', 0)] }), DICT)
    expect(d.map((x) => x.kind)).toEqual(['form'])
    // Even when the action is a mailing vendor, asking for a password keeps it a form.
    const hosted = classifyDoors(
      result({ formFields: [f('/login', 'email', 'email', 0, 'sibforms.com'), f('/login', 'pw', 'password', 0, 'sibforms.com')] }),
      DICT,
    )
    expect(hosted.map((x) => x.kind)).toEqual(['form'])
  })
  it('a lone email field posting to a mailing vendor is a newsletter with that provider', () => {
    const d = classifyDoors(result({ formFields: [f('/', 'EMAIL', 'email', 1, 'sibforms.com')] }), DICT)
    expect(d).toMatchObject([{ kind: 'newsletter', provider: 'sibforms.com' }])
  })
  it('an off-site booking link is a booking door with that provider', () => {
    const d = classifyDoors(result({ offsiteLinks: [{ page: '/', host: 'www.simplebooking.it', purpose: 'booking' }] }), DICT)
    expect(d).toMatchObject([{ kind: 'booking', provider: 'www.simplebooking.it', pages: ['/'] }])
  })
  it('a maps embed on six pages is one door listing six pages', () => {
    const iframes = [1, 2, 3, 4, 5, 6].map((n) => ({ page: `/p${n}`, host: 'www.google.com', segment: 'maps' }))
    const d = classifyDoors(result({ iframes }), DICT)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ kind: 'embed', provider: 'www.google.com' })
    expect(d[0]?.pages).toHaveLength(6)
  })
  it('an embed is classified by host and segment: maps is an embed, a bare search host is not', () => {
    const dict: VendorDictionary = {
      'google.com': { owner: 'Google', category: 'search', purposeGroup: 'Systems' },
      'www.google.com/maps': { owner: 'Google', category: 'maps', purposeGroup: 'Systems' },
      'www.google.com/recaptcha': { owner: 'Google', category: 'captcha', purposeGroup: 'Systems' },
    }
    const iframe = (segment: string) => ({ page: '/', host: 'www.google.com', segment })
    expect(classifyDoors(result({ iframes: [iframe('maps')] }), dict)).toMatchObject([{ kind: 'embed', segment: 'maps' }])
    expect(classifyDoors(result({ iframes: [iframe('recaptcha')] }), dict)).toMatchObject([{ kind: 'embed', segment: 'recaptcha' }])
    expect(classifyDoors(result({ iframes: [iframe('search')] }), dict)).toEqual([])
  })
  it('a same-site iframe is not an embed door', () => {
    const iframes = [{ page: '/', host: 'www.rossi-editore.it', segment: 'maps' }]
    expect(classifyDoors(result({ iframes }), { ...DICT, 'rossi-editore.it': DICT['www.google.com']! })).toEqual([])
  })
  it('a chat vendor host seen anywhere is a chat door', () => {
    const d = classifyDoors(result({ hosts: [{ host: 'embed.tawk.to', requestCount: 1 }] }), DICT)
    expect(d).toMatchObject([{ kind: 'chat', provider: 'embed.tawk.to' }])
  })
  it('a contact form on two pages is two form doors', () => {
    const d = classifyDoors(
      result({ formFields: [f('/a', 'nome', 'text', 0), f('/b', 'nome', 'text', 0)] }),
      DICT,
    )
    expect(d.map((x) => [x.kind, x.page])).toEqual([['form', '/a'], ['form', '/b']])
  })
})
