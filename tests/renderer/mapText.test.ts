import { describe, it, expect } from 'vitest'
import { computeLayout } from '../../src/core/layout'
import { drawnText, fontSizeOf, rowSuffix, rowText } from '../../src/renderer/mapText'
import { MAP_TEXT } from '../../src/renderer/mapMetrics'
import { STRINGS } from '../../src/renderer/strings'
import { dorsaleOversized, dorsaleSmall, dorsaleUgly, scanLike } from '../fixtures/dorsale'

const ugly = computeLayout(dorsaleUgly(), { openGroup: 'Marketing', openKind: 'form' })
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
    expect(rowText(node('more:Marketing'))).toBe('+12 more')
  })

  it('says after a group’s name how many of its places are not yet identified', () => {
    expect(rowSuffix(node('group:Marketing'))).toBe('5 not yet identified')
    expect(rowSuffix(node('group:Sales'))).toBe('')
  })

  it('does not say it twice on the group that is itself Not yet identified', () => {
    expect(node('group:Not yet identified').unexplained).toBe(4)
    expect(rowSuffix(node('group:Not yet identified'))).toBe('')
  })

  it('sets sub-rows and people one size down, and nothing below the smallest', () => {
    expect(fontSizeOf(node('doorGroup:form'))).toBe(MAP_TEXT.row)
    expect(fontSizeOf(node('moreDoors:form'))).toBe(MAP_TEXT.sub)
    expect(fontSizeOf(node('scan1-sg-1'))).toBe(MAP_TEXT.sub)
    for (const n of ugly.nodes) expect(fontSizeOf(n)).toBeGreaterThanOrEqual(MAP_TEXT.sub)
  })
})

describe('what is drawn fits its box', () => {
  it('shortens a 233-character path to its row, in the middle', () => {
    const l = computeLayout(dorsaleOversized(), { openKind: 'form' })
    const long = l.nodes.find((n) => n.kind === 'door' && n.label.length >= 233)!
    const { text } = drawnText(long)
    // A sub-row's box is 232 units wide and its type 12 units: 37 characters.
    expect(Array.from(text).length).toBeLessThanOrEqual(37)
    expect(text).toContain('…')
    expect(text.startsWith('/a-very-long')).toBe(true)
  })

  it('shortens a group’s name and keeps the count of what is not identified whole', () => {
    const p = dorsaleUgly()
    for (const pl of p.places) if (pl.purposeGroup === 'Marketing') pl.purposeGroup = 'Marketing and communication to customers and prospects'
    const l = computeLayout(p)
    const { text, suffix } = drawnText(l.nodes.find((n) => n.id.startsWith('group:Marketing and'))!)
    expect(suffix).toBe('5 not yet identified')
    expect(text.endsWith('…')).toBe(true)
    expect(Array.from(text).length + suffix.length + 3).toBeLessThanOrEqual(39)
  })

  it('leaves every label of the three real scans unshortened except the long addresses', () => {
    const shortened = ugly.nodes.filter((n) => drawnText(n).text !== rowText(n))
    expect(shortened.every((n) => n.kind === 'door' && n.doorKind === 'form')).toBe(true)
  })
})
