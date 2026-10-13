import { controllerName } from './controller'
import { DOOR_KINDS, FOLD_AT, barePath, deriveDoors, tracePaths } from './doors'
import { computeGaps } from './gaps'
import { destinations } from './layout'
import { NOT_IDENTIFIED } from './scan'
import { identify } from './vendors'
import type {
  Confidence,
  CookieLifetime,
  DoorKind,
  DoorOrigin,
  HandEnteredField,
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
  /** True when a person typed this one in. The place's own sources said nothing about it, so
   *  attributing it to them would put a typed answer over a document's name. */
  byHand: boolean
}

/**
 * One thing nobody has answered. `answer` is present when a person can answer it here, in which
 * case it names the field and how to ask: two of the gap rules map onto a field of the place, and
 * the third ("which document says this?") does not, so it is stated and not offered.
 */
export interface PanelQuestion {
  /** The gap's own id. Stable for a given place and field. */
  id: string
  question: string
  answer?: { field: HandEnteredField; kind: 'text' | 'yesno' }
}

export interface PanelUnknowns {
  count: number
  /** The gap questions, in the same words the printed gaps sheet uses. */
  questions: PanelQuestion[]
}

export interface PlacePanel {
  sort: 'place'
  id: string
  name: string
  facts: PanelFact[]
  observations: { domain: string; requestCount: number; beforeConsent?: boolean }[]
  cookies: { name: string; lifetime: CookieLifetime; thirdParty: boolean }[]
  /** The doors this place is reached from, each with the colour the map gave it. Carrying the
   *  colour rather than deriving it from list position is the whole point: a chip that disagrees
   *  with the sheet is worse than no chip. */
  reachedFrom: { id: string; colourIndex: number }[]
  unknowns: PanelUnknowns
}

export interface DoorPanel {
  sort: 'door'
  id: string
  label: string
  origin: DoorOrigin
  /** 'form' for a declared door and for one found before kinds existed. */
  kind: DoorKind
  /** Every page the door was seen on; empty for a declared door. */
  pages: string[]
  /** The name of the place this door sends data to, when it is a third party. */
  destinationName: string | null
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
  /** Cookies a platform is named for that belong to no place, grouped by platform. */
  platformCookies: { platform: string; names: string[] }[]
  unknowns: PanelUnknowns
}

export interface GroupPanel {
  sort: 'group'
  /** Which row of destinations: the organisation's own systems, one purpose's suppliers, or what
   *  nobody has identified. The first and last have no name of their own; the renderer speaks it. */
  row: 'own' | 'purpose' | 'unidentified'
  name: string
  /** `purpose` only where the row is not one purpose and the place has one: a row that mixes
   *  purposes says so here, member by member, and not on the map. */
  members: { id: string; name: string; purpose?: string }[]
}

/** The purposes the map folds into one row, largest first, each with how many places it holds. */
export interface PurposesPanel {
  sort: 'purposes'
  purposes: { name: string; places: number }[]
}

export interface DoorGroupPanel {
  sort: 'doorGroup'
  kind: DoorKind
  /** Every door of the kind, in map order. `label` is the bare path for a form ('/' for the root). */
  doors: { id: string; label: string }[]
}

export type Panel = PlacePanel | DoorPanel | ControllerPanel | GroupPanel | PurposesPanel | DoorGroupPanel

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

function derivedPlaceName(host: string, dictionary: VendorDictionary, segment?: string): string {
  const hit = identify(host, dictionary, segment)
  return hit === null ? host : `${hit.owner} ${titleCase(hit.category)}`
}

function sourceNames(place: Place): string[] {
  return [...new Set(place.sources.map((s) => s.documentName))]
}

/** Which field, if any, answers a gap. Read off the id the gap rules build. */
function answerFor(gapId: string): PanelQuestion['answer'] {
  if (gapId.endsWith(':retention')) return { field: 'retention', kind: 'text' }
  if (gapId.endsWith(':leavesEEA')) return { field: 'leavesEEA', kind: 'yesno' }
  return undefined
}

function unknownsFor(project: Project, subject: string | null): PanelUnknowns {
  const questions = computeGaps(project)
    .filter((g) => g.subject === subject)
    .map((g) => ({ id: g.id, question: g.question, answer: answerFor(g.id) }))
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
  const hand = place.handEntered ?? []
  const at = { confidence: place.confidence, sourceNames: sourceNames(place), byHand: false }
  // A field somebody typed is attributed to them, not to whatever named the place.
  const typed = { confidence: 'declared' as const, sourceNames: [], byHand: true }

  if (place.purposeGroup !== '' && place.purposeGroup !== NOT_IDENTIFIED) {
    facts.push({ field: 'purpose', value: place.purposeGroup, ...at })
  }
  if (place.jurisdiction !== undefined && place.jurisdiction !== '') {
    facts.push({ field: 'where', value: place.jurisdiction, ...at })
  }
  if (place.retention !== undefined && place.retention !== '') {
    facts.push({ field: 'retention', value: place.retention, ...(hand.includes('retention') ? typed : at) })
  }
  if (place.dataCategories !== undefined && place.dataCategories.length > 0) {
    facts.push({ field: 'dataCategories', value: place.dataCategories.join(', '), ...at })
  }
  if (place.leavesEEA !== 'unknown') {
    facts.push({
      field: 'eea',
      value: place.leavesEEA ? 'outside' : 'inside',
      ...(hand.includes('leavesEEA') ? typed : at),
    })
  }
  return facts
}

