import { describe, it, expect } from 'vitest'
import { panelFor } from '../../src/core/panel'
import { answerByHand } from '../../src/core/answers'
import { rossiEditore } from '../fixtures/rossiEditore'
import { emptyProject } from '../fixtures/projects'
import vendorsJson from '../../src/data/vendors.json'
import type { VendorDictionary } from '../../src/core/types'

const V = vendorsJson as VendorDictionary
const p = () => rossiEditore()
const panel = (id: string | null) => panelFor(p(), id, V)

describe('panelFor a place', () => {
  it('states only the facts somebody answered', () => {
    const d = panel('pl-4')
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    expect([...d.facts.map((f) => f.field)].sort()).toEqual([
      'dataCategories',
      'eea',
      'purpose',
      'retention',
      'where',
    ])
    expect(d.facts.every((f) => f.value !== '')).toBe(true)
  })

  it('leaves out a fact nobody answered rather than saying so', () => {
    const d = panel('pl-7')
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    expect(d.facts.map((f) => f.field)).toEqual(['purpose'])
    expect(JSON.stringify(d.facts)).not.toMatch(/not yet identified/i)
  })

  it('does not treat the "not yet identified" purpose as an answer', () => {
    // ingestScan writes that sentinel into purposeGroup for a host it cannot place. Rendering it
    // as a fact would put the loudest non-answer on the page back, which is what this panel is
    // being rebuilt to stop.
    const project = p()
    const place = project.places.find((pl) => pl.id === 'pl-9')
    if (place === undefined) throw new Error('fixture changed')
    place.purposeGroup = 'Not yet identified'
    const d = panelFor(project, 'pl-9', V)
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    expect(d.facts).toEqual([])
  })

  it('attributes every fact', () => {
    const d = panel('pl-4')
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    expect(d.facts.every((f) => f.confidence === 'declared')).toBe(true)
    expect(d.facts.every((f) => f.sourceNames.includes('informativa-clienti.pdf'))).toBe(true)
  })

  it('keeps a fact whose sources are empty, with an empty attribution', () => {
    const d = panel('pl-8')
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    const purpose = d.facts.find((f) => f.field === 'purpose')
    expect(purpose).toBeDefined()
    expect(purpose?.sourceNames).toEqual([])
  })

  it('rolls the unknowns into a count and the gap sheet’s own questions', () => {
    const d = panel('pl-7')
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    expect(d.unknowns.count).toBe(2)
    expect(d.unknowns.questions.map((q) => q.question)).toContain(
      'Does data sent to Payroll system leave the EEA?',
    )
    // Two of the three gap rules map onto a field of the place and can be answered here; the
    // one asking which document says so cannot, and is stated rather than offered.
    expect(d.unknowns.questions.find((q) => q.id.endsWith(':leavesEEA'))?.answer).toEqual({
      field: 'leavesEEA',
      kind: 'yesno',
    })
    expect(d.unknowns.questions.find((q) => q.id.endsWith(':sources'))?.answer).toBeUndefined()
  })

  it('says nothing at all when nothing is unknown', () => {
    const d = panel('pl-5')
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    expect(d.unknowns).toEqual({ count: 0, questions: [] })
  })

  it('lists what was observed running against the place it belongs to', () => {
    const d = panel('pl-8')
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    expect(d.observations.map((o) => o.domain)).toEqual(['stat.rossi-editore.it'])
  })

  it('lists the cookies recorded against the place', () => {
    const project = p()
    project.cookies = [
      { name: '_ga', domain: '.rossi-editore.it', thirdParty: true, lifetime: 'a-year-or-more', placeId: 'pl-4' },
      { name: 'sid', domain: '.rossi-editore.it', thirdParty: false, lifetime: 'session' },
    ]
    const d = panelFor(project, 'pl-4', V)
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    expect(d.cookies.map((c) => c.name)).toEqual(['_ga'])
  })

  it('names the doors it is reached from', () => {
    const d = panel('pl-4')
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    // The colour has to be the door's own, the one the map drew, not the chip's position here.
    expect(d.reachedFrom).toEqual([
      { id: 'place:pl-2', colourIndex: 0 },
      { id: 'place:pl-3', colourIndex: 1 },
    ])
  })

  it('answers the same for a member id as for the bare place id', () => {
    expect(panel('member:pl-4')).toEqual(panel('pl-4'))
  })
})

