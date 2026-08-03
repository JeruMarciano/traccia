import { describe, it, expect } from 'vitest'
import dictionary from '../../src/data/internalSystems.json'
import vendors from '../../src/data/vendors.json'
import { extractCandidates } from '../../src/core/documents'
import type { InternalSystemDictionary, VendorDictionary } from '../../src/core/types'

const dict = dictionary as InternalSystemDictionary
const V = vendors as VendorDictionary

// Closed, because `purposeGroup` is only a `string` in types.ts and the map groups by its exact
// value. A typo -- "Payroll & Hr" -- would pass any truthiness check and quietly draw two points
// where there is one thing.
const PURPOSE_GROUPS = new Set([
  'Payroll & HR',
  'Finance & Accounting',
  'Payments',
  'Sales & CRM',
  'Marketing',
  'Office & Email',
  'Communication',
  'Customer Support',
  'IT & Infrastructure',
  'Website tracking',
  'Facilities & Security',
])

/** What the shipped documents say, read straight out of a real Italian informativa. */
const found = (text: string): string[] =>
  extractCandidates([{ name: 'informativa.pdf', text }], V, dict)
    .map((c) => c.name)
    .sort()

describe('the shipped internal-systems dictionary', () => {
  it('gives every entry a name, a purpose group, a layer and a holder', () => {
    for (const [term, entry] of Object.entries(dict)) {
      expect(entry.name, term).toBeTruthy()
      expect(PURPOSE_GROUPS.has(entry.purposeGroup), `${term} → ${entry.purposeGroup}`).toBe(true)
      expect(['internal', 'external'], term).toContain(entry.layer)
      expect(['you', 'supplier'], term).toContain(entry.holder)
    }
  })

  it('keys every entry by a lowercase term, so matching is case-insensitive', () => {
    for (const term of Object.keys(dict)) {
      expect(term, term).toBe(term.toLowerCase())
    }
  })

  it('carries nothing that could be fetched at runtime', () => {
    expect(JSON.stringify(dict)).not.toMatch(/https?:\/\//)
  })
})

// Documents arrive in whatever language the client wrote them in, and for this tool that is
// usually Italian. The terms are Italian; the names they produce stay English, because the
// names are what the interface prints and the interface is English.
describe('reading an Italian document', () => {
  it('recognises tracking technologies named in Italian prose', () => {
    const text =
      'Il sito utilizza cookie tecnici e cookie di profilazione, oltre a pixel di ' +
      'tracciamento di terze parti. La gestione del consenso avviene tramite un banner cookie.'
    expect(found(text)).toEqual(['Consent management', 'Cookie banner', 'Cookies', 'Trackers'])
  })

  it('does not put on the map what the informativa says it does not do', () => {
    // The denial and the admission sit in the same paragraph, which is how these are written.
    const text =
      'Il sito non utilizza cookie di profilazione né strumenti di remarketing. ' +
      'Sono installati esclusivamente Google Analytics in forma anonimizzata e Iubenda ' +
      'per la gestione del consenso.'
    expect(found(text)).toEqual(['Consent management', 'Google Analytics', 'Iubenda'])
  })

  it('does not read a shipment-tracking clause as web tracking', () => {
    // "tracciamento" is ordinary Italian for tracking of any kind. Only the terms that mean
    // the web sense are in the dictionary, so a logistics sentence contributes nothing.
    expect(found('Il tracciamento delle spedizioni è affidato al corriere.')).toEqual([])
  })

  it('recognises internal operations named in Italian, including accented terms', () => {
    const text =
      'La contabilità e la fatturazione elettronica sono interne. Le buste paga sono ' +
      'elaborate mensilmente. È attiva la videosorveglianza con controllo accessi.'
    expect(found(text)).toEqual([
      'Access control',
      'Accounting system',
      'Invoicing',
      'Payroll system',
      'Video surveillance',
    ])
  })

  it('names an Italian term and its English equivalent as one thing, not two', () => {
    // A bilingual policy naming both must not put two "Video surveillance" points on the map.
    expect(found('CCTV, ovvero videosorveglianza, è installata all’ingresso.')).toEqual([
      'Video surveillance',
    ])
  })

  it('still reads an English document', () => {
    expect(found('We run payroll in Workday and keep accounting in Xero.')).toEqual([
      'Accounting system',
      'Payroll system',
      'Workday',
      'Xero',
    ])
  })
})
