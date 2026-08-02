import type { Confidence, Holder, PlaceKind, Project, Tri, VendorDictionary } from '../core/types'
import { identify } from '../core/vendors'
import { STRINGS } from './strings'

/**
 * The detail panel's data, assembled once per selection so the component stays a plain view.
 *
 * The map only draws purpose groups (see src/core/layout.ts), never single places, so what a
 * click selects is a group, not a place -- `placeDetails` names one place regardless, and
 * `placeIdsForSelection` is what turns a map selection into the places the panel lists.
 */

export interface FlowDetail {
  id: string
  dataDescription: string
  purpose: string
  /** The subject group or place the flow comes from, by name. */
  fromLabel: string
}

export interface ObservationDetail {
  domain: string
  requestCount: number
  beforeConsent: boolean
}

export interface PlaceDetail {
  id: string
  name: string
  purposeGroup: string
  holderLabel: string
  kindLabel: string
  confidenceLabel: string
  jurisdictionLabel: string
  leavesEEALabel: string
  retentionLabel: string
  flowsIn: FlowDetail[]
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

function holderLabel(h: Holder): string {
  if (h === 'you') return STRINGS.holderYou
  if (h === 'supplier') return STRINGS.holderSupplier
  return STRINGS.notYetIdentified
}

function kindLabel(k: PlaceKind): string {
  if (k === 'collection') return STRINGS.kindCollection
  if (k === 'internal') return STRINGS.kindInternal
  if (k === 'processor') return STRINGS.kindProcessor
  return STRINGS.notYetIdentified
}

function confidenceLabel(c: Confidence): string {
  if (c === 'observed') return STRINGS.confidenceObserved
  if (c === 'declared') return STRINGS.confidenceDeclared
  return STRINGS.confidenceInferred
}

function leavesEEALabel(t: Tri): string {
  if (t === true) return STRINGS.leavesEEAYes
  if (t === false) return STRINGS.leavesEEANo
  return STRINGS.notYetIdentified
}

/** The name of whatever a flow's `from` id points at -- a subject group or a place. */
function fromLabel(project: Project, id: string): string {
  const place = project.places.find((p) => p.id === id)
  if (place !== undefined) return place.name
  const subject = project.subjectGroups.find((s) => s.id === id)
  if (subject !== undefined) return subject.name
  return STRINGS.notYetIdentified
}

/**
 * Everything the detail panel shows for one place, read out of the project as it stands. `null`
 * for a null id or one that names no place -- a dangling id from a stale selection reads the
 * same as no selection, not as an error.
 */
export function placeDetails(
  project: Project,
  placeId: string | null,
  dictionary: VendorDictionary,
): PlaceDetail | null {
  if (placeId === null) return null
  const place = project.places.find((p) => p.id === placeId)
  if (place === undefined) return null

  const flowsIn: FlowDetail[] = project.flows
    .filter((f) => f.to === place.id)
    .map((f) => ({
      id: f.id,
      dataDescription: f.dataDescription,
      purpose: f.purpose,
      fromLabel: fromLabel(project, f.from),
    }))

  const observations: ObservationDetail[] = project.observations
    .filter((o) => derivedPlaceName(o.domain, dictionary).toLowerCase() === place.name.toLowerCase())
    .map((o) => ({ domain: o.domain, requestCount: o.requestCount, beforeConsent: o.beforeConsent }))

  return {
    id: place.id,
    name: place.name,
    purposeGroup: place.purposeGroup,
    holderLabel: holderLabel(place.holder),
    kindLabel: kindLabel(place.kind),
    confidenceLabel: confidenceLabel(place.confidence),
    jurisdictionLabel: place.jurisdiction ?? STRINGS.notYetIdentified,
    leavesEEALabel: leavesEEALabel(place.leavesEEA),
    retentionLabel: place.retention ?? STRINGS.notYetIdentified,
    flowsIn,
    observations,
  }
}

/**
 * Which places a map selection names. `null` and the people hub (`'centre'`) name none; a group
 * tile (`group:<purpose group>`, the id layout.ts assigns -- see src/core/layout.ts) names every
 * place in that group, in project order.
 *
 * A selection can also be a bare place id -- not something a map click ever produces, but
 * exactly what RegisterPanel's `onHover` passes when a gap's subject is a place (see
 * src/core/types.ts, `Gap.subject`). That id names just the one place.
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
