import { controllerName } from './controller'
import { deriveDoors, tracePaths } from './doors'
import { computeGaps } from './gaps'
import { groupMembers } from './layout'
import { NOT_IDENTIFIED } from './scan'
import { identify } from './vendors'
import type {
  Confidence,
  CookieLifetime,
  DoorOrigin,
  Place,
  Project,
  VendorDictionary,
} from './types'

/**
 * What the detail panel says about whatever is selected.
 *
 * Two rules shape all of it. Facts first: only a field somebody answered is a fact, so a place
 * with no retention has no retention line -- "not yet identified" repeated per empty field was
 * the loudest thing on the old panel, and it is what this replaces. And every fact says who said
 * it: a fact whose sources are empty still shows, attributed to nobody, because hiding a fact for
 * want of a document is a worse answer than saying it was recorded by hand.
 *
 * The unknowns are not lost by that -- they are rolled into one line, in the same words the
 * printed gaps sheet uses, computed on demand and never stored.
 *
 * No display text here. `value` carries what the project holds, or a token the renderer speaks.
 */

export type PanelFactField = 'purpose' | 'where' | 'retention' | 'dataCategories' | 'eea'

export interface PanelFact {
  field: PanelFactField
  /** For `eea`, one of the two tokens 'outside' | 'inside'; otherwise the project's own words. */
  value: string
  confidence: Confidence
  /** Document names, deduplicated. Empty means recorded by hand; it never means hide the fact. */
  sourceNames: string[]
}

export interface PanelUnknowns {
  count: number
  /** The gap questions, in the same words the printed gaps sheet uses. */
  questions: string[]
}

export interface PlacePanel {
  sort: 'place'
  id: string
  name: string
  facts: PanelFact[]
  observations: { domain: string; requestCount: number; beforeConsent: boolean }[]
  cookies: { name: string; lifetime: CookieLifetime; thirdParty: boolean }[]
  /** Door ids this place is reached from, for the panel's colour chips. */
  reachedFrom: string[]
  unknowns: PanelUnknowns
}

export interface DoorPanel {
  sort: 'door'
  id: string
  label: string
  origin: DoorOrigin
  /** Subject group names that come through, in project order. */
  whoComesThrough: string[]
  fields: string[]
  unknowns: PanelUnknowns
}

export interface ControllerPanel {
  sort: 'controller'
  /** null when no document has named one; the renderer speaks the neutral name. */
  name: string | null
  sourceNames: string[]
  totals: { places: number; doors: number; subjectGroups: number; flows: number }
  unknowns: PanelUnknowns
}

export interface GroupPanel {
  sort: 'group'
  name: string
  members: { id: string; name: string; unexplained: boolean }[]
}

export type Panel = PlacePanel | DoorPanel | ControllerPanel | GroupPanel

// Mirrors the displayName/titleCase pair in scan.ts, the only place a scanned host is turned into
// a place name. A Place carries no domain, so matching an observation back to the place it
// produced means recomputing that name rather than looking one up. Duplicated, not imported,
// because core does not export it; if scan.ts's naming changes, this has to change with it.
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

function sourceNames(place: Place): string[] {
  return [...new Set(place.sources.map((s) => s.documentName))]
}

function unknownsFor(project: Project, subject: string | null): PanelUnknowns {
  const questions = computeGaps(project)
    .filter((g) => g.subject === subject)
    .map((g) => g.question)
  return { count: questions.length, questions }
}

/**
 * The facts, in a fixed order, each one only if somebody answered it.
 *
 * `purpose` is skipped when it holds ingestScan's placeholder for a host the dictionary does not
 * know: that string is not an answer, and rendering it as one would be the old panel again.
 * `eea` is skipped when the answer is 'unknown' -- that is not a fact but a question, and
 * computeGaps already asks it.
 */
