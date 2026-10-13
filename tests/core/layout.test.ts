import { describe, it, expect } from 'vitest'
import {
  COLUMN,
  MAX_DESTINATIONS,
  MAX_OPEN,
  computeLayout,
  destinations,
  traced,
  tracedEdge,
  type Box,
  type LayoutResult,
  type LayoutView,
} from '../../src/core/layout'
import { NOT_IDENTIFIED } from '../../src/core/scan'
import type { DoorKind, Project } from '../../src/core/types'
import { DORSALE_FIXTURES, dorsaleMedium, dorsaleOversized, dorsaleSmall, dorsaleUgly, rightPlaces, scanLike } from '../fixtures/dorsale'
import { emptyProject } from '../fixtures/projects'
import { rossiEditore } from '../fixtures/rossiEditore'

const node = (l: LayoutResult, id: string) => l.nodes.find((n) => n.id === id)
const ids = (l: LayoutResult, kind: string) => l.nodes.filter((n) => n.kind === kind).map((n) => n.id)
const rossi = (view: LayoutView = {}) => computeLayout(rossiEditore(), view)
const right = (b: Box): number => b.x + b.width
/** The cards of a column: the rows a line starts from or ends at. */
const wayInCards = (l: LayoutResult) => l.nodes.filter((n) => (n.kind === 'door' || n.kind === 'doorGroup') && n.parent === undefined)
const destinationCards = (l: LayoutResult) => l.nodes.filter((n) => n.kind === 'group' && n.parent === undefined)
/** The fullest row of destinations: the one worth opening in a test. */
const biggest = (p: Project): string => [...destinations(p)].sort((a, b) => b.places.length - a.places.length)[0]!.id

describe('the sentence, left to right', () => {
  it('stands the people left of the ways in, those left of the organisation, and the destinations right of it', () => {
    const l = rossi()
    const org = node(l, 'controller')!.box
    expect(right(node(l, 'people')!.box)).toBeLessThan(node(l, 'door:place:pl-2')!.box.x)
    expect(right(node(l, 'door:place:pl-2')!.box)).toBeLessThan(org.x)
    for (const g of destinationCards(l)) expect(g.box.x).toBeGreaterThan(right(org))
  })

  it('draws exactly one controller, named when a document named it', () => {
    expect(ids(rossi(), 'controller')).toEqual(['controller'])
    expect(node(rossi(), 'controller')!.label).toBe('Rossi Editore srl')
  })

  it('leaves the controller label empty when nothing named one, for the renderer to speak', () => {
    expect(node(computeLayout(dorsaleSmall()), 'controller')!.label).toBe('')
  })

  it('draws the organisation as a card on the middle of the flow, only as tall as its lines need', () => {
    // The wrong answer: a pole the full height of the sheet, which is what the card replaced.
    expect(node(computeLayout(dorsaleSmall()), 'controller')!.box.height).toBe(56)
    for (const [name, make] of DORSALE_FIXTURES) {
      const l = computeLayout(make(), { openGroup: biggest(make()), openKind: 'form' })
      const org = node(l, 'controller')!
      expect(org.box.y + org.box.height / 2, name).toBe(org.y)
      expect(org.y, name).toBeCloseTo((44 + l.height - 18) / 2, 1)
      expect(org.box.height, name).toBe(Math.max(56, (Math.max(wayInCards(l).length, destinationCards(l).length) - 1) * 9 + 24))
      expect(org.box.height, name).toBeLessThan(l.height / 2)
      expect(org.labelBox.x, name).toBeGreaterThan(org.box.x)
      expect(right(org.labelBox), name).toBeLessThan(right(org.box))
    }
    expect(node(computeLayout(dorsaleOversized()), 'controller')!.box.height).toBe(105)
  })

  it('draws only the people who reach a way in, in project order, in one card', () => {
    const l = rossi()
    expect(ids(l, 'subject')).toEqual(['sg-1', 'sg-2'])
    const card = node(l, 'people')!.box
    for (const s of l.nodes.filter((n) => n.kind === 'subject')) {
      expect(s.parent).toBe('people')
      expect(s.box.y).toBeGreaterThanOrEqual(card.y)
      expect(s.box.y + s.box.height).toBeLessThanOrEqual(card.y + card.height)
    }
  })

  it('draws no card for people when nobody is recorded at any way in', () => {
    const p = scanLike([])
    p.flows = p.flows.filter((f) => f.from !== 'sg-1')
    expect(ids(computeLayout(p), 'people')).toEqual([])
  })

  it('draws nothing at all for an empty project', () => {
    expect(computeLayout(emptyProject())).toMatchObject({ nodes: [], edges: [], trails: [] })
  })
})

