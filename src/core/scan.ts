import { addFlow, addPlace } from './graph'
import { classifyHost, identify } from './vendors'
import type { Flow, Observation, Place, Project, ScanResult, VendorDictionary } from './types'

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
export function displayName(host: string, dictionary: VendorDictionary): string {
  const hit = identify(host, dictionary)
  return hit === null ? host : `${hit.owner} ${titleCase(hit.category)}`
}

// A handful of categories whose correct rendering is not mechanically
// derivable from the identifier — acronyms and initialisms that a mechanical
// kebab-split cannot know about. "cdn" is a content delivery network, not a
// word "Cdn"; "crm" is a CRM, not a "Crm"; "a-b-testing" is A/B testing, not
// "A B Testing". Checked before the generic split below; everything else
// falls through unchanged. Every distinct category in the shipped
// dictionary was checked against this: see the Task 2 report for the full
// list of categories and their rendered names.
const CATEGORY_OVERRIDES: Readonly<Record<string, string>> = {
  cdn: 'CDN',
  crm: 'CRM',
  'a-b-testing': 'A/B Testing',
}

// Dictionary categories are kebab-case identifiers (e.g. "tag-manager",
// "session-replay"), but these strings become place names on a printed map a
// consultant hands to a client — "Google Tag-manager" is not a thing that
// exists. Split on the hyphen, capitalise each word, join with a space.
function titleCase(s: string): string {
  const override = CATEGORY_OVERRIDES[s]
  if (override !== undefined) return override
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

/**
 * True when `host` is the scan origin `scannedHost` itself, or a
 * label-boundary subdomain of it — mirroring `admission::vet_host` /
 * `is_subdomain_of` in src-tauri/src/admission.rs, the same rule Rust uses to
 * admit a request as part of the site being scanned rather than a third
 * party. Both sides must agree, or a host the proxy treats as "the site"
 * gets ingested here as a fabricated supplier.
 *
 * Case-insensitive. `www.rossi-editore.it` is a subdomain of
 * `rossi-editore.it`; `evil-rossi-editore.it` is not (no label boundary —
 * the character before the shared suffix is not a dot); neither is
 * `rossi-editore.it.evil.com` (the scanned host is a prefix, not a suffix).
 */
export function isScannedHostOrSubdomain(host: string, scannedHost: string): boolean {
  const h = host.toLowerCase()
  const o = scannedHost.toLowerCase()
  if (h === o) return true
  const cut = h.length - o.length
  if (cut < 2) return false
  const prefix = h.slice(0, cut)
  const suffix = h.slice(cut)
  return prefix.endsWith('.') && suffix === o
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
    if (isScannedHostOrSubdomain(observed.host, result.scannedHost)) continue

    const name = displayName(observed.host, dictionary)
    const hit = identify(observed.host, dictionary)

    let place = findPlaceByName(working, name)
    if (place === undefined) {
      const id = nextId(taken, ids.prefix, 'pl')
      const newPlace: Place = {
        id,
        name,
        kind: hit === null ? 'unknown' : 'processor',
        // An uncatalogued host still gets a purpose where its own name suggests one — see
        // `classifyHost`. `kind` stays 'unknown', so the map keeps drawing it as a figure
        // nobody has explained: a guessed purpose is not an identification.
        purposeGroup: hit === null ? (classifyHost(observed.host) ?? NOT_IDENTIFIED) : hit.purposeGroup,
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
  //
  //    Keyed case-insensitively, the same way place matching is (finding 3),
  //    so "X.com" and "x.com" collapse to one row rather than two — whether
  //    that pair comes from an earlier scan or from the same result.hosts
  //    listing a host twice. And a domain already recorded from an earlier
  //    scan has its requestCount replaced by this scan's count rather than
  //    left stale (finding 2): the newer scan wins. Its position in the
  //    array is preserved rather than moved to the end, so ordering already
  //    relied on elsewhere does not shift underneath it.
  const latestCountByKey = new Map<string, number>()
  for (const h of result.hosts) {
    latestCountByKey.set(h.host.toLowerCase(), h.requestCount)
  }

  const updatedExisting = working.observations.map((o) => {
    const latest = latestCountByKey.get(o.domain.toLowerCase())
    return latest === undefined ? o : { ...o, requestCount: latest }
  })

  const alreadyKnown = new Set(working.observations.map((o) => o.domain.toLowerCase()))
  const seenThisScan = new Set<string>()
  const fresh: Observation[] = []
  for (const h of result.hosts) {
    const key = h.host.toLowerCase()
    if (alreadyKnown.has(key) || seenThisScan.has(key)) continue
    seenThisScan.add(key)
    fresh.push({
      domain: h.host,
      requestCount: latestCountByKey.get(key) ?? h.requestCount,
      beforeConsent: true,
    })
  }

  return { ...working, observations: [...updatedExisting, ...fresh] }
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
