// startScan is the boundary where Rust's ScanOutput becomes core's ScanResult. Rust checks what
// protects the machine; isScanResult here checks what protects the map — including possibleGaps
// and stoppedEarly, which earlier discarded silently and must not any more.
import { describe, it, expect, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

describe('startScan', () => {
  it('carries possibleGaps and stoppedEarly through to the caller', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        scannedHost: 'rossi-editore.it',
        hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
        pagesVisited: 1,
        possibleGaps: 2,
        stoppedEarly: true,
        cookies: [],
        formFields: [],
        storageKeys: [],
        consentMarkers: [],
        capturedAtEpochSeconds: 0,
      }),
    )
    const result = await startScan('https://rossi-editore.it')
    expect(result.possibleGaps).toBe(2)
    expect(result.stoppedEarly).toBe(true)
  })

  it('rejects a payload missing possibleGaps or stoppedEarly rather than passing it through', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        scannedHost: 'rossi-editore.it',
        hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
        pagesVisited: 1,
      }),
    )
    await expect(startScan('https://rossi-editore.it')).rejects.toThrow()
  })

  // A well-formed payload, otherwise. Each test below corrupts exactly one element of one of the
  // five arrays isScanResult now requires, to prove the per-element shape check actually runs
  // rather than the array merely being present.
  function validPayload(): Record<string, unknown> {
    return {
      scannedHost: 'rossi-editore.it',
      hosts: [{ host: 'rossi-editore.it', requestCount: 1 }],
      pagesVisited: 1,
      possibleGaps: 0,
      stoppedEarly: false,
      cookies: [],
      formFields: [],
      storageKeys: [],
      consentMarkers: [],
      capturedAtEpochSeconds: 0,
    }
  }

  it('rejects a host whose phase is neither before nor after', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        ...validPayload(),
        hosts: [{ host: 'rossi-editore.it', requestCount: 1, phase: 'during' }],
      }),
    )
    await expect(startScan('https://rossi-editore.it')).rejects.toThrow()
  })

  it('rejects a cookie whose phase is neither before nor after', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        ...validPayload(),
        cookies: [{ name: '_ga', domain: 'rossi-editore.it', session: true, expiresEpochSeconds: -1, phase: 'during' }],
      }),
    )
    await expect(startScan('https://rossi-editore.it')).rejects.toThrow()
  })

  it('rejects a payload whose cookie element has the wrong shape', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        ...validPayload(),
        cookies: [{ name: 1, domain: 'rossi-editore.it', session: true, expiresEpochSeconds: -1 }],
      }),
    )
    await expect(startScan('https://rossi-editore.it')).rejects.toThrow()
  })

  it('rejects a payload whose form field element has the wrong shape', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        ...validPayload(),
        formFields: [{ page: 'https://rossi-editore.it/', name: 'email', type: 'text', autocomplete: 'email', label: 1 }],
      }),
    )
    await expect(startScan('https://rossi-editore.it')).rejects.toThrow()
  })

  // Since Task 6 Rust sends `consent` and no `consentMarkers`; a v0.3 payload has only the latter.
  const consent = {
    cmp: 'iubenda',
    clicked: true,
    rule: 'cmp',
    ruleName: 'iubenda',
    matchedText: '',
    clickNavigated: false,
  }

  it('accepts a payload with consent and no consentMarkers, and a v0.3 one with consentMarkers only', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    const { consentMarkers: _, ...current } = validPayload()
    invoke.mockResolvedValueOnce(JSON.stringify({ ...current, consent }))
    expect((await startScan('https://rossi-editore.it')).consent?.ruleName).toBe('iubenda')
    invoke.mockResolvedValueOnce(JSON.stringify({ ...validPayload(), consentMarkers: ['OneTrust'] }))
    expect((await startScan('https://rossi-editore.it')).consentMarkers).toEqual(['OneTrust'])
  })

  it('rejects a consent whose rule is neither cmp nor text', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    invoke.mockResolvedValueOnce(JSON.stringify({ ...validPayload(), consent: { ...consent, rule: 'magic' } }))
    await expect(startScan('https://rossi-editore.it')).rejects.toThrow()
  })

  it('rejects a consent whose names fall outside the rule-name shape, or whose matched text is over 128', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    for (const bad of [
      { cmp: 'iubenda<script>' },
      { ruleName: 'x'.repeat(65) },
      { ruleName: 'a\u202eb' },
      { matchedText: 'x'.repeat(129) },
    ]) {
      invoke.mockResolvedValueOnce(JSON.stringify({ ...validPayload(), consent: { ...consent, ...bad } }))
      await expect(startScan('https://rossi-editore.it'), JSON.stringify(bad)).rejects.toThrow()
    }
    invoke.mockResolvedValueOnce(
      JSON.stringify({ ...validPayload(), consent: { ...consent, cmp: null, matchedText: 'x'.repeat(128) } }),
    )
    await expect(startScan('https://rossi-editore.it')).resolves.toBeDefined()
  })

  it('accepts a generated rule name with a +, as rules.json ships it', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    const name = 'auto_AU_acetool.com_n0w_+1'
    invoke.mockResolvedValueOnce(
      JSON.stringify({ ...validPayload(), consent: { ...consent, cmp: name, ruleName: name } }),
    )
    expect((await startScan('https://rossi-editore.it')).consent?.cmp).toBe(name)
  })

  it('rejects a payload whose storage key element has the wrong shape', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    invoke.mockResolvedValueOnce(
      JSON.stringify({
        ...validPayload(),
        storageKeys: [{ scope: 'not-a-scope', key: 'token', bytes: 12 }],
      }),
    )
    await expect(startScan('https://rossi-editore.it')).rejects.toThrow()
  })

  it('accepts a valid pages list and rejects malformed, overlong or too many entries', async () => {
    const { startScan } = await import('../../src/renderer/bridge')
    const ok = { page: 'https://rossi-editore.it/contatti', purpose: 'contacts' }
    const attempt = (pages: unknown) => {
      invoke.mockResolvedValueOnce(JSON.stringify({ ...validPayload(), pages }))
      return startScan('https://rossi-editore.it')
    }
    await expect(attempt([ok, { page: 'https://rossi-editore.it/x', purpose: null }])).resolves.toBeTruthy()
    await expect(attempt([{ ...ok, purpose: 'spying' }])).rejects.toThrow()
    await expect(attempt([{ ...ok, page: 'https://x.it/' + 'a'.repeat(2048) }])).rejects.toThrow()
    await expect(attempt([{ ...ok, page: 'javascript:alert(1)' }])).rejects.toThrow()
    await expect(attempt(Array(13).fill(ok))).rejects.toThrow()
  })
})
