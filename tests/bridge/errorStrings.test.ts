// The user-facing sentences now live in two languages. src/renderer/strings.ts is the single
// source for display text (Global Constraints), and the Rust side must not drift from it — a
// drift would show the generic save message where the actionable one belongs, silently, and only
// on the failure path nobody exercises by hand.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STRINGS } from '../../src/renderer/strings'

function rustLiteral(file: string, name: string): string {
  const source = readFileSync(join(__dirname, '../../src-tauri/src', file), 'utf8')
  const match = source.match(new RegExp(`${name}\\s*:\\s*&str\\s*=\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  if (match === null || match[1] === undefined) {
    throw new Error(`could not find a &str literal named ${name} in ${file}`)
  }
  return match[1]
}

describe('Rust and TypeScript agree on every sentence the user can see', () => {
  it('pins the actionable save message', () => {
    expect(rustLiteral('project_file.rs', 'SAVE_BLOCKED_BY_LOCK')).toBe(STRINGS.saveBlocked)
  })

  it('pins the generic save message', () => {
    expect(rustLiteral('commands.rs', 'SAVE_FAILED')).toBe(STRINGS.saveFailed)
  })

  it('pins the open message', () => {
    expect(rustLiteral('commands.rs', 'OPEN_FAILED')).toBe(STRINGS.openFailed)
  })
})
