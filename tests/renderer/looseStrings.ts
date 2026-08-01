/**
 * Finds display text sitting directly in JSX instead of in `src/renderer/strings.ts`.
 *
 * A per-line grep cannot do this: a text node the formatter wrapped across three lines has no line
 * containing both the tag and the words. So the source is walked once, tracking where JSX children
 * begin and end, and each text node is examined as a whole however it was laid out.
 *
 * Only text between tags is examined, which is what keeps the check quiet for the code that looks
 * like prose: attribute values and object keys sit inside a tag or a brace, imports and type
 * annotations are never JSX children, and comments and string literals are skipped outright. A
 * generic (`useState<string | null>`) is told from a tag by the character before the `<`: a generic
 * is always written straight after an identifier, a JSX tag never is.
 */

export interface LooseString {
  /** 1-based line of the element carrying the text. */
  line: number
  /** The text with its whitespace collapsed, as it would read on screen. */
  text: string
}

/** Two or more words, the first capitalised: the shape of a sentence, not of an identifier. */
const DISPLAY_TEXT = /[A-Z][a-z]+\s+[a-z]/

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/
const TAG_NAME_START = /[A-Za-z]/

/** Index just past a string literal that starts at `i`. */
function skipString(src: string, i: number): number {
  const quote = src[i]
  let j = i + 1
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2
      continue
    }
    if (src[j] === quote) return j + 1
    j += 1
  }
  return j
}

/** Index just past a comment that starts at `i`. */
function skipComment(src: string, i: number): number {
  if (src[i + 1] === '/') {
    const end = src.indexOf('\n', i)
    return end === -1 ? src.length : end
  }
  const end = src.indexOf('*/', i + 2)
  return end === -1 ? src.length : end + 2
}

interface Tag {
  /** Index just past the tag's closing `>`. */
  end: number
  selfClosing: boolean
  closing: boolean
}

/**
 * Reads the tag starting at `i`. Attribute values are skipped as strings and braced expressions,
 * so a `>` inside `onClick={() => f()}` is not mistaken for the end of the tag.
 */
function readTag(src: string, i: number): Tag {
  const closing = src[i + 1] === '/'
  let depth = 0
  let lastMeaningful = ''
  let j = i + 1

  while (j < src.length) {
    const c = src[j] as string
    if (c === '"' || c === "'" || c === '`') {
      j = skipString(src, j)
      continue
    }
    if (c === '/' && (src[j + 1] === '/' || src[j + 1] === '*')) {
      j = skipComment(src, j)
      continue
    }
    if (c === '{') depth += 1
    if (c === '}') depth -= 1
    if (c === '>' && depth <= 0) {
      return { end: j + 1, selfClosing: lastMeaningful === '/', closing }
    }
    if (!/\s/.test(c)) lastMeaningful = c
    j += 1
  }

  return { end: j, selfClosing: true, closing }
}

/** Index of the next character that ends a JSX text node: a tag or an expression container. */
function endOfText(src: string, i: number): number {
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === '<' || src[j] === '{') return j
  }
  return src.length
}

function lineOf(src: string, index: number): number {
  let line = 1
  for (let j = 0; j < index; j += 1) {
    if (src[j] === '\n') line += 1
  }
  return line
}

export function findLooseStrings(source: string): LooseString[] {
  const hits: LooseString[] = []
  // How many elements are currently open. Text is only ever read inside one, so code that happens
  // to follow the last closing tag in a file is never examined.
  let openElements = 0
  let i = 0

  while (i < source.length) {
    const c = source[i] as string

    if (c === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      i = skipComment(source, i)
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(source, i)
      continue
    }
    if (c !== '<') {
      i += 1
      continue
    }

    const previous = i > 0 ? (source[i - 1] as string) : ''
    const next = source[i + 1] ?? ''
    const isTag = !IDENTIFIER_CHAR.test(previous) && (TAG_NAME_START.test(next) || next === '/' || next === '>')
    if (!isTag) {
      i += 1
      continue
    }

    const tagStart = i
    const tag = readTag(source, i)
    i = tag.end
    if (tag.closing) openElements -= 1
    else if (!tag.selfClosing) openElements += 1

    if (openElements <= 0) continue

    const stop = endOfText(source, i)
    const text = source.slice(i, stop).replace(/\s+/g, ' ').trim()
    if (DISPLAY_TEXT.test(text)) hits.push({ line: lineOf(source, tagStart), text })
    i = stop
  }

  return hits
}
