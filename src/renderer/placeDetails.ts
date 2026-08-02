import type { Project, Tri, VendorDictionary } from '../core/types'
import { identify } from '../core/vendors'
import { STRINGS } from './strings'

/**
 * The detail panel's data, assembled once per selection so the component stays a plain view.
 *
 * The map only draws purpose groups (see src/core/layout.ts), never single places, so what a
 * click selects is a group, not a place -- `placeDetails` names one place regardless, and
 * `placeIdsForSelection` is what turns a map selection into the places the panel lists.
 *
 * The panel answers four questions and no more: what is this service, where is it, what was
 * observed running, and how long does it keep what it receives.
 */

export interface ObservationDetail {
  domain: string
  requestCount: number
  beforeConsent: boolean
}

export interface PlaceDetail {
  id: string
  name: string
  whereLabel: string
  retentionLabel: string
  observations: ObservationDetail[]
}

// Mirrors the (unexported) displayName/titleCase pair in src/core/scan.ts, the only place a
// scanned host is turned into a place name. A Place carries no domain field, so matching an
// observation back to the place it produced means recomputing that same name here rather than
// looking one up -- duplicated, not imported, because core does not export it. If scan.ts's
// naming ever changes, this has to change with it.
const CATEGORY_OVERRIDES: Readonly<Record<string, string>> = {
  cdn: 'CDN',
  crm: 'CRM',
  'a-b-testing': 'A/B Testing',
}

function titleCase(s: string): string {
  const override = CATEGORY_OVERRIDES[s]
  if (override !== undefined) return override
  return s
    .split('-')
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ')
}

function derivedPlaceName(host: string, dictionary: VendorDictionary): string {
  const hit = identify(host, dictionary)
  return hit === null ? host : `${hit.owner} ${titleCase(hit.category)}`
}

/**
 * Where the service is, as one line. A recorded jurisdiction answers it outright; failing that,
 * whether the data leaves the EEA is still a real answer; failing both, nobody has answered yet.
 */
function whereLabel(jurisdiction: string | undefined, leavesEEA: Tri): string {
  if (jurisdiction !== undefined) return jurisdiction
  if (leavesEEA === true) return STRINGS.detailWhereOutsideEEA
  if (leavesEEA === false) return STRINGS.detailWhereInsideEEA
  return STRINGS.notYetIdentified
}

/**
 * What the panel shows for one place, read out of the project as it stands. `null` for a null
 * id or one that names no place -- a dangling id from a stale selection reads the same as no
 * selection, not as an error.
 */
export function placeDetails(
  project: Project,
  placeId: string | null,
  dictionary: VendorDictionary,
): PlaceDetail | null {
  if (placeId === null) return null
  const place = project.places.find((p) => p.id === placeId)
  if (place === undefined) return null

  const observations: ObservationDetail[] = project.observations
    .filter((o) => derivedPlaceName(o.domain, dictionary).toLowerCase() === place.name.toLowerCase())
    .map((o) => ({ domain: o.domain, requestCount: o.requestCount, beforeConsent: o.beforeConsent }))

  return {
    id: place.id,
    name: place.name,
    whereLabel: whereLabel(place.jurisdiction, place.leavesEEA),
    retentionLabel: place.retention ?? STRINGS.notYetIdentified,
    observations,
  }
}

/**
 * Which places a map selection names. `null` and the people hub (`'centre'`) name none; a group
 * tile (`group:<purpose group>`, the id layout.ts assigns -- see src/core/layout.ts) names every
 * place in that group, in project order. A bare place id names just the one place.
 */
export function placeIdsForSelection(project: Project, selectedId: string | null): string[] {
  if (selectedId === null) return []
  const prefix = 'group:'
  if (selectedId.startsWith(prefix)) {
    const groupName = selectedId.slice(prefix.length)
    return project.places.filter((p) => p.purposeGroup === groupName).map((p) => p.id)
  }
  if (project.places.some((p) => p.id === selectedId)) return [selectedId]
  return []
}
