import { describe, it, expect } from 'vitest'
import { deriveDoors } from '../../src/core/doors'
import { ingestScan } from '../../src/core/scan'
import type { ScanResult } from '../../src/core/types'
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
    formFields: pages.map((page) => ({
      page,
      name: 'email',
      type: 'email',
      autocomplete: 'email',
      label: 'Email',
    })),
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
