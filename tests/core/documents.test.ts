// Document ingestion, the pure half: text in, candidates out, confirmed candidates folded
// into the project. See src/core/documents.ts.
import { describe, it, expect } from 'vitest'
import { extractCandidates, ingestDocument } from '../../src/core/documents'
import { ingestScan } from '../../src/core/scan'
import { emptyProject, place } from '../fixtures/projects'
import { addPlace } from '../../src/core/graph'
import type {
  Candidate,
  DataCategoryDictionary,
  InternalSystemDictionary,
  PlaceCandidate,
  SubjectGroupCandidate,
  SubjectGroupDictionary,
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

const SUBJECTS: SubjectGroupDictionary = {
  clienti: { name: 'Customers' },
  dipendenti: { name: 'Employees' },
  minori: { name: 'Children' },
  fornitori: { name: 'Suppliers' },
  'utenti del sito': { name: 'Website visitors' },
}

const CATEGORIES: DataCategoryDictionary = {
  email: { name: 'Email address' },
  'dati di navigazione': { name: 'Browsing data' },
  'codice fiscale': { name: 'Tax identifier' },
  nome: { name: 'Name' },
}

/** A candidate is a place or a group of people; most of these cases are about the places. */
const placesOnly = (cs: Candidate[]): PlaceCandidate[] =>
  cs.filter((c): c is PlaceCandidate => c.sort === 'place')

describe('extractCandidates', () => {
  it('finds an internal system by term, case-insensitively, with evidence around the match', () => {
    const docs = [{ name: 'contract.pdf', text: 'The monthly PAYROLL run is outsourced.' }]
    const out = placesOnly(extractCandidates(docs, VENDORS, INTERNAL, SUBJECTS, CATEGORIES))
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
    expect(extractCandidates(docs, VENDORS, INTERNAL, SUBJECTS, CATEGORIES)).toHaveLength(0)
  })

  it('finds a vendor by domain and names it exactly as a scan would', () => {
    const docs = [{ name: 'invoice.pdf', text: 'Billed for www.google-analytics.com usage.' }]
    const out = placesOnly(extractCandidates(docs, VENDORS, INTERNAL, SUBJECTS, CATEGORIES))
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('Google Analytics')
    expect(out[0]?.layer).toBe('external')
    expect(out[0]?.purposeGroup).toBe('Marketing')
  })

  it('ignores a domain the vendor dictionary does not know', () => {
    const docs = [{ name: 'a.txt', text: 'see internal-wiki.example for details' }]
    expect(extractCandidates(docs, VENDORS, INTERNAL, SUBJECTS, CATEGORIES)).toHaveLength(0)
  })

  it('deduplicates across documents, collecting every source name once', () => {
    const docs = [
      { name: 'one.docx', text: 'Payroll data is processed monthly. Payroll again.' },
      { name: 'two.csv', text: 'payroll;employee;amount' },
    ]
    const out = extractCandidates(docs, VENDORS, INTERNAL, SUBJECTS, CATEGORIES)
    expect(out).toHaveLength(1)
    expect(out[0]?.sourceNames).toEqual(['one.docx', 'two.csv'])
  })

  it('finds a term in a later document even when an earlier one matched it first', () => {
    // Every term pattern is compiled once for the whole call and carries the global flag, so it
    // owns a lastIndex. `matchAll` iterates a clone and leaves the shared pattern at zero -- but
    // a loop that advanced it and then stopped at the first usable match would carry that offset
    // into the next document, and the term would silently vanish from every later file. Document
    // one is long and names the term near its end, so the offset reached there lands well past
    // the end of document two: under such a bug two.pdf reads as never having said the word.
    const docs = [
      {
        name: 'one.pdf',
        text: `${'Filler prose about nothing in particular. '.repeat(20)}Salesforce is the CRM.`,
      },
      { name: 'two.pdf', text: 'Salesforce holds the customer records.' },
    ]
    const out = extractCandidates(docs, VENDORS, INTERNAL, SUBJECTS, CATEGORIES)
    expect(out.map((c) => c.name)).toEqual(['Salesforce'])
    expect(out[0]?.sourceNames).toEqual(['one.pdf', 'two.pdf'])
  })

  it('is empty for empty documents', () => {
    expect(extractCandidates([{ name: 'x.txt', text: '' }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES)).toHaveLength(0)
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
    extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, DENIABLE, SUBJECTS, CATEGORIES)
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
      SUBJECTS,
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
    const out = extractCandidates(docs, VENDORS, ACCENTED, SUBJECTS, CATEGORIES)
    expect(out.map((c) => c.name)).toEqual(['Accounting system'])
  })

  it('still refuses a term that is only part of a longer word', () => {
    const docs = [{ name: 'a.txt', text: 'contabilitàaziendale videosorveglianzaX' }]
    expect(extractCandidates(docs, VENDORS, ACCENTED, SUBJECTS, CATEGORIES)).toHaveLength(0)
  })

  it('treats an accented letter next to the term as part of a longer word', () => {
    // "è" is a letter, so "èvideosorveglianza" is one word and holds no term.
    const docs = [{ name: 'a.txt', text: 'èvideosorveglianza' }]
    expect(extractCandidates(docs, VENDORS, ACCENTED, SUBJECTS, CATEGORIES)).toHaveLength(0)
  })

  it('matches a term sitting against punctuation', () => {
    const docs = [{ name: 'a.txt', text: 'Impianti: videosorveglianza, badge.' }]
    const out = extractCandidates(docs, VENDORS, ACCENTED, SUBJECTS, CATEGORIES)
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
    extractCandidates([{ name: 'a.pdf', text }], VENDORS, MULTIWORD, SUBJECTS, CATEGORIES)
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
      SUBJECTS,
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
      SUBJECTS,
      CATEGORIES,
    )
    if (c === undefined) throw new Error('expected a candidate')
    expect(c.evidence).toContain('deposito')
  })
})

