// tests/main/builtArtefactClean.test.ts
//
// Security audit finding H1 (Task 13): the npm `electron` shim — a binary downloader that calls
// `spawnSync` on `install.js` — was once silently inlined into the shipped main/preload bundles.
// It was caught by hand. `tests/main/noRemoteAssets.test.ts` only greps `src/`, so it would never
// have caught this, and the fix (`ssr: { external: ['electron'] }` in electron.vite.config.ts)
// relies on an unsupported electron-vite/vite version combination that a lockfile refresh could
// silently break. This test inspects the actual built output in `out/` so a regression here fails
// loudly instead of shipping.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join(__dirname, '../../out')
const MAIN_FILE = join(OUT_DIR, 'main/index.js')
const PRELOAD_FILE = join(OUT_DIR, 'preload/index.cjs')

// Strings that must never appear in shipped code: they are the fingerprint of the npm `electron`
// package's postinstall binary downloader, not of the Electron runtime API surface.
const FORBIDDEN_TOKENS = ['spawnSync', 'child_process', 'install.js', '@electron/get', 'extract-zip']

// URL fragments that are known-safe string literals baked in by dependencies, never fetched:
// React's production error decoder link, and XML/SVG/MathML namespace identifiers used as plain
// attribute values.
const ALLOWED_URL_PREFIXES = [
  'https://react.dev/errors/',
  'http://www.w3.org/',
]

function collectBuiltFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectBuiltFiles(full))
    } else if (statSync(full).isFile()) {
      results.push(full)
    }
  }
  return results
}

function findUnallowedUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'`)]+/g) ?? []
  return matches.filter((url) => !ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix)))
}

describe('built artefact is clean (H1 regression guard)', () => {
  const outExists = existsSync(OUT_DIR)

  it.skipIf(!outExists)('main and preload bundles contain no electron-downloader tokens', () => {
    const mainText = readFileSync(MAIN_FILE, 'utf8')
    const preloadText = readFileSync(PRELOAD_FILE, 'utf8')
    for (const token of FORBIDDEN_TOKENS) {
      expect(mainText, `forbidden token "${token}" found in out/main/index.js`).not.toContain(token)
      expect(preloadText, `forbidden token "${token}" found in out/preload/index.cjs`).not.toContain(
        token
      )
    }
  })

  it.skipIf(!outExists)('electron is an external import/require, never inlined source', () => {
    const mainText = readFileSync(MAIN_FILE, 'utf8')
    const preloadText = readFileSync(PRELOAD_FILE, 'utf8')
    expect(/(?:from\s*["']electron["']|require\(["']electron["']\))/.test(mainText)).toBe(true)
    expect(/(?:from\s*["']electron["']|require\(["']electron["']\))/.test(preloadText)).toBe(true)
  })

  it.skipIf(!outExists)('no http(s) URL in any built asset outside the tiny allowlist', () => {
    const offenders: string[] = []
    for (const file of collectBuiltFiles(OUT_DIR)) {
      const text = readFileSync(file, 'utf8')
      const bad = findUnallowedUrls(text)
      if (bad.length > 0) offenders.push(`${file}: ${bad.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  if (!outExists) {
    it.skip('skipped: out/ does not exist — run `npm run build` first', () => {})
  }
})