function factsFor(place: Place): PanelFact[] {
  const facts: PanelFact[] = []
  const at = { confidence: place.confidence, sourceNames: sourceNames(place) }

  if (place.purposeGroup !== '' && place.purposeGroup !== NOT_IDENTIFIED) {
    facts.push({ field: 'purpose', value: place.purposeGroup, ...at })
  }
  if (place.jurisdiction !== undefined && place.jurisdiction !== '') {
    facts.push({ field: 'where', value: place.jurisdiction, ...at })
  }
  if (place.retention !== undefined && place.retention !== '') {
    facts.push({ field: 'retention', value: place.retention, ...at })
  }
  if (place.dataCategories !== undefined && place.dataCategories.length > 0) {
    facts.push({ field: 'dataCategories', value: place.dataCategories.join(', '), ...at })
  }
  if (place.leavesEEA !== 'unknown') {
    facts.push({ field: 'eea', value: place.leavesEEA ? 'outside' : 'inside', ...at })
  }
  return facts
}

function placePanel(project: Project, place: Place, dictionary: VendorDictionary): PlacePanel {
  const doors = deriveDoors(project)
  const reachedFrom = tracePaths(project, doors)
    .filter((p) => p.destinationIds.includes(place.id))
    .map((p) => p.doorId)

  return {
    sort: 'place',
    id: place.id,
    name: place.name,
    facts: factsFor(place),
    observations: project.observations
      .filter((o) => derivedPlaceName(o.domain, dictionary).toLowerCase() === place.name.toLowerCase())
      .map((o) => ({ domain: o.domain, requestCount: o.requestCount, beforeConsent: o.beforeConsent })),
    cookies: (project.cookies ?? [])
      .filter((c) => c.placeId === place.id)
      .map((c) => ({ name: c.name, lifetime: c.lifetime, thirdParty: c.thirdParty })),
    reachedFrom,
    unknowns: unknownsFor(project, place.id),
  }
}

/**
 * What the panel shows for one selection, read out of the project as it stands. `selectedId`
 * takes the layout's node ids verbatim. `null`, and any id naming nothing, answer `null`: a
 * dangling id from a stale selection reads the same as no selection, never as an error.
 */
export function panelFor(
  project: Project,
  selectedId: string | null,
  dictionary: VendorDictionary,
): Panel | null {
  if (selectedId === null) return null

  if (selectedId === 'controller') {
    if (project.places.length === 0 && project.subjectGroups.length === 0) return null
    const controller = controllerName(project)
    const place = project.places.find((p) => p.id === controller.placeId)
    return {
      sort: 'controller',
      name: controller.name,
      sourceNames: place === undefined ? [] : sourceNames(place),
      totals: {
        places: project.places.length,
        doors: deriveDoors(project).length,
        subjectGroups: project.subjectGroups.length,
        flows: project.flows.length,
      },
      // The questions that are about the project rather than about one place -- "who processes
      // payroll?" belongs to the organisation, and the centre is where the organisation is.
      unknowns: unknownsFor(project, null),
    }
  }

  if (selectedId.startsWith('door:')) {
    const doorId = selectedId.slice('door:'.length)
    const doors = deriveDoors(project)
    const door = doors.find((d) => d.id === doorId)
    if (door === undefined) return null
    const path = tracePaths(project, doors).find((p) => p.doorId === doorId)
    const subjects = path?.subjectIds ?? []
    return {
      sort: 'door',
      id: door.id,
      label: door.label,
      origin: door.origin,
      whoComesThrough: project.subjectGroups.filter((s) => subjects.includes(s.id)).map((s) => s.name),
      fields: door.fields,
      // A declared door is a place and can carry gaps of its own; a discovered one is not, and
      // has none.
      unknowns: unknownsFor(project, door.id.startsWith('place:') ? door.id.slice('place:'.length) : ''),
    }
  }

  if (selectedId.startsWith('group:')) {
    const name = selectedId.slice('group:'.length)
    const members = groupMembers(project, name)
    if (members.length === 0) return null
    return {
      sort: 'group',
      name,
      members: members.map((m) => ({ id: m.id, name: m.name, unexplained: m.kind === 'unknown' })),
    }
  }

  const placeId = selectedId.startsWith('member:') ? selectedId.slice('member:'.length) : selectedId
  const place = project.places.find((p) => p.id === placeId)
  if (place === undefined) return null
  return placePanel(project, place, dictionary)
}
