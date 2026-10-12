// The map is measured against these, not against the sample project: three real scans with the
// organisation's name replaced (scripts/anonymise-scans.ts), and one synthetic project larger than
// anything the bench produced.
import { readFileSync } from 'node:fs'
import { controllerName } from '../../src/core/controller'
import { ingestScan } from '../../src/core/scan'
import type {
  CollectionPoint,
  CookiePlatformRow,
  DoorKind,
  Place,
  Project,
  ScanResult,
  VendorDictionary,
} from '../../src/core/types'
import cookiePlatforms from '../../src/data/cookie-platforms.json'
import vendors from '../../src/data/vendors.json'
import { emptyProject } from './projects'

function scanned(name: string): Project {
  const scan = JSON.parse(readFileSync(`tests/fixtures/scans/${name}.scan.json`, 'utf8')) as ScanResult
  return ingestScan(
    emptyProject(),
    scan,
    vendors as VendorDictionary,
    { prefix: 'scan1' },
    cookiePlatforms as unknown as readonly CookiePlatformRow[],
  )
}

/** A restaurant: 2 ways in, 3 groups, 9 places. */
export const dorsaleSmall = (): Project => scanned('dorsale-small')
/** An estate agency: 7 ways in (6 forms), 3 groups, 13 places. */
export const dorsaleMedium = (): Project => scanned('dorsale-medium')
/** An oil mill with a shop: 15 ways in (12 forms), 5 groups, 40 places, a group of 17. */
export const dorsaleUgly = (): Project => scanned('dorsale-ugly')

/** The places that stand on the right of the map: not a door, not the controller. */
export function rightPlaces(p: Project): Place[] {
  const controller = controllerName(p)
  return p.places.filter((pl) => pl.kind !== 'collection' && pl.id !== controller.placeId)
}

const supplier = (id: string, name: string, purposeGroup: string): Place => ({
  id,
  name,
  kind: 'processor',
  purposeGroup,
  holder: 'supplier',
  leavesEEA: false,
  sources: [],
  confidence: 'declared',
})

const point = (id: string, kind: DoorKind, page: string, extra: Partial<CollectionPoint> = {}): CollectionPoint => ({
  id,
  page,
  kind,
  ...(kind === 'form' ? {} : { provider: `Vendor ${id}` }),
  fields: [],
  sources: [],
  confidence: 'observed',
  ...extra,
})

/**
 * A project as a scan leaves it: the site as a door, "Website visitors" reaching it, one supplier
 * the site sends to, and one discovered door per kind given, in that order.
 */
export function scanLike(kinds: DoorKind[]): Project {
  const p = emptyProject()
  p.subjectGroups = [{ id: 'sg-1', name: 'Website visitors' }]
  p.places = [
    { id: 'pl-1', name: 'example.test', kind: 'collection', purposeGroup: 'Systems', holder: 'you', leavesEEA: 'unknown', sources: [], confidence: 'observed' },
    supplier('pl-2', 'Mailchimp', 'Marketing'),
  ]
  p.flows = [
    { id: 'fl-1', from: 'sg-1', to: 'pl-1', dataDescription: '', purpose: '', sources: [], confidence: 'observed' },
    { id: 'fl-2', from: 'pl-1', to: 'pl-2', dataDescription: '', purpose: '', sources: [], confidence: 'observed' },
  ]
  p.collectionPoints = kinds.map((kind, i) => point(`cp-${i + 1}`, kind, `https://example.test/p${i + 1}`))
  return p
}

/**
 * Larger than any real scan (design §6): 30 purpose groups, one of 14 places; 19 ways in (10
 * forms, one with a 233-character path; two of each other kind; one declared in a document);
 * 12 subject groups; no controller named.
 */
export function dorsaleOversized(): Project {
  const p = emptyProject()
  p.subjectGroups = ['Website visitors', ...Array.from({ length: 11 }, (_, i) => `People ${i + 1}`)].map(
    (name, i) => ({ id: `sg-${i + 1}`, name }),
  )
  const groupName = (g: number): string => `Group ${String(g + 1).padStart(2, '0')}`
  p.places = [
    {
      id: 'pl-door',
      name: 'Paper form at the front desk',
      kind: 'collection',
      purposeGroup: 'Systems',
      holder: 'you',
      leavesEEA: false,
      sources: [{ documentId: 'd1', documentName: 'notice.pdf' }],
      confidence: 'declared',
    },
    ...Array.from({ length: 30 }, (_, g) =>
      Array.from({ length: g === 0 ? 14 : 1 }, (_, m) => supplier(`pl-${g + 1}-${m + 1}`, `Vendor ${g + 1}.${m + 1}`, groupName(g))),
    ).flat(),
  ]
  const flow = (id: string, from: string, to: string) => ({
    id,
    from,
    to,
    dataDescription: '',
    purpose: '',
    sources: [],
    confidence: 'declared' as const,
  })
  p.flows = [
    ...p.subjectGroups.map((s, i) => flow(`fl-in-${i + 1}`, s.id, 'pl-door')),
    ...Array.from({ length: 30 }, (_, g) => flow(`fl-out-${g + 1}`, 'pl-door', `pl-${g + 1}-1`)),
  ]
  const longPath = '/' + 'a-very-long-product-name-'.repeat(10).slice(0, 232)
  p.collectionPoints = [
    ...Array.from({ length: 10 }, (_, i) =>
      point(`cp-form-${i + 1}`, 'form', `https://example.test${i === 0 ? longPath : `/form-${i + 1}/`}`),
    ),
    ...(['newsletter', 'booking', 'chat'] as const).flatMap((kind) =>
      [1, 2].map((n) => point(`cp-${kind}-${n}`, kind, `https://example.test/${kind}-${n}/`)),
    ),
    point('cp-embed-1', 'embed', 'https://example.test/', { destination: 'pl-2-1' }),
    point('cp-embed-2', 'embed', 'https://example.test/', { destination: 'pl-3-1' }),
  ]
  return p
}

export const DORSALE_FIXTURES: [string, () => Project][] = [
  ['small', dorsaleSmall],
  ['medium', dorsaleMedium],
  ['ugly', dorsaleUgly],
  ['oversized', dorsaleOversized],
]
