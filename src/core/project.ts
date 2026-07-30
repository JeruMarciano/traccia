import type { Project } from './types'

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
    const p = value as Project
    const ids = new Set<string>([
      ...p.places.map((x) => x.id),
      ...p.subjectGroups.map((x) => x.id),
    ])
    for (const f of p.flows) {
      if (!ids.has(f.from)) errors.push(`Flow ${f.id} refers to unknown id: ${f.from}`)
      if (!ids.has(f.to)) errors.push(`Flow ${f.id} refers to unknown id: ${f.to}`)
    }
  }

  return errors.length === 0
    ? { ok: true, project: value as Project }
    : { ok: false, errors }
}