// A PDF wraps at the column, so a paragraph arrives with newlines inside it. Ending a statement
// at every newline chopped ordinary prose into fragments and handed each attribute extractor half
// a clause. A single newline mid-paragraph is a soft wrap and reads as whitespace; a blank line
// and a list marker still end the statement, because both really do start a new claim.
describe('a line wrapped by the page is not a new statement', () => {
  const saysOf = (text: string, name: string) =>
    placesOnly(
      extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES),
    ).find((c) => c.name === name)

  it('reads a retention phrase across a soft wrap', () => {
    expect(saysOf('I dati in Salesforce sono conservati\nper 24 mesi.', 'Salesforce')?.retention).toBe(
      '24 months',
    )
  })

  it('reads a jurisdiction phrase across a soft wrap', () => {
    expect(
      saysOf('I server di Salesforce sono ubicati\nin Irlanda.', 'Salesforce')?.jurisdiction,
    ).toBe('Irlanda')
  })

  it('reads a data category across a soft wrap', () => {
    expect(
      saysOf('Salesforce raccoglie i dati di navigazione\ndegli utenti e il nome.', 'Salesforce')
        ?.dataCategories,
    ).toEqual(['Browsing data', 'Name'])
  })

  it('does not read any of the three across a blank line', () => {
    const says = (tail: string) => saysOf(`Il CRM è Salesforce\n\n${tail}`, 'Salesforce')
    expect(says('I dati sono conservati per 24 mesi.')?.retention).toBeUndefined()
    expect(says('I server sono ubicati in Irlanda.')?.jurisdiction).toBeUndefined()
    expect(says('Trattiamo il nome del cliente.')?.dataCategories).toBeUndefined()
  })

  it('does not read any of the three across a bullet', () => {
    const says = (tail: string) => saysOf(`Il CRM è Salesforce\n• ${tail}`, 'Salesforce')
    expect(says('dati conservati per 24 mesi')?.retention).toBeUndefined()
    expect(says('server ubicati in Irlanda')?.jurisdiction).toBeUndefined()
    expect(says('trattiamo il nome del cliente')?.dataCategories).toBeUndefined()
  })

  it('does not read across a numbered or lettered list marker', () => {
    expect(
      saysOf('Il CRM è Salesforce\n2. I dati sono conservati per 24 mesi.', 'Salesforce')?.retention,
    ).toBeUndefined()
    expect(
      saysOf('Il CRM è Salesforce\nb) I dati sono conservati per 24 mesi.', 'Salesforce')?.retention,
    ).toBeUndefined()
  })

  it('does not read across a dash used as a list marker', () => {
    expect(
      saysOf('Il CRM è Salesforce\n- I dati sono conservati per 24 mesi.', 'Salesforce')?.retention,
    ).toBeUndefined()
  })
})

