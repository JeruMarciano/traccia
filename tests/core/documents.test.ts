// Document ingestion, the pure half: text in, candidates out, confirmed candidates folded
// into the project. See src/core/documents.ts.
import { describe, it, expect } from 'vitest'
import { extractCandidates, ingestDocument } from '../../src/core/documents'
import { emptyProject, place } from '../fixtures/projects'
import { addPlace } from '../../src/core/graph'
import type {
  Candidate,
  DataCategoryDictionary,
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

const CATEGORIES: DataCategoryDictionary = {
  email: { name: 'Email address' },
  'dati di navigazione': { name: 'Browsing data' },
  'codice fiscale': { name: 'Tax identifier' },
  nome: { name: 'Name' },
}

describe('extractCandidates', () => {
  it('finds an internal system by term, case-insensitively, with evidence around the match', () => {
    const docs = [{ name: 'contract.pdf', text: 'The monthly PAYROLL run is outsourced.' }]
    const out = extractCandidates(docs, VENDORS, INTERNAL, CATEGORIES)
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
    expect(extractCandidates(docs, VENDORS, INTERNAL, CATEGORIES)).toHaveLength(0)
  })

  it('finds a vendor by domain and names it exactly as a scan would', () => {
    const docs = [{ name: 'invoice.pdf', text: 'Billed for www.google-analytics.com usage.' }]
    const out = extractCandidates(docs, VENDORS, INTERNAL, CATEGORIES)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('Google Analytics')
    expect(out[0]?.layer).toBe('external')
    expect(out[0]?.purposeGroup).toBe('Marketing')
  })

  it('ignores a domain the vendor dictionary does not know', () => {
    const docs = [{ name: 'a.txt', text: 'see internal-wiki.example for details' }]
    expect(extractCandidates(docs, VENDORS, INTERNAL, CATEGORIES)).toHaveLength(0)
  })

  it('deduplicates across documents, collecting every source name once', () => {
    const docs = [
      { name: 'one.docx', text: 'Payroll data is processed monthly. Payroll again.' },
      { name: 'two.csv', text: 'payroll;employee;amount' },
    ]
    const out = extractCandidates(docs, VENDORS, INTERNAL, CATEGORIES)
    expect(out).toHaveLength(1)
    expect(out[0]?.sourceNames).toEqual(['one.docx', 'two.csv'])
  })

  it('is empty for empty documents', () => {
    expect(extractCandidates([{ name: 'x.txt', text: '' }], VENDORS, INTERNAL, CATEGORIES)).toHaveLength(0)
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
    extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, DENIABLE, CATEGORIES)
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
      CATEGORIES,
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

  it('still denies when a contrastive word sits inside the denied clause', () => {
    // These are why the denial does not stop at "solo"/"only". Letting a contrastive close a
    // denial would recover one data category from "non riceve X, solo Y" and would let all five
    // of these onto the map, each of them a sentence saying the tracker is not used.
    expect(names('L’azienda non ha mai adottato, nemmeno soltanto in via sperimentale, Hotjar.')).toEqual([])
    expect(names('Non abbiamo attivato, solo per scrupolo lo ribadiamo, Hotjar.')).toEqual([])
    expect(names('We have never used, not even only for testing, Hotjar.')).toEqual([])
    expect(names('Non trattiamo dati esclusivamente automatizzati tramite Hotjar.')).toEqual([])
    expect(names('Senza consenso, e solo in tal caso, attiviamo Hotjar.')).toEqual([])
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
    const out = extractCandidates(docs, VENDORS, ACCENTED, CATEGORIES)
    expect(out.map((c) => c.name)).toEqual(['Accounting system'])
  })

  it('still refuses a term that is only part of a longer word', () => {
    const docs = [{ name: 'a.txt', text: 'contabilitàaziendale videosorveglianzaX' }]
    expect(extractCandidates(docs, VENDORS, ACCENTED, CATEGORIES)).toHaveLength(0)
  })

  it('treats an accented letter next to the term as part of a longer word', () => {
    // "è" is a letter, so "èvideosorveglianza" is one word and holds no term.
    const docs = [{ name: 'a.txt', text: 'èvideosorveglianza' }]
    expect(extractCandidates(docs, VENDORS, ACCENTED, CATEGORIES)).toHaveLength(0)
  })

  it('matches a term sitting against punctuation', () => {
    const docs = [{ name: 'a.txt', text: 'Impianti: videosorveglianza, badge.' }]
    const out = extractCandidates(docs, VENDORS, ACCENTED, CATEGORIES)
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
    extractCandidates([{ name: 'a.pdf', text }], VENDORS, MULTIWORD, CATEGORIES)
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
      CATEGORIES,
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
      CATEGORIES,
    )
    if (c === undefined) throw new Error('expected a candidate')
    expect(c.evidence).toContain('deposito')
  })
})

// What a document says about a system, not only that it names one. See §4.1 of
// docs/superpowers/specs/2026-08-03-extraction-depth-design.md. Attribution is the risk, and the
// containment is that a phrase must share a sentence with the term, and that whatever is read is
// shown next to the evidence the user ticks.
describe('retention read off the sentence', () => {
  const retentionFor = (text: string, name: string): string | undefined =>
    extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, CATEGORIES).find(
      (c) => c.name === name,
    )?.retention

  it('reads an Italian retention phrase', () => {
    expect(retentionFor('I dati in Salesforce sono conservati per 24 mesi.', 'Salesforce')).toBe(
      '24 months',
    )
  })

  it('reads an English retention phrase', () => {
    expect(retentionFor('Payroll records are kept for 30 days.', 'Payroll system')).toBe('30 days')
  })

  it('reads "per un periodo di 10 anni"', () => {
    expect(
      retentionFor('Salesforce li conserva per un periodo di 10 anni.', 'Salesforce'),
    ).toBe('10 years')
  })

  it('says one year rather than 1 years', () => {
    expect(retentionFor('Stripe keeps this for 1 year.', 'Stripe')).toBe('1 year')
  })

  it('does not reach across a sentence boundary', () => {
    // The phrase is real and the term is real and they have nothing to do with each other.
    expect(
      retentionFor('I log sono conservati per 24 mesi. Il CRM è Salesforce.', 'Salesforce'),
    ).toBeUndefined()
  })

  it('is undefined when the sentence says nothing about how long', () => {
    expect(retentionFor('Il CRM aziendale è Salesforce.', 'Salesforce')).toBeUndefined()
  })

  it('takes the first phrase when a sentence carries two', () => {
    // Two figures in one sentence is ambiguous by construction. The first is reported and the
    // user sees the sentence, which is the whole point of the confirm step.
    expect(
      retentionFor('Salesforce conserva i dati per 24 mesi, il backup per 90 giorni.', 'Salesforce'),
    ).toBe('24 months')
  })

  it('does not read a number that is not a duration', () => {
    expect(retentionFor('Salesforce gestisce 24 utenti.', 'Salesforce')).toBeUndefined()
  })
})

