export type Confidence = 'observed' | 'declared' | 'inferred'
export type Holder = 'you' | 'supplier' | 'unknown'
export type PlaceKind = 'collection' | 'internal' | 'processor' | 'unknown'
export type GapKind = 'attribute' | 'existence' | 'contradiction'

/** Three-state boolean. `'unknown'` is a real answer, not a missing one. */
export type Tri = boolean | 'unknown'

export interface SourceRef {
  documentId: string
  documentName: string
  locator?: string
}

export interface SubjectGroup {
  id: string
  name: string
  estimatedCount?: number
  notes?: string
}

/** A field a person can answer by hand, from the questions the gap rules ask about a place. */
export type HandEnteredField = 'retention' | 'leavesEEA'

export interface Place {
  id: string
  name: string
  kind: PlaceKind
  purposeGroup: string
  holder: Holder
  jurisdiction?: string
  leavesEEA: Tri
  retention?: string
  /**
   * Which categories of personal data this holds, as an informativa lists them. Absent when
   * nobody has said; never an empty array, which would read as "none" rather than "not asked".
   */
  dataCategories?: string[]
  sources: SourceRef[]
  confidence: Confidence
  /**
   * Which of this place's fields a person typed in, rather than a document or a scan supplying
   * them. Absent on everything nobody has edited. The panel reads it to attribute each fact
   * truthfully: without it, a typed retention would appear over the name of a document that
   * never mentioned one.
   */
  handEntered?: HandEnteredField[]
}

export interface Flow {
  id: string
  /** A Place id or a SubjectGroup id. */
  from: string
  /** A Place id. */
  to: string
  dataDescription: string
  purpose: string
  sources: SourceRef[]
  confidence: Confidence
}

export interface Gap {
  id: string
  kind: GapKind
  /** Place id, Flow id, or null for gaps about the project as a whole. */
  subject: string | null
  question: string
  why: string
  severity: 1 | 2 | 3
}

/** One third-party domain seen during a scan. Produced in Phase 2. */
export interface Observation {
  domain: string
  requestCount: number
  beforeConsent: boolean
}

/** One entry in the bundled vendor dictionary. Data only; never fetched. */
export interface VendorEntry {
  /** The company that owns the host, e.g. "Google". */
  owner: string
  /** What it does, e.g. "analytics". Combined with owner to name a place. */
  category: string
  /** Which purpose group the place belongs to, e.g. "Marketing". */
  purposeGroup: string
}

export type VendorDictionary = Readonly<Record<string, VendorEntry>>

/**
 * One entry in the bundled internal-systems dictionary. Data only; never fetched. Keys of the
 * dictionary are the terms matched in document text, case-insensitively on word boundaries.
 */
export interface InternalSystemEntry {
  /** The place name a match produces, e.g. "Payroll system" or "Salesforce". */
  name: string
  purposeGroup: string
  /** 'internal': the company's own operation (inner ring). 'external': a named supplier. */
  layer: 'internal' | 'external'
  /** Who holds the data: 'you' for generic internal systems, 'supplier' for named products. */
  holder: 'you' | 'supplier'
}

export type InternalSystemDictionary = Readonly<Record<string, InternalSystemEntry>>

/** One entry in the bundled data-category dictionary. Data only; never fetched. */
export interface DataCategoryEntry {
  name: string
}

export type DataCategoryDictionary = Readonly<Record<string, DataCategoryEntry>>

/**
 * One entry in the bundled subject-group dictionary. Data only; never fetched. Keys are the terms
 * matched in document text; the name is what the interface prints, which is English even when the
 * term is not.
 */
export interface SubjectGroupEntry {
  name: string
}

export type SubjectGroupDictionary = Readonly<Record<string, SubjectGroupEntry>>

/** One document's extracted text, as returned by the Rust side. The text is session-only. */
export interface DocumentText {
  name: string
  text: string
}

/** What every candidate has, whichever kind it is. */
interface CandidateBase {
  /** Stable within one extraction run: derived from the name. */
  id: string
  name: string
  /** A short passage around the first match, so the user can judge it. */
  evidence: string
  /** Every document (by name) this candidate was found in. */
  sourceNames: string[]
}

/** A system, service or supplier the document appears to describe. */
export interface PlaceCandidate extends CandidateBase {
  sort: 'place'
  layer: 'internal' | 'external'
  purposeGroup: string
  holder: Holder
  kind: PlaceKind
  /**
   * What the document said about this system in the sentence that named it. Free text as the
   * document wrote it, normalised only enough to read in an English interface. Absent when the
   * sentence said nothing -- which is the common case and not a failure.
   */
  retention?: string
  /** Where the document says this sits. A label as the document wrote it, never a coordinate. */
  jurisdiction?: string
  /**
   * Which categories of personal data the sentence named. Absent when it named none; never an
   * empty array, which would read as "none" rather than "not asked".
   */
  dataCategories?: string[]
}

