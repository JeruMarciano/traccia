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
    // The passage the match was found in outlives the document — it is the only answer to
    // "why is this on the map?" once the file is gone.
    expect(added?.sources).toEqual([
      { documentId: 'contract.pdf', documentName: 'contract.pdf', locator: 'the payroll run' },
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
      locator: 'the payroll run',
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

  it('carries the sentence through to the place, so the map can say why it is there', () => {
    const docs = [{ name: 'policy.pdf', text: 'The site sets profiling cookies on first visit.' }]
    const [candidate] = extractCandidates(docs, VENDORS, TRACKING)
    if (candidate === undefined) throw new Error('expected a candidate')
    const p = ingestDocument(emptyProject(), [candidate])
    expect(p.places[0]?.name).toBe('Cookies')
    expect(p.places[0]?.sources[0]?.locator).toContain('profiling cookies')
  })
})