describe('jurisdiction read off the sentence', () => {
  const whereFor = (text: string, name: string): string | undefined =>
    extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, CATEGORIES).find(
      (c) => c.name === name,
    )?.jurisdiction

  it('reads an Italian placement phrase', () => {
    expect(whereFor('I server di Salesforce sono ubicati in Irlanda.', 'Salesforce')).toBe('Irlanda')
  })

  it('reads an English placement phrase', () => {
    expect(whereFor('Stripe data is hosted in Frankfurt.', 'Stripe')).toBe('Frankfurt')
  })

  it('reads a two-word country', () => {
    expect(whereFor('Salesforce archivia i dati negli Stati Uniti.', 'Salesforce')).toBe(
      'Stati Uniti',
    )
  })

  it('does not reach across a sentence boundary', () => {
    expect(
      whereFor('I server sono ubicati in Irlanda. Il CRM è Salesforce.', 'Salesforce'),
    ).toBeUndefined()
  })

  it('is undefined when the sentence says nothing about where', () => {
    expect(whereFor('Il CRM aziendale è Salesforce.', 'Salesforce')).toBeUndefined()
  })

  it('does not read a lowercase word after the preposition as a place', () => {
    // "conservati in modo sicuro" is about manner, not location. A place name is capitalised.
    expect(whereFor('I dati di Salesforce sono conservati in modo sicuro.', 'Salesforce')).toBeUndefined()
  })

  it('stops at the punctuation after the place name', () => {
    expect(
      whereFor('Salesforce, con server ubicati in Irlanda, tratta i dati.', 'Salesforce'),
    ).toBe('Irlanda')
  })
})

