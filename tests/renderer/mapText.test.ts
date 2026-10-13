import { describe, it, expect } from 'vitest'
import { computeLayout } from '../../src/core/layout'
import { drawnText, fontSizeOf, rowText } from '../../src/renderer/mapText'
import { MAP_TEXT } from '../../src/renderer/mapMetrics'
import { STRINGS } from '../../src/renderer/strings'
import { dorsaleMedium, dorsaleOversized, dorsaleSmall, dorsaleUgly, scanLike } from '../fixtures/dorsale'

const ugly = computeLayout(dorsaleUgly(), { openGroup: 'group:Marketing', openKind: 'form' })
const node = (id: string, l = ugly) => l.nodes.find((n) => n.id === id)!

describe('the words for a row', () => {
  it('names a folded row by its kind and how many it holds', () => {
    expect(rowText(node('doorGroup:form'))).toBe('Forms on 12 pages')
    const p = scanLike(['chat', 'chat', 'chat', 'embed', 'embed', 'embed', 'embed'])
    const l = computeLayout(p)
    expect(rowText(node('doorGroup:chat', l))).toBe('Chats (3)')
    expect(rowText(node('doorGroup:embed', l))).toBe('Embedded content (4)')
  })

  it('says Home page for a form on the site’s root, and the path for any other', () => {
    const p = scanLike(['form', 'form'])
    p.collectionPoints![0]!.page = 'https://example.test/'
    const l = computeLayout(p)
    expect(rowText(node('door:cp:cp-1', l))).toBe(STRINGS.homePage)
    expect(rowText(node('door:cp:cp-2', l))).toBe('/p2')
  })

  it('does not say Home page for a door that is not a form', () => {
    const p = scanLike([])
    p.places[0]!.name = '/'
    expect(rowText(node('door:place:pl-1', computeLayout(p)))).toBe('/')
  })

  it('speaks for the organisation when nothing has named it', () => {
    expect(rowText(node('controller', computeLayout(dorsaleSmall())))).toBe(STRINGS.yourOrganisation)
  })

  it('says how many more are behind a fold', () => {
    expect(rowText(node('moreDoors:form'))).toBe('+7 more')
    expect(rowText(node('more:group:Marketing'))).toBe('+7 more')
  })

  it('names a purpose by its name, and speaks for the three rows that have none', () => {
    expect(rowText(node('group:Marketing'))).toBe('Marketing')
    expect(rowText(node('unidentified'))).toBe(STRINGS.destination.unidentified)
    expect(rowText(node('others', computeLayout(dorsaleOversized())))).toBe(STRINGS.destination.others)
    const p = scanLike([])
    p.places.push({ id: 'pl-3', name: 'Archive', kind: 'internal', purposeGroup: 'Records', holder: 'you', leavesEEA: false, sources: [], confidence: 'declared' })
    expect(rowText(node('own', computeLayout(p)))).toBe(STRINGS.destination.own)
  })

  it('says nothing after a row’s name: what is not identified is counted once, in its own row', () => {
    // The wrong answer: "Marketing · 5 not yet identified", beside a row that counts the same five.
    for (const n of ugly.nodes) expect(drawnText(n)).not.toMatch(/not yet identified/)
    expect(node('unidentified').count).toBe(15)
  })

  it('sets sub-rows and people one size down, and nothing below the smallest', () => {
    expect(fontSizeOf(node('doorGroup:form'))).toBe(MAP_TEXT.row)
    expect(fontSizeOf(node('moreDoors:form'))).toBe(MAP_TEXT.sub)
    expect(fontSizeOf(node('scan1-sg-1'))).toBe(MAP_TEXT.sub)
    expect(fontSizeOf(node('controller'))).toBe(MAP_TEXT.row)
    for (const n of ugly.nodes) expect(fontSizeOf(n)).toBeGreaterThanOrEqual(MAP_TEXT.sub)
  })
})

describe('what is drawn fits its box', () => {
  it('shortens a 233-character path to its row, in the middle', () => {
    const l = computeLayout(dorsaleOversized(), { openKind: 'form' })
    const long = l.nodes.find((n) => n.kind === 'door' && n.label.length >= 233)!
    const text = drawnText(long)
    // A sub-row's box is 189 units wide and its type 12 units: 30 characters.
    expect(Array.from(text).length).toBe(30)
    expect(text).toContain('…')
    expect(text.startsWith('/a-very-long')).toBe(true)
    expect(text.endsWith('-a-very-')).toBe(true)
  })

  it('shortens a purpose’s name at the end, and leaves its count its room', () => {
    const p = dorsaleUgly()
    for (const pl of p.places) if (pl.purposeGroup === 'Marketing') pl.purposeGroup = 'Marketing and communication to customers and prospects'
    const row = computeLayout(p).nodes.find((n) => n.id.startsWith('group:Marketing and'))!
    const text = drawnText(row)
    expect(text.endsWith('…')).toBe(true)
    expect(text.startsWith('Marketing and')).toBe(true)
    // The label's box stops short of the count and the mark that says the card opens.
    expect(row.labelBox.x + row.labelBox.width).toBeLessThanOrEqual(row.box.x + row.box.width - 44)
  })

  it('leaves every label of the three real scans unshortened except the long addresses, cut in the middle', () => {
    for (const make of [dorsaleSmall, dorsaleMedium, dorsaleUgly]) {
      const p = make()
      for (const view of [{}, { openGroup: 'unidentified', openKind: 'form' as const }, { openGroup: 'group:Marketing' }]) {
        const shortened = computeLayout(p, view).nodes.filter((n) => drawnText(n) !== rowText(n))
        const address = (n: (typeof shortened)[number]) => (n.kind === 'door' && n.doorKind === 'form') || (n.kind === 'member' && n.mark === 'unidentified')
        expect(shortened.filter((n) => !address(n)).map((n) => rowText(n))).toEqual([])
        for (const n of shortened) expect(drawnText(n)).toMatch(/^[^…]+…[^…]+$/)
      }
    }
  })
})
