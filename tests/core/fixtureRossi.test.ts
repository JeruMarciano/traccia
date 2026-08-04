// The sample project the controller-centred map was approved against. It is a fixture, so the
// thing worth testing about it is that it stays the shape the design was judged on: a layout
// claim measured against a project that has drifted is measured against nothing.
import { describe, it, expect } from 'vitest'
import { rossiEditore } from '../fixtures/rossiEditore'
import { validateProject } from '../../src/core/project'

describe('the Rossi Editore sample project', () => {
  it('is a valid project file', () => {
    const result = validateProject(JSON.parse(JSON.stringify(rossiEditore())))
    // Asserted on the errors, not on ok alone: a failure should say what is wrong with the
    // fixture, and `expect(result.ok).toBe(true)` prints only "false".
    expect(result.ok ? [] : result.errors).toEqual([])
  })

  it('has the shape the design was approved against', () => {
    const p = rossiEditore()
    expect(p.subjectGroups).toHaveLength(3)
    expect(p.places.filter((pl) => pl.kind === 'collection')).toHaveLength(2)
    expect(p.collectionPoints ?? []).toHaveLength(1)
    expect(new Set(p.places.map((pl) => pl.purposeGroup)).size).toBe(5)
    expect(p.places.filter((pl) => pl.kind === 'unknown')).toHaveLength(2)
  })

  it('names a controller', () => {
    const p = rossiEditore()
    expect(
      p.places.some((pl) => pl.holder === 'you' && pl.purposeGroup === 'Systems'),
    ).toBe(true)
  })
})
