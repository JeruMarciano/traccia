import { controllerName } from './controller'
import { deriveDoors, doorRows, tracePaths } from './doors'
import type { Door, DoorKind, DoorOrigin, Place, Project } from './types'

/**
 * The map reads as a sentence, left to right: whose data, through which way in, across the
 * organisation, to where it goes. The organisation is a vertical bar, and a door's line crosses it
 * at the door's own height, so one line of one colour runs from the person to the destination.
 *
 * Everything is a row. Three or more doors of one kind are one row that opens in place, and so is
 * a purpose group. Pure, and a pure function of its arguments only: what is open and what is
 * selected are parameters, so the same project and the same view always draw the same sheet.
 */

export type LayoutNodeKind = 'subject' | 'door' | 'doorGroup' | 'controller' | 'group' | 'member' | 'more'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutNode {
  id: string
  kind: LayoutNodeKind
  /** A name, a door's label, or the bare path of a form ('/' for the site's root). Empty when the
   *  renderer speaks: the unnamed controller, a folded row, a '+N more' row. */
  label: string
  /** Centre of the mark. */
  x: number
  y: number
  /** The box the label may fill. Shortening the text to fit is the renderer's job. */
  labelBox: Box
  anchor: 'start' | 'end'
  /** A sub-row, and the row it hangs from: the renderer draws the bracket between them. */
  parent?: string
  count?: number
  unexplained?: number
  open?: boolean
  /** Group and member rows: true for something the organisation runs itself. */
  internal?: boolean
  /** True on the row that hides the selection, so a selection is never drawn nowhere. */
  highlighted?: true
  origin?: DoorOrigin
  /** 0-5, a row's colour. Sub-rows share their fold's. */
  colourIndex?: number
  doorKind?: DoorKind
  /** Controller only: the bar every line crosses. */
  spine?: Box
}

export interface LayoutEdge {
  from: string
  to: string
  /** The row whose line this is, from the person to the destination. Absent on a neutral line. */
  door?: string
  colourIndex?: number
  x1: number
  y1: number
  x2: number
  y2: number
  /** Control points share y1 and y2, so every line leaves and arrives level. */
  c1x: number
  c2x: number
  /** True where the line ends: at a destination row, or on the spine for a door that goes no further. */
  arrow: boolean
  /** Spine-to-destination lines: the height at which this door's line entered the spine. */
  entryY?: number
}

export interface LayoutView {
  openGroup?: string | null
  openKind?: DoorKind | null
  selectedId?: string | null
}

export interface LayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
  /** What stands open, echoed back so the renderer does not re-derive it. */
  openGroup: string | null
  openKind: DoorKind | null
}

export const SHEET_WIDTH = 1000
/** Where each column stands. Exported so the renderer's column heads sit over them. */
export const COLUMN = {
  person: 118,
  door: 156,
  doorLabel: 172,
  lineEnd: 410,
  spine: 525,
  spineWidth: 14,
  ring: 704,
} as const
const TOP = 54
const BOTTOM = 30
const MIN_BODY = 150
const ROW = 36
const SUB = 24
const PERSON = 64
const PORT_GAP = 5
const LAND_GAP = 3
const RIGHT_EDGE = SHEET_WIDTH - 10
/** Past this many sub-rows, all but one slot are drawn and the last is a '+N more' row. */
export const MAX_OPEN = 6

/** Two decimals keeps the SVG readable and the equality tests exact. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** A form is named by its page's path; the site's own root is '/'. Anything that is not an
 *  address is left as written: a blank beats a guess. */
function barePath(page: string): string {
  const path = page.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '')
  return path === '' ? '/' : path
}

function capped<T>(items: T[]): { shown: T[]; hidden: T[] } {
  return items.length > MAX_OPEN
    ? { shown: items.slice(0, MAX_OPEN - 1), hidden: items.slice(MAX_OPEN - 1) }
    : { shown: items, hidden: [] }
}

/** One horizontal band of a column, before it is given a height on the sheet. */
interface Band {
  node: LayoutNode
  height: number
  /** Ways in only: the doors whose line this row carries to the spine. None for an open fold's head. */
  carries: Door[]
  /** Ways in only: the doors people are drawn into at this row. None for a sub-row. */
  enters: Door[]
}

