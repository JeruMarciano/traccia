import { describe, it, expect } from 'vitest'
import { createEmptyProject, validateProject } from '../../src/core/project'

const NOW = '2026-07-30T09:00:00.000Z'

const makeProject = () => createEmptyProject('X', NOW)

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

  it('does not throw when places contains a null instead of an object', () => {
    const p: any = createEmptyProject('X', NOW)
    p.places.push(null)
    expect(() => validateProject(p)).not.toThrow()
    const r = validateProject(p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('places[0] must be an object with a string id.')
  })

  it('does not throw when subjectGroups contains a non-object element', () => {
    const p: any = createEmptyProject('X', NOW)
    p.subjectGroups.push('not-an-object')
    expect(() => validateProject(p)).not.toThrow()
    const r = validateProject(p)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContain('subjectGroups[0] must be an object with a string id.')
    }
  })

  it('does not throw when flows contains null', () => {
    const p: any = createEmptyProject('X', NOW)
    p.flows.push(null)
    expect(() => validateProject(p)).not.toThrow()
    const r = validateProject(p)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContain('flows[0] must be an object with string id, from, and to.')
    }
  })

  it('opens a v0.2.1 project file that has no cookies or collectionPoints', () => {
    const old = makeProject() // existing helper builds a valid schemaVersion-1 project
    delete (old as unknown as Record<string, unknown>).cookies
    delete (old as unknown as Record<string, unknown>).collectionPoints
    const result = validateProject(old)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.project.cookies).toEqual([])
      expect(result.project.collectionPoints).toEqual([])
    }
  })

  it('rejects cookies that are not an array of the expected shape', () => {
    const bad = { ...makeProject(), cookies: [{ name: 1 }] }
    expect(validateProject(bad).ok).toBe(false)
  })

  it('rejects a collectionPoint whose fields carry an unknown kind', () => {
    const bad = {
      ...makeProject(),
      collectionPoints: [{ id: 'cp-1', page: 'https://x.it/contact', fields: [{ name: 'e', kind: 'ssn' }], sources: [], confidence: 'observed' }],
    }
    expect(validateProject(bad).ok).toBe(false)
  })

  it('round-trips a project carrying cookies and collectionPoints unchanged', () => {
    const p = {
      ...makeProject(),
      cookies: [{ name: '_ga', domain: 'google.com', thirdParty: true, lifetime: 'a-year-or-more' }],
      collectionPoints: [{ id: 'cp-1', page: 'https://x.it/contact', fields: [{ name: 'email', kind: 'email' }], sources: [], confidence: 'observed' }],
    }
    const result = validateProject(p)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cookies).toEqual(p.cookies)
  })

  it('loads a collection point with no kind or pages, and refuses a malformed new field', () => {
    const cp = { id: 'cp-1', page: 'https://x.it/', fields: [], sources: [], confidence: 'observed' }
    const withCp = (extra: object) => ({ ...makeProject(), collectionPoints: [{ ...cp, ...extra }] })
    expect(validateProject(withCp({})).ok).toBe(true)
    expect(validateProject(withCp({ kind: 'booking', provider: 'X', pages: ['/'] })).ok).toBe(true)
    for (const bad of [{ kind: 'spy' }, { provider: 3 }, { pages: [1] }, { destination: {} }]) {
      expect(validateProject(withCp(bad)).ok).toBe(false)
    }
  })

  it('refuses a door whose destination is no place, or whose pages and provider are oversized', () => {
    const cp = { id: 'cp-1', page: 'https://x.it/', fields: [], sources: [], confidence: 'observed' }
    const place = { id: 'pl-1', name: 'P', kind: 'processor', purposeGroup: 'Systems', holder: 'supplier', leavesEEA: 'unknown', sources: [], confidence: 'observed' }
    const withCp = (extra: object) => ({ ...makeProject(), places: [place], collectionPoints: [{ ...cp, ...extra }] })
    const six = Array.from({ length: 6 }, (_, i) => `https://x.it/${i}`)
    expect(validateProject(withCp({ kind: 'embed', provider: 'Google Maps', pages: six, destination: 'pl-1' })).ok).toBe(true)
    for (const bad of [
      { destination: 'pl-missing' },
      { pages: Array(14).fill('https://x.it/') },
      { pages: ['https://x.it/' + 'a'.repeat(2048)] },
      { provider: 'p'.repeat(254) },
    ]) {
      expect(validateProject(withCp(bad)).ok).toBe(false)
    }
  })

  it('checks the optional name fields: observation paths and cookie platform', () => {
    const base = makeProject()
    const withObs = (paths: unknown) => ({ ...base, observations: [{ domain: 'a.com', requestCount: 1, beforeConsent: true, paths }] })
    const withCookie = (platform: unknown) => ({ ...base, cookies: [{ name: '_ga', domain: 'a.com', thirdParty: true, lifetime: 'session', platform }] })
    expect(validateProject({ ...base, observations: [{ domain: 'a.com', requestCount: 1, beforeConsent: true }] }).ok).toBe(true)
    expect(validateProject({ ...base, observations: [{ domain: 'a.com', requestCount: 1 }] }).ok).toBe(true)
    expect(validateProject({ ...base, observations: [{ domain: 'a.com', requestCount: 1, beforeConsent: 'yes' }] }).ok).toBe(false)
    expect(validateProject(withObs(['maps', 'a_b-1'])).ok).toBe(true)
    expect(validateProject(withCookie('Google Analytics')).ok).toBe(true)
    for (const bad of [[1], ['A/b'], ['a'.repeat(33)], [''], 'maps', Array.from({ length: 9 }, (_, i) => `s${i}`)]) {
      expect(validateProject(withObs(bad)).ok).toBe(false)
    }
    for (const bad of [5, 'x'.repeat(129)]) expect(validateProject(withCookie(bad)).ok).toBe(false)
  })
})
