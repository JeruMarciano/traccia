import { describe, it, expect } from 'vitest'
import { deriveDoors, tracePaths } from '../../src/core/doors'
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