const total = (bands: Band[]): number => bands.reduce((sum, b) => sum + b.height, 0)

/** Gives each band its place. A label box is written relative to its row until here. */
function stack(bands: Band[], top: number): void {
  let y = top
  for (const b of bands) {
    b.node.y = round(y + b.height / 2)
    b.node.labelBox.y = round(b.node.y + b.node.labelBox.y)
    y += b.height
  }
}

export function computeLayout(project: Project, view: LayoutView = {}): LayoutResult {
  const selectedId = view.selectedId ?? null
  const doors = deriveDoors(project)
  const pathOf = new Map(tracePaths(project, doors).map((p) => [p.doorId, p]))
  const controller = controllerName(project)
  const isSelected = (prefix: string, id: string): boolean => selectedId === id || selectedId === `${prefix}${id}`

  // Where it goes. A door is already a row on the left and the controller is the spine; drawing
  // either again as a member of its purpose group would put one place on the sheet twice.
  const onTheRight = project.places.filter((p) => p.kind !== 'collection' && p.id !== controller.placeId)
  const membersOf = (g: string): Place[] => onTheRight.filter((p) => p.purposeGroup === g)
  const isInternal = (g: string): boolean => membersOf(g).every((p) => p.kind === 'internal')
  // Own systems first, then suppliers, each alphabetical.
  const groups = [...new Set(onTheRight.map((p) => p.purposeGroup))].sort(
    (a, b) => Number(isInternal(b)) - Number(isInternal(a)) || (a < b ? -1 : a > b ? 1 : 0),
  )
  const openGroup = view.openGroup != null && groups.includes(view.openGroup) ? view.openGroup : null

  const right: Band[] = []
  /** Which row a place's lines arrive at: its group, itself when the group is open, or the fold. */
  const rowOfPlace = new Map<string, string>()
  for (const g of groups) {
    const inGroup = membersOf(g)
    const open = g === openGroup
    const head: LayoutNode = {
      id: `group:${g}`,
      kind: 'group',
      label: g,
      x: COLUMN.ring,
      y: 0,
      labelBox: { x: COLUMN.ring + 20, y: -8, width: RIGHT_EDGE - (COLUMN.ring + 20), height: 16 },
      anchor: 'start',
      count: inGroup.length,
      unexplained: inGroup.filter((p) => p.kind === 'unknown').length,
      internal: isInternal(g),
      open,
      ...(!open && inGroup.some((p) => isSelected('member:', p.id)) ? { highlighted: true as const } : {}),
    }
    right.push({ node: head, height: ROW, carries: [], enters: [] })
    if (!open) {
      for (const p of inGroup) rowOfPlace.set(p.id, head.id)
      continue
    }
    const { shown, hidden } = capped(inGroup)
    const sub = (id: string, label: string, extra: Partial<LayoutNode>): void => {
      right.push({
        node: {
          id,
          kind: 'member',
          label,
          x: COLUMN.ring + 17,
          y: 0,
          labelBox: { x: COLUMN.ring + 28, y: -7, width: RIGHT_EDGE - (COLUMN.ring + 28), height: 14 },
          anchor: 'start',
          parent: head.id,
          ...extra,
        },
        height: SUB,
        carries: [],
        enters: [],
      })
    }
    for (const p of shown) {
      sub(`member:${p.id}`, p.name, { unexplained: p.kind === 'unknown' ? 1 : 0, internal: p.kind === 'internal' })
      rowOfPlace.set(p.id, `member:${p.id}`)
    }
    if (hidden.length > 0) {
      sub(`more:${g}`, '', {
        kind: 'more',
        count: hidden.length,
        ...(hidden.some((p) => isSelected('member:', p.id)) ? { highlighted: true as const } : {}),
      })
      for (const p of hidden) rowOfPlace.set(p.id, `more:${g}`)
    }
  }

  /** The rows a set of doors reaches, deduplicated. */
  const targetsOf = (carried: Door[]): string[] => [
    ...new Set(
      carried.flatMap((d) => pathOf.get(d.id)?.destinationIds ?? []).flatMap((id) => rowOfPlace.get(id) ?? []),
    ),
  ]
  /** A door with k targets leaves the spine from k points PORT_GAP apart; its row grows to hold them. */
  const tall = (base: number, carried: Door[]): number =>
    Math.max(base, PORT_GAP * (targetsOf(carried).length - 1) + 16)

  // Ways in.
  const rows = doorRows(doors)
  const openKind =
    view.openKind != null && rows.some((r) => r.folded && r.kind === view.openKind) ? view.openKind : null
  const left: Band[] = []
  const rowBox = (): Box => ({ x: COLUMN.doorLabel, y: -19, width: COLUMN.lineEnd - COLUMN.doorLabel, height: 15 })
  const subBox = (): Box => ({ x: COLUMN.doorLabel + 6, y: -16, width: COLUMN.lineEnd - COLUMN.doorLabel - 6, height: 13 })
  const doorNode = (d: Door, extra: Partial<LayoutNode>): LayoutNode => ({
    id: `door:${d.id}`,
    kind: 'door',
    label: d.kind === 'form' ? barePath(d.label) : d.label,
    x: COLUMN.door,
    y: 0,
    labelBox: rowBox(),
    anchor: 'start',
    origin: d.origin,
    colourIndex: d.colourIndex,
    ...(d.kind === undefined ? {} : { doorKind: d.kind }),
    ...extra,
  })
  for (const row of rows) {
    const first = row.doors[0]
    if (first === undefined) continue
    if (!row.folded || row.kind === null) {
      left.push({ node: doorNode(first, {}), height: tall(ROW, row.doors), carries: row.doors, enters: row.doors })
      continue
    }
    const open = row.kind === openKind
    const head: LayoutNode = {
      id: `doorGroup:${row.kind}`,
      kind: 'doorGroup',
      label: '',
      x: COLUMN.door,
      y: 0,
      labelBox: rowBox(),
      anchor: 'start',
      count: row.doors.length,
      colourIndex: first.colourIndex,
      doorKind: row.kind,
      open,
      ...(!open && row.doors.some((d) => isSelected('door:', d.id)) ? { highlighted: true as const } : {}),
    }
    if (!open) {
      left.push({ node: head, height: tall(ROW, row.doors), carries: row.doors, enters: row.doors })
      continue
    }
    // Open: the head takes the people's line and carries nothing; each sub-row carries its own.
    left.push({ node: head, height: ROW, carries: [], enters: row.doors })
    const { shown, hidden } = capped(row.doors)
    for (const d of shown) {
      left.push({
        node: doorNode(d, { x: COLUMN.door + 10, labelBox: subBox(), parent: head.id }),
        height: tall(SUB, [d]),
        carries: [d],
        enters: [],
      })
    }
    if (hidden.length > 0) {
      left.push({
        node: {
          id: `moreDoors:${row.kind}`,
          kind: 'more',
          label: '',
          x: COLUMN.door + 10,
          y: 0,
          labelBox: subBox(),
          anchor: 'start',
          parent: head.id,
          count: hidden.length,
          colourIndex: first.colourIndex,
          doorKind: row.kind,
          ...(hidden.some((d) => isSelected('door:', d.id)) ? { highlighted: true as const } : {}),
        },
        height: tall(SUB, hidden),
        carries: hidden,
        enters: [],
      })
    }
  }

  // Whose data. Somebody with no traced way in is not drawn: an unconnected disc reads as a person
  // nobody handles, which is a claim this map has no evidence for.
  const reaching = new Set([...pathOf.values()].flatMap((p) => p.subjectIds))
  const subjects = project.subjectGroups.filter((s) => reaching.has(s.id))

  if (project.places.length === 0 && doors.length === 0 && subjects.length === 0) {
    return { nodes: [], edges: [], width: SHEET_WIDTH, height: 0, openGroup: null, openKind: null }
  }

  const body = Math.max(total(left), total(right), subjects.length * PERSON, MIN_BODY)
  stack(left, TOP + (body - total(left)) / 2)
  stack(right, TOP + (body - total(right)) / 2)

  const nodes: LayoutNode[] = []
  const firstPersonY = TOP + body / 2 - ((subjects.length - 1) * PERSON) / 2
  subjects.forEach((s, i) => {
    const y = round(firstPersonY + i * PERSON)
    nodes.push({
      id: s.id,
      kind: 'subject',
      label: s.name,
      x: COLUMN.person,
      y,
      labelBox: { x: 0, y: y - 8, width: COLUMN.person - 14, height: 16 },
      anchor: 'end',
    })
  })
  for (const b of left) nodes.push(b.node)
  // Always exactly one once there is anything to answer for, even before a document names it. The
  // empty label is the renderer's cue to say "Your organisation"; core holds no words the user reads.
  const spineCentre = COLUMN.spine + COLUMN.spineWidth / 2
  nodes.push({
    id: 'controller',
    kind: 'controller',
    label: controller.name ?? '',
    x: spineCentre,
    y: 26,
    labelBox: { x: spineCentre + 20, y: 19, width: RIGHT_EDGE - (spineCentre + 20), height: 15 },
    anchor: 'start',
    count: project.places.length,
    spine: { x: COLUMN.spine, y: TOP - 8, width: COLUMN.spineWidth, height: body + 16 },
  })
  for (const b of right) nodes.push(b.node)

  const at = new Map(nodes.map((n) => [n.id, n]))
  const yOf = (id: string): number => at.get(id)?.y ?? 0
  const edges: LayoutEdge[] = []
  const spineLeft = COLUMN.spine
  const spineRight = COLUMN.spine + COLUMN.spineWidth

  // People to the top-level rows. A folded row takes one line; its bracket carries it to the sub-rows.
  for (const s of subjects) {
    for (const b of left) {
      if (!b.enters.some((d) => pathOf.get(d.id)?.subjectIds.includes(s.id))) continue
      const x1 = COLUMN.person + 8
      const x2 = b.node.x - 4
      edges.push({
        from: s.id,
        to: b.node.id,
        door: b.node.id,
        colourIndex: b.node.colourIndex,
        x1,
        y1: yOf(s.id),
        x2,
        y2: b.node.y,
        c1x: x1 + 14,
        c2x: x2 - 14,
        arrow: false,
      })
    }
  }

  // Each carrying row to the spine at its own height, then out again from points PORT_GAP apart,
  // in the vertical order of the rows it reaches, so a door's own lines never cross each other.
  const leaving: { row: LayoutNode; to: string; y1: number }[] = []
  for (const b of left) {
    if (b.carries.length === 0) continue
    const targets = targetsOf(b.carries).sort((p, q) => yOf(p) - yOf(q))
    const y = b.node.y
    const x1 = b.node.x + 4
    edges.push({
      from: b.node.id,
      to: 'controller',
      door: b.node.id,
      colourIndex: b.node.colourIndex,
      x1,
      y1: y,
      x2: spineLeft,
      y2: y,
      c1x: x1,
      c2x: spineLeft,
      arrow: targets.length === 0,
    })
    targets.forEach((to, j) =>
      leaving.push({ row: b.node, to, y1: round(y + (j - (targets.length - 1) / 2) * PORT_GAP) }),
    )
  }

  // Two doors into one row land LAND_GAP apart, in the order they left the spine.
  const landing = (target: LayoutNode): number => target.x - (target.kind === 'group' ? 18 : 12)
  const reached = new Set(leaving.map((l) => l.to))
  for (const to of reached) {
    const target = at.get(to)
    if (target === undefined) continue
    const arriving = leaving.filter((l) => l.to === to).sort((p, q) => p.y1 - q.y1)
    const x2 = landing(target)
    arriving.forEach((l, i) => {
      edges.push({
        from: 'controller',
        to,
        door: l.row.id,
        colourIndex: l.row.colourIndex,
        x1: spineRight,
        y1: l.y1,
        x2,
        y2: round(target.y + (i - (arriving.length - 1) / 2) * LAND_GAP),
        c1x: spineRight + 70,
        c2x: x2 - 70,
        arrow: true,
        entryY: l.row.y,
      })
    })
  }

  // A destination no door reaches still belongs on the sheet: one neutral line, level, from the
  // spine. Inventing a door for it, or leaving it off, would both be claims the project cannot
  // support. An open group is reached through its members, so its own row takes none.
  for (const b of right) {
    if (reached.has(b.node.id) || (b.node.kind === 'group' && b.node.open === true)) continue
    const x2 = landing(b.node)
    edges.push({ from: 'controller', to: b.node.id, x1: spineRight, y1: b.node.y, x2, y2: b.node.y, c1x: spineRight, c2x: x2, arrow: true })
  }

  return { nodes, edges, width: SHEET_WIDTH, height: round(TOP + body + BOTTOM), openGroup, openKind }
}
