// Document ingestion, the pure half: text in, candidates out, confirmed candidates folded
// into the project. See src/core/documents.ts.
import { describe, it, expect } from 'vitest'
import { extractCandidates, ingestDocument } from '../../src/core/documents'
import { emptyProject, place } from '../fixtures/projects'
import { addPlace } from '../../src/core/graph'
import type {
  Candidate,
  InternalSystemDictionary,
  VendorDictionary,
} from '../../src/core/types'

const VENDORS: VendorDictionary = {
  'google-analytics.com': { owner: 'Google', category: 'analytics', purposeGroup: 'Marketing' },
}

const INTERNAL: InternalSystemDictionary = {
  payroll: { name: 'Payroll system', purposeGroup: 'Payroll & HR', layer: 'internal', holder: 'you' },
  salesforce: { name: 'Salesforce', purposeGroup: 'Sales & CRM', layer: 'internal', holder: 'supplier' },
  stripe: { name: 'Stripe', purposeGroup: 'Payments', layer: 'external', holder: 'supplier' },
}

describe('extractCandidates', () => {
  it('finds an internal system by term, case-insensitively, with evidence around the match', () => {
    const docs = [{ name: 'contract.pdf', text: 'The monthly PAYROLL run is outsourced.' }]
    const out = extractCandidates(docs, VENDORS, INTERNAL)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('Payroll system')
    expect(out[0]?.layer).toBe('internal')
    expect(out[0]?.kind).toBe('internal')
    expect(out[0]?.holder).toBe('you')
    expect(out[0]?.evidence).toContain('PAYROLL run')
    expect(out[0]?.sourceNames).toEqual(['contract.pdf'])
  })

  it('does not match a term inside a longer word', () => {
    const docs = [{ name: 'a.txt', text: 'the stripes on the flag' }]
    expect(extractCandidates(docs, VENDORS, INTERNAL)).toHaveLength(0)
  })

  it('finds a vendor by domain and names it exactly as a scan would', () => {
    const docs = [{ name: 'invoice.pdf', text: 'Billed for www.google-analytics.com usage.' }]
    const out = extractCandidates(docs, VENDORS, INTERNAL)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('Google Analytics')
    expect(out[0]?.layer).toBe('external')
    expect(out[0]?.purposeGroup).toBe('Marketing')
  })

  it('ignores a domain the vendor dictionary does not know', () => {
    const docs = [{ name: 'a.txt', text: 'see internal-wiki.example for details' }]
    expect(extractCandidates(docs, VENDORS, INTERNAL)).toHaveLength(0)
  })

  it('deduplicates across documents, collecting every source name once', () => {
    const docs = [
      { name: 'one.docx', text: 'Payroll data is processed monthly. Payroll again.' },
      { name: 'two.csv', text: 'payroll;employee;amount' },
    ]
    const out = extractCandidates(docs, VENDORS, INTERNAL)
    expect(out).toHaveLength(1)
    expect(out[0]?.sourceNames).toEqual(['one.docx', 'two.csv'])
  })

  it('is empty for empty documents', () => {
    expect(extractCandidates([{ name: 'x.txt', text: '' }], VENDORS, INTERNAL)).toHaveLength(0)
  })
})

// A document that denies doing something must not put it on the map. See src/core/documents.ts
// and §4.4 of docs/superpowers/specs/2026-08-03-extraction-depth-design.md.
describe('a term the document denies', () => {
  const DENIABLE: InternalSystemDictionary = {
    hotjar: { name: 'Hotjar', purposeGroup: 'Marketing', layer: 'external', holder: 'supplier' },
    matomo: { name: 'Matomo', purposeGroup: 'Marketing', layer: 'external', holder: 'supplier' },
    cookie: { name: 'Cookies', purposeGroup: 'Website tracking', layer: 'external', holder: 'supplier' },
  }
  const names = (text: string): string[] =>
    extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, DENIABLE)
      .map((c) => c.name)
      .sort()

  it('is not offered when the sentence denies it, in Italian', () => {
    expect(names('Non utilizziamo cookie di profilazione.')).toEqual([])
  })

  it('is not offered when the sentence denies it, in English', () => {
    expect(names('We do not use Hotjar on this site.')).toEqual([])
  })

  it('reads "nessun" and "senza" as denials too', () => {
    expect(names('Nessun cookie di terze parti. Il sito funziona senza Hotjar.')).toEqual([])
  })

  it('is still offered when a different sentence asserts it', () => {
    // Denial reaches to the end of its own sentence and no further.
    expect(names('Non utilizziamo Matomo. Utilizziamo Hotjar per le mappe di calore.')).toEqual([
      'Hotjar',
    ])
  })

  it('anchors its evidence on the sentence that asserts it', () => {
    const [c] = extractCandidates(
      [{ name: 'a.pdf', text: 'Non utilizziamo Hotjar per la pubblicità. Hotjar resta attivo per le heatmap.' }],
      VENDORS,
      DENIABLE,
    )
    if (c === undefined) throw new Error('expected a candidate')
    // Evidence stays a window around the match rather than being clipped to one sentence: a
    // reader deciding whether to tick this is better served seeing the denial next to the
    // assertion than seeing half the story.
    expect(c.evidence).toContain('resta attivo')
  })

  it('does not let a denial far off in the same sentence suppress an unrelated mention', () => {
    // "non" governs the retention clause, not the vendor named much later in the same sentence.
    const text =
      'Non conserviamo i dati oltre i ventiquattro mesi previsti dal contratto quadro ' +
      'sottoscritto con il fornitore, e per le statistiche il sito usa Matomo.'
    expect(names(text)).toEqual(['Matomo'])
  })

  it('is unaffected when the denial comes after the term', () => {
    expect(names('Hotjar è installato, non è disattivato.')).toEqual(['Hotjar'])
  })
})

