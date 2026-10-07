import { controllerName } from './controller'
import { deriveDoors, tracePaths } from './doors'
import type { DoorOrigin, Place, Project } from './types'

/**
 * The map reads as a sentence: whose data -> through which door -> to the controller -> onward to
 * whom. Distance now encodes direction, not ownership; ownership survives as the ring's stroke
 * colour alone.
 *
 * Pure, and a pure function of its arguments only -- the open ring is a parameter, not state kept
 * here, so the same project and the same selection always draw the same sheet.
 */

export type LayoutNodeKind = 'subject' | 'door' | 'controller' | 'group' | 'member' | 'more'

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
  /** More nodes: true when the selection is one of the hidden items, so it is never drawn nowhere. */
  highlighted?: true
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

/**
 * Which places stand in a purpose group on the right-hand side. A door is already drawn on the
 * inbound side and the controller is already the centre; counting either here would put one place
 * on the sheet twice and the ring's count would say so.
 *
 * Exported because the detail panel lists the same members the map draws, and two copies of this
 * rule would drift the moment one of them changed.
 */
export function groupMembers(project: Project, group: string): Place[] {
  const controller = controllerName(project)
  return project.places.filter(
    (p) => p.purposeGroup === group && p.kind !== 'collection' && p.id !== controller.placeId,
  )
}

/** How far an open ring's members sit from its centre. Grows a little past three members so
 *  they do not crowd, and stays a layout fact rather than a drawing one. */
const MEMBER_ORBIT = 40

/** Caps: past these, all but one slot are drawn and the last slot is a '+N more' mark. */
const MAX_OPEN_MEMBERS = 6
const MAX_DOORS = 8

/** Two decimals keeps the SVG readable and the equality tests exact. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Evenly spaced down a band in the middle of the sheet. One item sits centred, not at the top.
 *
 * The band is half the height rather than the whole of it: the inbound side is read as a
 * sequence, and a person at the top of the sheet joined to a door at the bottom draws a long
 * diagonal that says nothing except that both exist.
 */
function column(count: number, height: number, band = 0.5): number[] {
  if (count === 0) return []
  if (count === 1) return [round(height / 2)]
  const span = height * band
  const top = (height - span) / 2
  return Array.from({ length: count }, (_, i) => round(top + (span * i) / (count - 1)))
}

/**
 * Where a purpose group sits around the controller. Groups ring the centre rather than stacking
 * in a column, but only across the eastern side: the western sector is where the people and the
 * doors are, and a group drawn into it would collide with the way in.
 */
const GROUP_ARC = (100 * Math.PI) / 180

function groupAngle(i: number, count: number): number {
  if (count === 1) return 0
  return -GROUP_ARC + (2 * GROUP_ARC * i) / (count - 1)
}

