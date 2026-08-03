import { addPlace } from './graph'
import { displayName } from './scan'
import { identify } from './vendors'
import type {
  Candidate,
  DataCategoryDictionary,
  DataCategoryEntry,
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
 * A dictionary term, anchored so it matches a whole word and never part of one.
 *
 * `\b` cannot do this job. It is defined against `[A-Za-z0-9_]`, so every accented letter
 * counts as a boundary character — which gets Italian exactly backwards. `\bcontabilità\b`
 * fails on "la contabilità aziendale" (the closing boundary wants a letter-to-non-letter
 * step and finds "à" against " ", neither of them a word character to `\b`) and succeeds on
 * "contabilitàaziendale" (there the "à"-to-"a" step reads as a boundary). A dictionary of
 * Italian terms matched that way would look complete and find nothing.
 *
 * Unicode classes say what was meant all along: no letter or digit either side, whatever
 * alphabet it is written in. Punctuation, spaces and line breaks remain boundaries.
 *
 * The opening side is a capture group rather than a lookbehind, which would read better.
 * Lookbehind needs Safari 16.4, the build targets es2022 (Safari 15.4), and no minimum
 * system version is declared — so on an older Mac the pattern would throw where it is built,
 * which is inside document ingestion, and the only thing the user would see is "the documents
 * could not be read". A capture group costs one offset at the call site and nothing else.
 *
 * The space between the words of a multi-word term is whatever the file happened to contain. A
 * PDF wraps at the column, so "buste paga" arrives as "buste\npaga" about as often as with a
 * space, and matching on one literal space made every multi-word term in the dictionary a coin
 * toss. Each word is escaped on its own and joined with `\s+`, which is why the term is split
 * before escaping and not after: escaping first would leave a literal space to split on that had
 * already been treated as a pattern character.
 */
function wholeWord(term: string): RegExp {
  const body = term.split(' ').map(escapeRegExp).join('\\s+')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'gu')
}

/**
 * Words that turn a mention into a denial. Both languages the dictionary covers.
 *
 * A privacy notice says what an organisation does *not* do at least as often as what it does, and
 * "non utilizziamo cookie di profilazione" was being read as a cookie: the map showed the opposite
 * of what the document said. One confident false positive costs more than ten honest blanks, and
 * the whole register of this tool is that an unanswered question is work still to do.
 */
const NEGATIONS =
  /(^|[^\p{L}\p{N}])(non|nessun|nessuna|nessuno|né|senza|esclus[oaie]|not|no|never|without|nor|neither)(?![\p{L}\p{N}])/u

/** Where a statement stops. Bullets count: a list item is its own claim. */
const SENTENCE_END = /[.!?;:\n\r•]/

/** One letter or digit, in any alphabet. */
const ALNUM = /[\p{L}\p{N}]/u

/**
 * True when the character at `i` ends a statement.
 *
 * Every terminator but the dot ends one wherever it sits. A dot does not when it has a letter or
 * a digit on both sides: that is a domain label ("google-analytics.com"), a company suffix
 * ("S.r.l.") or a decimal ("24.5"), and reading it as a full stop cut the sentence short at the
 * first label of a domain. That made everything a document said *after* naming a vendor invisible
 * to the attribute extractors -- which is most real phrasing, since the sentence names the
 * supplier and then says what it keeps and where.
 *
 * A dot followed by a space stays a boundary, so "Non utilizziamo cookie. Utilizziamo Hotjar."
 * still reads as two statements and the denial still stops where it did.
 */
function endsSentence(text: string, i: number): boolean {
  const ch = text.charAt(i)
  if (!SENTENCE_END.test(ch)) return false
  if (ch !== '.') return true
  return !(ALNUM.test(text.charAt(i - 1)) && ALNUM.test(text.charAt(i + 1)))
}