// A term is matched on letter boundaries, not on ASCII word boundaries. `\b` treats every
// accented letter as a non-letter, so `\bcontabilità\b` never matches anything at all: the
// trailing boundary asks for a letter-to-non-letter transition and finds non-letter on both
// sides. That silently disables every Italian term ending in a vowel with an accent -- the
// dictionary would look right and match nothing.
describe('matching terms that are not ASCII', () => {
  const ACCENTED: InternalSystemDictionary = {
    contabilità: {
      name: 'Accounting system',
      purposeGroup: 'Finance & Accounting',
      layer: 'internal',
      holder: 'you',
    },
    videosorveglianza: {
      name: 'Video surveillance',
      purposeGroup: 'Facilities & Security',
      layer: 'internal',
      holder: 'you',
    },
  }

  it('finds a term ending in an accented letter', () => {
    const docs = [{ name: 'nota.pdf', text: 'La contabilità è tenuta internamente.' }]
    const out = extractCandidates(docs, VENDORS, ACCENTED)
    expect(out.map((c) => c.name)).toEqual(['Accounting system'])
  })

  it('still refuses a term that is only part of a longer word', () => {
    const docs = [{ name: 'a.txt', text: 'contabilitàaziendale videosorveglianzaX' }]
    expect(extractCandidates(docs, VENDORS, ACCENTED)).toHaveLength(0)
  })

  it('treats an accented letter next to the term as part of a longer word', () => {
    // "è" is a letter, so "èvideosorveglianza" is one word and holds no term.
    const docs = [{ name: 'a.txt', text: 'èvideosorveglianza' }]
    expect(extractCandidates(docs, VENDORS, ACCENTED)).toHaveLength(0)
  })

  it('matches a term sitting against punctuation', () => {
    const docs = [{ name: 'a.txt', text: 'Impianti: videosorveglianza, badge.' }]
    const out = extractCandidates(docs, VENDORS, ACCENTED)
    expect(out.map((c) => c.name)).toEqual(['Video surveillance'])
  })
})

// A PDF wraps lines wherever the column ends, so a two-word term arrives with a newline in the
// middle of it as often as with a space. Matching on one literal space made every multi-word
// term in the dictionary a coin toss.
describe('a term broken across a line', () => {
  const MULTIWORD: InternalSystemDictionary = {
    'buste paga': {
      name: 'Payroll system',
      purposeGroup: 'Payroll & HR',
      layer: 'internal',
      holder: 'you',
    },
    'access control': {
      name: 'Access control',
      purposeGroup: 'Facilities & Security',
      layer: 'internal',
      holder: 'you',
    },
  }
  const names = (text: string): string[] =>
    extractCandidates([{ name: 'a.pdf', text }], VENDORS, MULTIWORD)
      .map((c) => c.name)
      .sort()

  it('matches across a newline', () => {
    expect(names('Le buste\npaga sono elaborate internamente.')).toEqual(['Payroll system'])
  })

  it('matches across a line break with indentation', () => {
    expect(names('badge e access\n    control all’ingresso')).toEqual(['Access control'])
  })

  it('matches across a run of spaces left by a two-column layout', () => {
    expect(names('buste     paga')).toEqual(['Payroll system'])
  })

  it('still refuses the two words run together', () => {
    expect(names('bustepaga')).toEqual([])
  })

  it('still refuses a term that is only part of a longer word', () => {
    expect(names('le buste\npagate dal fornitore')).toEqual([])
  })

  it('does not bridge a comma between the two words', () => {
    // \s+ is whitespace only. "buste, paga" is a list, not the term.
    expect(names('buste, paga')).toEqual([])
  })

  it('does not bridge a word between the two words', () => {
    expect(names('buste di paga')).toEqual([])
  })

  it('shows the whole matched term in its evidence, newline and all', () => {
    const [c] = extractCandidates(
      [{ name: 'a.pdf', text: 'Elaborazione delle buste\npaga mensili per i dipendenti.' }],
      VENDORS,
      MULTIWORD,
    )
    if (c === undefined) throw new Error('expected a candidate')
    expect(c.evidence).toContain('mensili')
  })

  it('measures the evidence window from what matched, not from the dictionary key', () => {
    // "access\n      control" is 20 characters where the key "access control" is 14, so a window
    // sized from the key falls 6 characters short at the tail. "deposito" sits in that gap: it
    // ends 2 characters inside the window measured from the match and 4 characters outside the
    // window measured from the key. Only the second implementation truncates it to "depo".
    const [c] = extractCandidates(
      [
        {
          name: 'a.pdf',
          text:
            'Il badge e access\n      control regola l’ingresso agli uffici e agli archivi ' +
            'del deposito comunale.',
        },
      ],
      VENDORS,
      MULTIWORD,
    )
    if (c === undefined) throw new Error('expected a candidate')
    expect(c.evidence).toContain('deposito')
  })
})

