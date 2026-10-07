import { bucketLifetime, cookieOwnerName, cookiePlatform, isThirdPartyCookie } from './cookies'
import { classifyDoors } from './doors'
import { addFlow, addPlace } from './graph'
import { classifyHost, identify } from './vendors'
import type {
  CapturedCookie,
  CollectionPoint,
  CookiePlatformRow,
  Flow,
  Observation,
  Place,
  Project,
  ScanResult,
  VendorDictionary,
} from './types'

export interface IngestIds {
  /** Prefix for generated ids, e.g. "scan1". Callers pass a fresh one per scan. */
  prefix: string
}

/** Shown for a host the dictionary does not recognise. Neutral by requirement. */
/** What a host the dictionary does not know is filed under. Exported because the detail panel
 *  has to recognise it: it is a placeholder, not an answer, and must never render as a fact. */
export const NOT_IDENTIFIED = 'Not yet identified'

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
export function displayName(host: string, dictionary: VendorDictionary, segment?: string): string {
  const hit = identify(host, dictionary, segment)
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
export function isSameSite(host: string, scannedHost: string): boolean {
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
  cookieTable: readonly CookiePlatformRow[] = [],
): Project {
  let working = project

  const taken = new Set<string>([
    ...project.places.map((p) => p.id),
    ...project.subjectGroups.map((s) => s.id),
    ...project.flows.map((f) => f.id),
    ...(project.collectionPoints ?? []).map((cp) => cp.id),
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
      purposeGroup: 'Systems',
      holder: 'you',
      leavesEEA: 'unknown',
      sources: [],
      confidence: 'observed',
    }
    working = addPlace(working, newSite, id)
    site = newSite
  }

  const siteId = site.id
  if (!hasFlow(working, visitors.id, siteId)) {
    working = addFlow(working, visitorFlow(visitors.id, site.id), nextId(taken, ids.prefix, 'fl'))
  }

  // 3. Every third party, named from the dictionary, each with a flow from the
  //    site. The scanned host itself is skipped — it is the site, not a
  //    recipient of its own data. The same find-or-create serves a door's provider below.
  const placeForHost = (host: string, segment?: string): Place => {
    const name = displayName(host, dictionary, segment)
    const hit = identify(host, dictionary, segment)

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
        purposeGroup: hit === null ? (classifyHost(host) ?? NOT_IDENTIFIED) : hit.purposeGroup,
        holder: 'supplier',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'observed',
      }
      working = addPlace(working, newPlace, id)
      place = newPlace
    }

    if (!hasFlow(working, siteId, place.id)) {
      working = addFlow(working, thirdPartyFlow(siteId, place.id), nextId(taken, ids.prefix, 'fl'))
    }
    return place
  }
  for (const observed of result.hosts) {
    if (isSameSite(observed.host, result.scannedHost)) continue
    // One place per observed first segment (a segment nothing lists falls back to the host's own
    // entry); a host with no segments is the bare host.
    for (const segment of observed.paths?.length ? observed.paths : [undefined]) {
      placeForHost(observed.host, segment)
    }
  }

  // 4. The raw observations, so the map can always be traced back to what was
  //    seen. beforeConsent is false only for a host first seen after a consent
  //    click; a host without a phase (a v0.3 payload, from before Traccia ever
  //    clicked) stays true.
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
  const latestPathsByKey = new Map<string, string[]>()
  for (const h of result.hosts) {
    latestCountByKey.set(h.host.toLowerCase(), h.requestCount)
    if (h.paths?.length) latestPathsByKey.set(h.host.toLowerCase(), h.paths)
  }

  const updatedExisting = working.observations.map((o) => {
    const key = o.domain.toLowerCase()
    const latest = latestCountByKey.get(key)
    if (latest === undefined) return o
    const paths = latestPathsByKey.get(key)
    return { ...o, requestCount: latest, ...(paths ? { paths } : {}) }
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
      // Unknown phase: before for a v0.3 payload (no consent record, today's reading), otherwise
      // left out -- a blank beats a guess.
      ...(h.phase !== undefined
        ? { beforeConsent: h.phase === 'before' }
        : result.consent === undefined
          ? { beforeConsent: true }
          : {}),
      ...(h.paths?.length ? { paths: h.paths } : {}),
    })
  }

  // 5. Cookies the scan captured. Each is judged by the pure functions in
  //    `cookies.ts` and attached to a place only when the vendor dictionary
  //    recognises its domain and that place already exists on the map — a
  //    cookie is evidence, not a reason to invent a place. Deduped by
  //    (name, domain), same shape as the observations dedupe above: a domain
  //    already recorded keeps its position but takes this scan's judgement,
  //    the newer scan wins.
  //
  //    Keyed via JSON.stringify of the pair rather than a delimited template
  //    string: a hand-picked separator — even a control character typed as
  //    an escape sequence — is a guess about what a cookie name or domain
  //    cannot contain, and this key must never let two distinct (name, domain)
  //    pairs collide. JSON array encoding already escapes anything that would
  //    make that ambiguous, so no such guess is needed.
  const cookieKey = (name: string, domain: string): string => JSON.stringify([name, domain])

  const latestCookieByKey = new Map<string, CapturedCookie>()
  for (const raw of result.cookies) {
    const ownerName = cookieOwnerName(raw.domain, dictionary)
    // A cookie only ever attaches to a place that exists: first by the domain's owner, then by a
    // place carrying the platform's name. No place is created from a cookie.
    const platform = cookiePlatform(raw.name, cookieTable)?.platform
    const place =
      (ownerName === null ? undefined : findPlaceByName(working, ownerName)) ??
      (platform === undefined ? undefined : findPlaceByName(working, platform))
    latestCookieByKey.set(cookieKey(raw.name, raw.domain), {
      name: raw.name,
      domain: raw.domain,
      thirdParty: isThirdPartyCookie(raw.domain, result.scannedHost),
      lifetime: bucketLifetime(raw, result.capturedAtEpochSeconds),
      placeId: place?.id,
      ...(platform === undefined ? {} : { platform }),
    })
  }

  const existingCookies = working.cookies ?? []
  const updatedExistingCookies = existingCookies.map((c) => {
    return latestCookieByKey.get(cookieKey(c.name, c.domain)) ?? c
  })

  const alreadyKnownCookies = new Set(existingCookies.map((c) => cookieKey(c.name, c.domain)))
  const seenCookiesThisScan = new Set<string>()
  const freshCookies: CapturedCookie[] = []
  for (const raw of result.cookies) {
    const key = cookieKey(raw.name, raw.domain)
    if (alreadyKnownCookies.has(key) || seenCookiesThisScan.has(key)) continue
    seenCookiesThisScan.add(key)
    const captured = latestCookieByKey.get(key)
    if (captured !== undefined) freshCookies.push(captured)
  }

  // 6. Doors, classified by `classifyDoors` (spec §7): a form is one door per page, any other kind
  //    one per (kind, provider). A door whose provider is a third party points at that party's
  //    place, created like a host if absent. A door seen again keeps its id, because door colour
  //    is assigned by position and a renumbered door silently repaints the map; the fresh capture
  //    supplies the content, the original the identity.
  const doorKey = (kind: string, page: string, provider: string | undefined): string =>
    kind === 'form' ? `form|${page}` : `${kind}|${provider ?? ''}`
  const freshDoors = new Map<string, CollectionPoint>()
  for (const door of classifyDoors(result, dictionary)) {
    const provider = door.provider === null ? undefined : placeForHost(door.provider, door.segment)
    const page = door.page === '' ? result.scannedHost : door.page
    freshDoors.set(doorKey(door.kind, page, provider?.name), {
      id: nextId(taken, ids.prefix, 'cp'),
      page,
      // Absent kind and pages read as a form on `page`: older files and form doors stay as they were.
      ...(door.kind === 'form' ? {} : { kind: door.kind, pages: door.pages }),
      ...(provider === undefined ? {} : { provider: provider.name, destination: provider.id }),
      fields: door.fields,
      sources: [],
      confidence: 'observed',
    })
  }

  const existingCollectionPoints = working.collectionPoints ?? []
  const keptKeys = new Set<string>()
  const updatedExistingCollectionPoints = existingCollectionPoints.map((cp) => {
    const key = doorKey(cp.kind ?? 'form', cp.page, cp.provider)
    const fresh = freshDoors.get(key)
    if (fresh === undefined) return cp
    keptKeys.add(key)
    return { ...fresh, id: cp.id }
  })
  const freshCollectionPoints = [...freshDoors].filter(([key]) => !keptKeys.has(key)).map(([, cp]) => cp)

  return {
    ...working,
    observations: [...updatedExisting, ...fresh],
    cookies: [...updatedExistingCookies, ...freshCookies],
    collectionPoints: [...updatedExistingCollectionPoints, ...freshCollectionPoints],
  }
}

function visitorFlow(from: string, to: string): Omit<Flow, 'id'> {
  return {
    from,
    to,
    dataDescription: 'Whatever a visitor sends by loading the site',
    purpose: 'Systems',
    sources: [],
    confidence: 'observed',
  }
}

function thirdPartyFlow(from: string, to: string): Omit<Flow, 'id'> {
  return {
    from,
    to,
    dataDescription: 'Whatever the page hands to this third party',
    purpose: 'Systems',
    sources: [],
    confidence: 'observed',
  }
}
