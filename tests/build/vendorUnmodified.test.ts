// The autoconsent engine and its rules ship unmodified: each vendored file's sha256 must equal the
// one SOURCE.md records from the npm tarball. An edit to either file, however small, fails here.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, '../../src-tauri/vendor/autoconsent')
const SOURCE = readFileSync(join(DIR, 'SOURCE.md'), 'utf8')

describe('the vendored autoconsent', () => {
  it('matches the sha256 SOURCE.md records for the engine and the rules', () => {
    for (const file of ['autoconsent.playwright.js', 'compact-rules.json']) {
      const row = SOURCE.split('\n').find((l) => l.startsWith(`| \`${file}\``))
      const recorded = row?.match(/`([0-9a-f]{64})`/)?.[1]
      const actual = createHash('sha256').update(readFileSync(join(DIR, file))).digest('hex')
      expect(recorded, file).toBeDefined()
      expect(actual, file).toBe(recorded)
    }
  })
})