// Joining a soft wrap makes statements longer, and the denial guard is scoped by the statement.
// The reach cap is what keeps that from turning into a denial that swallows the rest of a
// paragraph. See §4.4.
describe('a denial across a wrapped line', () => {
  const DENIABLE: InternalSystemDictionary = {
    hotjar: { name: 'Hotjar', purposeGroup: 'Marketing', layer: 'external', holder: 'supplier' },
    matomo: { name: 'Matomo', purposeGroup: 'Marketing', layer: 'external', holder: 'supplier' },
  }
  const names = (text: string): string[] =>
    extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, DENIABLE, SUBJECTS, CATEGORIES)
      .map((c) => c.name)
      .sort()

  it('denies a term the wrap separated from its negation', () => {
    expect(names('Il sito non utilizza\nHotjar per le mappe di calore.')).toEqual([])
  })

  it('still stops at the reach cap when the wrap joined the two clauses', () => {
    // The negation governs the retention clause. Joining the wrap puts it in the same statement as
    // the vendor named at the end, and only the 60-character cap keeps it off.
    expect(
      names(
        'Non conserviamo i dati oltre i ventiquattro mesi previsti dal contratto\n' +
          'quadro sottoscritto con il fornitore, e per le statistiche il sito usa Matomo.',
      ),
    ).toEqual(['Matomo'])
  })
})

// What a document says about a system, not only that it names one. See §4.1 of
// docs/superpowers/specs/2026-08-03-extraction-depth-design.md. Attribution is the risk, and the
// containment is that a phrase must share a sentence with the term, and that whatever is read is
// shown next to the evidence the user ticks.
describe('retention read off the sentence', () => {
  const retentionFor = (text: string, name: string): string | undefined =>
    placesOnly(
      extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES),
    ).find((c) => c.name === name)?.retention

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

  it('takes the figure nearest the term, not the first in the sentence', () => {
    // Two retentions in one sentence, each with its own subject. Reporting the first gave the CRM
    // the ten years the accounting records are kept for.
    expect(
      retentionFor(
        'I dati contabili sono conservati per 10 anni come previsto dalla normativa fiscale, ' +
          'mentre i dati raccolti tramite Salesforce sono conservati per 24 mesi.',
        'Salesforce',
      ),
    ).toBe('24 months')
  })

  it('takes a figure stated before the term over a decoy after it', () => {
    expect(
      retentionFor(
        'I dati di Salesforce sono conservati per 24 mesi, mentre i log di sistema restano ' +
          'archiviati per 10 anni.',
        'Salesforce',
      ),
    ).toBe('24 months')
  })

  it('measures the distance inside the sentence, not from the start of the document', () => {
    expect(
      retentionFor(
        'Questa informativa descrive i trattamenti svolti dal titolare. ' +
          'I dati di Salesforce sono conservati per 24 mesi, mentre i log di sistema restano ' +
          'archiviati per 10 anni.',
        'Salesforce',
      ),
    ).toBe('24 months')
  })
})

describe('jurisdiction read off the sentence', () => {
  const whereFor = (text: string, name: string): string | undefined =>
    placesOnly(
      extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES),
    ).find((c) => c.name === name)?.jurisdiction

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

  it('takes the placement nearest the term, not the first in the sentence', () => {
    // A sentence that places two things names two countries. Reporting the first one is a
    // confident wrong answer, which §4.1 rates worse than a blank.
    expect(
      whereFor('I log sono conservati in Irlanda, mentre Stripe archivia i dati negli Stati Uniti.', 'Stripe'),
    ).toBe('Stati Uniti')
  })

  it('takes a placement stated before the term over a decoy after it', () => {
    expect(
      whereFor('I dati di Stripe sono conservati in Irlanda, mentre le buste paga restano archiviate in Italia.', 'Stripe'),
    ).toBe('Irlanda')
  })

  it('measures the distance inside the sentence, not from the start of the document', () => {
    // The term's offset is a document offset and the phrases are matched inside a slice of it.
    // Comparing the two unconverted puts the term past the end of its own sentence, and the last
    // phrase in the sentence always looks nearest.
    expect(
      whereFor(
        'Questa informativa descrive i trattamenti svolti dal titolare. ' +
          'I dati di Stripe sono conservati in Irlanda, mentre le buste paga restano archiviate in Italia.',
        'Stripe',
      ),
    ).toBe('Irlanda')
  })
})

