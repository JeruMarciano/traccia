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

export function decideEgress(url: string, scanOrigins: readonly string[]): EgressDecision {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allow: false, reason: 'Malformed URL' }
  }

  if (LOCAL_SCHEMES.includes(parsed.protocol)) {
    return { allow: true, reason: 'Local resource' }
  }

  const host = parsed.hostname.toLowerCase()
  for (const origin of scanOrigins) {
    const o = origin.toLowerCase()
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
    const decision = decideEgress(details.url, getScanOrigins())
    callback({ cancel: !decision.allow })
  })
}
