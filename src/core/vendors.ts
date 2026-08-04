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
    // A plain `dictionary[candidate]` reads the prototype chain, so
    // `__proto__` and `constructor` would otherwise come back as an
    // "identified" vendor with an undefined owner. Only own properties count.
    if (Object.prototype.hasOwnProperty.call(dictionary, candidate)) {
      const hit = dictionary[candidate]
      if (hit !== undefined) return hit
    }
  }
  return null
}

/**
 * What a host is probably *for*, when the dictionary does not know what it *is*.
 *
 * A scan sees hosts nobody has catalogued — a client's own subdomains, a regional vendor, a
 * service too small for any list. Left alone every one of them reads "not yet identified",
 * which is true but useless: a map where a third of the points say nothing cannot be read at a
 * glance, and the consultant is the one who has to fill them in.
 *
 * So the host name itself is used as evidence. `stats.example.com` is analytics work whoever
 * runs it; `cdn.` and `static.` are infrastructure; `checkout.` is payment. This is a guess
 * from a naming convention, not knowledge — which is why it only ever sets the purpose group,
 * never the vendor name, and why the place it produces stays `kind: 'unknown'`: we still do
 * not know *what* this is, only what it appears to be doing. The map draws that distinction
 * with a dashed figure, so nothing here can pass itself off as a recorded fact.
 *
 * Groups are the six the bundled dictionary already uses. Inventing a parallel vocabulary
 * ("Functional", "Strictly necessary") would split one map into two languages, and a printed
 * sheet cannot afford that.
 *
 * Ordering is deliberate: the specific readings are tested before the general ones, because
 * `pay` inside `payments-cdn` is about payment and `cdn` inside `cdn.ads.example` is about
 * advertising. Whichever rule matches first wins, so the list runs from least to most
 * ambiguous.
 */
const PURPOSE_HINTS: readonly (readonly [readonly string[], string])[] = [
  [['checkout', 'payment', 'paypal', 'billing', 'invoice', 'wallet'], 'Payments'],
  [['livechat', 'zendesk', 'helpdesk', 'support', 'helpshift', 'ticket'], 'Support'],
  [['shipping', 'courier', 'delivery', 'fulfil', 'fulfill'], 'Delivery'],
  [['shop', 'store', 'cart', 'basket', 'ecommerce', 'catalog'], 'Sales'],
  [
    [
      'analytic', 'analytics', 'stats', 'statistic', 'metric', 'telemetry', 'measure',
      'track', 'tracker', 'tracking', 'pixel', 'beacon', 'collect', 'tagmanager', 'gtm',
      'tag', 'ads', 'adserver', 'adservice', 'adsystem', 'advert', 'doubleclick', 'banner',
      'campaign', 'marketing', 'remarket', 'retarget', 'affiliate', 'audience', 'segment',
      'insight', 'heatmap', 'sessionreplay', 'recommend',
    ],
    'Marketing',
  ],
  [
    [
      'cdn', 'static', 'assets', 'asset', 'img', 'image', 'media', 'font', 'fonts', 'js',
      'css', 'api', 'auth', 'login', 'sso', 'account', 'identity', 'captcha', 'recaptcha',
      'consent', 'cookie', 'cmp', 'privacy', 'cloud', 'storage', 'bucket', 'edge', 'cache',
      'host', 'server', 'origin', 'monitor', 'status', 'error', 'sentry', 'log', 'maps',
      'video', 'player', 'embed', 'mail', 'smtp', 'push', 'notification',
    ],
    'Systems',
  ],
]

/**
 * The purpose group a host's own name suggests, or `null` when nothing in it does. Matching is
 * on whole labels and on label fragments, case-insensitively — `stats-eu.example.com` and
 * `eustats.example.com` both read as analytics work.
 */
export function classifyHost(host: string): string | null {
  const normalised = host.toLowerCase().replace(/\.$/, '')
  if (normalised === '') return null
  // The public suffix carries no intent, and its labels collide with real hints ("co", "id",
  // "media" as TLDs). Only what the operator chose is evidence, so the last label is dropped.
  const labels = normalised.split('.').slice(0, -1)
  const haystack = labels.join('.')
  for (const [needles, group] of PURPOSE_HINTS) {
    if (needles.some((n) => haystack.includes(n))) return group
  }
  return null
}
