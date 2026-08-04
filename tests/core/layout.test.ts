import { describe, it, expect } from 'vitest'
import { computeLayout } from '../../src/core/layout'
import { rossiEditore } from '../fixtures/rossiEditore'
import { emptyProject } from '../fixtures/projects'

const SIZE = { width: 800, height: 500 }
const l = (open: string | null = null) => computeLayout(rossiEditore(), SIZE, open)
const node = (id: string, open: string | null = null) => l(open).nodes.find((n) => n.id === id)

describe('the sentence, left to right', () => {
  it('puts the people left of the doors, and the doors left of the controller', () => {
    const x = (id: string) => node(id)?.x ?? NaN
    expect(x('sg-2')).toBeLessThan(x('door:place:pl-2'))
    expect(x('door:place:pl-2')).toBeLessThan(x('controller'))
  })

  it('sets the groups around the controller, on the far side from the way in', () => {
    // Groups ring the centre rather than stacking in a column, so "every group is right of the
    // controller" is no longer the rule and a test asserting it would pass or fail on which
    // group it happened to pick. What must hold is that no group lands on the inbound side.
    const l0 = l()
    const doors = l0.nodes.filter((n) => n.kind === 'door')
    const rightmostDoor = Math.max(...doors.map((d) => d.x))
    const groups = l0.nodes.filter((n) => n.kind === 'group')
    expect(groups.length).toBeGreaterThan(1)
    for (const g of groups) {
      expect(g.x).toBeGreaterThan(rightmostDoor + 60)
    }
  })

  it('spreads the groups around the centre rather than down one line', () => {
    const groups = l().nodes.filter((n) => n.kind === 'group')
    expect(new Set(groups.map((g) => g.x)).size).toBeGreaterThan(1)
    expect(new Set(groups.map((g) => g.y)).size).toBe(groups.length)
  })

  it('keeps the inbound arrows short by holding the three columns close together', () => {
    const x = (id: string) => node(id)?.x ?? NaN
    // The people, the door and the centre are one phrase. Distance between them adds no meaning,
    // so the gap stays under a quarter of the sheet at each step.
    expect(x('door:place:pl-2') - x('sg-2')).toBeLessThan(SIZE.width * 0.25)
    expect(x('controller') - x('door:place:pl-2')).toBeLessThan(SIZE.width * 0.25)
  })

  it('draws exactly one controller', () => {
    expect(l().nodes.filter((n) => n.kind === 'controller')).toHaveLength(1)
  })

  it('names the controller when a document did', () => {
    expect(node('controller')?.label).toBe('Rossi Editore srl')
  })

  it('leaves the controller label empty when nothing named one, for the renderer to speak', () => {
    const p = emptyProject()
    p.places = [
      {
        id: 'pl-1',
        name: 'Mailchimp',
        kind: 'processor',
        purposeGroup: 'Marketing',
        holder: 'supplier',
        leavesEEA: true,
        sources: [],
        confidence: 'declared',
      },
    ]
    expect(computeLayout(p, SIZE).nodes.find((n) => n.kind === 'controller')?.label).toBe('')
  })

  it('draws one door per derived door', () => {
    expect(l().nodes.filter((n) => n.kind === 'door').map((n) => n.id)).toEqual([
      'door:place:pl-2',
      'door:place:pl-3',
      'door:cp:cp-1',
    ])
  })

  it('says whether a door was discovered or declared', () => {
    expect(node('door:cp:cp-1')?.origin).toBe('discovered')
    expect(node('door:place:pl-2')?.origin).toBe('declared')
  })

  it('draws only the people who reach a door, in project order', () => {
    const subjects = l().nodes.filter((n) => n.kind === 'subject').map((n) => n.id)
    expect(subjects).toEqual(['sg-1', 'sg-2'])
    expect(subjects).not.toContain('sg-3')
  })
})

