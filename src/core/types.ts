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
}
