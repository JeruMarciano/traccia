import { describe, it, expect } from 'vitest'
import { computeLayout } from '../../src/core/layout'
import { rossiEditore } from '../fixtures/rossiEditore'
import { emptyProject } from '../fixtures/projects'

const SIZE = { width: 800, height: 500 }
const l = (open: string | null = null) => computeLayout(rossiEditore(), SIZE, open)
const node = (id: string, open: string | null = null) => l(open).nodes.find((n) => n.id === id)

describe('the sentence, left to right', () => {
  it('puts the people left of the doors, the doors left of the controller, the groups right of it', () => {
    const x = (id: string) => node(id)?.x ?? NaN
    expect(x('sg-2')).toBeLessThan(x('door:place:pl-2'))
    expect(x('door:place:pl-2')).toBeLessThan(x('controller'))
    expect(x('controller')).toBeLessThan(x('group:Marketing'))
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
    // pl-1 is the controller and shares 'Running the systems' with pl-9.
    expect(node('group:Running the systems')?.count).toBe(1)
  })

  it('still draws every occupied group', () => {
    const groups = l().nodes.filter((n) => n.kind === 'group').map((n) => n.label)
    expect(groups).toEqual([
      'Delivering orders',
      'Marketing',
      'Payroll & HR',
      'Running the systems',
      'Support',
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
    const toPayroll = l().edges.filter((e) => e.to === 'group:Payroll & HR')
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
    expect(node('group:Payroll & HR', 'Marketing')?.y).toBe(node('group:Payroll & HR')?.y)
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
      'Delivering orders',
      'Marketing',
      'Payroll & HR',
      'Running the systems',
      'Support',
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

describe('determinism', () => {
  it('produces identical results on repeat calls', () => {
    expect(computeLayout(rossiEditore(), SIZE, 'Marketing')).toEqual(
      computeLayout(rossiEditore(), SIZE, 'Marketing'),
    )
  })
})
