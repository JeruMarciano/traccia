import { describe, it, expect } from 'vitest'
import { controllerName } from '../../src/core/controller'
import { rossiEditore } from '../fixtures/rossiEditore'
import { emptyProject } from '../fixtures/projects'
import type { Place } from '../../src/core/types'

const internalPlace = (over: Partial<Place>): Place => ({
  id: 'pl-1',
  name: 'Payroll system',
  kind: 'internal',
  purposeGroup: 'Payroll & HR',
  holder: 'you',
  leavesEEA: false,
  sources: [],
  confidence: 'inferred',
  ...over,
})

describe('controllerName', () => {
  it('names the controller a document declared', () => {
    expect(controllerName(rossiEditore())).toEqual({ name: 'Rossi Editore srl', placeId: 'pl-1' })
  })

  it('answers null when nothing has named one', () => {
    expect(controllerName(emptyProject())).toEqual({ name: null, placeId: null })
  })

  it('does not mistake an internal system for the controller', () => {
    const p = emptyProject()
    p.places = [internalPlace({})]
    expect(controllerName(p)).toEqual({ name: null, placeId: null })
  })

  it('does not mistake the scanned site for the controller', () => {
    // ingestScan files the scanned host under 'Running the systems' too, but as a collection
    // place held by the organisation -- close enough to the controller's shape to be worth a test.
    const p = emptyProject()
    p.places = [
      internalPlace({ name: 'rossi-editore.it', kind: 'collection', purposeGroup: 'Running the systems' }),
    ]
    expect(controllerName(p)).toEqual({ name: null, placeId: null })
  })

  it('does not mistake a supplier in the same group for the controller', () => {
    const p = emptyProject()
    p.places = [
      internalPlace({ name: 'CloudShip', holder: 'supplier', purposeGroup: 'Running the systems' }),
    ]
    expect(controllerName(p)).toEqual({ name: null, placeId: null })
  })

  it('never returns display text', () => {
    expect(controllerName(emptyProject()).name).toBeNull()
  })
})
