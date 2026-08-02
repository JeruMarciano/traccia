// The detail panel's data assembly, pulled out as a pure function so the mix of dictionary
// names, flows and genuine unknowns can be checked without rendering anything. See
// src/renderer/placeDetails.ts and src/renderer/components/DetailPanel.tsx.
import { describe, it, expect } from 'vitest'
import { placeDetails, placeIdsForSelection } from '../../src/renderer/placeDetails'
import { emptyProject, place } from '../fixtures/projects'
import { addFlow, addPlace } from '../../src/core/graph'
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
    expect(d?.holderLabel).toBe('not yet identified')
    expect(d?.kindLabel).toBe('not yet identified')
    expect(d?.jurisdictionLabel).toBe('not yet identified')
    expect(d?.retentionLabel).toBe('not yet identified')
    expect(d?.leavesEEALabel).toBe('not yet identified')
    expect(d?.flowsIn).toEqual([])
    expect(d?.observations).toEqual([])
  })

  it('assembles a dictionary-named place with inbound flows and observed domains', () => {
    let p = emptyProject()
    p = addPlace(
      p,
      { ...place(), name: 'The Site', kind: 'collection', holder: 'you' },
      'pl-site',
    )
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
    p = addFlow(
      p,
      {
        from: 'pl-site',
        to: 'pl-ga',
        dataDescription: 'Page views',
        purpose: 'Audience measurement',
        sources: [],
        confidence: 'observed',
      },
      'fl-1',
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
    expect(d?.purposeGroup).toBe('Marketing')
    expect(d?.holderLabel).toBe('Held by a supplier')
    expect(d?.kindLabel).toBe('Processes data on your behalf')
    expect(d?.confidenceLabel).toBe('Observed by a scan')
    expect(d?.jurisdictionLabel).toBe('US')
    expect(d?.retentionLabel).toBe('2 years')
    expect(d?.leavesEEALabel).toBe('Leaves the EEA')
    expect(d?.flowsIn).toEqual([
      { id: 'fl-1', dataDescription: 'Page views', purpose: 'Audience measurement', fromLabel: 'The Site' },
    ])
    expect(d?.observations).toEqual([
      { domain: 'google-analytics.com', requestCount: 4, beforeConsent: true },
      { domain: 'www.google-analytics.com', requestCount: 9, beforeConsent: true },
    ])
  })

  it('resolves a flow whose from is a subject group, not a place', () => {
    let p = emptyProject()
    p = { ...p, subjectGroups: [{ id: 'sg-1', name: 'Website visitors' }] }
    p = addPlace(p, { ...place(), name: 'The Site' }, 'pl-1')
    p = addFlow(
      p,
      {
        from: 'sg-1',
        to: 'pl-1',
        dataDescription: 'IP address',
        purpose: 'Running the systems',
        sources: [],
        confidence: 'observed',
      },
      'fl-1',
    )

    const d = placeDetails(p, 'pl-1', DICTIONARY)
    expect(d?.flowsIn[0]?.fromLabel).toBe('Website visitors')
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

  it('resolves a bare place id -- what RegisterPanel.onHover passes for a place-level gap -- to that one place', () => {
    expect(placeIdsForSelection(project, 'pl-3')).toEqual(['pl-3'])
  })

  it('is empty for a bare id that names no place', () => {
    expect(placeIdsForSelection(project, 'fl-does-not-exist')).toEqual([])
  })
})
