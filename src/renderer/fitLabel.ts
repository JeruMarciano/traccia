/**
 * How much of a label fits a box. There is no text measurement without a DOM, and the map is drawn
 * without one, so width is estimated: a character of running sans-serif text is about 0.52 of its
 * font size wide. The figure is deliberately a little generous to the glyph, so text stays inside.
 */
const CHAR_WIDTH = 0.52

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function maxChars(width: number, fontSize: number): number {
  return Math.max(1, Math.floor(width / (fontSize * CHAR_WIDTH)))
}

/**
 * Shortens `text` to at most `max` characters, the ellipsis included. An address is cut in the
 * middle, since its start and its end are what tell it apart; a name is cut at the end.
 *
 * Counts grapheme clusters, so an emoji sequence (flag, family, variation selector) or an
 * accented pair is never cut in the middle.
 */
export function fitLabel(text: string, max: number, cut: 'middle' | 'end' = 'end'): string {
  const chars = Array.from(SEGMENTER.segment(text), (s) => s.segment)
  if (chars.length <= max) return text
  if (max <= 1) return '…'
  if (cut === 'end') return chars.slice(0, max - 1).join('') + '…'
  const tail = Math.floor((max - 1) / 2)
  return chars.slice(0, max - 1 - tail).join('') + '…' + chars.slice(chars.length - tail).join('')
}
