import type { Project } from './types'

/**
 * Who answers for all this. The centre of the map is the one point that is the organisation
 * itself rather than something it uses, and a document has to have said so -- guessing a company
 * name off a scanned domain is exactly the guess the non-negotiables forbid.
 *
 * Returns null rather than a fallback string. The fallback is display text and belongs in
 * strings.ts; core does not hold words the user reads.
 */

/** The group extractCandidates files a named controller under (see documents.ts). */
const RUNNING = 'Running the systems'

export interface ControllerName {
  /** The name to draw, or null when no document has named one. */
  name: string | null
  /** The place the name came from, for the panel's attribution line. */
  placeId: string | null
}

export function controllerName(project: Project): ControllerName {
  // All three clauses matter. Without the group, "Payroll system" becomes the controller of the
  // organisation; without kind, the scanned site does, since ingestScan files it under the same
  // group as a collection place held by 'you'.
  const hit = project.places.find(
    (p) => p.holder === 'you' && p.kind === 'internal' && p.purposeGroup === RUNNING,
  )
  return hit === undefined ? { name: null, placeId: null } : { name: hit.name, placeId: hit.id }
}