/** A category of people whose data the document says is processed. */
export interface SubjectGroupCandidate extends CandidateBase {
  sort: 'subjectGroup'
}

/**
 * One thing a document appears to describe, offered for confirmation — nothing lands on the
 * map without the user accepting it. Produced by extractCandidates, consumed (once confirmed)
 * by ingestDocument. Session-only: a candidate is never written to a project file, which is why
 * changing its shape does not touch schemaVersion.
 */
export type Candidate = PlaceCandidate | SubjectGroupCandidate

/** One host seen during a scan, before it is named. */
export interface ObservedHost {
  host: string
  requestCount: number
}

export type CookieLifetime = 'session' | 'under-a-day' | 'under-a-year' | 'a-year-or-more'

/** One cookie as Rust hands it over. Raw material; judgements happen in core. */
export interface RawScanCookie {
  name: string
  domain: string
  /** True when the browser reports no expiry (a session cookie). */
  session: boolean
  /** Seconds since epoch; meaningless when session is true. */
  expiresEpochSeconds: number
}

/** One cookie as the project records it, after core's judgements. */
export interface CapturedCookie {
  name: string
  domain: string
  thirdParty: boolean
  lifetime: CookieLifetime
  /** The Place this cookie belongs to, when the vendor dictionary recognises its domain. */
  placeId?: string
}

/** One form field as Rust hands it over, untrusted and unclassified. */
export interface RawFormField {
  /** URL of the page the field was found on, origin+path only. */
  page: string
  name: string
  type: string
  autocomplete: string
  label: string
}

export type FormFieldKind = 'email' | 'phone' | 'name' | 'address' | 'payment' | 'free-text'

export interface CollectionPointField {
  name: string
  kind: FormFieldKind
}

/** A discovered door: one page that collects data through a form. */
export interface CollectionPoint {
  id: string
  page: string
  fields: CollectionPointField[]
  sources: SourceRef[]
  confidence: Confidence
}

export type DoorOrigin = 'discovered' | 'declared'

/**
 * A way in. Computed by deriveDoors from places and collection points, never stored: a door is a
 * reading of the project, like a gap, not a fact somebody recorded.
 */
export interface Door {
  /** `place:<id>` for a declared door, `cp:<id>` for a discovered one. */
  id: string
  label: string
  origin: DoorOrigin
  /** 0-5. An index, never a hue -- the six colours live in theme.ts. Cycles beyond six doors. */
  colourIndex: number
  /** Field names asked at this door, in project order. Empty for a declared door with none. */
  fields: string[]
}

/** Where one door's data goes and who comes through it. Computed by tracePaths; never stored. */
export interface DoorPath {
  doorId: string
  /** Place ids this door's data reaches, in project flow order, deduplicated. */
  destinationIds: string[]
  /** SubjectGroup ids that come through this door, in project flow order, deduplicated. */
  subjectIds: string[]
}

export interface RawStorageKey {
  scope: 'local' | 'session'
  key: string
  bytes: number
}

/** What one completed scan produced. Consumed by ingestScan. */
export interface ScanResult {
  /** The origin host the user asked to scan, e.g. "rossi-editore.it". */
  scannedHost: string
  /** Every host contacted, including the scanned host itself. */
  hosts: ObservedHost[]
  /** How many pages were loaded, entry page included. */
  pagesVisited: number
  /**
   * How many places the map may be incomplete, e.g. a page that failed to load or a
   * request that could not be attributed to a page. Not a count of unobserved third
   * parties — the map cannot know what it never saw.
   */
  possibleGaps: number
  /** True if the scan was stopped before it ran its course, rather than finishing on its own. */
  stoppedEarly: boolean
  cookies: RawScanCookie[]
  formFields: RawFormField[]
  storageKeys: RawStorageKey[]
  /** Fixed marker names of consent managers detected, e.g. "OneTrust". Empty = none detected. */
  consentMarkers: string[]
  /** When the scan captured, seconds since epoch. Rust supplies it; core never asks the clock. */
  capturedAtEpochSeconds: number
}

export interface Project {
  schemaVersion: 1
  name: string
  createdAt: string
  purposeGroups: string[]
  subjectGroups: SubjectGroup[]
  places: Place[]
  flows: Flow[]
  observations: Observation[]
  cookies?: CapturedCookie[]
  collectionPoints?: CollectionPoint[]
}
