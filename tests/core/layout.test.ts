import { describe, it, expect } from 'vitest'
import { COLUMN, MAX_OPEN, computeLayout, type Box, type LayoutEdge, type LayoutResult, type LayoutView } from '../../src/core/layout'
import type { DoorKind, Project } from '../../src/core/types'
import { DORSALE_FIXTURES, dorsaleMedium, dorsaleOversized, dorsaleSmall, dorsaleUgly, rightPlaces, scanLike } from '../fixtures/dorsale'
import { emptyProject } from '../fixtures/projects'
import { rossiEditore } from '../fixtures/rossiEditore'

const node = (l: LayoutResult, id: string) => l.nodes.find((n) => n.id === id)
const ids = (l: LayoutResult, kind: string) => l.nodes.filter((n) => n.kind === kind).map((n) => n.id)
const rossi = (view: LayoutView = {}) => computeLayout(rossiEditore(), view)
/** The largest purpose group of a project: the one worth opening in a test. */
const biggest = (p: Project): string => {
  const sizes = new Map<string, number>()
  for (const pl of rightPlaces(p)) sizes.set(pl.purposeGroup, (sizes.get(pl.purposeGroup) ?? 0) + 1)
  return [...sizes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0]
}

describe('the sentence, left to right', () => {
  it('stands the people left of the ways in, those left of the spine, and the destinations right of it', () => {
    const l = rossi()
    const spine = node(l, 'controller')!.spine!
    expect(node(l, 'sg-2')!.x).toBeLessThan(node(l, 'door:place:pl-2')!.x)
    expect(node(l, 'door:place:pl-2')!.x).toBeLessThan(spine.x)
    for (const g of l.nodes.filter((n) => n.kind === 'group')) expect(g.x).toBeGreaterThan(spine.x + spine.width)
  })

  it('draws exactly one controller, named when a document named it', () => {
    expect(ids(rossi(), 'controller')).toEqual(['controller'])
    expect(node(rossi(), 'controller')!.label).toBe('Rossi Editore srl')
  })

  it('leaves the controller label empty when nothing named one, for the renderer to speak', () => {
    expect(node(computeLayout(dorsaleSmall()), 'controller')!.label).toBe('')
  })

  it('makes the spine as tall as every row on either side', () => {
    const l = computeLayout(dorsaleUgly(), { openGroup: 'Marketing', openKind: 'form' })
    const spine = node(l, 'controller')!.spine!
    for (const n of l.nodes.filter((n) => n.kind !== 'controller')) {
      expect(n.y).toBeGreaterThan(spine.y)
      expect(n.y).toBeLessThan(spine.y + spine.height)
    }
  })

  it('draws only the people who reach a way in, in project order', () => {
    expect(ids(rossi(), 'subject')).toEqual(['sg-1', 'sg-2'])
  })

  it('draws nothing at all for an empty project', () => {
    expect(computeLayout(emptyProject())).toMatchObject({ nodes: [], edges: [] })
  })
})

describe('ways in are rows', () => {
  it('draws one row per door, places first, each a full pitch below the last', () => {
    const l = rossi()
    expect(ids(l, 'door')).toEqual(['door:place:pl-2', 'door:place:pl-3', 'door:cp:cp-1'])
    const ys = ids(l, 'door').map((id) => node(l, id)!.y)
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(36)
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(36)
  })

  it('sets a door’s label to the right of its mark and above its own line', () => {
    const d = node(rossi(), 'door:place:pl-2')!
    expect(d.anchor).toBe('start')
    expect(d.labelBox.x).toBeGreaterThan(d.x)
    expect(d.labelBox.y + d.labelBox.height).toBeLessThanOrEqual(d.y)
  })

  it('sets a person’s name to the left of the disc, right-aligned', () => {
    const s = node(rossi(), 'sg-2')!
    expect(s.anchor).toBe('end')
    expect(s.labelBox.x + s.labelBox.width).toBeLessThan(s.x)
  })

  it('names a form by its page’s path, and the site’s root by a single slash', () => {
    const p = scanLike(['form', 'form'])
    p.collectionPoints![1]!.page = 'https://example.test'
    const l = computeLayout(p)
    expect(node(l, 'door:cp:cp-1')!.label).toBe('/p1')
    expect(node(l, 'door:cp:cp-2')!.label).toBe('/')
  })

  it('keeps a form’s page as written when it is not an address', () => {
    // The wrong answer: 'contatti' becomes '/' and is read out as the home page.
    const p = scanLike(['form', 'form'])
    p.collectionPoints![0]!.page = 'contatti'
    p.collectionPoints![1]!.page = 'https://example.test?p=3'
    const l = computeLayout(p)
    expect(node(l, 'door:cp:cp-1')!.label).toBe('contatti')
    expect(node(l, 'door:cp:cp-2')!.label).toBe('?p=3')
  })

  it('leaves the label of any other door as the project has it', () => {
    const l = computeLayout(dorsaleSmall())
    expect(node(l, 'door:cp:scan1-cp-1')!.label).toBe('Embed on Google Maps')
    expect(node(l, 'door:place:scan1-pl-1')!.label).toMatch(/\.test$/)
  })

  it('carries each door’s origin, kind and row colour', () => {
    const l = rossi()
    expect(node(l, 'door:cp:cp-1')).toMatchObject({ origin: 'discovered', doorKind: 'form', colourIndex: 2 })
    expect(node(l, 'door:place:pl-2')).toMatchObject({ origin: 'declared', colourIndex: 0 })
    expect(node(l, 'door:place:pl-2')!.doorKind).toBeUndefined()
  })
})

