import { createEmptyProject } from '../../src/core/project'
import { addPlace } from '../../src/core/graph'
import type { Place, Project } from '../../src/core/types'

export const NOW = '2026-07-30T09:00:00.000Z'

export function emptyProject(): Project {
  return createEmptyProject('Fixture', NOW)
}

export function place(over: Partial<Place> = {}): Omit<Place, 'id'> {
  return {
    name: 'A place',
    kind: 'processor',
    purposeGroup: 'Marketing',
    holder: 'supplier',
    leavesEEA: false,
    retention: '2 years',
    sources: [{ documentId: 'd1', documentName: 'dpa.pdf' }],
    confidence: 'declared',
    ...over,
  }
}

export function projectWithPlaces(...drafts: Array<Omit<Place, 'id'>>): Project {
  return drafts.reduce((p, d, i) => addPlace(p, d, `pl-${i + 1}`), emptyProject())
}
