import { updatePlace } from './graph'
import type { HandEnteredField, Place, Project } from './types'

/**
 * A person answering one of the questions the map is asking.
 *
 * The map computes what it does not know and states it neutrally; until now there was no way to
 * answer any of it inside the app, which made "not yet identified" a dead end rather than an
 * invitation. This is the smallest honest way to close that: the two questions the gap rules
 * actually ask about a place, answered in place.
 *
 * Honesty is the whole reason `handEntered` exists. Every fact in the panel carries a line saying
 * how it is known and from what, drawn from the place's own confidence and sources. A retention
 * somebody typed onto a place declared by a DPA would otherwise appear over that document's name,
 * which is a lie of exactly the kind this tool is built to avoid. Recording which fields were
 * entered by hand lets the panel attribute each one truthfully.
 *
 * Additive on `Place` and optional, so a project file written before this existed loads
 * unchanged and `schemaVersion` does not move -- the same treatment `cookies` and
 * `collectionPoints` had.
 */
export function answerByHand(
  project: Project,
  placeId: string,
  field: 'retention',
  value: string,
): Project
export function answerByHand(
  project: Project,
  placeId: string,
  field: 'leavesEEA',
  value: boolean,
): Project
export function answerByHand(
  project: Project,
  placeId: string,
  field: HandEnteredField,
  value: string | boolean,
): Project {
  const place = project.places.find((p) => p.id === placeId)
  // A dangling id reads as no selection everywhere else on this sheet; it does the same here
  // rather than throwing at the person who clicked.
  if (place === undefined) return project

  const patch: Partial<Omit<Place, 'id'>> = {}
  if (field === 'retention') {
    const text = typeof value === 'string' ? value.trim() : ''
    // A blank is not an answer. Storing one would turn a question the map was honestly asking
    // into a fact that says nothing.
    if (text === '') return project
    patch.retention = text
  } else {
    if (typeof value !== 'boolean') return project
    patch.leavesEEA = value
  }

  const handEntered = place.handEntered ?? []
  patch.handEntered = handEntered.includes(field) ? handEntered : [...handEntered, field]

  return updatePlace(project, placeId, patch)
}
