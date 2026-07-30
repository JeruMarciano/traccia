import type { Place, Project, SubjectGroup } from './types'

export const DEFAULT_PURPOSE_GROUPS = [
  'Selling',
  'Marketing',
  'Support',
  'Employing people',
  'Getting paid',
  'Running the systems',
  'Delivering orders',
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
  }

  return errors.length === 0
    ? { ok: true, project: value as Project }
    : { ok: false, errors }
}
