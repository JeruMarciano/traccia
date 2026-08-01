// Replaces tests/main/builtArtefactClean.test.ts. Its finding was that a dependency's binary
// downloader had been silently inlined into a shipped bundle and caught only by hand; the shape
// of the risk survives the port even though that particular dependency does not. What ships now
// is dist/ plus a Rust binary, and the property that must hold is the same one: nothing in the
// shipped artefact refers to a remote origin.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = join(__dirname, '../../dist')
const CONF = join(__dirname, '../../src-tauri/tauri.conf.json')

// Known-safe string literals baked in by dependencies, never fetched: React's production error
// decoder link, and XML/SVG/MathML namespace identifiers used as plain attribute values.
const ALLOWED_URL_PREFIXES = ['https://react.dev/errors/', 'http://www.w3.org/']

function collect(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collect(full))
    else if (statSync(full).isFile()) out.push(full)
  }
  return out
}

// Vite copies HTML comments through to dist/index.html verbatim, and index.html carries the
// comment explaining why the CSP lives in tauri.conf.json alone -- which has to name
// http://ipc.localhost to be worth reading. tests/build/noRemoteAssets.test.ts already draws this
// line for source: a comment explaining the rule is allowed, code is not. The same line is drawn
// here rather than allowlisting the IPC origin outright, so that the literal appearing in shipped
// *code* still fails.
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '')
}

function unallowedUrls(text: string): string[] {
  const matches = stripHtmlComments(text).match(/https?:\/\/[^\s"'`)]+/g) ?? []
  return matches.filter((url) => !ALLOWED_URL_PREFIXES.some((p) => url.startsWith(p)))
}

describe('shipped configuration', () => {
  const raw = readFileSync(CONF, 'utf8')
  const conf: Record<string, unknown> = JSON.parse(raw)

  it('declares no updater', () => {
    expect(raw).not.toContain('"updater"')
    expect(raw).not.toContain('createUpdaterArtifacts')
  })

  it('serves the app from the bundle, never from a remote origin', () => {
    const build = conf.build as Record<string, unknown>
    expect(build.frontendDist).toBe('../dist')
    // devUrl is localhost-only and never reaches a release build; assert it anyway.
    expect(String(build.devUrl)).toMatch(/^http:\/\/localhost:/)
  })

  it('keeps a content security policy that forbids everything but the bundle and the IPC channel', () => {
    const security = (conf.app as Record<string, unknown>).security as Record<string, unknown>
    const csp = String(security.csp)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    // connect-src may name the IPC channel and nothing else.
    const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src')) ?? ''
    expect(connect).toBe('connect-src ipc: http://ipc.localhost')
    expect(security.dangerousDisableAssetCspModification).toBe(false)
  })
})

describe('built renderer is clean', () => {
  const built = existsSync(DIST)

  it.skipIf(!built)('has no http(s) URL in any built asset outside the tiny allowlist', () => {
    const offenders: string[] = []
    for (const file of collect(DIST)) {
      const bad = unallowedUrls(readFileSync(file, 'utf8'))
      if (bad.length > 0) offenders.push(`${file}: ${bad.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  if (!built) {
    it.skip('skipped: dist/ does not exist — run `npm run build:vite` first', () => {})
  }
})