export function computeLayout(
  project: Project,
  size: { width: number; height: number },
  openGroup: string | null = null,
  selectedId: string | null = null,
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
  const hiddenMembers = new Map<string, string>()
  const groupOfPlace = new Map(onTheRight.map((p) => [p.id, p.purposeGroup]))

  // The inbound side, read left to right: the people who reach a door, then the doors. Somebody
  // with no traced way in is not drawn -- an unconnected dot on the far left reads as a person
  // nobody handles, which is a claim this map has no evidence for.
  //
  // The three columns sit close together on purpose. They are one phrase, and a long arrow
  // between them adds distance without adding meaning.
  const reaching = new Set(paths.flatMap((p) => p.subjectIds))
  const subjects = project.subjectGroups.filter((s) => reaching.has(s.id))
  const subjectY = column(subjects.length, size.height, 0.44)
  subjects.forEach((s, i) => {
    nodes.push({ id: s.id, kind: 'subject', label: s.name, x: round(size.width * 0.07), y: subjectY[i] ?? 0 })
  })

  const doorsCapped = doors.length > MAX_DOORS
  const shownDoors = doorsCapped ? doors.slice(0, MAX_DOORS - 1) : doors
  const hiddenDoors = doorsCapped ? doors.slice(MAX_DOORS - 1) : []
  const hiddenDoorIds = new Set(hiddenDoors.map((d) => `door:${d.id}`))
  const doorY = column(Math.min(doors.length, MAX_DOORS), size.height, 0.44)
  shownDoors.forEach((d, i) => {
    nodes.push({
      id: `door:${d.id}`,
      kind: 'door',
      label: d.label,
      x: round(size.width * 0.21),
      y: doorY[i] ?? 0,
      origin: d.origin,
      colourIndex: d.colourIndex,
    })
  })

  if (doorsCapped) {
    nodes.push({
      id: 'more:doors',
      kind: 'more',
      label: `+${hiddenDoors.length} more`,
      x: round(size.width * 0.21),
      y: doorY[MAX_DOORS - 1] ?? 0,
      count: hiddenDoors.length,
      ...(hiddenDoors.some((d) => selectedId === d.id || selectedId === `door:${d.id}`)
        ? { highlighted: true as const }
        : {}),
    })
  }

  // Column 3: the controller. Always exactly one once there is anything to answer for, even
  // before a document names it -- the sentence has no subject otherwise. The empty label is the
  // renderer's cue to say "Your organisation"; core holds no words the user reads.
  const anything = project.places.length > 0 || subjects.length > 0
  const cx = round(size.width * 0.42)
  const cy = round(size.height / 2)
  if (anything) {
    nodes.push({
      id: 'controller',
      kind: 'controller',
      label: controller.name ?? '',
      x: cx,
      y: cy,
      count: project.places.length,
    })
  }

  // The purpose groups, set around the controller rather than stacked in a column: what the
  // organisation hands data to surrounds it, and a ring of five reads at a glance where a column
  // of five crowds. They occupy the eastern side only, so none of them lands on the way in.
  //
  // A ring that opens stays exactly where it is, becoming a boundary with its members set out
  // around its centre, rather than vanishing and leaving a reader no way back to it.
  const rx = size.width * 0.235
  const ry = size.height * 0.35
  groups.forEach((g, i) => {
    const inGroup = onTheRight.filter((p) => p.purposeGroup === g)
    const angle = groupAngle(i, groups.length)
    const x = round(cx + Math.cos(angle) * rx)
    const y = round(cy + Math.sin(angle) * ry)
    const slots = Math.min(inGroup.length, MAX_OPEN_MEMBERS)
    const orbit = MEMBER_ORBIT + Math.max(slots - 3, 0) * 5
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
    const capped = inGroup.length > MAX_OPEN_MEMBERS
    const shown = capped ? inGroup.slice(0, MAX_OPEN_MEMBERS - 1) : inGroup
    const hidden = capped ? inGroup.slice(MAX_OPEN_MEMBERS - 1) : []
    const at = (k: number) => {
      const angle = (k / Math.max(slots, 1)) * Math.PI * 2 - Math.PI / 2
      return { x: round(x + Math.cos(angle) * orbit), y: round(y + Math.sin(angle) * orbit) }
    }
    if (capped) {
      nodes.push({
        id: `more:${g}`,
        kind: 'more',
        label: `+${hidden.length} more`,
        ...at(MAX_OPEN_MEMBERS - 1),
        count: hidden.length,
        ...(hidden.some((m) => selectedId === m.id || selectedId === `member:${m.id}`)
          ? { highlighted: true as const }
          : {}),
      })
      for (const m of hidden) hiddenMembers.set(m.id, `more:${g}`)
    }
    shown.forEach((m, k) => {
      const angle = (k / Math.max(slots, 1)) * Math.PI * 2 - Math.PI / 2
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
    const isHidden = hiddenDoorIds.has(`door:${path.doorId}`)
    // A hidden door's lines go to the mark: neutral, and once per pair.
    const doorNodeId = isHidden ? 'more:doors' : `door:${path.doorId}`
    const doorColour = isHidden ? undefined : colourIndex
    const push = (from: string, to: string, colour: number | undefined): void => {
      if (isHidden && edges.some((e) => e.from === from && e.to === to)) return
      edges.push({ from, to, directed: true, colourIndex: colour })
    }
    for (const s of path.subjectIds) {
      if (!drawn.has(s)) continue
      push(s, doorNodeId, doorColour)
    }
    if (anything && (path.subjectIds.length > 0 || path.destinationIds.length > 0)) {
      push(doorNodeId, 'controller', doorColour)
    }
    for (const dest of path.destinationIds) {
      const g = groupOfPlace.get(dest)
      if (g === undefined) continue
      const to = g === open ? (hiddenMembers.get(dest) ?? `member:${dest}`) : `group:${g}`
      if (!drawn.has(to)) continue
      // Several hidden members collapse onto one edge; it keeps a colour only while every path
      // that reaches the mark agrees on it.
      const prior = to.startsWith('more:') ? edges.find((e) => e.from === 'controller' && e.to === to) : undefined
      if (prior === undefined) edges.push({ from: 'controller', to, directed: true, colourIndex })
      else if (prior.colourIndex !== colourIndex) delete prior.colourIndex
      reached.add(to)
    }
  }

  // Anything no door reaches still belongs on the sheet: one neutral line from the controller.
  // Inventing a door for it, or leaving it off, would both be claims the project cannot support.
  for (const n of nodes) {
    if (n.kind === 'subject' || n.kind === 'door' || n.kind === 'controller' || n.id === 'more:doors') continue
    if (reached.has(n.id)) continue
    edges.push({ from: 'controller', to: n.id, directed: true })
  }

  return { nodes, edges, openGroup: open }
}
