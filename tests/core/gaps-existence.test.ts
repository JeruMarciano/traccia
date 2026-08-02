import { describe, it, expect } from 'vitest'
import { existenceGaps } from '../../src/core/gaps/existence'
import { EXPECTATIONS } from '../../src/core/expectations'
import { emptyProject, place, projectWithPlaces } from '../fixtures/projects'

function withEmployees() {
  const p = projectWithPlaces(place({ name: 'HR files', purposeGroup: 'Employing people' }))
  return { ...p, subjectGroups: [{ id: 'sg-1', name: 'Employees', estimatedCount: 40 }] }
}

describe('expectations', () => {
  it('ships exactly twelve', () => {
    expect(EXPECTATIONS).toHaveLength(12)
  })

  it('gives every expectation a unique id', () => {
    const ids = EXPECTATIONS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('existenceGaps', () => {
  it('asserts nothing about an empty project', () => {
    expect(existenceGaps(emptyProject())).toEqual([])
  })

  it('expects payroll once the project records employees', () => {
    const gaps = existenceGaps(withEmployees())
    expect(gaps.map((g) => g.id)).toContain('exist:payroll')
    expect(gaps.find((g) => g.id === 'exist:payroll')?.question).toBe('Who processes payroll?')
  })

  it('stops expecting payroll once a payroll place exists', () => {
    const base = withEmployees()
    const p = {
      ...base,
      places: [
        ...base.places,
        { ...place({ name: 'Payroll bureau', purposeGroup: 'Employing people' }), id: 'pl-9' },
      ],
    }
    expect(existenceGaps(p).map((g) => g.id)).not.toContain('exist:payroll')
  })

  it('does not expect payroll when the project records no employees', () => {
    const p = projectWithPlaces(place({ name: 'Newsletter' }))
    expect(existenceGaps(p).map((g) => g.id)).not.toContain('exist:payroll')
  })

  it('phrases the reason neutrally', () => {
    const g = existenceGaps(withEmployees()).find((x) => x.id === 'exist:payroll')
    expect(g?.why).toBe(
      'The project records employees, so something processes their pay. No entry names it yet.',
    )
    expect(g?.why).not.toMatch(/violation|breach|non-compliant|risk/i)
  })

  it('asserts no internal-function expectations against a scan-only project', () => {
    // A website scan produces observed places and a visitors subject group and
    // nothing else. It is not evidence about payroll, accounting or backups,
    // and a first-checkup map must not ask about them as if it were.
    // The assertion is exact rather than five `not.toContain` checks: an
    // empty register would satisfy those trivially, which is not the claim
    // being tested. `exist:hosting` is expected to fire — a scanned site is
    // genuine evidence of website hosting.
    const scanOnly = {
      ...emptyProject(),
      subjectGroups: [{ id: 'sg-1', name: 'Website visitors' }],
      places: [
        { ...place({ name: 'rossi-editore.it', kind: 'collection', confidence: 'observed', holder: 'you' }), id: 'pl-1' },
        { ...place({ name: 'Google Analytics', confidence: 'observed' }), id: 'pl-2' },
      ],
    }
    expect(existenceGaps(scanOnly).map((g) => g.id)).toEqual(['exist:hosting'])
  })

  it('asserts them again once a document has declared something', () => {
    const withDocument = {
      ...emptyProject(),
      subjectGroups: [{ id: 'sg-1', name: 'Website visitors' }],
      places: [
        { ...place({ name: 'rossi-editore.it', confidence: 'observed', holder: 'you' }), id: 'pl-1' },
        { ...place({ name: 'Acme Srl', confidence: 'declared' }), id: 'pl-2' },
      ],
    }
    expect(existenceGaps(withDocument).map((g) => g.id)).toContain('exist:accounting')
  })

  it('still expects website analytics once a site has been observed', () => {
    // The scanned site is a collection point the organisation holds. That is a
    // website whatever it is named, so the site-triggered expectations apply.
    const scanOnly = {
      ...emptyProject(),
      subjectGroups: [{ id: 'sg-1', name: 'Website visitors' }],
      places: [
        { ...place({ name: 'rossi-editore.it', kind: 'collection', holder: 'you', confidence: 'observed' }), id: 'pl-1' },
      ],
    }
    expect(existenceGaps(scanOnly).map((g) => g.id)).toContain('exist:analytics')
  })
})