describe('panelFor a door', () => {
  it('says who comes through and what is asked', () => {
    const d = panel('door:cp:cp-1')
    if (d?.sort !== 'door') throw new Error('expected a door panel')
    expect(d.origin).toBe('discovered')
    expect(d.fields).toEqual(['email', 'nome', 'messaggio'])
    expect(d.whoComesThrough).toEqual([])
  })

  it('names the people who come through a declared door', () => {
    const d = panel('door:place:pl-2')
    if (d?.sort !== 'door') throw new Error('expected a door panel')
    expect(d.whoComesThrough).toEqual(['Website visitors'])
    expect(d.origin).toBe('declared')
  })
})

describe('panelFor the controller', () => {
  it('gives the name, the document that named it, and the totals', () => {
    const d = panel('controller')
    if (d?.sort !== 'controller') throw new Error('expected a controller panel')
    expect(d.name).toBe('Rossi Editore srl')
    expect(d.sourceNames).toEqual(['informativa-clienti.pdf'])
    expect(d.totals).toEqual({ places: 9, doors: 3, subjectGroups: 3, flows: 6 })
  })

  it('leaves the name null when no document has named one', () => {
    const project = p()
    project.places = project.places.filter((pl) => pl.id !== 'pl-1')
    const d = panelFor(project, 'controller', V)
    if (d?.sort !== 'controller') throw new Error('expected a controller panel')
    expect(d.name).toBeNull()
    expect(d.sourceNames).toEqual([])
  })

  it('carries the questions that are about the project rather than one place', () => {
    const d = panel('controller')
    if (d?.sort !== 'controller') throw new Error('expected a controller panel')
    expect(d.unknowns.count).toBeGreaterThan(0)
    expect(d.unknowns.questions.every((q) => q.question.length > 0)).toBe(true)
  })
})

describe('panelFor a group', () => {
  it('lists its members, unexplained ones marked', () => {
    const d = panel('group:Marketing')
    if (d?.sort !== 'group') throw new Error('expected a group panel')
    expect(d.members).toEqual([
      { id: 'pl-4', name: 'Mailchimp', unexplained: false },
      { id: 'pl-8', name: 'stat.rossi-editore.it', unexplained: true },
    ])
  })

  it('leaves out the door and the controller, exactly as the map does', () => {
    const d = panel('group:Systems')
    if (d?.sort !== 'group') throw new Error('expected a group panel')
    expect(d.members.map((m) => m.id)).toEqual(['pl-9'])
  })
})

describe('a selection that names nothing', () => {
  it('reads as no selection', () => {
    expect(panel(null)).toBeNull()
    expect(panel('pl-999')).toBeNull()
    expect(panel('group:Nonexistent')).toBeNull()
    expect(panel('door:cp:nope')).toBeNull()
    expect(panel('member:pl-999')).toBeNull()
    expect(panelFor(emptyProject(), 'controller', V)).toBeNull()
  })
})

describe('a fact somebody typed in', () => {
  it('is attributed to the hand that typed it, not to the document that named the place', () => {
    // pl-4 is declared by informativa-clienti.pdf, which said nothing about how long Mailchimp
    // keeps anything. A typed retention showing "declared · informativa-clienti.pdf" would put
    // words in that document's mouth.
    const typed = answerByHand(p(), 'pl-4', 'retention', 'six weeks')
    const d = panelFor(typed, 'pl-4', V)
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    const retention = d.facts.find((f) => f.field === 'retention')
    expect(retention?.value).toBe('six weeks')
    expect(retention?.byHand).toBe(true)
    expect(retention?.sourceNames).toEqual([])
  })

  it('leaves the place’s other facts attributed to their document', () => {
    const typed = answerByHand(p(), 'pl-4', 'retention', 'six weeks')
    const d = panelFor(typed, 'pl-4', V)
    if (d?.sort !== 'place') throw new Error('expected a place panel')
    const where = d.facts.find((f) => f.field === 'where')
    expect(where?.byHand).toBe(false)
    expect(where?.sourceNames).toEqual(['informativa-clienti.pdf'])
  })

  it('answers the question it was asked, so the roll-up drops by one', () => {
    const before = panelFor(p(), 'pl-7', V)
    const after = panelFor(answerByHand(p(), 'pl-7', 'leavesEEA', false), 'pl-7', V)
    if (before?.sort !== 'place' || after?.sort !== 'place') throw new Error('expected place panels')
    expect(after.unknowns.count).toBe(before.unknowns.count - 1)
    expect(after.facts.find((f) => f.field === 'eea')?.byHand).toBe(true)
  })
})
