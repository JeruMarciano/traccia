// tests/main/noRemoteAssets.test.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe('no remote assets in source', () => {
  it('has no http(s) URL in code anywhere under src/', () => {
    const out = execSync('grep -rEn "https?://" src/ || true').toString().trim()
    const offenders = out
      .split('\n')
      .filter(Boolean)
      // Comments explaining the rule are allowed; code is not.
      .filter((line) => !/^\S+:\d+:\s*(\/\/|\*|\/\*)/.test(line))
    expect(offenders).toEqual([])
  })
})