describe('nothing is drawn twice', () => {
  it('leaves a door out of the purpose group on the right', () => {
    // pl-2 is a collection place in Marketing. It is already a door on the inbound side; drawing
    // it again as a member of Marketing would put one place on the sheet twice.
    expect(node('group:Marketing')?.count).toBe(2)
    expect(l('Marketing').nodes.map((n) => n.id)).not.toContain('member:pl-2')
  })

  it('leaves the controller out of its own purpose group', () => {
    // pl-1 is the controller and shares 'Systems' with pl-9.
    expect(node('group:Systems')?.count).toBe(1)
  })

  it('still draws every occupied group', () => {
    const groups = l().nodes.filter((n) => n.kind === 'group').map((n) => n.label)
    expect(groups).toEqual([
      'Delivery',
      'Marketing',
      'Payroll',
      'Support',
      'Systems',
    ])
  })
})

describe('direction and colour', () => {
  it('gives every edge a direction', () => {
    expect(l().edges.every((e) => e.directed)).toBe(true)
  })

  it('carries the door colour from the person through to the destination', () => {
    const c = node('door:place:pl-2')?.colourIndex
    const edges = l().edges.filter((e) => e.colourIndex === c)
    expect(edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      'sg-2->door:place:pl-2',
      'door:place:pl-2->controller',
      'controller->group:Marketing',
    ])
  })

  it('draws two parallel lines when two doors feed the same group', () => {
    const toMarketing = l().edges.filter((e) => e.to === 'group:Marketing')
    expect(toMarketing).toHaveLength(2)
    expect(new Set(toMarketing.map((e) => e.colourIndex)).size).toBe(2)
  })

  it('connects a group no door reaches with one uncoloured line', () => {
    const toPayroll = l().edges.filter((e) => e.to === 'group:Payroll')
    expect(toPayroll).toHaveLength(1)
    expect(toPayroll[0]?.colourIndex).toBeUndefined()
    expect(toPayroll[0]?.from).toBe('controller')
  })

  it('draws no line into a node that is not on the sheet', () => {
    const ids = new Set(l().nodes.map((n) => n.id))
    expect(l().edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true)
  })
})

describe('a ring that opens in place', () => {
  it('adds one node per member', () => {
    const ids = l('Marketing').nodes.filter((n) => n.kind === 'member').map((n) => n.id)
    expect(ids).toEqual(['member:pl-4', 'member:pl-8'])
  })

  it('keeps the open ring on the sheet, so there is a way back to it', () => {
    // The wrong answer: the ring vanishes and is replaced by its members, leaving a reader no
    // mark to click to close it again.
    const ring = node('group:Marketing', 'Marketing')
    expect(ring).toBeDefined()
    expect(ring?.open).toBe(true)
    expect(ring?.count).toBe(2)
  })

  it('does not move the ring when it opens', () => {
    expect(node('group:Marketing', 'Marketing')?.y).toBe(node('group:Marketing')?.y)
    expect(node('group:Payroll', 'Marketing')?.y).toBe(node('group:Payroll')?.y)
  })

  it('sets the members out around the ring’s centre, all at one distance', () => {
    const ring = node('group:Marketing', 'Marketing')
    const members = l('Marketing').nodes.filter((n) => n.kind === 'member')
    const away = members.map((m) => Math.round(Math.hypot(m.x - (ring?.x ?? 0), m.y - (ring?.y ?? 0))))
    expect(new Set(away).size).toBe(1)
    expect(away[0]).toBeGreaterThan(0)
  })

  it('marks every other group closed', () => {
    const groups = l('Marketing').nodes.filter((n) => n.kind === 'group')
    expect(groups.map((g) => g.label)).toEqual([
      'Delivery',
      'Marketing',
      'Payroll',
      'Support',
      'Systems',
    ])
    expect(groups.filter((g) => g.open).map((g) => g.label)).toEqual(['Marketing'])
  })

  it('draws an unnamed member with its host string', () => {
    const m = l('Marketing').nodes.find((n) => n.id === 'member:pl-8')
    expect(m?.label).toBe('stat.rossi-editore.it')
    expect(m?.unexplained).toBe(1)
  })

  it('routes a coloured path to the member rather than the vanished ring', () => {
    const toMember = l('Marketing').edges.filter((e) => e.to === 'member:pl-4')
    expect(toMember).toHaveLength(2)
    expect(new Set(toMember.map((e) => e.colourIndex)).size).toBe(2)
  })

  it('treats an open group that does not exist as none open', () => {
    expect(l('Nonexistent')).toEqual(l(null))
  })
})

