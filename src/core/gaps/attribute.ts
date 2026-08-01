import type { Gap, Project } from '../types'

export function attributeGaps(project: Project): Gap[] {
  const gaps: Gap[] = []

  for (const p of project.places) {
    if (p.sources.length === 0) {
      gaps.push({
        id: `attr:${p.id}:sources`,
        kind: 'attribute',
        subject: p.id,
        question: `Which document says ${p.name} receives data?`,
        why: 'Nothing on file supports this entry, so it cannot be shown to anyone as evidence.',
        severity: 2,
      })
    }

    if (p.leavesEEA === 'unknown') {
      gaps.push({
        id: `attr:${p.id}:leavesEEA`,
        kind: 'attribute',
        subject: p.id,
        question: `Does data sent to ${p.name} leave the EEA?`,
        why: 'Where the data comes to rest is one of the questions this map exists to answer.',
        severity: 1,
      })
    }

    if (p.holder === 'supplier' && !p.retention) {
      gaps.push({
        id: `attr:${p.id}:retention`,
        kind: 'attribute',
        subject: p.id,
        question: `How long does ${p.name} keep this data?`,
        why: 'A supplier holds this data and no document says for how long.',
        severity: 2,
      })
    }
  }

  return gaps
}
