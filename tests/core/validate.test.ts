import { describe, it, expect } from 'vitest'
import { createEmptyProject, validateProject } from '../../src/core/project'

const NOW = '2026-07-30T09:00:00.000Z'

describe('validateProject', () => {
  it('accepts a project it just created', () => {
    const r = validateProject(createEmptyProject('X', NOW))
    expect(r.ok).toBe(true)
  })

  it('rejects a non-object', () => {
    const r = validateProject('not a project')
    expect(r).toEqual({ ok: false, errors: ['Project must be an object.'] })
  })

  it('rejects an unsupported schemaVersion with a readable message', () => {
    const r = validateProject({ ...createEmptyProject('X', NOW), schemaVersion: 99 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContain(
        'Unsupported schemaVersion: 99. This file needs a newer version of the app.',
      )
    }
  })

  it('reports every missing array rather than only the first', () => {
    const r = validateProject({ schemaVersion: 1, name: 'X', createdAt: NOW })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContain('purposeGroups must be an array.')
      expect(r.errors).toContain('places must be an array.')
      expect(r.errors).toContain('flows must be an array.')
    }
  })

  it('rejects a flow pointing at a place that does not exist', () => {
    const p = createEmptyProject('X', NOW)
    p.flows.push({
      id: 'f1', from: 'missing-a', to: 'missing-b',
      dataDescription: 'd', purpose: 'p', sources: [], confidence: 'declared',
    })
    const r = validateProject(p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('Flow f1 refers to unknown id: missing-a')
  })
})
