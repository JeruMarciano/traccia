import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DetailPanel } from '../../src/renderer/components/DetailPanel'
import { STRINGS } from '../../src/renderer/strings'
import { rossiEditore } from '../fixtures/rossiEditore'
import { answerByHand } from '../../src/core/answers'
import vendorsJson from '../../src/data/vendors.json'
import type { Project, VendorDictionary } from '../../src/core/types'

const V = vendorsJson as VendorDictionary

function show(id: string, project: Project = rossiEditore()): string {
  return renderToStaticMarkup(<DetailPanel project={project} selected={id} dictionary={V} />)
}

describe('DetailPanel', () => {
  it('states a fact and, under it, who said it', () => {
    // The document's name is the attribution. Prefixing it with "declared" only repeated what a
    // filename already implies.
    const markup = show('pl-4')
    expect(markup).toContain('until unsubscribed')
    expect(markup).toContain('informativa-clienti.pdf')
    expect(markup).not.toContain(`${STRINGS.detailConfidenceDeclared} ·`)
  })

  it('says how an unsourced fact is known rather than hiding it', () => {
    // pl-8 came from a scan and no document names it. Its facts are still shown, attributed as
    // observed. Saying "recorded by hand" here, as this panel once did, claims a person typed
    // something nobody typed.
    const markup = show('pl-8')
    expect(markup).toContain(STRINGS.detailConfidenceObserved)
    expect(markup).not.toContain(STRINGS.detailRecordedByHand)
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

describe('answering a question from the panel', () => {
  const show = (id: string, project = rossiEditore()) =>
    renderToStaticMarkup(
      <DetailPanel project={project} selected={id} dictionary={V} onAnswer={() => {}} />,
    )

  /** A supplier with no retention on file: the shape the retention gap rule asks about. */
  const withRetentionUnanswered = () => {
    const project = rossiEditore()
    const mailchimp = project.places.find((pl) => pl.id === 'pl-4')
    if (mailchimp === undefined) throw new Error('fixture changed')
    delete mailchimp.retention
    return project
  }

  it('offers a text box for the question a typed answer settles', () => {
    const markup = show('pl-4', withRetentionUnanswered())
    expect(markup).toContain('answer-input')
    expect(markup).toContain(STRINGS.detailAnswerSave)
  })

  it('offers yes and no for whether data leaves the EEA', () => {
    const markup = show('pl-7')
    expect(markup).toContain(STRINGS.detailAnswerYes)
    expect(markup).toContain(STRINGS.detailAnswerNo)
  })

  it('states the question it cannot answer rather than offering an empty box for it', () => {
    // "Which document says this receives data?" is not something a text box settles, so it is
    // listed and left alone. pl-7 has that gap alongside the EEA one.
    const markup = show('pl-7')
    expect(markup).toContain('Which document says Payroll system receives data?')
    expect((markup.match(/answer-input/g) ?? []).length).toBe(0)
  })

  it('attributes an answered fact to the hand that typed it', () => {
    const answered = answerByHand(withRetentionUnanswered(), 'pl-4', 'retention', 'six weeks')
    const markup = show('pl-4', answered)
    expect(markup).toContain('six weeks')
    expect(markup).toContain(STRINGS.detailRecordedByHand)
    // The document that named the place never said this, and must not appear to have.
    expect(markup).not.toMatch(/six weeks[\s\S]{0,120}informativa-clienti\.pdf/)
  })

  it('offers nothing to answer with when no handler is given', () => {
    const markup = renderToStaticMarkup(
      <DetailPanel project={rossiEditore()} selected="pl-7" dictionary={V} />,
    )
    expect(markup).not.toContain(STRINGS.detailAnswerYes)
  })
})