describe('three or more doors of one kind are one row', () => {
  it('folds the six forms of the medium scan into one row that says how many', () => {
    const l = computeLayout(dorsaleMedium())
    expect(ids(l, 'door')).toHaveLength(1)
    expect(node(l, 'doorGroup:form')).toMatchObject({ kind: 'doorGroup', count: 6, doorKind: 'form', open: false, label: '' })
  })

  it('draws 11 rows for two doors of every kind plus the site, in 396 units', () => {
    const p = scanLike(['form', 'form', 'newsletter', 'newsletter', 'booking', 'booking', 'chat', 'chat', 'embed', 'embed'])
    const l = computeLayout(p)
    expect(ids(l, 'door')).toHaveLength(11)
    const ys = ids(l, 'door').map((id) => node(l, id)!.y)
    expect(ys[10]! - ys[0]!).toBe(360)
  })

  it('opens a fold in place: sub-rows under it, and the rows below move down', () => {
    const closed = computeLayout(dorsaleMedium())
    const open = computeLayout(dorsaleMedium(), { openKind: 'form' })
    const subs = open.nodes.filter((n) => n.parent === 'doorGroup:form')
    expect(subs).toHaveLength(6)
    expect(subs.every((n) => n.kind === 'door' && n.y > node(open, 'doorGroup:form')!.y)).toBe(true)
    expect(subs[1]!.y - subs[0]!.y).toBe(24)
    expect(node(open, 'doorGroup:form')!.open).toBe(true)
    expect(open.height).toBeGreaterThan(closed.height)
    expect(open.openKind).toBe('form')
  })

  it('shows at most six sub-rows: past that, five and a row that says how many more', () => {
    const l = computeLayout(dorsaleUgly(), { openKind: 'form' })
    const subs = l.nodes.filter((n) => n.parent === 'doorGroup:form')
    expect(subs).toHaveLength(MAX_OPEN)
    expect(subs.filter((n) => n.kind === 'door')).toHaveLength(5)
    expect(node(l, 'moreDoors:form')).toMatchObject({ kind: 'more', count: 7, label: '' })
  })

  it('treats an open kind that is not folded as none open', () => {
    expect(computeLayout(dorsaleSmall(), { openKind: 'embed' })).toEqual(computeLayout(dorsaleSmall()))
    expect(computeLayout(dorsaleSmall(), { openKind: 'embed' }).openKind).toBeNull()
  })

  it('highlights a closed fold that hides the selection, by node id or by door id', () => {
    const p = dorsaleMedium()
    for (const selectedId of ['door:cp:scan1-cp-3', 'cp:scan1-cp-3']) {
      expect(node(computeLayout(p, { selectedId }), 'doorGroup:form')!.highlighted).toBe(true)
    }
    expect(node(computeLayout(p), 'doorGroup:form')!.highlighted).toBeUndefined()
    expect(node(computeLayout(p, { selectedId: 'door:place:scan1-pl-1' }), 'doorGroup:form')!.highlighted).toBeUndefined()
  })

  it('highlights the +N more row when the selection is behind it, and not the open fold', () => {
    const p = dorsaleUgly()
    const hidden = p.collectionPoints!.filter((cp) => (cp.kind ?? 'form') === 'form')[11]!.id
    const l = computeLayout(p, { openKind: 'form', selectedId: `door:cp:${hidden}` })
    expect(node(l, 'moreDoors:form')!.highlighted).toBe(true)
    expect(node(l, 'doorGroup:form')!.highlighted).toBeUndefined()
  })

  it('grows a row to hold its lines: a door reaching 30 groups is 161 units tall', () => {
    const l = computeLayout(dorsaleOversized())
    const rows = l.nodes.filter((n) => (n.kind === 'door' || n.kind === 'doorGroup') && n.parent === undefined)
    expect(rows[0]!.id).toBe('door:place:pl-door')
    // Half of 161 and half of the next row's 36.
    expect(rows[1]!.y - rows[0]!.y).toBe(98.5)
  })
})

