import { controllerName } from './controller'
import { deriveDoors, tracePaths } from './doors'
import type { DoorOrigin, Project } from './types'

/**
 * The map reads as a sentence: whose data -> through which door -> to the controller -> onward to
 * whom. Distance now encodes direction, not ownership; ownership survives as the ring's stroke
 * colour alone.
 *
 * Pure, and a pure function of its arguments only -- the open ring is a parameter, not state kept
 * here, so the same project and the same selection always draw the same sheet.
 */

export type LayoutNodeKind = 'subject' | 'door' | 'controller' | 'group' | 'member'

export interface LayoutNode {
  id: string
  kind: LayoutNodeKind
  label: string
  x: number
  y: number
  count?: number
  unexplained?: number
  /** Group nodes: true when this ring stands open. An open ring is still on the sheet -- it is
   *  what a reader clicks to close it again, and it still says how many are inside. */
  open?: boolean
  /** Open group nodes: how far its members sit from the centre, so the renderer can draw the
   *  boundary round them without knowing this layout's spacing. */
  openRadius?: number
  /** Group and member nodes: true for something the organisation runs itself (stroke colour). */
  internal?: boolean
  /** Door nodes only. */
  origin?: DoorOrigin
  /** Doors and the paths that leave them: 0-5, or absent for a neutral mark. */
  colourIndex?: number
}

export interface LayoutEdge {
  from: string
  to: string
  /** Every edge has one. The arrowhead is drawn at `to`. */
  directed: true
  colourIndex?: number
}

export interface LayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  /** Which group is open, echoed back so the renderer does not re-derive it. */
  openGroup: string | null
}

/** How far an open ring's members sit from its centre. Grows a little past three members so
 *  they do not crowd, and stays a layout fact rather than a drawing one. */
const MEMBER_ORBIT = 40

/** Two decimals keeps the SVG readable and the equality tests exact. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Evenly spaced down the middle 80% of the sheet. One item sits centred, not at the top. */
function column(count: number, height: number): number[] {
  if (count === 0) return []
  if (count === 1) return [round(height / 2)]
  const top = height * 0.1
  const span = height * 0.8
  return Array.from({ length: count }, (_, i) => round(top + (span * i) / (count - 1)))
}

export function computeLayout(
  project: Project,
  size: { width: number; height: number },
  openGroup: string | null = null,
): LayoutResult {
  const doors = deriveDoors(project)
  const paths = tracePaths(project, doors)
  const controller = controllerName(project)

  // What the right-hand column is made of. A door is already drawn on the inbound side and the
  // controller is already the centre; drawing either again as a member of its purpose group would
  // put one place on the sheet twice, and the count under a ring would say so.
  const onTheRight = project.places.filter(
    (p) => p.kind !== 'collection' && p.id !== controller.placeId,
  )
  const groups = [...new Set(onTheRight.map((p) => p.purposeGroup))].sort()
  const open = openGroup !== null && groups.includes(openGroup) ? openGroup : null

  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []

  const colourOf = new Map(doors.map((d) => [d.id, d.colourIndex]))
  const groupOfPlace = new Map(onTheRight.map((p) => [p.id, p.purposeGroup]))

  // Column 1: the people who reach a door, in the project's own order. Somebody with no traced
  // way in is not drawn -- an unconnected dot on the far left reads as a person nobody handles,
  // which is a claim this map has no evidence for.
  const reaching = new Set(paths.flatMap((p) => p.subjectIds))
  const subjects = project.subjectGroups.filter((s) => reaching.has(s.id))
  const subjectY = column(subjects.length, size.height)
  subjects.forEach((s, i) => {
    nodes.push({ id: s.id, kind: 'subject', label: s.name, x: round(size.width * 0.08), y: subjectY[i] ?? 0 })
  })

  // Column 2: the doors.
  const doorY = column(doors.length, size.height)
  doors.forEach((d, i) => {
    nodes.push({
      id: `door:${d.id}`,
      kind: 'door',
      label: d.label,
      x: round(size.width * 0.28),
      y: doorY[i] ?? 0,
      origin: d.origin,
      colourIndex: d.colourIndex,
    })
  })

  // Column 3: the controller. Always exactly one once there is anything to answer for, even
  // before a document names it -- the sentence has no subject otherwise. The empty label is the
  // renderer's cue to say "Your organisation"; core holds no words the user reads.
  const anything = project.places.length > 0 || subjects.length > 0
  if (anything) {
    nodes.push({
      id: 'controller',
      kind: 'controller',
      label: controller.name ?? '',
      x: round(size.width * 0.5),
      y: round(size.height / 2),
      count: project.places.length,
    })
  }

  // Column 4: the purpose groups. A ring that opens stays exactly where it is and keeps its
  // place in the column -- it becomes a boundary with its members set out around its centre,
  // rather than vanishing and leaving a reader no way back to it.
  const rightY = column(groups.length, size.height)
  groups.forEach((g, i) => {
    const inGroup = onTheRight.filter((p) => p.purposeGroup === g)
    const x = round(size.width * 0.78)
    const y = rightY[i] ?? 0
    const orbit = MEMBER_ORBIT + Math.max(inGroup.length - 3, 0) * 5
    nodes.push({
      id: `group:${g}`,
      kind: 'group',
      label: g,
      x,
      y,
      count: inGroup.length,
      unexplained: inGroup.filter((p) => p.kind === 'unknown').length,
      internal: inGroup.length > 0 && inGroup.every((p) => p.kind === 'internal'),
      open: g === open,
      ...(g === open ? { openRadius: orbit } : {}),
    })
    if (g !== open) return
    // Members set out around the centre, starting at twelve o'clock. One member sits above the
    // centre rather than on it, so the group's own count stays readable underneath.
    inGroup.forEach((m, k) => {
      const angle = (k / Math.max(inGroup.length, 1)) * Math.PI * 2 - Math.PI / 2
      nodes.push({
        id: `member:${m.id}`,
        kind: 'member',
        label: m.name,
        x: round(x + Math.cos(angle) * orbit),
        y: round(y + Math.sin(angle) * orbit),
        unexplained: m.kind === 'unknown' ? 1 : 0,
        internal: m.kind === 'internal',
      })
    })
  })

  // Every edge directed; the coloured ones repeat a door's colour along the whole path, so two
  // doors into one destination are two lines a reader can follow separately.
  const reached = new Set<string>()
  const drawn = new Set(nodes.map((n) => n.id))
  for (const path of paths) {
    const colourIndex = colourOf.get(path.doorId)
    const doorNodeId = `door:${path.doorId}`
    for (const s of path.subjectIds) {
      if (!drawn.has(s)) continue
      edges.push({ from: s, to: doorNodeId, directed: true, colourIndex })
    }
    if (anything && (path.subjectIds.length > 0 || path.destinationIds.length > 0)) {
      edges.push({ from: doorNodeId, to: 'controller', directed: true, colourIndex })
    }
    for (const dest of path.destinationIds) {
      const g = groupOfPlace.get(dest)
      if (g === undefined) continue
      const to = g === open ? `member:${dest}` : `group:${g}`
      if (!drawn.has(to)) continue
      edges.push({ from: 'controller', to, directed: true, colourIndex })
      reached.add(to)
    }
  }

  // Anything no door reaches still belongs on the sheet: one neutral line from the controller.
  // Inventing a door for it, or leaving it off, would both be claims the project cannot support.
  for (const n of nodes) {
    if (n.kind !== 'group' && n.kind !== 'member') continue
    if (reached.has(n.id)) continue
    edges.push({ from: 'controller', to: n.id, directed: true })
  }

  return { nodes, edges, openGroup: open }
}
