import { describe, it, expect } from 'vitest'
import { attributeGaps } from '../../src/core/gaps/attribute'
import { place, projectWithPlaces } from '../fixtures/projects'

describe('attributeGaps', () => {
  it('finds nothing when every field is answered', () => {
    expect(attributeGaps(projectWithPlaces(place()))).toEqual([])
  })

  it('reports a missing retention', () => {
    const gaps = attributeGaps(projectWithPlaces(place({ retention: undefined })))
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.kind).toBe('attribute')
    expect(gaps[0]?.subject).toBe('pl-1')
    expect(gaps[0]?.question).toBe('How long does A place keep this data?')
  })

  it('reports an unknown EEA answer', () => {
    const gaps = attributeGaps(projectWithPlaces(place({ leavesEEA: 'unknown' })))
    expect(gaps.map((g) => g.question)).toContain('Does data sent to A place leave the EEA?')
  })

  it('reports a place with no source at all', () => {
    const gaps = attributeGaps(projectWithPlaces(place({ sources: [] })))
    expect(gaps.map((g) => g.question)).toContain('Which document says A place receives data?')
  })

  it('gives every gap a stable id derived from the place and field', () => {
    const p = projectWithPlaces(place({ retention: undefined }))
    expect(attributeGaps(p)[0]?.id).toBe('attr:pl-1:retention')
    expect(attributeGaps(p)).toEqual(attributeGaps(p))
  })

  it('never reports retention for a place the organisation holds itself', () => {
    const gaps = attributeGaps(projectWithPlaces(place({ holder: 'you', retention: undefined })))
    expect(gaps.map((g) => g.id)).not.toContain('attr:pl-1:retention')
  })
})
