import type {
  CapturedCookie,
  CollectionPoint,
  CookieLifetime,
  DoorKind,
  FormFieldKind,
  Place,
  Project,
  SubjectGroup,
} from './types'

const COOKIE_LIFETIMES: readonly CookieLifetime[] = [
  'session',
  'under-a-day',
  'under-a-year',
  'a-year-or-more',
]

const FORM_FIELD_KINDS: readonly FormFieldKind[] = [
  'email',
  'phone',
  'name',
  'address',
  'payment',
  'free-text',
]

const DOOR_KINDS: readonly DoorKind[] = ['form', 'newsletter', 'booking', 'chat', 'embed']

export const DEFAULT_PURPOSE_GROUPS = [
  'Sales',
  'Marketing',
  'Support',
  'Employing people',
  'Payments',
  'Systems',
  'Delivery',
] as const

export function createEmptyProject(name: string, createdAt: string): Project {
  return {
    schemaVersion: 1,
    name,
    createdAt,
    purposeGroups: [...DEFAULT_PURPOSE_GROUPS],
    subjectGroups: [],
    places: [],
    flows: [],
    observations: [],
  }
}

export type ValidationResult =
  | { ok: true; project: Project }
  | { ok: false; errors: string[] }

export function validateProject(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['Project must be an object.'] }
  }
  const v = value as Record<string, unknown>
  const errors: string[] = []

  if (v.schemaVersion !== 1) {
    errors.push(
      `Unsupported schemaVersion: ${String(v.schemaVersion)}. This file needs a newer version of the app.`,
    )
  }
  if (typeof v.name !== 'string') errors.push('name must be a string.')
  if (typeof v.createdAt !== 'string') errors.push('createdAt must be a string.')

  for (const key of ['purposeGroups', 'subjectGroups', 'places', 'flows', 'observations']) {
    if (!Array.isArray(v[key])) errors.push(`${key} must be an array.`)
  }
  if (v.cookies !== undefined && !Array.isArray(v.cookies)) {
    errors.push('cookies must be an array.')
  }
  if (v.collectionPoints !== undefined && !Array.isArray(v.collectionPoints)) {
    errors.push('collectionPoints must be an array.')
  }

  let validCookies: CapturedCookie[] = []
  let validCollectionPoints: CollectionPoint[] = []

  if (errors.length === 0) {
    // The arrays themselves are confirmed to be arrays above, but a
    // hand-edited or corrupted project file can still put `null` or other
    // non-object junk *inside* those arrays. Guard every element access so a
    // malformed entry produces a validation error instead of an uncaught
    // TypeError (e.g. `null.id`).
    const isRecord = (x: unknown): x is Record<string, unknown> =>
      typeof x === 'object' && x !== null && !Array.isArray(x)

    const rawPlaces = v.places as unknown[]
    const rawSubjectGroups = v.subjectGroups as unknown[]
    const rawFlows = v.flows as unknown[]

    const validPlaces: Place[] = []
    rawPlaces.forEach((x, i) => {
      if (!isRecord(x) || typeof x.id !== 'string') {
        errors.push(`places[${i}] must be an object with a string id.`)
        return
      }
      validPlaces.push(x as unknown as Place)
    })

    const validSubjectGroups: SubjectGroup[] = []
    rawSubjectGroups.forEach((x, i) => {
      if (!isRecord(x) || typeof x.id !== 'string') {
        errors.push(`subjectGroups[${i}] must be an object with a string id.`)
        return
      }
      validSubjectGroups.push(x as unknown as SubjectGroup)
    })

    const ids = new Set<string>([
      ...validPlaces.map((x) => x.id),
      ...validSubjectGroups.map((x) => x.id),
    ])

    rawFlows.forEach((f, i) => {
      if (
        !isRecord(f) ||
        typeof f.id !== 'string' ||
        typeof f.from !== 'string' ||
        typeof f.to !== 'string'
      ) {
        errors.push(`flows[${i}] must be an object with string id, from, and to.`)
        return
      }
      if (!ids.has(f.from)) errors.push(`Flow ${f.id} refers to unknown id: ${f.from}`)
      if (!ids.has(f.to)) errors.push(`Flow ${f.id} refers to unknown id: ${f.to}`)
    })

    // Name fields added in a later release: optional, but bounded when present (a crafted file
    // must not smuggle in a huge array or an arbitrary string). paths: at most 8 first segments.
    ;(v.observations as unknown[]).forEach((o, i) => {
      const paths = isRecord(o) ? o.paths : undefined
      if (
        paths !== undefined &&
        !(Array.isArray(paths) && paths.length <= 8 && paths.every((s) => typeof s === 'string' && /^[a-z0-9_-]{1,32}$/.test(s)))
      ) {
        errors.push(`observations[${i}].paths must be at most 8 plain first path segments.`)
      }
    })

    const rawCookies = (v.cookies ?? []) as unknown[]
    rawCookies.forEach((x, i) => {
      if (
        !isRecord(x) ||
        typeof x.name !== 'string' ||
        typeof x.domain !== 'string' ||
        typeof x.thirdParty !== 'boolean' ||
        typeof x.lifetime !== 'string' ||
        !COOKIE_LIFETIMES.includes(x.lifetime as CookieLifetime)
      ) {
        errors.push(`cookies[${i}] must be an object with string name and domain, boolean thirdParty, and a valid lifetime.`)
        return
      }
      if (x.platform !== undefined && !(typeof x.platform === 'string' && x.platform.length <= 128)) {
        errors.push(`cookies[${i}].platform must be a string of at most 128 characters.`)
        return
      }
      validCookies.push(x as unknown as CapturedCookie)
    })

    const rawCollectionPoints = (v.collectionPoints ?? []) as unknown[]
    rawCollectionPoints.forEach((x, i) => {
      if (!isRecord(x) || typeof x.id !== 'string' || typeof x.page !== 'string' || !Array.isArray(x.fields)) {
        errors.push(`collectionPoints[${i}] must be an object with string id and page, and an array of fields.`)
        return
      }
      const fields = x.fields as unknown[]
      let fieldsOk = true
      fields.forEach((f, fi) => {
        if (
          !isRecord(f) ||
          typeof f.name !== 'string' ||
          typeof f.kind !== 'string' ||
          !FORM_FIELD_KINDS.includes(f.kind as FormFieldKind)
        ) {
          errors.push(`collectionPoints[${i}].fields[${fi}] must be an object with a string name and a valid kind.`)
          fieldsOk = false
        }
      })
      const isStrings = (a: unknown): boolean => Array.isArray(a) && a.every((e) => typeof e === 'string')
      if (
        (x.kind !== undefined && !DOOR_KINDS.includes(x.kind as DoorKind)) ||
        (x.provider !== undefined && typeof x.provider !== 'string') ||
        (x.destination !== undefined && typeof x.destination !== 'string') ||
        (x.pages !== undefined && !isStrings(x.pages))
      ) {
        errors.push(`collectionPoints[${i}] has a malformed kind, provider, pages or destination.`)
        return
      }
      // Bounds a scan can actually produce: 13 pages, a page identity of at most 2048 characters,
      // and a provider that is a place name (a hostname, 253).
      if (
        (typeof x.provider === 'string' && x.provider.length > 253) ||
        (Array.isArray(x.pages) && (x.pages.length > 13 || x.pages.some((p: string) => p.length > 2048)))
      ) {
        errors.push(`collectionPoints[${i}] has too many pages, a page that is too long, or a provider that is too long.`)
        return
      }
      if (typeof x.destination === 'string' && !validPlaces.some((p) => p.id === x.destination)) {
        errors.push(`collectionPoints[${i}] sends data to an unknown place: ${x.destination}`)
        return
      }
      if (!fieldsOk) return
      validCollectionPoints.push(x as unknown as CollectionPoint)
    })
  }

  if (errors.length > 0) return { ok: false, errors }

  const project: Project = {
    ...(value as Project),
    cookies: validCookies,
    collectionPoints: validCollectionPoints,
  }

  return { ok: true, project }
}
