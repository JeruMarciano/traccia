import { describe, it, expect } from 'vitest'
import { fitLabel, maxChars } from '../../src/renderer/fitLabel'
import { MAP_MIN_WIDTH, MAP_TEXT, SCREEN_FLOOR_PX } from '../../src/renderer/mapMetrics'

describe('fitLabel', () => {
  it('leaves a label that fits alone', () => {
    expect(fitLabel('/contatti/', 34, 'middle')).toBe('/contatti/')
  })

  it('cuts the middle of an address, keeping its start and its end', () => {
    const path = '/prodotti/kit-2x-lattine-5-litri-olio-extravergine-oliva-classico-biologico/'
    const out = fitLabel(path, 34, 'middle')
    expect(Array.from(out)).toHaveLength(34)
    expect(out.startsWith('/prodotti/kit-2x')).toBe(true)
    expect(out.endsWith('classico-biologico/'.slice(-16))).toBe(true)
    expect(out).toContain('…')
  })

  it('cuts the end of a name', () => {
    expect(fitLabel('Associazione Sportiva Dilettantistica Esempio', 12)).toBe('Associazion…')
  })

  it('reads two addresses alike when only their middles differ: the declared limit', () => {
    const a = '/prodotti/olio-extravergine-AAAAAAAAAAAAAAAAAAAAAA-lattina-5-litri/'
    const b = '/prodotti/olio-extravergine-BBBBBBBBBBBBBBBBBBBBBB-lattina-5-litri/'
    expect(fitLabel(a, 34, 'middle')).toBe(fitLabel(b, 34, 'middle'))
  })

  it('never cuts a character in half', () => {
    // The wrong answer: slicing by UTF-16 unit leaves half of the cup, drawn as a broken glyph.
    const out = fitLabel('/caffè-☕️-menu-degustazione-della-casa-2026/', 12, 'middle')
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    expect(fitLabel('😀😀😀😀😀😀', 4)).toBe('😀😀😀…')
  })

  it('never cuts inside an accented pair, a flag, a family or a variation sequence', () => {
    const seg = (s: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment)
    const e = 'é'
    const flag = '🇮🇹'
    const family = '👨‍👩‍👧'
    for (const max of [2, 3, 4, 5]) {
      for (const cut of ['end', 'middle'] as const) {
        const outE = fitLabel(e.repeat(10), max, cut)
        expect(seg(outE.replace('…', '')).every((g) => g === e)).toBe(true)
        const outF = fitLabel(flag.repeat(5), max, cut)
        expect(seg(outF.replace('…', '')).every((g) => g === flag)).toBe(true)
        const outM = fitLabel(family.repeat(5), max, cut)
        expect(outM.startsWith('‍') || outM.endsWith('‍')).toBe(false)
        expect(seg(outM.replace('…', '')).every((g) => g === family)).toBe(true)
      }
    }
    // the cup is the last kept character: it keeps its variation selector
    expect(fitLabel('☕️abc', 2)).toBe('☕️…')
  })

  it('answers with the ellipsis alone when there is room for nothing else', () => {
    expect(fitLabel('anything', 1)).toBe('…')
    expect(fitLabel('anything', 0)).toBe('…')
  })

  it('fits about 35 characters of a door label in its row', () => {
    expect(maxChars(238, MAP_TEXT.row)).toBeGreaterThanOrEqual(34)
    expect(maxChars(238, MAP_TEXT.row)).toBeLessThanOrEqual(36)
    expect(maxChars(3, MAP_TEXT.row)).toBe(1)
  })
})

describe('the floor under the map’s text', () => {
  it('keeps the smallest text at 9 px or more at the sheet’s narrowest', () => {
    // The sheet is 1000 units wide; drawn MAP_MIN_WIDTH px wide, a unit is MAP_MIN_WIDTH / 1000 px.
    const smallest = Math.min(...Object.values(MAP_TEXT))
    expect((smallest * MAP_MIN_WIDTH) / 1000).toBeGreaterThanOrEqual(SCREEN_FLOOR_PX)
  })
})
