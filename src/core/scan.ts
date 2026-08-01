import { addFlow, addPlace } from './graph'
import { identify } from './vendors'
import type { Flow, Place, Project, ScanResult, VendorDictionary } from './types'

export interface IngestIds {
  /** Prefix for generated ids, e.g. "scan1". Callers pass a fresh one per scan. */
  prefix: string
}

/** Shown for a host the dictionary does not recognise. Neutral by requirement. */
const NOT_IDENTIFIED = 'Not yet identified'

const VISITORS = 'Website visitors'

/**
 * A recognised host becomes a place named "<owner> <category>", e.g. "Google
 * Analytics". Collapsing on owner alone would merge Google Analytics and
 * Google Ads into one "Google" node, losing the purpose group — which is what
 * the map groups by — and breaking the substring match the analytics
 * expectation uses, producing a false gap on a map that just observed Google
 * Analytics. An unrecognised host keeps its full name and collapses with
 * nothing.
 */
function displayName(host: string, dictionary: VendorDictionary): string {
  const hit = identify(host, dictionary)
  return hit === null ? host : `${hit.owner} ${titleCase(hit.category)}`
}

// Dictionary categories are kebab-case identifiers (e.g. "tag-manager",
// "session-replay"), but these strings become place names on a printed map a
// consultant hands to a client — "Google Tag-manager" is not a thing that
// exists. Split on the hyphen, capitalise each word, join with a space.
function titleCase(s: string): string {
  return s
    .split('-')
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ')
}

function findPlaceByName(project: Project, name: string): Place | undefined {
  return project.places.find((p) => p.name.toLowerCase() === name.toLowerCase())
}

function nextId(taken: Set<string>, prefix: string, kind: string): string {
  let n = 1
  while (taken.has(`${prefix}-${kind}-${n}`)) n += 1
  const id = `${prefix}-${kind}-${n}`
  taken.add(id)
  return id
}

function hasFlow(project: Project, from: string, to: string): boolean {
  return project.flows.some((f) => f.from === from && f.to === to)
}

export function ingestScan(
  project: Project,
  result: ScanResult,
  dictionary: VendorDictionary,
  ids: IngestIds,
): Project {
  let working = project

  const taken = new Set<string>([
    ...project.places.map((p) => p.id),
    ...project.subjectGroups.map((s) => s.id),
    ...project.flows.map((f) => f.id),
  ])

  // 1. Whose data this is. For a website scan the answer is not in doubt, so it
  //    is seeded rather than asked for. Seeded once, however many scans run.
  let visitors = working.subjectGroups.find((s) => s.name === VISITORS)
  if (visitors === undefined) {
    visitors = { id: nextId(taken, ids.prefix, 'sg'), name: VISITORS }
    working = { ...working, subjectGroups: [...working.subjectGroups, visitors] }
  }

  // 2. The site itself. Held by the organisation, and where collection happens.
  let site = findPlaceByName(working, result.scannedHost)
  if (site === undefined) {
    const id = nextId(taken, ids.prefix, 'pl')
    const newSite: Place = {
      id,
      name: result.scannedHost,
      kind: 'collection',
      purposeGroup: 'Running the systems',
      holder: 'you',
      leavesEEA: 'unknown',
      sources: [],
      confidence: 'observed',
    }
    working = addPlace(working, newSite, id)
    site = newSite
  }

  if (!hasFlow(working, visitors.id, site.id)) {
    working = addFlow(working, visitorFlow(visitors.id, site.id), nextId(taken, ids.prefix, 'fl'))
  }

  // 3. Every third party, named from the dictionary, each with a flow from the
  //    site. The scanned host itself is skipped — it is the site, not a
  //    recipient of its own data.
  for (const observed of result.hosts) {
    if (observed.host.toLowerCase() === result.scannedHost.toLowerCase()) continue

    const name = displayName(observed.host, dictionary)
    const hit = identify(observed.host, dictionary)

    let place = findPlaceByName(working, name)
    if (place === undefined) {
      const id = nextId(taken, ids.prefix, 'pl')
      const newPlace: Place = {
        id,
        name,
        kind: hit === null ? 'unknown' : 'processor',
        purposeGroup: hit === null ? NOT_IDENTIFIED : hit.purposeGroup,
        holder: 'supplier',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'observed',
      }
      working = addPlace(working, newPlace, id)
      place = newPlace
    }

    if (!hasFlow(working, site.id, place.id)) {
      working = addFlow(working, thirdPartyFlow(site.id, place.id), nextId(taken, ids.prefix, 'fl'))
    }
  }

  // 4. The raw observations, so the map can always be traced back to what was
  //    seen. beforeConsent is always true: Traccia never clicks anything, so
  //    nothing it records happened after consent was given.
  const seen = new Set(working.observations.map((o) => o.domain))
  const fresh = result.hosts
    .filter((h) => !seen.has(h.host))
    .map((h) => ({ domain: h.host, requestCount: h.requestCount, beforeConsent: true }))

  return { ...working, observations: [...working.observations, ...fresh] }
}

function visitorFlow(from: string, to: string): Omit<Flow, 'id'> {
  return {
    from,
    to,
    dataDescription: 'Whatever a visitor sends by loading the site',
    purpose: 'Running the systems',
    sources: [],
    confidence: 'observed',
  }
}

function thirdPartyFlow(from: string, to: string): Omit<Flow, 'id'> {
  return {
    from,
    to,
    dataDescription: 'Whatever the page hands to this third party',
    purpose: 'Running the systems',
    sources: [],
    confidence: 'observed',
  }
}