describe('ways in are cards', () => {
  it('draws one card per door, places first, each a full pitch below the last', () => {
    const l = rossi()
    expect(ids(l, 'door')).toEqual(['door:place:pl-2', 'door:place:pl-3', 'door:cp:cp-1'])
    const ys = ids(l, 'door').map((id) => node(l, id)!.y)
    expect(ys[1]! - ys[0]!).toBe(40)
    expect(ys[2]! - ys[1]!).toBe(40)
  })

  it('writes every label inside its own card, to the right of the mark', () => {
    for (const [name, make] of DORSALE_FIXTURES) {
      const l = computeLayout(make(), { openGroup: biggest(make()), openKind: 'form' })
      for (const n of l.nodes.filter((n) => n.kind !== 'people' && n.kind !== 'controller')) {
        expect(n.anchor, `${name} ${n.id}`).toBe('start')
        expect(n.labelBox.x, `${name} ${n.id}`).toBeGreaterThan(n.x)
        expect(right(n.labelBox), `${name} ${n.id}`).toBeLessThan(right(n.box))
        expect(n.labelBox.y, `${name} ${n.id}`).toBeGreaterThanOrEqual(n.box.y)
        expect(n.labelBox.y + n.labelBox.height, `${name} ${n.id}`).toBeLessThanOrEqual(n.box.y + n.box.height)
      }
    }
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

describe('three or more doors of one kind are one card', () => {
  it('folds the six forms of the medium scan into one card that says how many', () => {
    const l = computeLayout(dorsaleMedium())
    expect(ids(l, 'door')).toHaveLength(1)
    expect(node(l, 'doorGroup:form')).toMatchObject({ kind: 'doorGroup', count: 6, doorKind: 'form', open: false, label: '' })
  })

  it('draws 11 cards for two doors of every kind plus the site, in 430 units', () => {
    const p = scanLike(['form', 'form', 'newsletter', 'newsletter', 'booking', 'booking', 'chat', 'chat', 'embed', 'embed'])
    const l = computeLayout(p)
    expect(ids(l, 'door')).toHaveLength(11)
    const cards = wayInCards(l)
    expect(cards[10]!.box.y + cards[10]!.box.height - cards[0]!.box.y).toBe(430)
  })

  it('opens a fold in place: sub-rows inside its card, and the cards below move down', () => {
    const closed = computeLayout(dorsaleMedium())
    const open = computeLayout(dorsaleMedium(), { openKind: 'form' })
    const head = node(open, 'doorGroup:form')!
    const subs = open.nodes.filter((n) => n.parent === 'doorGroup:form')
    expect(subs).toHaveLength(6)
    expect(subs.every((n) => n.kind === 'door' && n.y > head.y && n.box.y + n.box.height <= head.box.y + head.box.height)).toBe(true)
    expect(subs[1]!.y - subs[0]!.y).toBe(22)
    expect(head.open).toBe(true)
    expect(head.box.height).toBeGreaterThan(node(closed, 'doorGroup:form')!.box.height)
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

  it('keeps a card one row tall however many places its door reaches', () => {
    // The wrong answer: a door reaching 30 groups grew to 161 units to hold 30 lines of its own.
    const l = computeLayout(dorsaleOversized())
    const cards = wayInCards(l)
    expect(cards[0]!.id).toBe('door:place:pl-door')
    expect(cards[0]!.box.height).toBe(30)
    expect(cards[1]!.y - cards[0]!.y).toBe(40)
  })
})

describe('where it goes is a handful of rows', () => {
  const twoKinds = (): Project => {
    const p = scanLike([])
    p.places.push(
      { id: 'pl-3', name: 'Archive', kind: 'internal', purposeGroup: 'Records', holder: 'you', leavesEEA: false, sources: [], confidence: 'declared' },
      { id: 'pl-4', name: 'cdn.example.net', kind: 'unknown', purposeGroup: 'Marketing', holder: 'supplier', leavesEEA: 'unknown', sources: [], confidence: 'observed' },
      { id: 'pl-5', name: 'Stripe', kind: 'processor', purposeGroup: 'Billing', holder: 'supplier', leavesEEA: false, sources: [], confidence: 'declared' },
      { id: 'pl-6', name: 'Brevo', kind: 'processor', purposeGroup: 'Marketing', holder: 'supplier', leavesEEA: false, sources: [], confidence: 'declared' },
    )
    return p
  }
  /** `n` purposes of suppliers, the first with two places and the rest with one. */
  const purposes = (n: number): Project => {
    const p = scanLike([])
    p.places = p.places.slice(0, 1)
    p.flows = p.flows.slice(0, 1)
    for (let g = 0; g < n; g++) {
      for (let m = 0; m < (g === 0 ? 2 : 1); m++) {
        p.places.push({ id: `pl-${g}-${m}`, name: `Vendor ${g}.${m}`, kind: 'processor', purposeGroup: `Purpose ${g}`, holder: 'supplier', leavesEEA: false, sources: [], confidence: 'declared' })
      }
    }
    return p
  }

  it('lists own systems first, then suppliers by purpose, largest first, then what is not identified', () => {
    expect(destinationCards(computeLayout(twoKinds())).map((n) => n.id)).toEqual(['own', 'group:Marketing', 'group:Billing', 'unidentified'])
    // Equal sizes fall back on the alphabet, so the same project always draws the same order.
    expect(destinationCards(computeLayout(purposes(3))).map((n) => n.id)).toEqual(['group:Purpose 0', 'group:Purpose 1', 'group:Purpose 2'])
  })

  it('says on each row how many places it holds, and by its mark what they are', () => {
    const l = computeLayout(twoKinds())
    expect(node(l, 'own')).toMatchObject({ count: 1, mark: 'internal', label: '', open: false })
    expect(node(l, 'group:Marketing')).toMatchObject({ count: 2, mark: 'supplier', label: 'Marketing' })
    expect(node(l, 'unidentified')).toMatchObject({ count: 1, mark: 'unidentified', label: '' })
  })

  it('counts a place nobody has identified once, in its own row, whatever purpose its address suggested', () => {
    // The wrong answer: cdn.example.net counted under Marketing, and announced again as
    // "1 not yet identified" beside it.
    const l = computeLayout(twoKinds(), { openGroup: 'group:Marketing' })
    expect(l.nodes.filter((n) => n.parent === 'group:Marketing').map((n) => n.id)).toEqual(['member:pl-2', 'member:pl-6'])
    const open = computeLayout(twoKinds(), { openGroup: 'unidentified' })
    expect(open.nodes.filter((n) => n.parent === 'unidentified').map((n) => n.id)).toEqual(['member:pl-4'])
  })

  it('stands every place on the right in exactly one row, on every fixture', () => {
    for (const [name, make] of [...DORSALE_FIXTURES, ['rossi', rossiEditore] as const]) {
      const p = make()
      const rows = destinations(p)
      for (const place of rightPlaces(p)) {
        expect(rows.filter((r) => r.places.some((m) => m.id === place.id)).map((r) => r.id), `${name} ${place.id}`).toHaveLength(1)
      }
      const open = rightPlaces(p).filter((pl) => pl.kind === 'unknown' || pl.purposeGroup === NOT_IDENTIFIED)
      const l = computeLayout(p)
      expect(node(l, 'unidentified')?.count ?? 0, name).toBe(open.length)
      for (const pl of open) {
        expect(rows.find((r) => r.places.some((m) => m.id === pl.id))!.id, `${name} ${pl.id}`).toBe('unidentified')
      }
      expect(destinationCards(l).reduce((sum, n) => sum + (n.count ?? 0), 0), name).toBe(rightPlaces(p).length)
    }
  })

  it('never draws more than five rows: the smallest purposes share one', () => {
    const p = dorsaleOversized()
    const l = computeLayout(p)
    expect(destinationCards(l).map((n) => n.id)).toEqual(['group:Group 01', 'group:Group 02', 'group:Group 03', 'group:Group 04', 'others'])
    expect(node(l, 'others')).toMatchObject({ count: 26, mark: 'supplier', label: '' })
    for (const [name, make] of [...DORSALE_FIXTURES, ['rossi', rossiEditore] as const]) {
      expect(destinationCards(computeLayout(make())).length, name).toBeLessThanOrEqual(MAX_DESTINATIONS)
    }
  })

  it('gives own systems and the unidentified a row each inside the five', () => {
    const p = purposes(8)
    p.places.push(
      { id: 'pl-own', name: 'Archive', kind: 'internal', purposeGroup: 'Purpose 1', holder: 'you', leavesEEA: false, sources: [], confidence: 'declared' },
      { id: 'pl-open', name: 'cdn.example.net', kind: 'unknown', purposeGroup: NOT_IDENTIFIED, holder: 'supplier', leavesEEA: 'unknown', sources: [], confidence: 'observed' },
    )
    expect(destinationCards(computeLayout(p)).map((n) => n.id)).toEqual(['own', 'group:Purpose 0', 'group:Purpose 1', 'others', 'unidentified'])
  })

  it('folds no purpose alone: five purposes are five rows, six are four and a fold of two', () => {
    expect(destinationCards(computeLayout(purposes(5))).map((n) => n.id)).not.toContain('others')
    const l = computeLayout(purposes(6))
    expect(destinationCards(l)).toHaveLength(5)
    expect(destinations(purposes(6)).find((d) => d.id === 'others')!.purposes!.map((x) => x.name)).toEqual(['Purpose 4', 'Purpose 5'])
  })

  it('opens the fold of purposes into the purposes it holds, and highlights it for one of them', () => {
    const p = dorsaleOversized()
    const open = computeLayout(p, { openGroup: 'others' })
    const subs = open.nodes.filter((n) => n.parent === 'others')
    expect(subs.map((n) => n.id)).toEqual(['group:Group 05', 'group:Group 06', 'group:Group 07', 'group:Group 08', 'group:Group 09', 'more:others'])
    expect(subs[0]).toMatchObject({ kind: 'group', count: 1, label: 'Group 05' })
    expect(node(open, 'more:others')!.count).toBe(21)
    expect(node(computeLayout(p, { selectedId: 'group:Group 20' }), 'others')!.highlighted).toBe(true)
    expect(node(computeLayout(p, { selectedId: 'member:pl-20-1' }), 'others')!.highlighted).toBe(true)
    expect(node(computeLayout(p, { openGroup: 'others', selectedId: 'member:pl-5-1' }), 'group:Group 05')!.highlighted).toBe(true)
    expect(node(computeLayout(p, { openGroup: 'others', selectedId: 'group:Group 20' }), 'more:others')!.highlighted).toBe(true)
  })

  it('draws no door and no controller among the destinations', () => {
    // pl-2 is a door in Marketing; pl-1 is the controller.
    const all = destinations(rossiEditore()).flatMap((d) => d.places.map((p) => p.id))
    expect(all).not.toContain('pl-1')
    expect(all).not.toContain('pl-2')
    expect(rossi({ openGroup: 'group:Marketing' }).nodes.map((n) => n.id)).not.toContain('member:pl-2')
  })

  it('opens a row in place: members inside its card, the row itself still there', () => {
    const l = rossi({ openGroup: 'own' })
    const head = node(l, 'own')!
    const members = l.nodes.filter((n) => n.parent === 'own')
    expect(members.map((n) => n.kind)).toEqual(['member', 'member'])
    expect(members[1]!.y - members[0]!.y).toBe(22)
    expect(members.every((n) => n.mark === 'internal' && n.box.y + n.box.height <= head.box.y + head.box.height)).toBe(true)
    expect(head).toMatchObject({ open: true, count: 2 })
    expect(l.openGroup).toBe('own')
  })

  it('shows at most six members: past that, five and a row that says how many more', () => {
    const l = computeLayout(dorsaleUgly(), { openGroup: 'group:Marketing' })
    expect(ids(l, 'member')).toHaveLength(5)
    expect(node(l, 'more:group:Marketing')).toMatchObject({ kind: 'more', count: 7, label: '' })
  })

  it('highlights the row that hides a selected place: the closed row, or +N more', () => {
    const p = dorsaleUgly()
    const last = destinations(p).find((d) => d.id === 'group:Marketing')!.places[11]!.id
    expect(node(computeLayout(p, { selectedId: `member:${last}` }), 'group:Marketing')!.highlighted).toBe(true)
    const open = computeLayout(p, { openGroup: 'group:Marketing', selectedId: last })
    expect(node(open, 'more:group:Marketing')!.highlighted).toBe(true)
    expect(node(open, 'group:Marketing')!.highlighted).toBeUndefined()
    expect(node(computeLayout(p), 'group:Marketing')!.highlighted).toBeUndefined()
  })

  it('highlights nothing for a member whose own row is drawn', () => {
    const p = dorsaleUgly()
    const first = destinations(p).find((d) => d.id === 'group:Marketing')!.places[0]!.id
    const l = computeLayout(p, { openGroup: 'group:Marketing', selectedId: `member:${first}` })
    expect(l.nodes.filter((n) => n.highlighted === true)).toEqual([])
  })

  it('treats an open row that does not exist as none open', () => {
    expect(rossi({ openGroup: 'group:Nonexistent' })).toEqual(rossi())
    // A purpose inside the fold is not a row of its own, so it cannot stand open.
    expect(computeLayout(dorsaleOversized(), { openGroup: 'group:Group 20' }).openGroup).toBeNull()
  })

  it('keeps every id on the sheet unique when a purpose is named like an id', () => {
    // The wrong answer: a purpose called 'own', or 'kind:form', and a row of the sheet share one id.
    for (const name of ['kind:form', 'own', 'others', 'unidentified']) {
      const p = dorsaleUgly()
      for (const pl of p.places) if (pl.purposeGroup === 'Marketing') pl.purposeGroup = name
      const l = computeLayout(p, { openGroup: `group:${name}`, openKind: 'form' })
      expect(new Set(l.nodes.map((n) => n.id)).size, name).toBe(l.nodes.length)
      expect(node(l, `more:group:${name}`)!.parent, name).toBe(`group:${name}`)
      expect(node(l, 'moreDoors:form')!.parent, name).toBe('doorGroup:form')
    }
  })
})

describe('the sheet', () => {
  it('is 1000 wide and as tall as its rows, and never a slit', () => {
    expect(computeLayout(dorsaleSmall())).toMatchObject({ width: 1000, height: 182 })
    expect(computeLayout(dorsaleUgly(), { openGroup: 'group:Marketing', openKind: 'form' }).height).toBe(389)
  })

  it('holds core to no words: a fold, a +N more row and the unnamed rows carry a count, not a sentence', () => {
    const l = computeLayout(dorsaleUgly(), { openGroup: 'unidentified', openKind: 'form' })
    for (const n of l.nodes.filter((n) => n.kind === 'doorGroup' || n.kind === 'more' || n.id === 'unidentified')) expect(n.label).toBe('')
  })

  it('stands the columns where COLUMN says', () => {
    const l = rossi()
    expect(node(l, 'people')!.box).toMatchObject(COLUMN.people)
    expect(node(l, 'door:place:pl-2')!.box).toMatchObject(COLUMN.doors)
    expect(node(l, 'controller')!.box).toMatchObject(COLUMN.controller)
    expect(node(l, 'group:Marketing')!.box).toMatchObject(COLUMN.places)
  })
})

// Every view worth drawing of every fixture.
const VIEWS = (p: Project): LayoutView[] => [
  {},
  { openGroup: biggest(p) },
  { openKind: 'form' as DoorKind },
  { openGroup: biggest(p), openKind: 'form' as DoorKind },
]
const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
type Stretch = { x1: number; y1: number; x2: number; y2: number }
/** A point of a line as the renderer draws it: both control points at the horizontal midpoint. */
const along = (e: Stretch, t: number): { x: number; y: number } => {
  const u = 1 - t
  const mid = (e.x1 + e.x2) / 2
  return {
    x: u * u * u * e.x1 + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * e.x2,
    y: u * u * u * e.y1 + 3 * u * u * t * e.y1 + 3 * u * t * t * e.y2 + t * t * t * e.y2,
  }
}
const inside = (p: { x: number; y: number }, b: Box): boolean => p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height
/** Everything that would make a sheet unreadable, as sentences. Empty is the pass. */
function problems(l: LayoutResult): string[] {
  const out: string[] = []
  const known = new Set(l.nodes.map((n) => n.id))
  if (known.size !== l.nodes.length) out.push('two nodes share an id')
  const cards = l.nodes.filter((n) => n.parent === undefined)
  l.nodes.forEach((a, i) =>
    l.nodes.slice(i + 1).forEach((b) => {
      if (overlap(a.labelBox, b.labelBox)) out.push(`labels overlap: ${a.id} / ${b.id}`)
    }),
  )
  cards.forEach((a, i) =>
    cards.slice(i + 1).forEach((b) => {
      if (overlap(a.box, b.box)) out.push(`cards touch: ${a.id} / ${b.id}`)
    }),
  )
  for (const n of l.nodes) {
    for (const b of [n.labelBox, n.box]) {
      if (b.x < 0 || b.y < 0 || b.x + b.width > l.width || b.y + b.height > l.height) out.push(`off the sheet: ${n.id}`)
    }
  }
  for (const e of l.edges) {
    if (!known.has(e.from) || !known.has(e.to)) out.push(`line to nowhere: ${e.from} -> ${e.to}`)
    for (const stretch of [e, ...(e.lead === undefined ? [] : [e.lead])]) {
      for (let k = 0; k <= 24; k++) {
        const p = along(stretch, k / 24)
        const hit = l.nodes.find((n) => inside(p, n.box))
        if (hit !== undefined) {
          out.push(`line ${e.from} -> ${e.to} crosses ${hit.id}`)
          break
        }
      }
    }
  }
  return out
}

describe('on every fixture, closed and open', () => {
  it('no two labels overlap, no two cards touch, and nothing leaves the sheet', () => {
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

describe('lines are a sum, not a product', () => {
  const from = (l: LayoutResult, id: string) => l.edges.filter((e) => e.from === id)
  const into = (l: LayoutResult, id: string) => l.edges.filter((e) => e.to === id)

  it('draws one line per way in and one per row of destinations, on every fixture, closed and open', () => {
    // The wrong answer: a line per way in per destination, which drew 63 lines for 10 and 30 rows.
    for (const [name, make] of DORSALE_FIXTURES) {
      for (const view of VIEWS(make())) {
        const l = computeLayout(make(), view)
        const at = `${name} ${JSON.stringify(view)}`
        expect(l.edges.length, at).toBe(wayInCards(l).length + destinationCards(l).length)
        for (const card of wayInCards(l)) expect(from(l, card.id).map((e) => e.to), `${at} ${card.id}`).toEqual(['controller'])
        for (const card of destinationCards(l)) expect(into(l, card.id).map((e) => e.from), `${at} ${card.id}`).toEqual(['controller'])
      }
    }
    expect(computeLayout(dorsaleOversized()).edges).toHaveLength(15)
    expect(computeLayout(dorsaleUgly()).edges).toHaveLength(9)
  })

  it('brings the website’s visitors to every way in of a scanned site', () => {
    for (const make of [dorsaleSmall, dorsaleMedium, dorsaleUgly]) {
      const l = computeLayout(make())
      for (const card of wayInCards(l)) {
        expect(from(l, card.id)[0]!.lead, card.id).toBeDefined()
        expect(l.trails.find((t) => t.id === card.id)!.people, card.id).toEqual(['scan1-sg-1'])
      }
    }
  })

  it('gives an open fold or an open row the one line it had closed, and none to what is inside', () => {
    // The wrong answer: twelve forms draw thirteen lines.
    const l = computeLayout(dorsaleUgly(), { openKind: 'form', openGroup: 'group:Marketing' })
    expect(from(l, 'doorGroup:form')).toHaveLength(1)
    expect(into(l, 'group:Marketing')).toHaveLength(1)
    const subs = l.nodes.filter((n) => n.parent !== undefined).map((n) => n.id)
    expect(subs.length).toBeGreaterThan(10)
    expect(l.edges.filter((e) => subs.includes(e.to) || subs.includes(e.from))).toEqual([])
  })

  it('invents no line in a documents-only project', () => {
    // The wrong answer: a declared door nobody is recorded at is given the visitors.
    const p = dorsaleOversized()
    p.collectionPoints = []
    p.places.push({ id: 'pl-desk', name: 'Second desk', kind: 'collection', purposeGroup: 'Systems', holder: 'you', leavesEEA: false, sources: [{ documentId: 'd1', documentName: 'notice.pdf' }], confidence: 'declared' })
    const l = computeLayout(p)
    expect(l.trails.find((t) => t.id === 'door:place:pl-door')!.people).toHaveLength(12)
    expect(from(l, 'door:place:pl-door')[0]!.lead).toBeDefined()
    expect(l.trails.find((t) => t.id === 'door:place:pl-desk')).toMatchObject({ people: [], reaches: [] })
    expect(from(l, 'door:place:pl-desk')).toHaveLength(1)
    expect(from(l, 'door:place:pl-desk')[0]!.lead).toBeUndefined()
  })

  it('runs every line from the right edge of one card to the left edge of the next, at the card’s own row', () => {
    for (const [name, make] of DORSALE_FIXTURES) {
      const l = computeLayout(make(), { openGroup: biggest(make()), openKind: 'form' })
      const org = node(l, 'controller')!.box
      for (const card of wayInCards(l)) {
        const e = from(l, card.id)[0]!
        expect([e.x1, e.y1, e.x2], `${name} ${card.id}`).toEqual([right(card.box), card.y, org.x])
        if (e.lead !== undefined) expect([e.lead.x1, e.lead.x2, e.lead.y2], `${name} ${card.id}`).toEqual([right(node(l, 'people')!.box), card.box.x, card.y])
      }
      for (const card of destinationCards(l)) {
        const e = into(l, card.id)[0]!
        expect([e.x1, e.x2, e.y2], `${name} ${card.id}`).toEqual([right(org), card.box.x, card.y])
      }
    }
  })

  it('spreads the lines that meet one card along its edge, in the order of the cards they come from', () => {
    for (const [name, make] of DORSALE_FIXTURES) {
      const l = computeLayout(make())
      const org = node(l, 'controller')!.box
      const people = node(l, 'people')!.box
      const groups: [number[], number, Box][] = [
        [wayInCards(l).map((c) => from(l, c.id)[0]!.y2), 9, org],
        [destinationCards(l).map((c) => into(l, c.id)[0]!.y1), 9, org],
        [wayInCards(l).flatMap((c) => from(l, c.id)[0]!.lead?.y1 ?? []), 4, people],
      ]
      for (const [ports, gap, card] of groups) {
        // Top to bottom as the cards stand, so no two lines of a column cross; apart, so none hides another.
        for (let i = 1; i < ports.length; i++) expect(ports[i]! - ports[i - 1]!, name).toBeCloseTo(gap, 5)
        for (const y of ports) {
          expect(y, name).toBeGreaterThan(card.y + 4)
          expect(y, name).toBeLessThan(card.y + card.height - 4)
        }
        if (ports.length > 0) expect((ports[0]! + ports[ports.length - 1]!) / 2, name).toBeCloseTo(card.y + card.height / 2, 1)
      }
    }
  })

  it('gives a way in’s line its card’s colour, and the organisation’s lines none', () => {
    const l = rossi()
    expect(wayInCards(l).map((c) => from(l, c.id)[0]!.colourIndex)).toEqual([0, 1, 2])
    expect(from(l, 'controller').map((e) => e.colourIndex)).toEqual(destinationCards(l).map(() => undefined))
  })

  it('reaches a destination no door reaches like any other: one line from the organisation', () => {
    const l = rossi()
    expect(l.trails.some((t) => t.reaches.includes('own'))).toBe(false)
    expect(into(l, 'own')).toHaveLength(1)
  })
})

describe('what a way in connects is kept beside the drawing', () => {
  it('records for each way in who comes through it and which rows it reaches', () => {
    expect(rossi().trails.find((t) => t.id === 'door:place:pl-2')).toEqual({
      id: 'door:place:pl-2',
      row: 'door:place:pl-2',
      people: ['sg-2'],
      reaches: ['group:Marketing'],
    })
  })

  it('records a sub-row’s own trail under its card, and the hidden doors’ under +N more', () => {
    const p = scanLike(['form', 'form', 'form', 'form', 'form', 'form', 'form'])
    p.collectionPoints![6]!.destination = 'pl-2'
    const l = computeLayout(p, { openKind: 'form' })
    expect(l.trails.find((t) => t.id === 'moreDoors:form')).toMatchObject({ row: 'doorGroup:form', reaches: ['group:Marketing'] })
    expect(l.trails.find((t) => t.id === 'door:cp:cp-1')).toMatchObject({ row: 'doorGroup:form', reaches: [] })
    expect(l.trails.find((t) => t.id === 'doorGroup:form')).toMatchObject({ row: 'doorGroup:form', reaches: ['group:Marketing'] })
  })

  it('reaches a member’s own row as well as its card when the card is open', () => {
    const l = rossi({ openGroup: 'group:Marketing' })
    expect(l.trails.find((t) => t.id === 'door:place:pl-2')!.reaches).toEqual(['group:Marketing', 'member:pl-4'])
  })

  it('keeps at full strength what a way in is connected to, and nothing else', () => {
    const l = rossi()
    const lit = traced(l, 'door:place:pl-2')!
    expect([...lit].sort()).toEqual(['controller', 'door:place:pl-2', 'group:Marketing', 'people', 'sg-2'])
    expect(l.edges.filter((e) => tracedEdge(lit, e)).map((e) => `${e.from}->${e.to}`)).toEqual(['door:place:pl-2->controller', 'controller->group:Marketing'])
  })

  it('answers a destination with the ways in that reach it and the people who use them', () => {
    const lit = traced(rossi(), 'group:Delivery')!
    expect([...lit].sort()).toEqual(['controller', 'door:place:pl-3', 'group:Delivery', 'people', 'sg-1'])
    // Asked about one destination, the others the same way in also feeds are not the answer.
    const ugly = computeLayout(dorsaleUgly())
    const one = traced(ugly, 'group:Sales')!
    expect(destinationCards(ugly).filter((n) => one.has(n.id)).map((n) => n.id)).toEqual(['group:Sales'])
  })

  it('answers a person with the ways in they come through and where those lead', () => {
    const lit = traced(rossi(), 'sg-2')!
    expect(lit.has('door:place:pl-2')).toBe(true)
    expect(lit.has('group:Marketing')).toBe(true)
    expect(lit.has('sg-1')).toBe(false)
  })

  it('does not grey a card’s own rows when the card is what is asked about, nor the card for one of its rows', () => {
    const l = computeLayout(dorsaleUgly(), { openKind: 'form' })
    const sub = l.nodes.find((n) => n.parent === 'doorGroup:form')!
    expect(traced(l, 'doorGroup:form')!.has(sub.id)).toBe(true)
    expect(traced(l, sub.id)!.has('doorGroup:form')).toBe(true)
    expect(traced(l, sub.id)!.has('moreDoors:form')).toBe(false)
  })

  it('dims nothing for the organisation, nor for a focus that is not on the sheet', () => {
    expect(traced(rossi(), 'controller')).toBeNull()
    expect(traced(rossi(), 'nothing-here')).toBeNull()
    expect(traced(rossi(), null)).toBeNull()
    expect(rossi().edges.every((e) => tracedEdge(null, e))).toBe(true)
  })
})

describe('on every fixture, closed and open: lines', () => {
  it('no line crosses a card, and every line ends at one', () => {
    for (const [name, make] of DORSALE_FIXTURES) {
      for (const view of VIEWS(make())) {
        const l = computeLayout(make(), view)
        expect(l.edges.length, name).toBeGreaterThan(0)
        expect(problems(l), `${name} ${JSON.stringify(view)}`).toEqual([])
      }
    }
  })
})
