export interface EgressDecision {
  allow: boolean
  reason: string
}

export interface GuardableSession {
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (
        details: { url: string },
        callback: (response: { cancel: boolean }) => void,
      ) => void,
    ): void
  }
}

const LOCAL_SCHEMES = ['file:', 'devtools:', 'data:', 'blob:', 'chrome-extension:']

// A file: URL is only local if it has no authority. Chromium maps file://host/share/x to the UNC
// path \\host\share\x on Windows and opens an SMB connection to that host, which is off-machine
// egress to an attacker-chosen destination (and leaks the user's NTLM credentials). The other
// local schemes carry no meaningful authority, so this applies to file: alone.
const LOCAL_FILE_HOSTS = ['', 'localhost']

// An entry only counts as a scan origin if it is a hostname we can match against. A blank entry
// would turn `host.endsWith('.' + o)` into `host.endsWith('.')`, which matches any absolute-DNS
// host such as `evil.example.`, and would make `host === o` match any empty hostname. A bare TLD
// would allow everything registered under it. Anything else — including a non-string, which the
// exported function must not throw on — is skipped rather than matched.
function usableOrigin(entry: unknown): string | null {
  if (typeof entry !== 'string') return null
  const o = entry.trim().toLowerCase()
  if (o === '' || !o.includes('.') || o.includes('/') || o.includes(':')) return null
  return o
}

export function decideEgress(url: string, scanOrigins: readonly string[]): EgressDecision {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allow: false, reason: 'Malformed URL' }
  }

  const host = parsed.hostname.toLowerCase()

  if (LOCAL_SCHEMES.includes(parsed.protocol)) {
    if (parsed.protocol === 'file:' && !LOCAL_FILE_HOSTS.includes(host)) {
      return { allow: false, reason: `Remote file authority: ${host}` }
    }
    return { allow: true, reason: 'Local resource' }
  }

  const entries: readonly unknown[] = Array.isArray(scanOrigins) ? scanOrigins : []
  for (const entry of entries) {
    const o = usableOrigin(entry)
    if (o === null) continue
    if (host === o || host.endsWith(`.${o}`)) {
      return { allow: true, reason: `Scan target: ${o}` }
    }
  }

  return { allow: false, reason: `Not a scan target: ${host}` }
}

export function installEgressGuard(
  session: GuardableSession,
  getScanOrigins: () => readonly string[],
): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    // Fail closed: if getScanOrigins() (caller-supplied) throws, or decideEgress throws for a
    // reason we haven't anticipated, the request is still cancelled. The callback must always be
    // invoked with cancel: true on any error path — an uninvoked callback leaves Electron's
    // request pending rather than blocked, which is not an acceptable failure mode for the guard
    // that is the app's entire no-egress promise.
    let allow = false
    try {
      allow = decideEgress(details.url, getScanOrigins()).allow
    } catch {
      allow = false
    }
    callback({ cancel: !allow })
  })
}