function confirmed(over: Partial<Candidate>): Candidate {
  return {
    id: 'payroll-system',
    name: 'Payroll system',
    layer: 'internal',
    purposeGroup: 'Payroll & HR',
    holder: 'you',
    kind: 'internal',
    evidence: 'the payroll run',
    sourceNames: ['contract.pdf'],
    ...over,
  }
}

describe('ingestDocument', () => {
  it('adds a confirmed candidate as a declared place with the document as its source', () => {
    const p = ingestDocument(emptyProject(), [confirmed({})])
    expect(p.places).toHaveLength(1)
    const added = p.places[0]
    expect(added?.name).toBe('Payroll system')
    expect(added?.kind).toBe('internal')
    expect(added?.confidence).toBe('declared')
    // The file name and nothing else: the passage that produced the match is shown while
    // confirming, then dropped with the text it came from.
    expect(added?.sources).toEqual([
      { documentId: 'contract.pdf', documentName: 'contract.pdf' },
    ])
  })

  it('enriches an existing place instead of duplicating it, and never downgrades what a scan observed', () => {
    let p = emptyProject()
    p = addPlace(
      p,
      { ...place(), name: 'Payroll System', confidence: 'observed' as const },
      'pl-1',
    )
    const out = ingestDocument(p, [confirmed({})])
    expect(out.places).toHaveLength(1)
    expect(out.places[0]?.confidence).toBe('observed')
    // The fixture's own source stays; the document is appended after it.
    expect(out.places[0]?.sources).toContainEqual({
      documentId: 'contract.pdf',
      documentName: 'contract.pdf',
    })
    expect(out.places[0]?.sources.length).toBe((p.places[0]?.sources.length ?? 0) + 1)
  })

  it('does not append the same document to a place twice', () => {
    const once = ingestDocument(emptyProject(), [confirmed({})])
    const twice = ingestDocument(once, [confirmed({})])
    expect(twice.places[0]?.sources).toHaveLength(1)
  })

  it('leaves the project untouched for an empty confirmation', () => {
    const p = emptyProject()
    expect(ingestDocument(p, [])).toEqual(p)
  })
})

describe('trackers and cookies named in prose', () => {
  const TRACKING: InternalSystemDictionary = {
    'facebook pixel': { name: 'Meta Pixel', purposeGroup: 'Marketing', layer: 'external', holder: 'supplier' },
    cookies: { name: 'Cookies', purposeGroup: 'Website tracking', layer: 'external', holder: 'supplier' },
    hotjar: { name: 'Hotjar', purposeGroup: 'Marketing', layer: 'external', holder: 'supplier' },
  }

  it('finds a tracker named in a sentence, with no domain and no scan', () => {
    const docs = [
      {
        name: 'privacy-policy.docx',
        text: 'We use profiling cookies and a Facebook Pixel, plus Hotjar for session replay.',
      },
    ]
    const out = extractCandidates(docs, VENDORS, TRACKING)
    expect(out.map((c) => c.name).sort()).toEqual(['Cookies', 'Hotjar', 'Meta Pixel'])
    expect(out.every((c) => c.layer === 'external')).toBe(true)
  })

  it('keeps the file name as the source and nothing of what the file said', () => {
    const docs = [{ name: 'policy.pdf', text: 'The site sets profiling cookies on first visit.' }]
    const [candidate] = extractCandidates(docs, VENDORS, TRACKING)
    if (candidate === undefined) throw new Error('expected a candidate')
    // The evidence exists while confirming -- it is what the user judges the suggestion on --
    // and must not survive into the project.
    expect(candidate.evidence).toContain('profiling cookies')
    const p = ingestDocument(emptyProject(), [candidate])
    expect(p.places[0]?.name).toBe('Cookies')
    expect(p.places[0]?.sources[0]?.locator).toBeUndefined()
  })
})