function platformCookies(project: Project): { platform: string; names: string[] }[] {
  const by = new Map<string, string[]>()
  for (const c of project.cookies ?? []) {
    if (c.placeId !== undefined || c.platform === undefined) continue
    by.set(c.platform, [...(by.get(c.platform) ?? []), c.name])
  }
  return [...by].map(([platform, names]) => ({ platform, names }))
}

function placePanel(project: Project, place: Place, dictionary: VendorDictionary): PlacePanel {
  const doors = deriveDoors(project)
  const colourOf = new Map(doors.map((d) => [d.id, d.colourIndex]))
  const reachedFrom = tracePaths(project, doors)
    .filter((p) => p.destinationIds.includes(place.id))
    .map((p) => ({ id: p.doorId, colourIndex: colourOf.get(p.doorId) ?? 0 }))

  return {
    sort: 'place',
    id: place.id,
    name: place.name,
    facts: factsFor(place),
    observations: project.observations
      // As ingestScan names it: one name per observed first segment, or the bare host when none.
      .filter((o) =>
        (o.paths?.length ? o.paths : [undefined]).some(
          (seg) => derivedPlaceName(o.domain, dictionary, seg).toLowerCase() === place.name.toLowerCase(),
        ),
      )
      .map((o) => ({ domain: o.domain, requestCount: o.requestCount, ...(o.beforeConsent === undefined ? {} : { beforeConsent: o.beforeConsent }) })),
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
      platformCookies: platformCookies(project),
      // The questions that are about the project rather than about one place -- "who processes
      // payroll?" belongs to the organisation, and the centre is where the organisation is.
      unknowns: unknownsFor(project, null),
    }
  }

  if (selectedId.startsWith('doorGroup:')) {
    const kind = DOOR_KINDS.find((k) => k === selectedId.slice('doorGroup:'.length))
    if (kind === undefined) return null
    const doors = deriveDoors(project).filter((d) => d.kind === kind)
    // A fold exists only at FOLD_AT doors; a stale selection from before a rescan names nothing.
    if (doors.length < FOLD_AT) return null
    return {
      sort: 'doorGroup',
      kind,
      doors: doors.map((d) => ({ id: d.id, label: kind === 'form' ? barePath(d.label) : d.label })),
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
      kind: door.kind ?? 'form',
      pages: door.pages ?? [],
      destinationName: project.places.find((p) => p.id === door.destination)?.name ?? null,
      whoComesThrough: project.subjectGroups.filter((s) => subjects.includes(s.id)).map((s) => s.name),
      fields: door.fields,
      // A declared door is a place and can carry gaps of its own; a discovered one is not, and
      // has none.
      unknowns: unknownsFor(project, door.id.startsWith('place:') ? door.id.slice('place:'.length) : ''),
    }
  }

  // The rows of destinations, by the ids the layout gives them. A purpose the map folds into
  // "other purposes" is not a row there, and still answers here: its places are in the project.
  const rows = destinations(project)
  const others = rows.find((d) => d.id === 'others')
  if (selectedId === 'others') {
    if (others?.purposes === undefined) return null
    return { sort: 'purposes', purposes: others.purposes.map((p) => ({ name: p.name, places: p.places.length })) }
  }
  if (selectedId === 'own' || selectedId === 'unidentified' || selectedId.startsWith('group:')) {
    const name = selectedId.startsWith('group:') ? selectedId.slice('group:'.length) : ''
    const members =
      rows.find((d) => d.id === selectedId)?.places ?? others?.purposes?.find((p) => p.name === name)?.places ?? []
    if (members.length === 0) return null
    return {
      sort: 'group',
      row: name === '' ? (selectedId as 'own' | 'unidentified') : 'purpose',
      name,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        ...(name === '' && m.purposeGroup !== '' && m.purposeGroup !== NOT_IDENTIFIED ? { purpose: m.purposeGroup } : {}),
      })),
    }
  }

  const placeId = selectedId.startsWith('member:') ? selectedId.slice('member:'.length) : selectedId
  const place = project.places.find((p) => p.id === placeId)
  if (place === undefined) return null
  return placePanel(project, place, dictionary)
}