describe('where it goes is rows', () => {
  const twoKinds = (): Project => {
    const p = scanLike([])
    p.places.push(
      { id: 'pl-3', name: 'Archive', kind: 'internal', purposeGroup: 'Records', holder: 'you', leavesEEA: false, sources: [], confidence: 'declared' },
      { id: 'pl-4', name: 'cdn.example.net', kind: 'unknown', purposeGroup: 'Marketing', holder: 'supplier', leavesEEA: 'unknown', sources: [], confidence: 'observed' },
      { id: 'pl-5', name: 'Stripe', kind: 'processor', purposeGroup: 'Billing', holder: 'supplier', leavesEEA: false, sources: [], confidence: 'declared' },
    )
    return p
  }

  it('lists own systems first, then suppliers, each in alphabetical order', () => {
    expect(ids(computeLayout(twoKinds()), 'group')).toEqual(['group:Records', 'group:Billing', 'group:Marketing'])
  })

  it('says on each row how many places it holds and how many are not yet identified', () => {
    const l = computeLayout(twoKinds())
    expect(node(l, 'group:Marketing')).toMatchObject({ count: 2, unexplained: 1, internal: false, open: false })
    expect(node(l, 'group:Records')).toMatchObject({ count: 1, unexplained: 0, internal: true })
  })

  it('draws no door and no controller among the destinations', () => {
    // pl-2 is a door in Marketing; pl-1 is the controller, in Systems with pl-9.
    expect(node(rossi(), 'group:Marketing')!.count).toBe(2)
    expect(node(rossi(), 'group:Systems')!.count).toBe(1)
    expect(rossi({ openGroup: 'Marketing' }).nodes.map((n) => n.id)).not.toContain('member:pl-2')
  })

  it('opens a group in place: members as sub-rows, the group’s own row still there', () => {
    const l = rossi({ openGroup: 'Marketing' })
    const members = l.nodes.filter((n) => n.parent === 'group:Marketing')
    expect(members.map((n) => n.id)).toEqual(['member:pl-4', 'member:pl-8'])
    expect(members[1]!.y - members[0]!.y).toBe(24)
    expect(node(l, 'group:Marketing')).toMatchObject({ open: true, count: 2 })
    expect(node(l, 'member:pl-8')).toMatchObject({ label: 'stat.rossi-editore.it', unexplained: 1 })
    expect(l.openGroup).toBe('Marketing')
  })

  it('shows at most six members: past that, five and a row that says how many more', () => {
    const l = computeLayout(dorsaleUgly(), { openGroup: 'Marketing' })
    expect(ids(l, 'member')).toHaveLength(5)
    expect(node(l, 'more:Marketing')).toMatchObject({ kind: 'more', count: 12, label: '' })
  })

  it('highlights the row that hides a selected place: the closed group, or +N more', () => {
    const p = dorsaleUgly()
    const last = rightPlaces(p).filter((pl) => pl.purposeGroup === 'Marketing')[16]!.id
    expect(node(computeLayout(p, { selectedId: `member:${last}` }), 'group:Marketing')!.highlighted).toBe(true)
    const open = computeLayout(p, { openGroup: 'Marketing', selectedId: last })
    expect(node(open, 'more:Marketing')!.highlighted).toBe(true)
    expect(node(open, 'group:Marketing')!.highlighted).toBeUndefined()
    expect(node(computeLayout(p), 'group:Marketing')!.highlighted).toBeUndefined()
  })

  it('treats an open group that does not exist as none open', () => {
    expect(rossi({ openGroup: 'Nonexistent' })).toEqual(rossi())
  })

  it('keeps every id on the sheet unique when a group is named like an id', () => {
    // The wrong answer: a purpose group called 'kind:form' and the forms' fold share one id.
    const p = dorsaleUgly()
    for (const pl of p.places) if (pl.purposeGroup === 'Marketing') pl.purposeGroup = 'kind:form'
    const l = computeLayout(p, { openGroup: 'kind:form', openKind: 'form' })
    expect(new Set(l.nodes.map((n) => n.id)).size).toBe(l.nodes.length)
    expect(node(l, 'more:kind:form')!.parent).toBe('group:kind:form')
    expect(node(l, 'moreDoors:form')!.parent).toBe('doorGroup:form')
  })
})

