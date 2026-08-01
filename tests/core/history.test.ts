import { describe, it, expect } from 'vitest'
import { initHistory, push, undo, redo, canUndo, canRedo } from '../../src/core/history'
import { updatePlace } from '../../src/core/graph'
import { place, projectWithPlaces } from '../fixtures/projects'

const base = () => projectWithPlaces(place({ name: 'Newsletter' }))

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = initHistory(base())
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('undo restores the previous project', () => {
    const start = base()
    const h = push(initHistory(start), updatePlace(start, 'pl-1', { retention: '1 year' }))
    expect(h.present.places[0]?.retention).toBe('1 year')
    expect(undo(h).present.places[0]?.retention).toBe('2 years')
  })

  it('redo reapplies what undo removed', () => {
    const start = base()
    const h = push(initHistory(start), updatePlace(start, 'pl-1', { retention: '1 year' }))
    expect(redo(undo(h)).present.places[0]?.retention).toBe('1 year')
  })

  it('a new change discards the redo branch', () => {
    const start = base()
    let h = push(initHistory(start), updatePlace(start, 'pl-1', { retention: '1 year' }))
    h = undo(h)
    h = push(h, updatePlace(h.present, 'pl-1', { retention: '5 years' }))
    expect(canRedo(h)).toBe(false)
    expect(h.present.places[0]?.retention).toBe('5 years')
  })

  it('undo at the beginning is a no-op', () => {
    const h = initHistory(base())
    expect(undo(h)).toEqual(h)
  })

  it('keeps at most 50 past states', () => {
    let h = initHistory(base())
    for (let i = 0; i < 60; i += 1) {
      h = push(h, updatePlace(h.present, 'pl-1', { retention: `${i} years` }))
    }
    expect(h.past).toHaveLength(50)
  })
})
