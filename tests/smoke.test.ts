// tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs typescript under vitest', () => {
    const n: number = 1 + 1
    expect(n).toBe(2)
  })
})
