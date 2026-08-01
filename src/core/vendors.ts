import type { VendorDictionary, VendorEntry } from './types'

/**
 * Look a host up in the bundled dictionary.
 *
 * Matching walks the host's labels from the left, so `a.b.example.com` tries
 * `a.b.example.com`, then `b.example.com`, then `example.com`. That gives
 * longest-match-wins for free and, unlike `endsWith`, cannot match
 * `notstripe.com` against `stripe.com`: the boundary is always a label
 * boundary, never an arbitrary character offset. Attributing one company's
 * traffic to another is the failure this function exists to avoid.
 *
 * The dictionary is a parameter so that `src/core/` holds no bundled data and
 * so these tests run against three entries instead of several thousand.
 */
export function identify(host: string, dictionary: VendorDictionary): VendorEntry | null {
  const normalised = host.toLowerCase().replace(/\.$/, '')
  if (normalised === '') return null

  const labels = normalised.split('.')
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.')
    const hit = dictionary[candidate]
    if (hit !== undefined) return hit
  }
  return null
}
