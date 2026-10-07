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
  /** Absent when the scan had a consent record but could not place the host before or after it. */
  beforeConsent?: boolean
  /** First path segments seen for this domain; lets the panel recompute the place name. */
  paths?: string[]
}

/** One entry in the bundled vendor dictionary. Data only; never fetched. */
export interface VendorEntry {
  /** The company that owns the host, e.g. "Google". */
  owner: string
  /** What it does, e.g. "analytics". Combined with owner to name a place. */
  category: string
  /** Which purpose group the place belongs to, e.g. "Marketing". */
  purposeGroup: string
  /** Why this entry's purpose group differs from the owner's other entries. Exempts it from the one-purpose-per-owner test. */
  note?: string
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
  /**
   * The consent phase the host was first seen in. Absent in a v0.3 payload (no `consent`): read as
   * 'before'. Absent next to a `consent` record: not known, and it stays unknown.
   */
  phase?: 'before' | 'after'
  /** Up to 8 distinct first path segments requested from the host (lowercase `[a-z0-9-_]{1,32}`). */
  paths?: string[]
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
  /** The consent phase the cookie was first seen in. Absent in a v0.3 payload, or when not known. */
  phase?: 'before' | 'after'
}

/** One cookie as the project records it, after core's judgements. */
export interface CapturedCookie {
  name: string
  domain: string
  thirdParty: boolean
  lifetime: CookieLifetime
  /** The Place this cookie belongs to, when the vendor dictionary recognises its domain. */
  placeId?: string
  /** The platform the Open Cookie Database names for this cookie's name, when it does. */
  platform?: string
}

/** One slimmed Open Cookie Database row: [cookie name, platform, category, wildcard flag]. */
export type CookiePlatformRow = readonly [name: string, platform: string, category: string, wildcard: 0 | 1]

/** One form field as Rust hands it over, untrusted and unclassified. */
export interface RawFormField {
  /** URL of the page the field was found on, origin+path only. */
  page: string
  name: string
  type: string
  autocomplete: string
  label: string
  /** Index among the page's forms; -1 (or absent in an older payload) when in none. */
  form?: number
  /** Hostname of the enclosing form's action. Empty or absent when there is none. */
  actionHost?: string
}

/** An iframe seen on a page: host and first path segment only. */
export interface RawIframe {
  page: string
  host: string
  segment: string
}

/** A link from the home page to another site, never visited. */
export interface RawOffsiteLink {
  page: string
  host: string
  purpose: 'booking' | 'newsletter' | 'account'
}

export type FormFieldKind = 'email' | 'phone' | 'name' | 'address' | 'payment' | 'free-text'

export interface CollectionPointField {
  name: string
  kind: FormFieldKind
}

export type DoorKind = 'form' | 'newsletter' | 'booking' | 'chat' | 'embed'

/** What classifyDoors finds: one candidate per page for a form, one per provider otherwise. */
export interface DoorCandidate {
  kind: DoorKind
  /** First path segment of the provider's iframe, when the door is an embed. */
  segment?: string
  page: string
  pages: string[]
  /** The host as scanned, never a guessed name. Null when there is no third party. */
  provider: string | null
  fields: CollectionPointField[]
}

/** A discovered door: a form on a page, or a third party's collection point seen on the site. */
export interface CollectionPoint {
  id: string
  page: string
  /** Absent in an older file: read as 'form'. */
  kind?: DoorKind
  /** The provider place's name. */
  provider?: string
  /** Every page the door was seen on. Absent: just `page`. */
  pages?: string[]
  /** The place this door sends data to. */
  destination?: string
  fields: CollectionPointField[]
  sources: SourceRef[]
  confidence: Confidence
}

/** 'unsourced': a collection place with no document and no scan behind it -- no caption is claimed. */
export type DoorOrigin = 'discovered' | 'declared' | 'unsourced'

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
  /** Absent on a declared door. */
  kind?: DoorKind
  pages?: string[]
  /** The place id a discovered door sends data to. */
  destination?: string
}

/** Where one door's data goes and who comes through it. Computed by tracePaths; never stored. */
export interface DoorPath {
  doorId: string
  /** Place ids this door's data reaches, in project flow order, deduplicated. */
  destinationIds: string[]
  /** SubjectGroup ids that come through this door, in project flow order, deduplicated. */
  subjectIds: string[]
}

/** What the scan did about consent, as Rust reports it. */
export interface ScanConsent {
  /** The CMP whose rules detected it, by rule name, e.g. "iubenda". */
  cmp: string | null
  clicked: boolean
  /** What the click went by: the CMP's rule, or a button's text. */
  rule: 'cmp' | 'text' | null
  ruleName: string
  matchedText: string
  clickNavigated: boolean
  /**
   * Why nothing was clicked. Absent when detection did not run to its end, a click happened, or a
   * click was sent and never answered (whether consent was given is then not known).
   */
  reason?: 'no-banner' | 'no-button' | 'click-failed'
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
  iframes?: RawIframe[]
  offsiteLinks?: RawOffsiteLink[]
  /** Key pages the scan visited (not the home page) and what each is for, when its link said so. */
  pages?: { page: string; purpose: 'contacts' | 'careers' | 'shop' | 'booking' | 'newsletter' | 'account' | null }[]
  /** v0.3 payloads only: fixed marker names of consent managers detected. Never persisted. */
  consentMarkers?: string[]
  consent?: ScanConsent
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
