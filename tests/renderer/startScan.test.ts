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
})
