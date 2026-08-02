import type { Project } from './types'

export interface LayoutNode {
  id: string
  kind: 'subject' | 'group'
  label: string
  x: number
  y: number
  count?: number
  leavesEEA?: number
  unexplained?: number
}

export interface LayoutEdge {
  from: string
  to: string
}

export interface LayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
}

/** Two decimals keeps the SVG readable and the equality tests exact. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeLayout(
  project: Project,
  size: { width: number; height: number },
): LayoutResult {
  const cx = size.width / 2
  const cy = size.height / 2
  const rx = size.width * 0.32
  const ry = size.height * 0.3

  const occupied = [...new Set(project.places.map((p) => p.purposeGroup))].sort()

  const nodes: LayoutNode[] = [
    {
      id: 'centre',
      kind: 'subject',
      label: 'People',
      x: cx,
      y: cy,
      count: project.subjectGroups.length,
    },
  ]
  const edges: LayoutEdge[] = []

  // Two rings. A group made entirely of internal places — the company's own operations,
  // declared by documents — sits on an inner ring between the people and the outer ring of
  // external services: data flows outward, people → the company's systems → its suppliers.
  // A group with even one external place stays on the outer ring, where a supplier belongs.
  const isInternal = (group: string): boolean => {
    const inGroup = project.places.filter((p) => p.purposeGroup === group)
    return inGroup.length > 0 && inGroup.every((p) => p.kind === 'internal')
  }
  const inner = occupied.filter(isInternal)
  const outer = occupied.filter((g) => !isInternal(g))

  const place = (group: string, i: number, total: number, scale: number): void => {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2
    const inGroup = project.places.filter((p) => p.purposeGroup === group)
    nodes.push({
      id: `group:${group}`,
      kind: 'group',
      label: group,
      x: round(cx + Math.cos(angle) * rx * scale),
      y: round(cy + Math.sin(angle) * ry * scale),
      count: inGroup.length,
      leavesEEA: inGroup.filter((p) => p.leavesEEA === true).length,
      unexplained: inGroup.filter((p) => p.kind === 'unknown').length,
    })
    edges.push({ from: 'centre', to: `group:${group}` })
  }

  outer.forEach((group, i) => place(group, i, outer.length, 1))
  // Offset half a step so an inner tile does not sit directly under an outer connector.
  inner.forEach((group, i) => place(group, i + 0.5, Math.max(inner.length, 2), 0.52))

  return { nodes, edges }
}
