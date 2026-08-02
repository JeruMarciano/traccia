// tests/build/noRemoteAssets.test.ts
// §7.1: everything is bundled, nothing is fetched at runtime. A URL literal in source is the
// first symptom of that eroding, in either language. Comments explaining the rule are allowed;
// code is not.
//
// Two literal classes are excluded from "remote asset", both narrowly, directed by the
// coordinator rather than loosened unilaterally:
//
//   - A URL whose host is exactly 127.0.0.1, localhost or [::1] is not remote: it names this
//     process's own loopback proxy — the thing that enforces the no-egress promise — or a
//     browser-launch flag pointing at it. The exemption is anchored on the character that
//     legitimately follows a host (':', '/', or end of the matched URL) so a lookalike host such
//     as 127.0.0.1.evil.example or localhost.evil.example is still caught: the character
//     following "127.0.0.1" or "localhost" there is '.', which the anchor rejects. A '@' anywhere
//     in the matched segment disqualifies the exemption outright, regardless of what precedes or
//     follows it: `http://127.0.0.1:80@evil.example/x.js` names host evil.example, with
//     "127.0.0.1:80" serving only as userinfo, and the anchor above cannot tell the two apart by
//     itself — a security audit found exactly this gap.
//   - Rust `#[cfg(test)]` modules under src-tauri/src/ are excluded: that code never ships in the
//     release binary, so a URL literal there cannot be fetched at runtime. This applies only to
//     Rust and only from each file's first line that is *exactly* `#[cfg(test)]` (anchored at
//     column 0, not a substring match) onwards — a substring match would let a doc comment or a
//     string that merely mentions `#[cfg(test)]` truncate the scan of real code beneath it, which
//     a security audit also found as a gap. TypeScript tests already live under tests/, outside
//     the scanned roots, so there is nothing equivalent to exempt there.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOTS = ['src/', 'src-tauri/src/']

// Anchors on the character that legitimately ends a host: a port separator, a path separator, or
// the end of the URL as grep's match captured it (which itself stopped at whitespace or a quote).
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/

// True for a grep "file:line:content" line that is a genuine remote-asset URL literal — the thing
// this test exists to forbid. Used both by the scan below and by the positive control, so the two
// cannot drift apart.
function isRemoteAssetLine(line: string): boolean {
  // A leading //, *, /* or # is a comment in TypeScript or in Rust.
  if (/^\S+:\d+:\s*(\/\/|\*|\/\*|#)/.test(line)) return false
  const matches = [...line.matchAll(/https?:\/\/([^\s"'`]*)/g)]
  if (matches.length === 0) return false
  // A line can carry more than one URL; a loopback address in one match must not exempt a remote
  // one in another. Every match must be loopback (or userinfo-suspect, which counts as remote) for
  // the line as a whole to be exempt.
  return matches.some((match) => {
    const host = match[1]
    if (host === undefined) return false
    // A '@' means whatever precedes it is userinfo, not the host — the real host is what follows,
    // and this function does not know what that is. Never exempt on the strength of a guess.
    if (host.includes('@')) return true
    return !LOOPBACK_HOST.test(host)
  })
}

function firstCfgTestLineNumber(filePath: string): number | null {
  const lines = readFileSync(filePath, 'utf8').split('\n')
  const idx = lines.findIndex((l) => /^#\[cfg\(test\)\]$/.test(l))
  return idx === -1 ? null : idx + 1 // grep's line numbers are 1-based
}

// Drops grep "file:line:content" entries that fall at or after their file's first #[cfg(test)],
// since that code is never in the release binary.
function dropRustTestModules(lines: string[]): string[] {
  const cutoffs = new Map<string, number | null>()
  return lines.filter((line) => {
    const m = line.match(/^([^:]+):(\d+):/)
    const file = m?.[1]
    const lineNoStr = m?.[2]
    if (file === undefined || lineNoStr === undefined) return true
    if (!cutoffs.has(file)) cutoffs.set(file, firstCfgTestLineNumber(file))
    const cutoff = cutoffs.get(file)
    if (cutoff == null) return true
    return Number(lineNoStr) < cutoff
  })
}

describe('no remote assets in source', () => {
  it.each(ROOTS)('has no http(s) URL in code anywhere under %s', (root) => {
    const out = execSync(`grep -rEn "https?://" ${root} || true`).toString().trim()
    const lines = out.split('\n').filter(Boolean)
    const scanned = root === 'src-tauri/src/' ? dropRustTestModules(lines) : lines
    const offenders = scanned.filter(isRemoteAssetLine)
    expect(offenders).toEqual([])
  })

  it('still rejects genuinely remote literals, including loopback lookalikes and userinfo tricks', () => {
    // A guard nobody has watched fail is a guard nobody can trust.
    for (const line of [
      'src/x.ts:1:const u = "https://cdn.example.com/x.js"',
      'src/x.ts:2:const u = "http://evil.example/"',
      'src/x.ts:3:const u = "https://127.0.0.1.evil.example/"',
      'src/x.ts:4:const u = "http://localhost.evil.example/"',
      'src/x.ts:5:const u = "http://127.0.0.1:80@evil.example/x.js"',
      'src/x.ts:6:const u = "http://localhost:8123@evil.example/x.js"',
      'src/x.ts:7:const u = "http://[::1]:1@evil.example/"',
      'src/x.ts:8:const a = "http://127.0.0.1:8123"; const b = "https://cdn.evil/x.js"',
      'src/x.ts:9:"http://127.0.0.1 https://cdn.evil/x.js"',
    ]) {
      expect(isRemoteAssetLine(line)).toBe(true)
    }
  })

  it('does not reject the loopback proxy address it exists to protect', () => {
    for (const line of [
      'src-tauri/src/browser.rs:1:let x = "http://127.0.0.1:8123";',
      'src/x.ts:1:const u = "http://localhost:8123/x"',
      'src/x.ts:2:const u = "http://[::1]:8123/x"',
    ]) {
      expect(isRemoteAssetLine(line)).toBe(false)
    }
  })

  it('does not truncate a Rust file at a mention of #[cfg(test)] inside a comment', () => {
    // The anchor must match only the exact module-opening line, not any line that happens to
    // contain the same text — otherwise a doc comment describing the rule would itself disable
    // the rule for everything beneath it.
    const dir = mkdtempSync(join(tmpdir(), 'noRemoteAssets-'))
    const file = join(dir, 'fixture.rs')
    writeFileSync(
      file,
      [
        '/// Only compiled under `#[cfg(test)]`.',
        'fn real_code() {',
        '    let u = "https://evil.example/x";',
        '}',
        '',
      ].join('\n'),
    )
    const lines = [`${file}:3:    let u = "https://evil.example/x";`]
    expect(dropRustTestModules(lines)).toEqual(lines)
  })

  it('does truncate a Rust file at its real #[cfg(test)] module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noRemoteAssets-'))
    const file = join(dir, 'fixture.rs')
    writeFileSync(
      file,
      [
        'fn real_code() {}',
        '#[cfg(test)]',
        'mod tests {',
        '    const U: &str = "https://evil.example/x";',
        '}',
        '',
      ].join('\n'),
    )
    const lines = [`${file}:4:    const U: &str = "https://evil.example/x";`]
    expect(dropRustTestModules(lines)).toEqual([])
  })
})
