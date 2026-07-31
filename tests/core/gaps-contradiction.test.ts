import { describe, it, expect } from 'vitest'
import { contradictionGaps } from '../../src/core/gaps/contradiction'
import { mergeObservations } from '../../src/core/merge'
import { place, projectWithPlaces } from '../fixtures/projects'

describe('contradictionGaps', () => {
  it('finds nothing when no scan has run', () => {
    expect(contradictionGaps(projectWithPlaces(place()))).toEqual([])
  })

  it('reports each recipient no document accounts for', () => {
    const merged = mergeObservations(
      projectWithPlaces(place({ name: 'Newsletter', jurisdiction: 'mailer.example' })),
      [{ domain: 'tracker.example', requestCount: 9, beforeConsent: false }],
      'obs',
    )
    const gaps = contradictionGaps(merged)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.kind).toBe('contradiction')
    expect(gaps[0]?.question).toBe('What is tracker.example, and why does it receive data?')
  })

  it('raises severity when the recipient was contacted before consent', () => {
    const merged = mergeObservations(
      projectWithPlaces(place()),
      [{ domain: 'tracker.example', requestCount: 2, beforeConsent: true }],
      'obs',
    )
    expect(contradictionGaps(merged)[0]?.severity).toBe(1)
  })

  it('uses a stable id per domain', () => {
    const merged = mergeObservations(
      projectWithPlaces(place()),
      [{ domain: 'tracker.example', requestCount: 2, beforeConsent: false }],
      'obs',
    )
    expect(contradictionGaps(merged)[0]?.id).toBe('contra:tracker.example')
  })
})