// The question a client asks first, and the model had nowhere to put the answer. See §4.7.
describe('categories of personal data', () => {
  const categoriesFor = (text: string, name: string): string[] | undefined =>
    extractCandidates([{ name: 'a.pdf', text }], VENDORS, INTERNAL, CATEGORIES).find(
      (c) => c.name === name,
    )?.dataCategories

  it('reads one category from the sentence that names the system', () => {
    expect(categoriesFor('Salesforce conserva il codice fiscale del cliente.', 'Salesforce')).toEqual([
      'Tax identifier',
    ])
  })

  it('reads several, in the order the sentence names them', () => {
    expect(
      categoriesFor('In Salesforce trattiamo nome, email e dati di navigazione.', 'Salesforce'),
    ).toEqual(['Name', 'Email address', 'Browsing data'])
  })

  it('lists a category once however many times the sentence says it', () => {
    expect(categoriesFor('Salesforce riceve email; l’email è obbligatoria.', 'Salesforce')).toEqual([
      'Email address',
    ])
  })

  it('does not reach across a sentence boundary', () => {
    expect(
      categoriesFor('Raccogliamo nome ed email. Il CRM è Salesforce.', 'Salesforce'),
    ).toBeUndefined()
  })

  it('is undefined rather than empty when the sentence names none', () => {
    expect(categoriesFor('Il CRM aziendale è Salesforce.', 'Salesforce')).toBeUndefined()
  })

  it('does not read a category the sentence denies', () => {
    // The denial governs the rest of its sentence, contrastive clause included, so this reads as
    // naming nothing rather than as naming the second category. Recovering "il nome" from after
    // the "solo" would cost the denial guard its reach and let ordinary denials -- "non ha mai
    // adottato, nemmeno soltanto in via sperimentale, X" -- through. §4.4 settles that trade:
    // one confident false positive costs more than ten honest blanks.
    expect(
      categoriesFor('Salesforce non riceve il codice fiscale, solo il nome.', 'Salesforce'),
    ).toBeUndefined()
  })
})

