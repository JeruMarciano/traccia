import { describe, it, expect } from 'vitest'
import { mergeObservations } from '../../src/core/merge'
import { addPlace } from '../../src/core/graph'
import { place, projectWithPlaces } from '../fixtures/projects'
import type { Observation } from '../../src/core/types'

const obs = (domain: string, over: Partial<Observation> = {}): Observation => ({
  domain, requestCount: 3, beforeConsent: false, ...over,
})

describe('mergeObservations', () => {
  it('raises confidence on a place that already accounts for the domain', () => {
    const p = projectWithPlaces(place({ name: 'Newsletter', jurisdiction: 'mailer.example' }))
    const merged = mergeObservations(p, [obs('mailer.example')], 'obs')
    expect(merged.places).toHaveLength(1)
    expect(merged.places[0]?.confidence).toBe('observed')
  })

  it('creates an unknown place for a domain nothing accounts for', () => {
    const p = projectWithPlaces(place({ name: 'Newsletter', jurisdiction: 'mailer.example' }))
    const merged = mergeObservations(p, [obs('tracker.example')], 'obs')
    const created = merged.places.find((x) => x.name === 'tracker.example')
    expect(created?.kind).toBe('unknown')
    expect(created?.holder).toBe('unknown')
    expect(created?.leavesEEA).toBe('unknown')
    expect(created?.confidence).toBe('observed')
    expect(created?.id).toBe('obs-1')
  })

  it('does not create a duplicate when merged twice', () => {
    const p = projectWithPlaces(place())
    const once = mergeObservations(p, [obs('tracker.example')], 'obs')
    const twice = mergeObservations(once, [obs('tracker.example')], 'obs')
    expect(twice.places.filter((x) => x.name === 'tracker.example')).toHaveLength(1)
  })

  it('never overwrites what a human or a document declared', () => {
    const p = projectWithPlaces(
      place({
        name: 'Newsletter', jurisdiction: 'mailer.example',
        confidence: 'declared', retention: '2 years',
      }),
    )
    const merged = mergeObservations(p, [obs('mailer.example')], 'obs')
    expect(merged.places[0]?.retention).toBe('2 years')
    expect(merged.places[0]?.name).toBe('Newsletter')
  })

  it('records the observations on the project', () => {
    const merged = mergeObservations(projectWithPlaces(place()), [obs('a.example')], 'obs')
    expect(merged.observations).toHaveLength(1)
    expect(merged.observations[0]?.domain).toBe('a.example')
  })

  it('does not treat an unrelated place as accounting for a domain that is merely a substring of its jurisdiction', () => {
    const p = projectWithPlaces(
      place({ name: 'Other service', jurisdiction: 'acme.example.org' }),
    )
    const merged = mergeObservations(p, [obs('acme.example')], 'obs')
    const original = merged.places.find((x) => x.name === 'Other service')
    const created = merged.places.find((x) => x.name === 'acme.example')
    expect(original?.confidence).toBe('declared')
    expect(created).toBeDefined()
    expect(created?.kind).toBe('unknown')
    expect(created?.confidence).toBe('observed')
  })

  it('does not collide ids across two separate merges that reuse the same idPrefix', () => {
    const p = projectWithPlaces(place())
    const first = mergeObservations(p, [obs('a.example')], 'obs')
    const second = mergeObservations(first, [obs('b.example')], 'obs')
    const a = second.places.find((x) => x.name === 'a.example')
    const b = second.places.find((x) => x.name === 'b.example')
    expect(a?.id).toBeDefined()
    expect(b?.id).toBeDefined()
    expect(a?.id).not.toBe(b?.id)
    expect(new Set(second.places.map((x) => x.id)).size).toBe(second.places.length)
  })

  it('skips an id already taken by an unrelated place instead of colliding with it', () => {
    const p = addPlace(projectWithPlaces(place()), place({ name: 'Manually numbered' }), 'obs-1')
    const merged = mergeObservations(p, [obs('tracker.example')], 'obs')
    const created = merged.places.find((x) => x.name === 'tracker.example')
    expect(created?.id).toBe('obs-2')
    expect(merged.places.filter((x) => x.id === 'obs-1')).toHaveLength(1)
  })
})
