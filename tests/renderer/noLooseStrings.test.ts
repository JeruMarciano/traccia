// Every user-facing string lives in src/renderer/strings.ts. This guard exists to stop that
// eroding, so it has to catch display text however a person or a formatter laid it out -- on one
// line, or wrapped across several. The cases below prove it fires on both, and that it stays quiet
// for the code that legitimately looks like text: attributes, type annotations, imports, comments,
// object keys.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { findLooseStrings } from './looseStrings'

function rendererComponents(): string[] {
  const found = execSync("find src/renderer -name '*.tsx'").toString().trim()
  return found === '' ? [] : found.split('\n')
}

describe('renderer strings', () => {
  it('has no display text outside strings.ts', () => {
    const files = rendererComponents()
    expect(files.length).toBeGreaterThan(0)

    const hits = files.flatMap((file) =>
      findLooseStrings(readFileSync(file, 'utf8')).map((h) => `${file}:${h.line}: ${h.text}`),
    )
    expect(hits).toEqual([])
  })
})

describe('findLooseStrings', () => {
  it('catches display text on one line', () => {
    const hits = findLooseStrings('export const A = () => <p>Hello there</p>\n')
    expect(hits).toEqual([{ line: 1, text: 'Hello there' }])
  })

  it('catches display text wrapped across lines', () => {
    const source = ['export const A = () => (', '  <p>', '    Hello there', '  </p>', ')', ''].join(
      '\n',
    )
    expect(findLooseStrings(source)).toEqual([{ line: 2, text: 'Hello there' }])
  })

  it('catches display text inside a nested element with attributes', () => {
    const source = [
      '<aside style={{ width: 280 }}>',
      '  <h2 title="heading">',
      '    Not yet identified',
      '  </h2>',
      '</aside>',
      '',
    ].join('\n')
    expect(findLooseStrings(source)).toEqual([{ line: 2, text: 'Not yet identified' }])
  })

  it('stays quiet for attribute values', () => {
    const source = [
      '<p role="status" aria-label="Nothing outstanding here" style={{ margin: 0 }}>',
      '  {STRINGS.registerEmpty}',
      '</p>',
      '',
    ].join('\n')
    expect(findLooseStrings(source)).toEqual([])
  })

  it('stays quiet for type annotations, imports and object keys', () => {
    const source = [
      "import { STRINGS } from './strings'",
      "import type { Project } from '../core/types'",
      '',
      'interface Props {',
      '  onSave(p: Project): Promise<Project | null>',
      '}',
      '',
      'const style = { textTransform: "uppercase", letterSpacing: ".12em" }',
      'const [notice, setNotice] = useState<string | null>(null)',
      'const later = new Map<string, Project>()',
      '',
    ].join('\n')
    expect(findLooseStrings(source)).toEqual([])
  })

  it('stays quiet for comments, including ones quoting JSX', () => {
    const source = [
      '// The register lists what nobody has answered yet.',
      '/* Once looked like <p>Hello there</p> and was moved into strings.ts. */',
      'const a = 1',
      '',
    ].join('\n')
    expect(findLooseStrings(source)).toEqual([])
  })

  it('stays quiet for handlers and expressions inside JSX', () => {
    const source = [
      '<button onClick={() => setNotice(null)} disabled={!canUndo(history)}>',
      '  {STRINGS.dismiss}',
      '</button>',
      '',
    ].join('\n')
    expect(findLooseStrings(source)).toEqual([])
  })
})
