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
const VENDORS = join(__dirname, '../../src/data/vendors.json')

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

// The dictionary is inlined into the bundle as an object literal keyed by domain, in source
// order (Vite preserves the JSON's key order when it turns an `import x from './vendors.json'`
// into a JS object). Locating it precisely -- rather than scanning the whole file, which would
// also catch the allowlisted React/XML strings the file is *supposed* to carry -- means finding
// the byte range that runs from the first domain key to the closing brace right after the last
// entry's value, and scanning only that range. Returns null if the file does not contain the
// dictionary at all (most built files won't).
function findDictionaryRegion(text: string, firstDomain: string, lastDomain: string): string | null {
  const startMarker = `"${firstDomain}"`
  const start = text.indexOf(startMarker)
  if (start === -1) return null
  const lastKeyMarker = `"${lastDomain}"`
  const lastKeyIdx = text.indexOf(lastKeyMarker, start)
  if (lastKeyIdx === -1) return null
  // The last entry's value ends with its own closing brace, immediately followed by the
  // dictionary object's own closing brace: "}}" is exactly that boundary, and it is the first
  // "}}" after the last key because a single-object-valued entry (owner/category/purposeGroup,
  // no nested braces) cannot produce one earlier.
  const closeIdx = text.indexOf('}}', lastKeyIdx)
  if (closeIdx === -1) return null
  return text.slice(start, closeIdx + 2)
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

describe('the vendor dictionary ships in the bundle, and carries no URL', () => {
  const built = existsSync(DIST)
  const vendors: Record<string, { owner: string }> = JSON.parse(readFileSync(VENDORS, 'utf8'))

  it('source dictionary contains no http:// or https:// URL', () => {
    const raw = readFileSync(VENDORS, 'utf8')
    expect(raw).not.toMatch(/https?:\/\//)
  })

  it.skipIf(!built)('is present in the built bundle — a sample of its domains and owners appear verbatim', () => {
    const bundled = collect(DIST)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    // A sample rather than every entry: cheap to run, and any one of these missing means the
    // dictionary was not inlined the way the renderer expects.
    const sample = Object.entries(vendors).slice(0, 10)
    for (const [domain, entry] of sample) {
      expect(bundled).toContain(domain)
      expect(bundled).toContain(entry.owner)
    }
  })

  // The requirement is the *shipped* data, not the source file above -- a URL could in principle
  // be introduced by a build step even if src/data/vendors.json stays clean. This is the file's
  // existing convention: assert against dist/, not just the file that feeds it.
  it.skipIf(!built)('carries no http:// or https:// URL in the built bundle, scoped to the dictionary itself', () => {
    const domains = Object.keys(vendors)
    const firstDomain = domains[0]
    const lastDomain = domains[domains.length - 1]
    if (firstDomain === undefined || lastDomain === undefined) throw new Error('vendors.json is empty')

    let region: string | null = null
    for (const file of collect(DIST)) {
      region = findDictionaryRegion(readFileSync(file, 'utf8'), firstDomain, lastDomain)
      if (region !== null) break
    }
    // A null region means the dictionary was not found in any built file at all -- a failure of
    // this test's own method, not a pass. It must not be confused with "no URLs found".
    expect(region).not.toBeNull()
    // Sanity check: the extracted region should be within shouting distance of the compact
    // source JSON's length (built JS drops the quotes JSON needs around string values, so it is
    // reliably a little shorter, not equal) -- a mislocated or truncated region would be far
    // shorter still, and this catches that without being pinned to a specific bundler's output.
    expect((region as string).length).toBeGreaterThanOrEqual(JSON.stringify(vendors).length * 0.8)
    expect(region).not.toMatch(/https?:\/\//)
  })

  if (!built) {
    it.skip('skipped: dist/ does not exist — run `npm run build:vite` first', () => {})
  }
})