// The reviewer's sentence: two placements, and the nearer one belongs to the term. See §4.1.
describe('two things placed in one sentence', () => {
  const STORAGE: InternalSystemDictionary = {
    backup: { name: 'Backup', purposeGroup: 'IT & Infrastructure', layer: 'internal', holder: 'you' },
  }

  it('gives the backup the datacenter it is actually kept in', () => {
    const out = placesOnly(
      extractCandidates(
        [
          {
            name: 'informativa.pdf',
            text:
              'I server sono ubicati in Irlanda e i backup sono conservati presso datacenter ' +
              'situati in Italia.',
          },
        ],
        VENDORS,
        STORAGE,
        SUBJECTS,
        CATEGORIES,
      ),
    )
    expect(out.find((c) => c.name === 'Backup')?.jurisdiction).toBe('Italia')
  })
})

// The question a client asks first, and the model had nowhere to put the answer. See §4.7.
describe('categories of personal data', () => {
  const categoriesFor = (text: string, name: string): string[] | undefined =>
    placesOnly(
      extractCandidates([{ name: 'a.pdf', text }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES),
    ).find((c) => c.name === name)?.dataCategories

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

// A sentence in an informativa lists several purposes at once, each with its own system, and the
// whole sentence as the scope gave every one of them every category in it. The clause the term
// sits in is the scope; a list of categories is not a list of clauses. See §4.7.
describe('categories are read from the term’s own clause', () => {
  const categoriesFor = (text: string, name: string): string[] | undefined =>
    placesOnly(
      extractCandidates([{ name: 'a.pdf', text }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES),
    ).find((c) => c.name === name)?.dataCategories

  const PURPOSES =
    'I dati sono trattati per la gestione del payroll, per l’invio della newsletter tramite ' +
    'Stripe e per le statistiche raccolte da google-analytics.com, che tratta i dati di navigazione.'

  it('gives the category to the system whose clause names it', () => {
    expect(categoriesFor(PURPOSES, 'Google Analytics')).toEqual(['Browsing data'])
  })

  it('does not give it to the other systems the sentence lists', () => {
    expect(categoriesFor(PURPOSES, 'Payroll system')).toBeUndefined()
    expect(categoriesFor(PURPOSES, 'Stripe')).toBeUndefined()
  })

  it('still reads a whole list of categories attached to one term', () => {
    // Commas separate clauses and they also separate the items of a list. A run that names a
    // category and says almost nothing else is the second kind and stays with the clause before it.
    expect(categoriesFor('Salesforce tratta nome, codice fiscale ed email.', 'Salesforce')).toEqual([
      'Name',
      'Tax identifier',
      'Email address',
    ])
  })

  it('does not read across a contrast between two systems', () => {
    const text = 'Il payroll gestisce le presenze, mentre Salesforce riceve il codice fiscale.'
    expect(categoriesFor(text, 'Payroll system')).toBeUndefined()
    expect(categoriesFor(text, 'Salesforce')).toEqual(['Tax identifier'])
  })

  it('does not read a short second clause back into the first across "mentre"', () => {
    // "mentre" sets two subjects against each other, so what follows it is a claim of its own
    // however briefly it is written -- otherwise a clause light enough to look like more of a list
    // hands the second system's data to the first.
    const text = 'Salesforce tratta il nome, mentre il payroll anche il codice fiscale.'
    expect(categoriesFor(text, 'Salesforce')).toEqual(['Name'])
    expect(categoriesFor(text, 'Payroll system')).toEqual(['Tax identifier'])
  })

  it('measures the term’s offset inside its sentence, not from the start of the document', () => {
    const text =
      'Questa informativa descrive i trattamenti svolti dal titolare. ' +
      'Il payroll gestisce le presenze, mentre Salesforce riceve il codice fiscale.'
    expect(categoriesFor(text, 'Payroll system')).toBeUndefined()
  })

  it('is undefined rather than widening back out when the term’s clause names none', () => {
    expect(
      categoriesFor('Il payroll è interno, mentre il CRM riceve nome ed email.', 'Payroll system'),
    ).toBeUndefined()
  })
})

describe('one category term written inside another', () => {
  // "indirizzo" sits inside "indirizzo email" and inside "indirizzo IP", and the dictionary keeps
  // all three. Without a precedence rule a sentence naming an email address also asserts a postal
  // address the document never claimed -- and a category is confirmed as a bundle, with no
  // per-category tick, so the falsehood is written into the saved project.
  const OVERLAPPING: DataCategoryDictionary = {
    indirizzo: { name: 'Postal address' },
    'indirizzo email': { name: 'Email address' },
    'indirizzo ip': { name: 'Browsing data' },
  }

  const cats = (text: string): string[] | undefined =>
    placesOnly(
      extractCandidates([{ name: 'a.pdf', text }], VENDORS, INTERNAL, SUBJECTS, OVERLAPPING),
    ).find((c) => c.name === 'Salesforce')?.dataCategories

  it('reads the longer term and not the shorter one it contains', () => {
    expect(cats('Salesforce riceve il vostro indirizzo email.')).toEqual(['Email address'])
    expect(cats('Salesforce conserva l’indirizzo IP per 30 giorni.')).toEqual(['Browsing data'])
  })

  it('still reads the shorter term where it stands on its own', () => {
    expect(cats('Salesforce conserva l’indirizzo di fatturazione.')).toEqual(['Postal address'])
  })

  it('reads both when the sentence writes the shorter term somewhere else too', () => {
    expect(cats('Salesforce riceve l’indirizzo email e l’indirizzo di fatturazione.')).toEqual([
      'Email address',
      'Postal address',
    ])
  })
})

// A vendor is matched by its domain, and a domain is full of dots. The sentence a dot ends is the
// same sentence the attribute extractors read, so a dot inside "google-analytics.com" truncated
// every reading at the first label and made everything stated after the vendor's name invisible.
describe('attributes read around a vendor domain', () => {
  const vendorSays = (text: string) =>
    placesOnly(
      extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES),
    ).find((c) => c.name === 'Google Analytics')

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

// Whose data this is. Today the only group that can exist is the one a scan seeds; an informativa
// lists four of them in its second paragraph. See §4.2 of the extraction-depth spec.
describe('subject groups named in a document', () => {
  const subjects = (text: string): string[] =>
    extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES)
      .filter((c) => c.sort === 'subjectGroup')
      .map((c) => c.name)
      .sort()

  it('finds the groups an informativa lists', () => {
    expect(subjects('Trattiamo i dati di clienti, dipendenti e utenti del sito.')).toEqual([
      'Customers',
      'Employees',
      'Website visitors',
    ])
  })

  it('names them in English however the document wrote them', () => {
    expect(subjects('We process data about clienti.')).toEqual(['Customers'])
  })

  it('offers a group and a place from the same document without confusing them', () => {
    const out = extractCandidates(
      [{ name: 'a.pdf', text: 'I dati dei dipendenti sono elaborati in Salesforce.' }],
      VENDORS,
      INTERNAL,
      SUBJECTS,
      CATEGORIES,
    )
    expect(out.filter((c) => c.sort === 'subjectGroup').map((c) => c.name)).toEqual(['Employees'])
    expect(out.filter((c) => c.sort === 'place').map((c) => c.name)).toEqual(['Salesforce'])
  })

  it('is not offered when the sentence denies it', () => {
    expect(subjects('Non trattiamo dati di minori.')).toEqual([])
  })

  it('carries the sentence as evidence, like a place does', () => {
    const [c] = extractCandidates(
      [{ name: 'a.pdf', text: 'Il titolare tratta i dati dei dipendenti assunti.' }],
      VENDORS,
      INTERNAL,
      SUBJECTS,
      CATEGORIES,
    )
    if (c === undefined) throw new Error('expected a candidate')
    expect(c.evidence).toContain('dipendenti')
  })

  it('deduplicates a group named in two documents, keeping both sources', () => {
    const out = extractCandidates(
      [
        { name: 'one.pdf', text: 'clienti e fornitori' },
        { name: 'two.pdf', text: 'i clienti del sito' },
      ],
      VENDORS,
      INTERNAL,
      SUBJECTS,
      CATEGORIES,
    )
    const customers = out.find((c) => c.name === 'Customers')
    expect(customers?.sourceNames).toEqual(['one.pdf', 'two.pdf'])
  })

  it('keeps a place and a group of the same name apart', () => {
    // The dedup key carries the sort, so a supplier called "Fornitori" and the people called
    // "Suppliers" would not collide even where the two dictionaries agree on a word.
    const SAME: InternalSystemDictionary = {
      clienti: {
        name: 'Customers',
        purposeGroup: 'Sales & CRM',
        layer: 'internal',
        holder: 'you',
      },
    }
    const out = extractCandidates(
      [{ name: 'a.pdf', text: 'Trattiamo i dati dei clienti.' }],
      VENDORS,
      SAME,
      SUBJECTS,
      CATEGORIES,
    )
    expect(out.map((c) => `${c.sort}:${c.name}`).sort()).toEqual([
      'place:Customers',
      'subjectGroup:Customers',
    ])
  })
})

// An informativa names the controller in a near-fixed position, and it is the one organisation on
// the map that is not a supplier. See §4.3 of the extraction-depth spec.
describe('the controller and the processor, by name', () => {
  const rolePlaces = (text: string): PlaceCandidate[] =>
    placesOnly(extractCandidates([{ name: 'informativa.pdf', text }], VENDORS, INTERNAL, SUBJECTS, CATEGORIES))
      .filter((c) => c.purposeGroup === 'Running the systems')

  const roles = (text: string): Array<{ name: string; holder: string }> =>
    rolePlaces(text).map((c) => ({ name: c.name, holder: c.holder }))

  it('names the controller from an Italian informativa', () => {
    expect(roles('Titolare del trattamento è Rossi Editore S.r.l., con sede in Milano.')).toEqual([
      { name: 'Rossi Editore S.r.l.', holder: 'you' },
    ])
  })

  it('names the controller when it is introduced with a colon', () => {
    expect(roles('Titolare del trattamento: Bianchi S.p.A.')).toEqual([
      { name: 'Bianchi S.p.A.', holder: 'you' },
    ])
  })

  it('names the controller in English', () => {
    // "Ltd." loses its dot: the dot is the full stop of the sentence as much as it is the
    // abbreviation's, and the two cannot be told apart after a multi-letter token. See the
    // amendment note under Task 5 in the plan.
    expect(roles('The data controller is Acme Ltd.')).toEqual([{ name: 'Acme Ltd', holder: 'you' }])
  })

  it('keeps the dot of a company suffix and drops the one that ends the sentence', () => {
    // "S.r.l." ends in a dot that belongs to the name; "Editore." does not. The single letter
    // before the dot is what separates them.
    expect(roles('Titolare del trattamento è Rossi S.r.l.')).toEqual([
      { name: 'Rossi S.r.l.', holder: 'you' },
    ])
    expect(roles('Titolare del trattamento è Rossi Editore.')).toEqual([
      { name: 'Rossi Editore', holder: 'you' },
    ])
  })

  it('marks a named processor as a supplier rather than as the organisation', () => {
    expect(roles('Responsabile del trattamento è Cloud Servizi S.r.l.')).toEqual([
      { name: 'Cloud Servizi S.r.l.', holder: 'supplier' },
    ])
  })

  it('stops at the comma after the name', () => {
    expect(
      roles('Il Titolare del trattamento è Verdi e Figli S.n.c., in persona del legale rappresentante.'),
    ).toEqual([{ name: 'Verdi e Figli S.n.c.', holder: 'you' }])
  })

  it('does not read bare "titolare" as the role', () => {
    // Ordinary Italian for the owner or holder of anything: the account holder is not the
    // controller, and reading him as one puts a stranger at the centre of the map.
    expect(roles('Il titolare del conto corrente è Mario Rossi.')).toEqual([])
    expect(roles('Il titolare è Mario Rossi.')).toEqual([])
  })

  it('does not swallow the rest of a title-case sentence', () => {
    const [first] = roles('Titolare del trattamento è Rossi Editore Group Holding Italia Spa Roma')
    expect(first?.name).toBe('Rossi Editore Group Holding Italia')
  })

  it('offers nothing when the phrase introduces the topic rather than a name', () => {
    // "il titolare del trattamento adotta misure" is prose about the role, not a name.
    expect(roles('Il titolare del trattamento adotta misure di sicurezza adeguate.')).toEqual([])
  })

  it('is not offered when the sentence denies it', () => {
    expect(roles('Non è stato nominato un responsabile del trattamento esterno.')).toEqual([])
    // The case that needs the guard rather than the separator rule: a name is right there,
    // introduced the way a named one would be.
    expect(
      roles('Non abbiamo nominato responsabile del trattamento: Cloud Servizi S.r.l.'),
    ).toEqual([])
  })

  it('puts the controller in the inner ring and a named processor outside it', () => {
    const [controller] = rolePlaces('Titolare del trattamento è Rossi Editore S.r.l.')
    expect(controller?.layer).toBe('internal')
    expect(controller?.kind).toBe('internal')
    const [processor] = rolePlaces('Responsabile del trattamento è Cloud Servizi S.r.l.')
    expect(processor?.layer).toBe('external')
    expect(processor?.kind).toBe('processor')
  })

  it('stops the name where its sentence stops', () => {
    // A name ending in "S.r.l." runs straight into the next sentence, because the dot that ends
    // the sentence is also the dot the company suffix is allowed to keep. Every other extractor
    // in the module is bounded by the sentence; this one has to be too.
    expect(
      roles('Titolare del trattamento è Acme S.r.l. I Dati Personali sono raccolti online.'),
    ).toEqual([{ name: 'Acme S.r.l.', holder: 'you' }])
    expect(
      roles('Titolare del trattamento è Acme S.r.l. Via Roma 12, 20100 Milano (MI).'),
    ).toEqual([{ name: 'Acme S.r.l.', holder: 'you' }])
  })

  it('reads the controller and the processor separately when they follow one another', () => {
    expect(
      roles(
        'Titolare del trattamento è Acme S.r.l. Responsabile del trattamento è Cloud Servizi S.r.l.',
      ),
    ).toEqual([
      { name: 'Acme S.r.l.', holder: 'you' },
      { name: 'Cloud Servizi S.r.l.', holder: 'supplier' },
    ])
  })

  it('reads a heading-and-value layout, and never puts a line break inside a name', () => {
    const text = 'Titolare del trattamento\nAcme S.r.l.\nVia Roma 12'
    expect(roles(text)).toEqual([{ name: 'Acme S.r.l.', holder: 'you' }])
  })

  it('reads past a bare heading to the sentence below, rather than naming the article', () => {
    // The bare phrase as a heading is followed by a line break, which is a separator, and the
    // capitalised token after it is the article that opens the sentence. "Il" is not an
    // organisation, and stopping there loses the one the document actually names.
    expect(
      roles('Titolare del trattamento\nIl titolare del trattamento è Offdigit S.r.l.'),
    ).toEqual([{ name: 'Offdigit S.r.l.', holder: 'you' }])
  })

  it('offers nothing rather than an article when the heading is the only occurrence', () => {
    expect(
      roles('RESPONSABILE DEL TRATTAMENTO\nLa società Nuvola Informatica S.r.l. tratta i dati.'),
    ).toEqual([])
    expect(roles('Titolare del trattamento\nvedi la sezione precedente.')).toEqual([])
  })

  it('keeps a name that begins with an article', () => {
    // The rejection is for a capture that is nothing but an article. "La Rinascente S.p.A." is a
    // company, and a rule broad enough to strip its first word would rename it.
    expect(roles('Titolare del trattamento è La Rinascente S.p.A.')).toEqual([
      { name: 'La Rinascente S.p.A.', holder: 'you' },
    ])
  })

  it('reads past an all-caps heading to the sentence that names the organisation', () => {
    // Capitalisation cannot tell a name from prose inside an all-caps run, and the phrase is
    // matched case-insensitively precisely because a heading is printed that way. A heading has
    // no connector after it, so it yields nothing and the sentence below is reached.
    expect(
      roles(
        'TITOLARE DEL TRATTAMENTO E RESPONSABILE DELLA PROTEZIONE DEI DATI\n\n' +
          'Il Titolare del trattamento è Rossi Editore S.r.l.',
      ),
    ).toEqual([{ name: 'Rossi Editore S.r.l.', holder: 'you' }])
    expect(
      roles('DATA CONTROLLER AND CONTACT DETAILS\nThe data controller is Acme Ltd.'),
    ).toEqual([{ name: 'Acme Ltd', holder: 'you' }])
  })

  it('does not read a name that follows the phrase with neither connector nor line break', () => {
    expect(roles('Titolare del trattamento Acme S.r.l.')).toEqual([])
  })

  it('drops a joiner left dangling at the end of the name', () => {
    expect(roles('Titolare del trattamento è Acme e successivamente il gruppo')).toEqual([
      { name: 'Acme', holder: 'you' },
    ])
  })
})

describe('confirming a subject group', () => {
  const group = (over: Partial<SubjectGroupCandidate> = {}): SubjectGroupCandidate => ({
    sort: 'subjectGroup',
    id: 'customers',
    name: 'Customers',
    evidence: 'i clienti',
    sourceNames: ['informativa.pdf'],
    ...over,
  })

  it('adds it to the project as a subject group, not as a place', () => {
    const p = ingestDocument(emptyProject(), [group()])
    expect(p.subjectGroups.map((s) => s.name)).toEqual(['Customers'])
    expect(p.places).toHaveLength(0)
  })

  it('merges into the group a scan already seeded rather than duplicating it', () => {
    // ingestScan seeds "Website visitors"; a document naming "utenti del sito" is the same people.
    const seeded = ingestScan(
      emptyProject(),
      {
        scannedHost: 'rossi-editore.it',
        hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
        pagesVisited: 1,
        possibleGaps: 0,
        stoppedEarly: false,
      },
      {},
      { prefix: 'scan1' },
    )
    const out = ingestDocument(seeded, [
      group({ id: 'website-visitors', name: 'Website visitors' }),
    ])
    expect(out.subjectGroups).toHaveLength(1)
    expect(out.subjectGroups[0]?.id).toBe(seeded.subjectGroups[0]?.id)
  })

  it('is not duplicated by a scan that runs after the document', () => {
    // The other order. The spelling in subjectGroups.json has to match the one ingestScan seeds
    // exactly, or the same people appear twice on the map.
    const fromDoc = ingestDocument(emptyProject(), [
      group({ id: 'website-visitors', name: 'Website visitors' }),
    ])
    const out = ingestScan(
      fromDoc,
      {
        scannedHost: 'rossi-editore.it',
        hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
        pagesVisited: 1,
        possibleGaps: 0,
        stoppedEarly: false,
      },
      {},
      { prefix: 'scan1' },
    )
    expect(out.subjectGroups.map((s) => s.name)).toEqual(['Website visitors'])
  })

  it('merges a group whose name differs only in case', () => {
    // Two dictionaries and a scan write the same people three ways; the map must hold one point.
    const seeded = { ...emptyProject(), subjectGroups: [{ id: 'scan1-sg-1', name: 'Website visitors' }] }
    const out = ingestDocument(seeded, [group({ name: 'WEBSITE VISITORS' })])
    expect(out.subjectGroups).toEqual([{ id: 'scan1-sg-1', name: 'Website visitors' }])
  })

  it('does not add the same group twice from two confirmations', () => {
    const once = ingestDocument(emptyProject(), [group()])
    const twice = ingestDocument(once, [group()])
    expect(twice.subjectGroups).toHaveLength(1)
  })

  it('does not collide with a place id', () => {
    const p = ingestDocument(emptyProject(), [
      group(),
      {
        sort: 'place' as const,
        id: 'payroll-system',
        name: 'Payroll system',
        layer: 'internal' as const,
        purposeGroup: 'Payroll & HR',
        holder: 'you' as const,
        kind: 'internal' as const,
        evidence: 'payroll',
        sourceNames: ['a.pdf'],
      },
    ])
    const ids = [...p.places.map((x) => x.id), ...p.subjectGroups.map((x) => x.id)]
    expect(new Set(ids).size).toBe(ids.length)
    // Not merely distinct: a group is numbered in its own series, so the two cannot run into
    // each other as a project accumulates documents.
    expect(p.places[0]?.id).toBe('doc-pl-1')
    expect(p.subjectGroups[0]?.id).toBe('doc-sg-1')
  })

  it('numbers a second group past the one an earlier document left', () => {
    const first = ingestDocument(emptyProject(), [group()])
    const second = ingestDocument(first, [group({ id: 'employees', name: 'Employees' })])
    expect(second.subjectGroups.map((s) => s.id)).toEqual(['doc-sg-1', 'doc-sg-2'])
  })

  it('does not reuse an id a scan already assigned', () => {
    const seeded = { ...emptyProject(), subjectGroups: [{ id: 'doc-sg-1', name: 'Website visitors' }] }
    const out = ingestDocument(seeded, [group()])
    expect(out.subjectGroups.map((s) => s.id)).toEqual(['doc-sg-1', 'doc-sg-2'])
  })
})

function confirmed(over: Partial<PlaceCandidate>): Candidate {
  return {
    sort: 'place',
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
    const out = placesOnly(extractCandidates(docs, VENDORS, TRACKING, SUBJECTS, CATEGORIES))
    expect(out.map((c) => c.name).sort()).toEqual(['Cookies', 'Hotjar', 'Meta Pixel'])
    expect(out.every((c) => c.layer === 'external')).toBe(true)
  })

  it('keeps the file name as the source and nothing of what the file said', () => {
    const docs = [{ name: 'policy.pdf', text: 'The site sets profiling cookies on first visit.' }]
    const [candidate] = extractCandidates(docs, VENDORS, TRACKING, SUBJECTS, CATEGORIES)
    if (candidate === undefined) throw new Error('expected a candidate')
    // The evidence exists while confirming -- it is what the user judges the suggestion on --
    // and must not survive into the project.
    expect(candidate.evidence).toContain('profiling cookies')
    const p = ingestDocument(emptyProject(), [candidate])
    expect(p.places[0]?.name).toBe('Cookies')
    expect(p.places[0]?.sources[0]?.locator).toBeUndefined()
  })
})