describe('the sheet', () => {
  it('is 1000 wide and as tall as its rows, and never a slit', () => {
    expect(computeLayout(dorsaleSmall())).toMatchObject({ width: 1000, height: 234 })
    expect(computeLayout(dorsaleUgly(), { openGroup: 'Marketing', openKind: 'form' }).height).toBe(408)
  })

  it('holds core to no words: a fold and a +N more row carry a count, not a sentence', () => {
    const l = computeLayout(dorsaleUgly(), { openGroup: 'Marketing', openKind: 'form' })
    for (const n of l.nodes.filter((n) => n.kind === 'doorGroup' || n.kind === 'more')) expect(n.label).toBe('')
  })

  it('stands the columns where COLUMN says', () => {
    const l = rossi()
    expect(node(l, 'sg-2')!.x).toBe(COLUMN.person)
    expect(node(l, 'door:place:pl-2')!.x).toBe(COLUMN.door)
    expect(node(l, 'group:Marketing')!.x).toBe(COLUMN.ring)
  })
})

// Shared with Task 5: every view worth drawing of every fixture.
export const VIEWS = (p: Project): LayoutView[] => [
  {},
  { openGroup: biggest(p) },
  { openKind: 'form' as DoorKind },
  { openGroup: biggest(p), openKind: 'form' as DoorKind },
]
const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const along = (e: LayoutEdge, t: number): { x: number; y: number } => {
  const u = 1 - t
  return {
    x: u * u * u * e.x1 + 3 * u * u * t * e.c1x + 3 * u * t * t * e.c2x + t * t * t * e.x2,
    y: u * u * u * e.y1 + 3 * u * u * t * e.y1 + 3 * u * t * t * e.y2 + t * t * t * e.y2,
  }
}
/** Everything that would make a sheet unreadable, as sentences. Empty is the pass. */
export function problems(l: LayoutResult): string[] {
  const out: string[] = []
  const known = new Set(l.nodes.map((n) => n.id))
  if (known.size !== l.nodes.length) out.push('two nodes share an id')
  l.nodes.forEach((a, i) =>
    l.nodes.slice(i + 1).forEach((b) => {
      if (overlap(a.labelBox, b.labelBox)) out.push(`labels overlap: ${a.id} / ${b.id}`)
    }),
  )
  for (const n of l.nodes) {
    const b = n.labelBox
    if (b.x < 0 || b.y < 0 || b.x + b.width > l.width || b.y + b.height > l.height) out.push(`label off the sheet: ${n.id}`)
  }
  for (const e of l.edges) {
    if (!known.has(e.from) || !known.has(e.to)) out.push(`line to nowhere: ${e.from} -> ${e.to}`)
    for (let k = 0; k <= 24; k++) {
      const p = along(e, k / 24)
      const hit = l.nodes.find(
        (n) => p.x > n.labelBox.x && p.x < n.labelBox.x + n.labelBox.width && p.y > n.labelBox.y && p.y < n.labelBox.y + n.labelBox.height,
      )
      if (hit !== undefined) {
        out.push(`line ${e.from} -> ${e.to} crosses the label of ${hit.id}`)
        break
      }
    }
  }
  return out
}

describe('on every fixture, closed and open', () => {
  it('no two labels overlap and none leaves the sheet', () => {
    for (const [name, make] of DORSALE_FIXTURES) {
      for (const view of VIEWS(make())) {
        expect(problems(computeLayout(make(), view)), `${name} ${JSON.stringify(view)}`).toEqual([])
      }
    }
  })

  it('gives identical output on a second run', () => {
    for (const [, make] of DORSALE_FIXTURES) {
      for (const view of VIEWS(make())) expect(computeLayout(make(), view)).toEqual(computeLayout(make(), view))
    }
  })
})

