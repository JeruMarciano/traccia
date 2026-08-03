// The detail bar's data assembly, pulled out as a pure function so the mix of dictionary
// names, observations and genuine unknowns can be checked without rendering anything. See
// src/renderer/placeDetails.ts and src/renderer/components/DetailPanel.tsx.
import { describe, it, expect } from 'vitest'
import { placeDetails, placeIdsForSelection } from '../../src/renderer/placeDetails'
import { emptyProject, place } from '../fixtures/projects'
import { addPlace } from '../../src/core/graph'
import type { Project, VendorDictionary } from '../../src/core/types'

const DICTIONARY: VendorDictionary = {
  'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Marketing' },
}

describe('placeDetails', () => {
  it('is null for a null id', () => {
    expect(placeDetails(emptyProject(), null, DICTIONARY)).toBeNull()
  })

  it('is null for an id that names no place -- a dangling or stale selection', () => {
    expect(placeDetails(emptyProject(), 'nope', DICTIONARY)).toBeNull()
  })

  it('assembles a place with nothing but a name: unknowns read as not yet identified, not as blank', () => {
    let p = emptyProject()
    p = addPlace(
      p,
      {
        name: 'Some Host',
        kind: 'unknown',
        purposeGroup: 'not yet identified',
        holder: 'unknown',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'observed',
      },
      'pl-1',
    )

    const d = placeDetails(p, 'pl-1', DICTIONARY)
    expect(d).not.toBeNull()
    expect(d?.name).toBe('Some Host')
    expect(d?.whereLabel).toBe('not yet identified')
    expect(d?.retentionLabel).toBe('not yet identified')
    expect(d?.observations).toEqual([])
  })

  it('assembles a dictionary-named place: jurisdiction, retention, and the observed domains', () => {
    let p = emptyProject()
    p = addPlace(
      p,
      {
        name: 'Google Analytics',
        kind: 'processor',
        purposeGroup: 'Marketing',
        holder: 'supplier',
        leavesEEA: true,
        jurisdiction: 'US',
        retention: '2 years',
        sources: [],
        confidence: 'observed',
      },
      'pl-ga',
    )
    // Two distinct observed hosts that scan.ts's naming collapses onto the same place: a bare
    // domain and a subdomain of it. Both should show up against "Google Analytics", not just
    // the one that matches the dictionary key verbatim.
    p = {
      ...p,
      observations: [
        { domain: 'google-analytics.com', requestCount: 4, beforeConsent: true },
        { domain: 'www.google-analytics.com', requestCount: 9, beforeConsent: true },
      ],
    }

    const d = placeDetails(p, 'pl-ga', DICTIONARY)
    expect(d).not.toBeNull()
    expect(d?.name).toBe('Google Analytics')
    expect(d?.whereLabel).toBe('US')
    expect(d?.retentionLabel).toBe('2 years')
    expect(d?.observations).toEqual([
      { domain: 'google-analytics.com', requestCount: 4, beforeConsent: true },
      { domain: 'www.google-analytics.com', requestCount: 9, beforeConsent: true },
    ])
  })

  it('reads what is held as one line when the document listed categories', () => {
    let p = emptyProject()
    p = addPlace(p, { ...place(), dataCategories: ['Name', 'Email address'] }, 'pl-1')
    expect(placeDetails(p, 'pl-1', DICTIONARY)?.dataCategoriesLabel).toBe('Name, Email address')
  })

  it('says not yet identified when nobody has said what is held', () => {
    // Neutral copy on an unanswered line: a blank or a "none" would both be claims the tool
    // cannot make. An empty array reads the same as an absent one for exactly that reason.
    let p = emptyProject()
    p = addPlace(p, { ...place(), name: 'A' }, 'pl-none')
    p = addPlace(p, { ...place(), name: 'B', dataCategories: [] }, 'pl-empty')
    expect(placeDetails(p, 'pl-none', DICTIONARY)?.dataCategoriesLabel).toBe('not yet identified')
    expect(placeDetails(p, 'pl-empty', DICTIONARY)?.dataCategoriesLabel).toBe('not yet identified')
  })

  it('answers where from leavesEEA when no jurisdiction is recorded', () => {
    let p = emptyProject()
    p = addPlace(p, { ...place(), name: 'A', leavesEEA: true }, 'pl-out')
    p = addPlace(p, { ...place(), name: 'B', leavesEEA: false }, 'pl-in')

    expect(placeDetails(p, 'pl-out', DICTIONARY)?.whereLabel).toBe('Outside the EEA')
    expect(placeDetails(p, 'pl-in', DICTIONARY)?.whereLabel).toBe('Inside the EEA')
  })
})

describe('placeIdsForSelection', () => {
  const project: Project = (() => {
    let p = emptyProject()
    p = addPlace(p, { ...place(), name: 'A', purposeGroup: 'Marketing' }, 'pl-1')
    p = addPlace(p, { ...place(), name: 'B', purposeGroup: 'Marketing' }, 'pl-2')
    p = addPlace(p, { ...place(), name: 'C', purposeGroup: 'Analytics' }, 'pl-3')
    return p
  })()

  it('is empty for no selection', () => {
    expect(placeIdsForSelection(project, null)).toEqual([])
  })

  it('is empty for the people hub', () => {
    expect(placeIdsForSelection(project, 'centre')).toEqual([])
  })

  it('lists every place in the selected purpose group', () => {
    expect(placeIdsForSelection(project, 'group:Marketing')).toEqual(['pl-1', 'pl-2'])
  })

  it('is empty for a group name that matches nothing', () => {
    expect(placeIdsForSelection(project, 'group:Nothing here')).toEqual([])
  })

  it('resolves a bare place id to that one place', () => {
    expect(placeIdsForSelection(project, 'pl-3')).toEqual(['pl-3'])
  })

  it('is empty for a bare id that names no place', () => {
    expect(placeIdsForSelection(project, 'fl-does-not-exist')).toEqual([])
  })
})