/**
 * How far back a denial reaches, in characters.
 *
 * The sentence alone is too generous. "Non conserviamo i dati oltre i ventiquattro mesi …, e per le
 * statistiche il sito usa Matomo" is one sentence in which the denial governs the first clause and
 * has nothing to do with the vendor named at the end. Requiring the denial to be *near* the term as
 * well as in its sentence keeps the common phrasing working without swallowing the rest of the line.
 */
const NEGATION_REACH = 60

/**
 * The sentence containing `at`, as half-open bounds. One definition of how far a statement
 * reaches, shared by the negation guard and by every attribute read off a sentence -- so there is
 * one rule to argue about rather than two that drift apart.
 */
function sentenceBounds(text: string, at: number): { start: number; end: number } {
  let start = 0
  for (let i = at - 1; i >= 0; i -= 1) {
    if (endsSentence(text, i)) {
      start = i + 1
      break
    }
  }
  let end = text.length
  for (let i = at; i < text.length; i += 1) {
    if (endsSentence(text, i)) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * True when the text just before `at` denies whatever is at `at`.
 *
 * A contrastive word ("solo", "only") is deliberately not treated as closing the denial, though
 * that would let "non riceve il codice fiscale, solo il nome" report the second category. It also
 * lets five ordinary denials through -- "non ha mai adottato, nemmeno soltanto in via
 * sperimentale, Hotjar" among them -- because the contrast can sit inside the denied clause
 * rather than after it. §4.4 settles that trade in its own words: one confident false positive
 * costs more than ten honest blanks. If the contrastive read is wanted later it belongs inside
 * `dataCategoriesIn`, scoped to categories, with its own tests.
 */
function isDenied(lower: string, at: number): boolean {
  const { start } = sentenceBounds(lower, at)
  return NEGATIONS.test(lower.slice(Math.max(start, at - NEGATION_REACH), at))
}

/**
 * Durations, in both languages, mapped to the plural English noun the interface prints. The
 * interface is English (see src/renderer/strings.ts) and the document is usually not, so what is
 * read in Italian is stored in English: "24 mesi" on a printed sheet that says "Retention" in
 * English reads as an oversight rather than as faithfulness.
 */
const RETENTION_UNITS: Readonly<Record<string, string>> = {
  giorno: 'days', giorni: 'days', day: 'days', days: 'days',
  settimana: 'weeks', settimane: 'weeks', week: 'weeks', weeks: 'weeks',
  mese: 'months', mesi: 'months', month: 'months', months: 'months',
  anno: 'years', anni: 'years', year: 'years', years: 'years',
}

/**
 * A figure and a unit, separated by whitespace. Digits only: "ventiquattro mesi" is a
 * word-number dictionary in two languages, and the phrasing an informativa actually uses is
 * numeric. Boundaries are the \p{L} kind the rest of this module uses rather than \b, for the
 * reason set out above `wholeWord`.
 */
const RETENTION = new RegExp(
  `(^|[^\\p{L}\\p{N}])(\\d{1,4})\\s+(${Object.keys(RETENTION_UNITS).join('|')})(?![\\p{L}\\p{N}])`,
  'iu',
)

/**
 * How long the sentence says something is kept, or undefined. The first figure wins when a
 * sentence carries two: that is ambiguous by construction, and the user is shown the sentence.
 *
 * Not negation-guarded: "Non conserviamo i dati per 24 mesi" yields "24 months". The guard runs
 * on the term that anchors the sentence, not on the attributes read off it, and the confirm list
 * is the containment.
 */
export function retentionIn(sentence: string): string | undefined {
  const m = RETENTION.exec(sentence)
  if (m === null) return undefined
  const count = m[2]
  const unit = RETENTION_UNITS[(m[3] ?? '').toLowerCase()]
  if (count === undefined || unit === undefined) return undefined
  return `${count} ${count === '1' ? unit.slice(0, -1) : unit}`
}

/**
 * Verbs that place a thing somewhere, in both languages. The Italian participles carry their whole
 * inflection (ubicato/ubicata/ubicati/ubicate) because a dictionary of stems would match
 * "ubicazione" too, which introduces the topic rather than answering it. The present tense is
 * spelled out alongside the participle for the same reason: "archivia i dati negli Stati Uniti"
 * is how an informativa writes it about as often as "archiviati".
 */
const PLACED =
  'ubicat[oaie]|situat[oaie]|ospitat[oaie]|archiviat[oaie]|conservat[oaie]|memorizzat[oaie]|' +
  'archivia|conserva|ospita|memorizza|' +
  'hosted|located|stored|held|based|situated'

/**
 * Words allowed to sit between the verb and the preposition. Italian puts the object there --
 * "archivia i dati negli Stati Uniti" -- so requiring the two to be adjacent would read only half
 * the phrasings. Lowercase only and at most three, so the run cannot swallow the capitalised name
 * the pattern exists to find, nor reach into a clause about something else.
 */
const PLACED_FILLER = `(?:\\s+[\\p{Ll}\\p{N}’'-]+){0,3}`

/**
 * A placement verb, a preposition, and a capitalised name. Capitalisation is what separates a
 * place from a manner -- "conservati in Irlanda" against "conservati in modo sicuro" -- and it is
 * the only signal available without a gazetteer, which would be a bundled dataset of its own.
 * Two words at most, so "Stati Uniti" and "United Kingdom" survive and a run-on clause does not.
 */
const JURISDICTION = new RegExp(
  `(?:${PLACED})${PLACED_FILLER}\\s+(?:in|nel|nella|nelle|nei|negli|presso|su)\\s+` +
    `(\\p{Lu}[\\p{L}’'-]+(?:\\s+\\p{Lu}[\\p{L}’'-]+)?)`,
  'u',
)

/**
 * Where the sentence says this sits, or undefined. Run against the sentence in its original case:
 * capitalisation is the whole signal, and the lowercased copy used for term matching has thrown
 * it away.
 *
 * Not negation-guarded, as `retentionIn` is not: "I dati non sono ubicati in Irlanda" yields
 * "Irlanda". The guard runs on the term that anchors the sentence, and the confirm list is the
 * containment.
 */
export function jurisdictionIn(sentence: string): string | undefined {
  const m = JURISDICTION.exec(sentence)
  return m?.[1]
}

/**
 * Which categories of personal data the sentence names, in the order it names them, each once.
 * Undefined rather than an empty array when it names none: an empty list on a printed sheet reads
 * as "no personal data here", which is a claim this function is in no position to make.
 *
 * Denial is judged per occurrence, as it is for a term: "non riceve il codice fiscale, solo il
 * nome" names two categories and asserts one.
 */
export function dataCategoriesIn(
  sentence: string,
  categories: ReadonlyArray<{ entry: DataCategoryEntry; pattern: RegExp }>,
): string[] | undefined {
  const lower = sentence.toLowerCase()
  const found: Array<{ name: string; at: number }> = []
  for (const { entry, pattern } of categories) {
    for (const m of lower.matchAll(pattern)) {
      const start = m.index + (m[1]?.length ?? 0)
      if (isDenied(lower, start)) continue
      found.push({ name: entry.name, at: start })
      break
    }
  }
  if (found.length === 0) return undefined
  found.sort((a, b) => a.at - b.at)
  return [...new Set(found.map((f) => f.name))]
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
  categories: DataCategoryDictionary,
): Candidate[] {
  const byKey = new Map<string, Candidate>()

  // The dictionary is fixed for the whole call, so its patterns are compiled once here rather
  // than once per document. None carries the global flag, so none holds a lastIndex to reset
  // between documents.
  const terms = Object.entries(internal).map(([term, entry]) => ({
    entry,
    pattern: wholeWord(term.toLowerCase()),
  }))

  const categoryTerms = Object.entries(categories).map(([term, entry]) => ({
    entry,
    pattern: wholeWord(term.toLowerCase()),
  }))

  const add = (candidate: Omit<Candidate, 'id' | 'sourceNames'>, sourceName: string): void => {
    const key = candidate.name.toLowerCase()
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, { ...candidate, id: slug(candidate.name), sourceNames: [sourceName] })
    } else {
      if (!existing.sourceNames.includes(sourceName)) existing.sourceNames.push(sourceName)
      // First document to say something wins. A second document that says something different is
      // a contradiction, and this list is not where a contradiction gets resolved -- the user
      // sees both files named under the candidate and decides.
      existing.retention ??= candidate.retention
      existing.jurisdiction ??= candidate.jurisdiction
      existing.dataCategories ??= candidate.dataCategories
    }
  }

  for (const doc of documents) {
    const text = doc.text
    const lower = text.toLowerCase()

    // 1. Internal-systems dictionary: whole-word term match, case-insensitive. Denial is judged
    //    per occurrence, so a term denied in one sentence and asserted in another is still offered
    //    -- carrying the sentence that asserts it as its evidence, which is what the user judges.
    for (const { entry, pattern } of terms) {
      let at = -1
      let matched = 0
      for (const m of lower.matchAll(pattern)) {
        // The match starts after whatever the opening group swallowed: one character mid-text,
        // nothing at all at the very start of the document. What remains is the term as this
        // document actually wrote it, which may be longer than the dictionary key -- a newline
        // and an indent where the key has one space.
        const lead = m[1]?.length ?? 0
        const start = m.index + lead
        if (isDenied(lower, start)) continue
        at = start
        matched = m[0].length - lead
        break
      }
      if (at === -1) continue
      const { start: sStart, end: sEnd } = sentenceBounds(text, at)
      const sentence = text.slice(sStart, sEnd)
      add(
        {
          name: entry.name,
          layer: entry.layer,
          purposeGroup: entry.purposeGroup,
          holder: entry.holder,
          kind: entry.layer === 'internal' ? 'internal' : 'processor',
          evidence: evidenceAround(text, at, matched),
          retention: retentionIn(sentence),
          jurisdiction: jurisdictionIn(sentence),
          dataCategories: dataCategoriesIn(sentence, categoryTerms),
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
      const at = m.index ?? 0
      const { start: sStart, end: sEnd } = sentenceBounds(text, at)
      const sentence = text.slice(sStart, sEnd)
      add(
        {
          name: displayName(host, vendors),
          layer: 'external',
          purposeGroup: hit.purposeGroup,
          holder: 'supplier',
          kind: 'processor',
          evidence: evidenceAround(text, at, m[0].length),
          retention: retentionIn(sentence),
          jurisdiction: jurisdictionIn(sentence),
          dataCategories: dataCategoriesIn(sentence, categoryTerms),
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
      // A scan never sets retention, so filling a blank one is enrichment rather than the
      // downgrade the comment above this function forbids. A retention already on the place
      // stands: it was either confirmed earlier or typed by the user.
      const retention = existing.retention ?? candidate.retention
      const jurisdiction = existing.jurisdiction ?? candidate.jurisdiction
      const dataCategories = existing.dataCategories ?? candidate.dataCategories
      if (
        fresh.length === 0 &&
        retention === existing.retention &&
        jurisdiction === existing.jurisdiction &&
        dataCategories === existing.dataCategories
      )
        continue
      working = {
        ...working,
        places: working.places.map((p) =>
          p.id === existing.id
            ? { ...p, retention, jurisdiction, dataCategories, sources: [...p.sources, ...fresh] }
            : p,
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
      jurisdiction: candidate.jurisdiction,
      leavesEEA: 'unknown',
      retention: candidate.retention,
      dataCategories: candidate.dataCategories,
      // The document's name and nothing else. The passage that produced the match is shown
      // while confirming and then dropped with the text it came from: what survives into the
      // project is which file said so, never what it said.
      sources: candidate.sourceNames.map((s) => ({ documentId: s, documentName: s })),
      confidence: 'declared',
    }
    working = addPlace(working, place, id)
  }

  return working
}
