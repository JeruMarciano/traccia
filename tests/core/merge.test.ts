import { describe, it, expect } from 'vitest'
import { mergeObservations } from '../../src/core/merge'
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
})
