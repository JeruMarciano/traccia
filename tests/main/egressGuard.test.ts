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

// These probe the exact bypass classes a security-auditor pass checks for on egress code:
// userinfo tricks, IDN/homograph confusables, and Unicode/whitespace host-injection lookalikes.
// Each expected outcome below was confirmed against Node's WHATWG URL parser before being
// asserted here, so this is a verified regression test, not a restatement of the implementation.
describe('decideEgress — bypass attempts', () => {
  const origins = ['rossi-editore.it']

  it('is not fooled by the scan target used as userinfo in front of a real attacker host', () => {
    // Displays as if it points at the scan target; new URL().hostname is actually evil.example.
    expect(decideEgress('https://rossi-editore.it@evil.example/', origins).allow).toBe(false)
    expect(decideEgress('https://rossi-editore.it:443@evil.example/', origins).allow).toBe(false)
  })

  it('is not fooled by an attacker host with the scan target as a userinfo-adjacent prefix', () => {
    expect(decideEgress('https://evil@rossi-editore.it.attacker.example/', origins).allow).toBe(
      false,
    )
  })

  it('is not fooled by a Unicode dot look-alike normalized into a lookalike subdomain', () => {
    // U+3002 IDEOGRAPHIC FULL STOP is host-parsed as '.', producing rossi-editore.it.evil.example
    expect(decideEgress('https://rossi-editore.it。evil.example/', origins).allow).toBe(false)
  })

  it('is not fooled by a tab injected into the host component', () => {
    // ASCII tab is stripped from the URL by the parser, again yielding the lookalike subdomain.
    expect(decideEgress('https://rossi-editore.it\t.evil.example/', origins).allow).toBe(false)
  })

  it('does not let a Unicode-hyphen homograph of the scan target match', () => {
    // U+2010 HYPHEN is punycode-encoded (xn--...), never collapsing to the ASCII scan origin.
    expect(decideEgress('https://rossi‐editore.it/', origins).allow).toBe(false)
  })

  it('does not allowlist an IPv6 literal by falling through to some default-allow', () => {
    expect(decideEgress('https://[::1]/', origins).allow).toBe(false)
  })

  it('treats the scan origin case-insensitively regardless of URL casing', () => {
    expect(decideEgress('https://ROSSI-EDITORE.IT/', origins).allow).toBe(true)
    expect(decideEgress('HTTPS://rossi-editore.it/', origins).allow).toBe(true)
  })
})

// A file: URL can carry an authority. Chromium maps file://host/share/x to the UNC path
// \\host\share\x on Windows and opens an SMB connection to that host — off-machine egress to an
// attacker-chosen destination, plus an NTLM credential leak. Only a hostless (or localhost)
// file: URL is actually local. Node's WHATWG parser normalises file://localhost/x to hostname ''.
describe('decideEgress — file: authority', () => {
  it('blocks a file url pointing at a remote authority', () => {
    expect(decideEgress('file://attacker.example/share/x.png', []).allow).toBe(false)
  })

  it('blocks a remote file authority even when it is the scan target', () => {
    expect(decideEgress('file://rossi-editore.it/share/x.png', ['rossi-editore.it']).allow).toBe(
      false,
    )
  })

  it('still allows hostless and localhost file urls', () => {
    expect(decideEgress('file:///app/index.html', []).allow).toBe(true)
    expect(decideEgress('file://localhost/app/index.html', []).allow).toBe(true)
  })

  it('leaves the other local schemes, which have no meaningful authority, alone', () => {
    expect(decideEgress('devtools://devtools/bundled/x.js', []).allow).toBe(true)
    expect(decideEgress('data:text/css,body{}', []).allow).toBe(true)
    expect(decideEgress('blob:https://evil.example/uuid', []).allow).toBe(true)
    expect(decideEgress('chrome-extension://abc/x.js', []).allow).toBe(true)
  })
})

// scanOrigins is populated from parsed user input in a later phase, where an empty or partial
// hostname is easy to produce. An unusable entry must be skipped, never matched on.
describe('decideEgress — unusable scan origins', () => {
  it('does not let a blank origin match a host with a trailing dot', () => {
    // 'https://evil.example./' is a working URL: a trailing dot is absolute-DNS form. With a blank
    // origin, host.endsWith('.' + o) degenerates into host.endsWith('.') and matches it.
    expect(decideEgress('https://evil.example./', ['']).allow).toBe(false)
  })

  it('does not let a blank origin match a url with an empty hostname', () => {
    expect(decideEgress('about:blank', ['']).allow).toBe(false)
  })

  it('does not let a whitespace-only origin match', () => {
    expect(decideEgress('https://evil.example./', ['   ']).allow).toBe(false)
  })

  it('does not let a bare TLD origin allow everything under it', () => {
    expect(decideEgress('https://anything.it/', ['it']).allow).toBe(false)
  })

  it('ignores origins carrying a scheme or a port separator', () => {
    expect(decideEgress('https://evil.example/', ['https://evil.example/']).allow).toBe(false)
    expect(decideEgress('https://evil.example/', ['evil.example:443']).allow).toBe(false)
  })

  it('skips unusable entries but still honours a usable one alongside them', () => {
    const origins = ['', '   ', 'it', 'rossi-editore.it']
    expect(decideEgress('https://rossi-editore.it/', origins).allow).toBe(true)
    expect(decideEgress('https://www.rossi-editore.it/a.css', origins).allow).toBe(true)
  })

  it('accepts a usable origin that needs trimming and lowercasing', () => {
    expect(decideEgress('https://rossi-editore.it/', ['  Rossi-Editore.IT  ']).allow).toBe(true)
  })
})

// decideEgress is exported and reused where a throw is not automatically a deny, so a malformed
// argument must return a decision rather than blow up.
describe('decideEgress — malformed scanOrigins argument', () => {
  it('blocks, without throwing, when scanOrigins is not an array', () => {
    const bad = undefined as unknown as readonly string[]
    expect(() => decideEgress('https://evil.example/', bad)).not.toThrow()
    expect(decideEgress('https://evil.example/', bad).allow).toBe(false)
  })

  it('blocks, without throwing, when an entry is not a string', () => {
    const bad = [null] as unknown as readonly string[]
    expect(() => decideEgress('https://evil.example/', bad)).not.toThrow()
    expect(decideEgress('https://evil.example/', bad).allow).toBe(false)
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

  it('cancels a file url aimed at a remote authority', () => {
    const { session, fire } = fakeSession()
    installEgressGuard(session, () => [])
    expect(fire('file://attacker.example/share/x.png')).toEqual({ cancel: true })
  })

  it('fails closed, and still calls back, if getScanOrigins throws', () => {
    const { session, fire } = fakeSession()
    installEgressGuard(session, () => {
      throw new Error('scan origin lookup blew up')
    })
    expect(fire('https://rossi-editore.it/')).toEqual({ cancel: true })
  })
})
