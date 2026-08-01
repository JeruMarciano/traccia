import type { Gap, Project } from '../types'
import { attributeGaps } from './attribute'
import { contradictionGaps } from './contradiction'
import { existenceGaps } from './existence'

export { attributeGaps, contradictionGaps, existenceGaps }

export function computeGaps(project: Project): Gap[] {
  return [
    ...contradictionGaps(project),
    ...attributeGaps(project),
    ...existenceGaps(project),
  ].sort((a, b) => a.severity - b.severity || a.id.localeCompare(b.id))
}
