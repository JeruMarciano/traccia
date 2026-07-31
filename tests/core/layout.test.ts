import { describe, it, expect } from 'vitest'
import { computeLayout } from '../../src/core/layout'
import { place, projectWithPlaces } from '../fixtures/projects'

const SIZE = { width: 800, height: 500 }

function mixed() {
  return projectWithPlaces(
    place({ name: 'Newsletter', purposeGroup: 'Marketing', leavesEEA: true }),
    place({ name: 'Ads', purposeGroup: 'Marketing', kind: 'unknown', leavesEEA: 'unknown' }),
    place({ name: 'Helpdesk', purposeGroup: 'Support' }),
  )
}

describe('computeLayout', () => {
  it('puts one node at the centre for the people', () => {
    const centre = computeLayout(mixed(), SIZE).nodes.find((n) => n.kind === 'subject')
    expect(centre?.x).toBe(400)
    expect(centre?.y).toBe(250)
  })

  it('emits one node per occupied purpose group, alphabetically', () => {
    const groups = computeLayout(mixed(), SIZE).nodes.filter((n) => n.kind === 'group')
    expect(groups.map((g) => g.label)).toEqual(['Marketing', 'Support'])
  })

  it('counts places, EEA departures and unexplained per group', () => {
    const mk = computeLayout(mixed(), SIZE).nodes.find((n) => n.label === 'Marketing')
    expect(mk?.count).toBe(2)
    expect(mk?.leavesEEA).toBe(1)
    expect(mk?.unexplained).toBe(1)
  })

  it('connects every group to the centre', () => {
    const l = computeLayout(mixed(), SIZE)
    expect(l.edges).toHaveLength(2)
    expect(l.edges.every((e) => e.from === 'centre')).toBe(true)
  })

  it('produces identical coordinates on repeat calls', () => {
    expect(computeLayout(mixed(), SIZE)).toEqual(computeLayout(mixed(), SIZE))
  })

  it('leaves out purpose groups that hold nothing', () => {
    const labels = computeLayout(mixed(), SIZE).nodes.map((n) => n.label)
    expect(labels).not.toContain('Delivering orders')
  })
})