describe('what the redesign removes', () => {
  it('states no EEA count on any node', () => {
    expect(l().nodes.every((n) => !('leavesEEA' in n))).toBe(true)
  })

  it('draws nothing at all for an empty project', () => {
    const empty = computeLayout(emptyProject(), SIZE)
    expect(empty.nodes).toEqual([])
    expect(empty.edges).toEqual([])
  })
})

// Spec §9 names the shapes this has to survive. A layout that only works on the sample project
// is a layout measured against one project.
describe('layout edge cases', () => {
  const withDoors = (n: number) => {
    const p = rossiEditore()
    p.places = p.places.filter((pl) => pl.kind !== 'collection')
    p.collectionPoints = Array.from({ length: n }, (_, i) => ({
      id: `cp-${i + 1}`,
      page: `https://rossi-editore.it/${i + 1}`,
      fields: [],
      sources: [],
      confidence: 'observed' as const,
    }))
    return p
  }

  it('draws a sheet with no doors at all', () => {
    const out = computeLayout(withDoors(0), SIZE)
    expect(out.nodes.filter((n) => n.kind === 'door')).toHaveLength(0)
    expect(out.nodes.find((n) => n.kind === 'controller')).toBeDefined()
    expect(out.edges.every((e) => e.colourIndex === undefined)).toBe(true)
  })

  it('draws a sheet with one door', () => {
    expect(computeLayout(withDoors(1), SIZE).nodes.filter((n) => n.kind === 'door')).toHaveLength(1)
  })

  it('cycles the palette at seven doors and keeps them all on the sheet', () => {
    const doors = computeLayout(withDoors(7), SIZE).nodes.filter((n) => n.kind === 'door')
    expect(doors).toHaveLength(7)
    expect(doors.map((d) => d.colourIndex)).toEqual([0, 1, 2, 3, 4, 5, 0])
  })

  it('spaces doors apart rather than stacking them', () => {
    const ys = computeLayout(withDoors(7), SIZE).nodes.filter((n) => n.kind === 'door').map((n) => n.y)
    expect(new Set(ys).size).toBe(7)
  })

  it('draws no arrowhead-less line on any of these shapes', () => {
    for (const n of [0, 1, 7]) {
      expect(computeLayout(withDoors(n), SIZE).edges.every((e) => e.directed)).toBe(true)
    }
  })

  it('draws a project with no controller named yet', () => {
    const p = rossiEditore()
    p.places = p.places.filter((pl) => pl.id !== 'pl-1')
    const centre = computeLayout(p, SIZE).nodes.find((n) => n.kind === 'controller')
    expect(centre).toBeDefined()
    expect(centre?.label).toBe('')
  })

  it('opens a ring holding one member without stacking it on the centre', () => {
    const ring = computeLayout(rossiEditore(), SIZE, 'Support').nodes.find(
      (n) => n.id === 'group:Support',
    )
    const member = computeLayout(rossiEditore(), SIZE, 'Support').nodes.find(
      (n) => n.kind === 'member',
    )
    expect(member).toBeDefined()
    expect(Math.hypot((member?.x ?? 0) - (ring?.x ?? 0), (member?.y ?? 0) - (ring?.y ?? 0))).toBeGreaterThan(20)
  })
})

describe('determinism', () => {
  it('produces identical results on repeat calls', () => {
    expect(computeLayout(rossiEditore(), SIZE, 'Marketing')).toEqual(
      computeLayout(rossiEditore(), SIZE, 'Marketing'),
    )
  })
})