describe('lines', () => {
  const edge = (l: LayoutResult, from: string, to: string) => l.edges.filter((e) => e.from === from && e.to === to)
  const topRows = (l: LayoutResult) =>
    l.nodes.filter((n) => (n.kind === 'door' || n.kind === 'doorGroup') && n.parent === undefined)

  it('brings the website’s visitors to every top-level row of a scanned site', () => {
    for (const make of [dorsaleSmall, dorsaleMedium, dorsaleUgly]) {
      const l = computeLayout(make())
      for (const row of topRows(l)) expect(edge(l, 'scan1-sg-1', row.id), row.id).toHaveLength(1)
    }
  })

  it('gives an open fold one line in, and none to its sub-rows', () => {
    const l = computeLayout(dorsaleUgly(), { openKind: 'form' })
    expect(edge(l, 'scan1-sg-1', 'doorGroup:form')).toHaveLength(1)
    const subs = l.nodes.filter((n) => n.parent === 'doorGroup:form').map((n) => n.id)
    expect(l.edges.filter((e) => subs.includes(e.to))).toEqual([])
  })

  it('invents no line in a documents-only project', () => {
    // The wrong answer: a declared door nobody is recorded at is given the visitors, or all twelve groups.
    const p = dorsaleOversized()
    p.collectionPoints = []
    p.places.push({ id: 'pl-desk', name: 'Second desk', kind: 'collection', purposeGroup: 'Systems', holder: 'you', leavesEEA: false, sources: [{ documentId: 'd1', documentName: 'notice.pdf' }], confidence: 'declared' })
    const l = computeLayout(p)
    expect(l.edges.filter((e) => e.to === 'door:place:pl-door')).toHaveLength(12)
    expect(l.edges.filter((e) => e.to === 'door:place:pl-desk')).toEqual([])
    expect(edge(l, 'door:place:pl-desk', 'controller')).toHaveLength(1)
  })

  it('runs every carrying row to the spine, level, at the row’s own height', () => {
    const l = computeLayout(dorsaleUgly(), { openGroup: 'Marketing', openKind: 'form' })
    const carrying = l.nodes.filter(
      (n) => n.kind === 'door' || (n.kind === 'doorGroup' && n.open !== true) || n.id.startsWith('moreDoors:'),
    )
    expect(carrying.length).toBeGreaterThan(5)
    for (const row of carrying) {
      const [e] = edge(l, row.id, 'controller')
      expect(e, row.id).toBeDefined()
      expect([e!.y1, e!.y2, e!.x2]).toEqual([row.y, row.y, COLUMN.spine])
    }
  })

  it('draws no line to the spine from the head of an open fold', () => {
    // The wrong answer: twelve forms draw thirteen lines.
    expect(edge(computeLayout(dorsaleUgly(), { openKind: 'form' }), 'doorGroup:form', 'controller')).toEqual([])
    expect(edge(computeLayout(dorsaleUgly()), 'doorGroup:form', 'controller')).toHaveLength(1)
  })

  it('ends a door that goes no further on the spine, and one that goes on at its destinations', () => {
    const l = computeLayout(dorsaleUgly())
    expect(edge(l, 'doorGroup:form', 'controller')[0]!.arrow).toBe(true)
    expect(edge(l, 'door:place:scan1-pl-1', 'controller')[0]!.arrow).toBe(false)
    expect(l.edges.filter((e) => e.from === 'controller').every((e) => e.arrow)).toBe(true)
    expect(l.edges.filter((e) => e.to !== 'controller' && e.from !== 'controller').every((e) => !e.arrow)).toBe(true)
  })

  it('carries one colour from the person, through the door, to the destination', () => {
    const l = rossi()
    const row = 'door:place:pl-2'
    const mine = l.edges.filter((e) => e.door === row)
    expect(mine.map((e) => `${e.from}->${e.to}`)).toEqual(['sg-2->door:place:pl-2', 'door:place:pl-2->controller', 'controller->group:Marketing'])
    expect(new Set(mine.map((e) => e.colourIndex))).toEqual(new Set([0]))
  })

  it('leaves the spine from points 5 apart, centred on the door, in the order of the rows reached', () => {
    const l = computeLayout(dorsaleUgly())
    const site = node(l, 'door:place:scan1-pl-1')!
    const out = l.edges.filter((e) => e.door === site.id && e.from === 'controller')
    expect(out).toHaveLength(5)
    const ports = out.map((e) => e.y1).sort((a, b) => a - b)
    expect(ports).toEqual([-10, -5, 0, 5, 10].map((d) => site.y + d))
    // Its own lines never cross: the higher port goes to the higher row.
    const byPort = [...out].sort((a, b) => a.y1 - b.y1).map((e) => e.y2)
    expect(byPort).toEqual([...byPort].sort((a, b) => a - b))
    expect(out.every((e) => e.entryY === site.y && e.x1 === COLUMN.spine + COLUMN.spineWidth)).toBe(true)
  })

  it('lands two doors on one row 3 units apart, in two colours', () => {
    const into = rossi().edges.filter((e) => e.to === 'group:Marketing')
    expect(into).toHaveLength(2)
    expect(new Set(into.map((e) => e.colourIndex)).size).toBe(2)
    expect(Math.abs(into[0]!.y2 - into[1]!.y2)).toBe(3)
  })

  it('reaches a destination no door reaches with one neutral, level line', () => {
    const [e, ...rest] = rossi().edges.filter((e) => e.to === 'group:Payroll')
    expect(rest).toEqual([])
    expect(e).toMatchObject({ from: 'controller', arrow: true })
    expect(e!.y1).toBe(e!.y2)
    expect([e!.colourIndex, e!.door, e!.entryY]).toEqual([undefined, undefined, undefined])
  })

  it('sends lines to the members of an open group, and none to the group’s own row', () => {
    const l = rossi({ openGroup: 'Marketing' })
    expect(l.edges.filter((e) => e.to === 'group:Marketing')).toEqual([])
    const toMember = l.edges.filter((e) => e.to === 'member:pl-4')
    expect(toMember).toHaveLength(2)
    expect(new Set(toMember.map((e) => e.colourIndex)).size).toBe(2)
    // pl-8 is reached by no door: one neutral line of its own.
    expect(l.edges.filter((e) => e.to === 'member:pl-8').map((e) => e.colourIndex)).toEqual([undefined])
  })

  it('gives each door one line to +N more, however many hidden members it reaches', () => {
    const l = computeLayout(dorsaleUgly(), { openGroup: 'Marketing' })
    const toMore = l.edges.filter((e) => e.to === 'more:Marketing')
    expect(toMore.map((e) => e.door)).toEqual(['door:place:scan1-pl-1'])
  })

  it('draws the lines of the doors behind +N more from that row', () => {
    const p = scanLike(['form', 'form', 'form', 'form', 'form', 'form', 'form'])
    p.collectionPoints![6]!.destination = 'pl-2'
    const l = computeLayout(p, { openKind: 'form' })
    expect(edge(l, 'moreDoors:form', 'controller')[0]!.arrow).toBe(false)
    expect(l.edges.filter((e) => e.door === 'moreDoors:form' && e.to === 'group:Marketing')).toHaveLength(1)
  })
})

describe('on every fixture, closed and open: lines', () => {
  it('no line crosses a label, and every line ends at a row', () => {
    for (const [name, make] of DORSALE_FIXTURES) {
      for (const view of VIEWS(make())) {
        const l = computeLayout(make(), view)
        expect(l.edges.length, name).toBeGreaterThan(0)
        expect(problems(l), `${name} ${JSON.stringify(view)}`).toEqual([])
      }
    }
  })

  it('every way in has a line to the spine, and on a scanned site a line in', () => {
    for (const [name, make] of DORSALE_FIXTURES) {
      for (const view of VIEWS(make())) {
        const l = computeLayout(make(), view)
        for (const d of l.nodes.filter((n) => n.kind === 'door')) {
          expect(l.edges.some((e) => e.from === d.id && e.to === 'controller'), `${name} ${d.id}`).toBe(true)
        }
        if (name === 'oversized') continue
        for (const row of l.nodes.filter((n) => (n.kind === 'door' || n.kind === 'doorGroup') && n.parent === undefined)) {
          expect(l.edges.some((e) => e.to === row.id), `${name} ${row.id}`).toBe(true)
        }
      }
    }
  })
})
