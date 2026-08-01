import type { Gap, Project } from '../types'

export function contradictionGaps(project: Project): Gap[] {
  const gaps: Gap[] = []

  for (const o of project.observations) {
    const p = project.places.find((x) => x.name === o.domain && x.kind === 'unknown')
    if (!p) continue
    gaps.push({
      id: `contra:${o.domain}`,
      kind: 'contradiction',
      subject: p.id,
      question: `What is ${o.domain}, and why does it receive data?`,
      why: o.beforeConsent
        ? `Contacted ${o.requestCount} times before anyone accepted cookies, and no document names it.`
        : `Contacted ${o.requestCount} times during the scan, and no document names it.`,
      severity: o.beforeConsent ? 1 : 2,
    })
  }

  return gaps
}
