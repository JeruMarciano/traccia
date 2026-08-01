import { describe, it, expect } from 'vitest'
import { computeGaps } from '../../src/core/gaps'
import { updatePlace } from '../../src/core/graph'
import { place, projectWithPlaces } from '../fixtures/projects'

describe('computeGaps', () => {
  it('returns gaps of every applicable kind together', () => {
    const p = {
      ...projectWithPlaces(place({ retention: undefined })),
      subjectGroups: [{ id: 'sg-1', name: 'Employees' }],
    }
    const kinds = new Set(computeGaps(p).map((g) => g.kind))
    expect(kinds.has('attribute')).toBe(true)
    expect(kinds.has('existence')).toBe(true)
  })

  it('ranks severity 1 before severity 2', () => {
    const p = projectWithPlaces(place({ leavesEEA: 'unknown', retention: undefined }))
    expect(computeGaps(p)[0]?.severity).toBe(1)
  })

  it('is deterministic across calls', () => {
    const p = projectWithPlaces(place({ retention: undefined }))
    expect(computeGaps(p)).toEqual(computeGaps(p))
  })

  it('closes a gap when the answer arrives', () => {
    let p = projectWithPlaces(place({ retention: undefined }))
    expect(computeGaps(p).map((g) => g.id)).toContain('attr:pl-1:retention')
    p = updatePlace(p, 'pl-1', { retention: '18 months' })
    expect(computeGaps(p).map((g) => g.id)).not.toContain('attr:pl-1:retention')
  })

  it('reopens the same gap, with the same id, if the answer is removed', () => {
    let p = projectWithPlaces(place({ retention: '18 months' }))
    p = updatePlace(p, 'pl-1', { retention: undefined })
    expect(computeGaps(p).map((g) => g.id)).toContain('attr:pl-1:retention')
  })
})
