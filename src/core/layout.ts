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

  occupied.forEach((group, i) => {
    const angle = (i / occupied.length) * Math.PI * 2 - Math.PI / 2
    const inGroup = project.places.filter((p) => p.purposeGroup === group)
    nodes.push({
      id: `group:${group}`,
      kind: 'group',
      label: group,
      x: round(cx + Math.cos(angle) * rx),
      y: round(cy + Math.sin(angle) * ry),
      count: inGroup.length,
      leavesEEA: inGroup.filter((p) => p.leavesEEA === true).length,
      unexplained: inGroup.filter((p) => p.kind === 'unknown').length,
    })
    edges.push({ from: 'centre', to: `group:${group}` })
  })

  return { nodes, edges }
}
