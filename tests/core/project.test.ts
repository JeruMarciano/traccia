import { describe, it, expect } from 'vitest'
import { createEmptyProject, DEFAULT_PURPOSE_GROUPS } from '../../src/core/project'

describe('createEmptyProject', () => {
  it('stamps schemaVersion 1 and the supplied timestamp', () => {
    const p = createEmptyProject('Rossi Editore', '2026-07-30T09:00:00.000Z')
    expect(p.schemaVersion).toBe(1)
    expect(p.name).toBe('Rossi Editore')
    expect(p.createdAt).toBe('2026-07-30T09:00:00.000Z')
  })

  it('starts with the default purpose groups and nothing else', () => {
    const p = createEmptyProject('X', '2026-07-30T09:00:00.000Z')
    expect(p.purposeGroups).toEqual([...DEFAULT_PURPOSE_GROUPS])
    expect(p.places).toEqual([])
    expect(p.flows).toEqual([])
    expect(p.subjectGroups).toEqual([])
    expect(p.observations).toEqual([])
  })

  it('returns an independent object each call', () => {
    const a = createEmptyProject('A', '2026-07-30T09:00:00.000Z')
    const b = createEmptyProject('B', '2026-07-30T09:00:00.000Z')
    a.places.push({
      id: 'p1', name: 'X', kind: 'internal', purposeGroup: 'Selling',
      holder: 'you', leavesEEA: false, sources: [], confidence: 'declared',
    })
    expect(b.places).toEqual([])
  })
})
