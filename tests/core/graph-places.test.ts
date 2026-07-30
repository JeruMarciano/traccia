import { describe, it, expect } from 'vitest'
import { createEmptyProject } from '../../src/core/project'
import { addPlace, updatePlace, removePlace } from '../../src/core/graph'
import type { Place } from '../../src/core/types'

const NOW = '2026-07-30T09:00:00.000Z'
const draft: Omit<Place, 'id'> = {
  name: 'Newsletter', kind: 'processor', purposeGroup: 'Marketing',
  holder: 'supplier', leavesEEA: false, sources: [], confidence: 'declared',
}

describe('place mutations', () => {
  it('adds a place with the supplied id', () => {
    const p = addPlace(createEmptyProject('X', NOW), draft, 'pl-1')
    expect(p.places).toHaveLength(1)
    expect(p.places[0]?.id).toBe('pl-1')
    expect(p.places[0]?.name).toBe('Newsletter')
  })

  it('does not mutate the project passed in', () => {
    const before = createEmptyProject('X', NOW)
    addPlace(before, draft, 'pl-1')
    expect(before.places).toEqual([])
  })

  it('rejects a duplicate id', () => {
    const p = addPlace(createEmptyProject('X', NOW), draft, 'pl-1')
    expect(() => addPlace(p, draft, 'pl-1')).toThrow('Place id already exists: pl-1')
  })

  it('applies a patch and leaves other fields alone', () => {
    let p = addPlace(createEmptyProject('X', NOW), draft, 'pl-1')
    p = updatePlace(p, 'pl-1', { retention: '2 years', confidence: 'observed' })
    expect(p.places[0]?.retention).toBe('2 years')
    expect(p.places[0]?.confidence).toBe('observed')
    expect(p.places[0]?.name).toBe('Newsletter')
  })

  it('throws when updating a place that does not exist', () => {
    const p = createEmptyProject('X', NOW)
    expect(() => updatePlace(p, 'nope', { retention: '1 year' })).toThrow('No such place: nope')
  })

  it('removes a place', () => {
    let p = addPlace(createEmptyProject('X', NOW), draft, 'pl-1')
    p = removePlace(p, 'pl-1')
    expect(p.places).toEqual([])
  })
})
