import { describe, it, expect } from 'vitest'
import { createEmptyProject } from '../../src/core/project'
import { addPlace, addFlow, removeFlow, removePlace } from '../../src/core/graph'
import type { Flow, Place } from '../../src/core/types'

const NOW = '2026-07-30T09:00:00.000Z'
const place = (name: string): Omit<Place, 'id'> => ({
  name, kind: 'internal', purposeGroup: 'Sales',
  holder: 'you', leavesEEA: false, sources: [], confidence: 'declared',
})
const flow: Omit<Flow, 'id'> = {
  from: 'pl-1', to: 'pl-2', dataDescription: 'Name, email',
  purpose: 'Fulfilling orders', sources: [], confidence: 'declared',
}

function twoPlaces() {
  let p = createEmptyProject('X', NOW)
  p = addPlace(p, place('Website'), 'pl-1')
  p = addPlace(p, place('CRM'), 'pl-2')
  return p
}

describe('flow mutations', () => {
  it('adds a flow between two places', () => {
    const p = addFlow(twoPlaces(), flow, 'fl-1')
    expect(p.flows).toHaveLength(1)
    expect(p.flows[0]?.id).toBe('fl-1')
  })

  it('rejects a flow whose endpoint does not exist', () => {
    const p = twoPlaces()
    expect(() => addFlow(p, { ...flow, to: 'ghost' }, 'fl-1'))
      .toThrow('Flow endpoint does not exist: ghost')
  })

  it('rejects a duplicate flow id', () => {
    const p = addFlow(twoPlaces(), flow, 'fl-1')
    expect(() => addFlow(p, flow, 'fl-1')).toThrow('Flow id already exists: fl-1')
  })

  it('removes a flow', () => {
    let p = addFlow(twoPlaces(), flow, 'fl-1')
    p = removeFlow(p, 'fl-1')
    expect(p.flows).toEqual([])
  })

  it('removing a place also removes every flow touching it', () => {
    let p = addFlow(twoPlaces(), flow, 'fl-1')
    p = removePlace(p, 'pl-2')
    expect(p.places).toHaveLength(1)
    expect(p.flows).toEqual([])
  })
})
