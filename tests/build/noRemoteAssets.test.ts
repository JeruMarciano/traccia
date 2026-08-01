// tests/build/noRemoteAssets.test.ts
// §7.1: everything is bundled, nothing is fetched at runtime. A URL literal in source is the
// first symptom of that eroding, in either language. Comments explaining the rule are allowed;
// code is not.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

const ROOTS = ['src/', 'src-tauri/src/']

describe('no remote assets in source', () => {
  it.each(ROOTS)('has no http(s) URL in code anywhere under %s', (root) => {
    const out = execSync(`grep -rEn "https?://" ${root} || true`).toString().trim()
    const offenders = out
      .split('\n')
      .filter(Boolean)
      // A leading //, *, /* or # is a comment in TypeScript or in Rust.
      .filter((line) => !/^\S+:\d+:\s*(\/\/|\*|\/\*|#)/.test(line))
    expect(offenders).toEqual([])
  })
})
