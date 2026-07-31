// tests/main/egressGuard.test.ts
import { describe, it, expect, vi } from 'vitest'
import { decideEgress, installEgressGuard } from '../../src/main/egressGuard'
import type { GuardableSession } from '../../src/main/egressGuard'

type Listener = (d: { url: string }, cb: (r: { cancel: boolean }) => void) => void

function fakeSession(): { session: GuardableSession; fire: (url: string) => { cancel: boolean } } {
  let listener: Listener | null = null
  const session: GuardableSession = {
    webRequest: { onBeforeRequest: (_f, l) => { listener = l as Listener } },
  }
  return {
    session,
    fire: (url) => {
      const cb = vi.fn()
      listener?.({ url }, cb)
      return cb.mock.calls[0]?.[0] as { cancel: boolean }
    },
  }
}

describe('decideEgress', () => {
  it('allows local app resources', () => {
    expect(decideEgress('file:///app/index.html', []).allow).toBe(true)
    expect(decideEgress('devtools://devtools/bundled/x.js', []).allow).toBe(true)
  })

  it('blocks a font CDN even though it looks harmless', () => {
    const d = decideEgress('https://fonts.googleapis.com/css2?family=Inter', [])
    expect(d.allow).toBe(false)
    expect(d.reason).toBe('Not a scan target: fonts.googleapis.com')
  })

  it('blocks any remote host when no scan is running', () => {
    expect(decideEgress('https://example.com/x.png', []).allow).toBe(false)
  })

  it('allows the scan target and its subdomains while a scan runs', () => {
    const origins = ['rossi-editore.it']
    expect(decideEgress('https://rossi-editore.it/', origins).allow).toBe(true)
    expect(decideEgress('https://www.rossi-editore.it/a.css', origins).allow).toBe(true)
  })

  it('still blocks third parties during a scan', () => {
    expect(decideEgress('https://tracker.example/px.gif', ['rossi-editore.it']).allow).toBe(false)
  })

  it('does not treat a lookalike host as the scan target', () => {
    expect(decideEgress('https://rossi-editore.it.evil.example/', ['rossi-editore.it']).allow).toBe(false)
  })

  it('blocks a malformed url rather than letting it through', () => {
    expect(decideEgress('not a url', ['rossi-editore.it']).allow).toBe(false)
  })
})

describe('installEgressGuard', () => {
  it('cancels a request the decision rejects', () => {
    const { session, fire } = fakeSession()
    installEgressGuard(session, () => [])
    expect(fire('https://fonts.googleapis.com/css2')).toEqual({ cancel: true })
  })

  it('lets a file url through', () => {
    const { session, fire } = fakeSession()
    installEgressGuard(session, () => [])
    expect(fire('file:///app/index.html')).toEqual({ cancel: false })
  })
})
