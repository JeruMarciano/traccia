import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DetailPanel } from '../../src/renderer/components/DetailPanel'
import { STRINGS } from '../../src/renderer/strings'
import { rossiEditore } from '../fixtures/rossiEditore'
import vendorsJson from '../../src/data/vendors.json'
import type { Project, VendorDictionary } from '../../src/core/types'

const V = vendorsJson as VendorDictionary

function show(id: string, project: Project = rossiEditore()): string {
  return renderToStaticMarkup(<DetailPanel project={project} selected={id} dictionary={V} />)
}

describe('DetailPanel', () => {
  it('states a fact and, under it, who said it', () => {
    const markup = show('pl-4')
    expect(markup).toContain('until unsubscribed')
    expect(markup).toContain(
      STRINGS.detailAttribution(STRINGS.detailConfidenceDeclared, 'informativa-clienti.pdf'),
    )
  })

  it('says recorded by hand rather than hiding an unattributed fact', () => {
    expect(show('pl-8')).toContain(STRINGS.detailRecordedByHand)
  })

  it('does not state a field nobody answered', () => {
    // The phrase itself is allowed here — it is the roll-up line's own copy. What must not
    // appear is a Retention row with nothing in it, which is the old panel's defect.
    const markup = show('pl-7')
    expect(markup).not.toContain(`<dt>${STRINGS.detailRetention}</dt>`)
    expect(markup).not.toContain(`<dt>${STRINGS.detailEEA}</dt>`)
  })

  it('rolls the unknowns into one line', () => {
    expect(show('pl-7')).toContain(STRINGS.detailUnknownsSummary(2))
  })

  it('draws no roll-up line when nothing is unknown', () => {
    // The wrong answer: "0 things not yet identified". When nothing is unknown the line is
    // absent, not zero.
    expect(show('pl-5')).not.toMatch(/not yet identified/i)
  })

  it('states the EEA fact here, and as a sentence', () => {
    expect(show('pl-4')).toContain(STRINGS.detailEEAOutside)
    expect(show('pl-5')).toContain(STRINGS.detailEEAInside)
  })

  it('shows a door’s fields and who comes through it', () => {
    const markup = show('door:cp:cp-1')
    expect(markup).toContain(STRINGS.doorDiscovered)
    expect(markup).toContain('messaggio')
    const declared = show('door:place:pl-2')
    expect(declared).toContain('Website visitors')
  })

  it('shows the controller’s name and the project totals', () => {
    const markup = show('controller')
    expect(markup).toContain('Rossi Editore srl')
    expect(markup).toContain(STRINGS.detailTotals(9, 3, 3, 6))
  })

  it('speaks for the controller when no document has named one', () => {
    const project = rossiEditore()
    project.places = project.places.filter((p) => p.id !== 'pl-1')
    expect(show('controller', project)).toContain(STRINGS.yourOrganisation)
  })

  it('lists cookies against the place they belong to', () => {
    const project = rossiEditore()
    project.cookies = [
      { name: '_ga', domain: '.rossi-editore.it', thirdParty: true, lifetime: 'a-year-or-more', placeId: 'pl-4' },
    ]
    expect(show('pl-4', project)).toContain(
      STRINGS.detailCookie('_ga', STRINGS.detailLifetimeAYearOrMore, true),
    )
  })

  it('lists a group’s members', () => {
    expect(show('group:Marketing')).toContain('stat.rossi-editore.it')
  })

  it('renders nothing for a selection that names nothing', () => {
    expect(show('pl-999')).toBe('')
  })
})
