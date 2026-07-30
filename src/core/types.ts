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
