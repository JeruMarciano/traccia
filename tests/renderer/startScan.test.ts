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
})