// A vendor is matched by its domain, and a domain is full of dots. The sentence a dot ends is the
// same sentence the attribute extractors read, so a dot inside "google-analytics.com" truncated
// every reading at the first label and made everything stated after the vendor's name invisible.
describe('attributes read around a vendor domain', () => {
  const vendorSays = (text: string) =>
    extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, CATEGORIES).find(
      (c) => c.name === 'Google Analytics',
    )

  const AFTER =
    'Il fornitore google-analytics.com conserva i dati per 24 mesi, ubicati in Irlanda, ' +
    'e riceve nome ed email.'

  it('reads a retention stated after the domain', () => {
    expect(vendorSays(AFTER)?.retention).toBe('24 months')
  })

  it('reads a jurisdiction stated after the domain', () => {
    expect(vendorSays(AFTER)?.jurisdiction).toBe('Irlanda')
  })

  it('reads data categories stated after the domain', () => {
    expect(vendorSays(AFTER)?.dataCategories).toEqual(['Name', 'Email address'])
  })

  it('still stops at a full stop, which a domain dot is not', () => {
    // The dot after "com" has a space behind it and ends the sentence as it always did; the dot
    // inside the domain has letters both sides and does not.
    expect(
      vendorSays('Usiamo google-analytics.com. I log sono conservati per 24 mesi.')?.retention,
    ).toBeUndefined()
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

  it('carries a retention read from the document onto the new place', () => {
    const p = ingestDocument(emptyProject(), [confirmed({ retention: '24 months' })])
    expect(p.places[0]?.retention).toBe('24 months')
  })

  it('fills a blank retention on an existing place without touching anything else', () => {
    let p = emptyProject()
    // The shared fixture carries a retention of its own; this case is about a place that has
    // none, which is what a scan leaves behind.
    p = addPlace(
      p,
      { ...place(), name: 'Payroll System', retention: undefined, confidence: 'observed' as const },
      'pl-1',
    )
    const out = ingestDocument(p, [confirmed({ retention: '24 months' })])
    expect(out.places).toHaveLength(1)
    expect(out.places[0]?.retention).toBe('24 months')
    expect(out.places[0]?.confidence).toBe('observed')
  })

  it('does not overwrite a retention the place already has', () => {
    let p = emptyProject()
    p = addPlace(p, { ...place(), name: 'Payroll System', retention: '10 years' }, 'pl-1')
    const out = ingestDocument(p, [confirmed({ retention: '24 months' })])
    expect(out.places[0]?.retention).toBe('10 years')
  })

  it('carries a jurisdiction onto the new place, where the detail panel already reads it', () => {
    const p = ingestDocument(emptyProject(), [confirmed({ jurisdiction: 'Irlanda' })])
    expect(p.places[0]?.jurisdiction).toBe('Irlanda')
  })

  it('fills a blank jurisdiction on an existing place', () => {
    // The shared fixture records no jurisdiction, which is what a scan leaves behind.
    let p = emptyProject()
    p = addPlace(p, { ...place(), name: 'Payroll System' }, 'pl-1')
    const out = ingestDocument(p, [confirmed({ jurisdiction: 'Irlanda' })])
    expect(out.places[0]?.jurisdiction).toBe('Irlanda')
  })

  it('fills blank data categories on an existing place', () => {
    let p = emptyProject()
    p = addPlace(p, { ...place(), name: 'Payroll System' }, 'pl-1')
    const out = ingestDocument(p, [confirmed({ dataCategories: ['Name'] })])
    expect(out.places[0]?.dataCategories).toEqual(['Name'])
  })

  it('does not overwrite data categories the place already has', () => {
    let p = emptyProject()
    p = addPlace(p, { ...place(), name: 'Payroll System', dataCategories: ['Name'] }, 'pl-1')
    const out = ingestDocument(p, [confirmed({ dataCategories: ['Email address'] })])
    expect(out.places[0]?.dataCategories).toEqual(['Name'])
  })

  it('carries data categories onto the new place', () => {
    const p = ingestDocument(emptyProject(), [confirmed({ dataCategories: ['Name', 'Email address'] })])
    expect(p.places[0]?.dataCategories).toEqual(['Name', 'Email address'])
  })

  it('does not overwrite a jurisdiction the place already has', () => {
    let p = emptyProject()
    p = addPlace(p, { ...place(), name: 'Payroll System', jurisdiction: 'Italia' }, 'pl-1')
    const out = ingestDocument(p, [confirmed({ jurisdiction: 'Irlanda' })])
    expect(out.places[0]?.jurisdiction).toBe('Italia')
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
    const out = extractCandidates(docs, VENDORS, TRACKING, CATEGORIES)
    expect(out.map((c) => c.name).sort()).toEqual(['Cookies', 'Hotjar', 'Meta Pixel'])
    expect(out.every((c) => c.layer === 'external')).toBe(true)
  })

  it('keeps the file name as the source and nothing of what the file said', () => {
    const docs = [{ name: 'policy.pdf', text: 'The site sets profiling cookies on first visit.' }]
    const [candidate] = extractCandidates(docs, VENDORS, TRACKING, CATEGORIES)
    if (candidate === undefined) throw new Error('expected a candidate')
    // The evidence exists while confirming -- it is what the user judges the suggestion on --
    // and must not survive into the project.
    expect(candidate.evidence).toContain('profiling cookies')
    const p = ingestDocument(emptyProject(), [candidate])
    expect(p.places[0]?.name).toBe('Cookies')
    expect(p.places[0]?.sources[0]?.locator).toBeUndefined()
  })
})
