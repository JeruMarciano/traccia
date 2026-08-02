import { addPlace } from './graph'
import { displayName } from './scan'
import { identify } from './vendors'
import type {
  Candidate,
  DocumentText,
  InternalSystemDictionary,
  Place,
  Project,
  VendorDictionary,
} from './types'

/**
 * Document ingestion, the pure half. Rust extracts plain text from files the user picked;
 * this module mines that text for what it appears to describe — internal systems by
 * dictionary term, external vendors by domain — and offers candidates. Nothing lands on the
 * map without confirmation, and the text itself is session-only: what survives into the
 * project is a confirmed place and the *name* of the document that declared it, never the
 * document or its contents.
 *
 * Matching is deliberately rule-based and local. Accuracy is not the bar (the map is a
 * first understanding, not an audit); the suggest-then-confirm flow is what keeps a false
 * match off the map.
 */

/** How much text around a match the user sees to judge it. */
const EVIDENCE_RADIUS = 60

/** Something that looks like a domain: labels, dots, a plausible TLD. */
const DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,12}\b/gi

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function evidenceAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - EVIDENCE_RADIUS)
  const end = Math.min(text.length, index + matchLength + EVIDENCE_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + collapseWhitespace(text.slice(start, end)) + suffix
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Every candidate the given documents suggest, deduplicated by name across documents (a
 * system named in three files is one candidate carrying three source names). Order:
 * first appearance across the documents, in the order given.
 */
export function extractCandidates(
  documents: DocumentText[],
  vendors: VendorDictionary,
  internal: InternalSystemDictionary,
): Candidate[] {
  const byKey = new Map<string, Candidate>()

  const add = (candidate: Omit<Candidate, 'id' | 'sourceNames'>, sourceName: string): void => {
    const key = candidate.name.toLowerCase()
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, { ...candidate, id: slug(candidate.name), sourceNames: [sourceName] })
    } else if (!existing.sourceNames.includes(sourceName)) {
      existing.sourceNames.push(sourceName)
    }
  }

  for (const doc of documents) {
    const text = doc.text
    const lower = text.toLowerCase()

    // 1. Internal-systems dictionary: term match on word boundaries, case-insensitive.
    for (const [term, entry] of Object.entries(internal)) {
      const re = new RegExp(`\\b${escapeRegExp(term.toLowerCase())}\\b`)
      const m = re.exec(lower)
      if (m === null) continue
      add(
        {
          name: entry.name,
          layer: entry.layer,
          purposeGroup: entry.purposeGroup,
          holder: entry.holder,
          kind: entry.layer === 'internal' ? 'internal' : 'processor',
          evidence: evidenceAround(text, m.index, term.length),
        },
        doc.name,
      )
    }

    // 2. Vendor dictionary: anything that looks like a domain, resolved the same way a
    //    scanned host is, so a domain in an invoice and the same domain observed by a scan
    //    produce the same place name and merge instead of duplicating.
    DOMAIN_PATTERN.lastIndex = 0
    for (const m of text.matchAll(DOMAIN_PATTERN)) {
      const host = m[0].toLowerCase()
      const hit = identify(host, vendors)
      if (hit === null) continue
      add(
        {
          name: displayName(host, vendors),
          layer: 'external',
          purposeGroup: hit.purposeGroup,
          holder: 'supplier',
          kind: 'processor',
          evidence: evidenceAround(text, m.index ?? 0, m[0].length),
        },
        doc.name,
      )
    }
  }

  return [...byKey.values()]
}

/**
 * Folds confirmed candidates into the project. A candidate whose name matches an existing
 * place (case-insensitively) enriches it — the document is appended to its sources, and
 * nothing else about it is overwritten: an observation from a scan outranks a mention in a
 * document. A new candidate becomes a place with confidence `declared`. No flows are
 * created: the map's geometry connects the hub to every group without them.
 *
 * `documentId` is the document's name — documents are read and forgotten, so the name is
 * the only identity they have.
 */
export function ingestDocument(project: Project, confirmed: Candidate[]): Project {
  let working = project
  const taken = new Set<string>([
    ...project.places.map((p) => p.id),
    ...project.subjectGroups.map((s) => s.id),
    ...project.flows.map((f) => f.id),
  ])

  for (const candidate of confirmed) {
    const existing = working.places.find(
      (p) => p.name.toLowerCase() === candidate.name.toLowerCase(),
    )
    if (existing !== undefined) {
      const known = new Set(existing.sources.map((s) => s.documentName))
      const fresh = candidate.sourceNames
        .filter((n) => !known.has(n))
        .map((n) => ({ documentId: n, documentName: n }))
      if (fresh.length === 0) continue
      working = {
        ...working,
        places: working.places.map((p) =>
          p.id === existing.id ? { ...p, sources: [...p.sources, ...fresh] } : p,
        ),
      }
      continue
    }

    let n = 1
    while (taken.has(`doc-pl-${n}`)) n += 1
    const id = `doc-pl-${n}`
    taken.add(id)
    const place: Place = {
      id,
      name: candidate.name,
      kind: candidate.kind,
      purposeGroup: candidate.purposeGroup,
      holder: candidate.holder,
      leavesEEA: 'unknown',
      sources: candidate.sourceNames.map((s) => ({ documentId: s, documentName: s })),
      confidence: 'declared',
    }
    working = addPlace(working, place, id)
  }

  return working
}
