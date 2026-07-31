import { EXPECTATIONS } from '../expectations'
import type { Gap, Project } from '../types'

const WHY: Record<string, string> = {
  payroll: 'The project records employees, so something processes their pay. No entry names it yet.',
}

function questionFor(id: string, label: string): string {
  return id === 'payroll' ? 'Who processes payroll?' : `Who provides ${label}?`
}

export function existenceGaps(project: Project): Gap[] {
  // An empty project is not yet evidence of anything.
  if (project.places.length === 0 && project.subjectGroups.length === 0) return []

  const gaps: Gap[] = []

  for (const e of EXPECTATIONS) {
    if (!e.appliesWhen(project)) continue
    if (e.satisfiedBy(project)) continue
    gaps.push({
      id: `exist:${e.id}`,
      kind: 'existence',
      subject: null,
      question: questionFor(e.id, e.label),
      why: WHY[e.id] ?? `Most organisations have ${e.label}. No entry names one yet.`,
      severity: 2,
    })
  }

  return gaps
}
