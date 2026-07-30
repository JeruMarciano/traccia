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
