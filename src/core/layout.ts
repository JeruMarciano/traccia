import { controllerName } from './controller'
import { barePath, deriveDoors, doorRows, tracePaths } from './doors'
import { NOT_IDENTIFIED } from './scan'
import type { Door, DoorKind, DoorOrigin, Place, Project } from './types'

/**
 * The map reads as a sentence, left to right, in four columns: whose data, through which way in,
 * into the organisation, out to where it goes.
 *
 * Everything is a card, and the lines are a sum, not a product. A way in draws one line, from the
 * people to the organisation; the organisation draws one line to each row of destinations. Which
 * way in reaches which destination is not drawn: it is kept beside the drawing as trails, and the
 * renderer answers it by dimming everything a hovered or selected row has nothing to do with.
 * Drawing it (a line per way in per destination) is what made a real scan a fan of curves.
 *
 * Three or more doors of one kind are one card that opens in place, and so is a row of
 * destinations. Pure, and a pure function of its arguments only: what is open and what is
 * selected are parameters, so the same project and the same view always draw the same sheet.
 */

export type LayoutNodeKind = 'people' | 'subject' | 'door' | 'doorGroup' | 'controller' | 'group' | 'member' | 'more'

/** What a destination is, said by the shape of its mark: the organisation's own, a supplier's, or
 *  something nobody has identified yet. */
export type Mark = 'internal' | 'supplier' | 'unidentified'

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
   *  renderer speaks: the unnamed controller, a folded row, a '+N more' row, the three rows of
   *  destinations that are not a purpose. */
  label: string
  /** Centre of the mark; for a card, the height its line arrives or leaves at. */
  x: number
  y: number
  /** The card, or the band a sub-row takes inside its card. An open card includes its sub-rows. */
  box: Box
  /** The box the label may fill. Shortening the text to fit is the renderer's job. */
  labelBox: Box
  anchor: 'start' | 'middle'
  /** A sub-row, and the card it stands in. */
  parent?: string
  count?: number
  open?: boolean
  /** Destinations only. */
  mark?: Mark
  /** True on the row that hides the selection, so a selection is never drawn nowhere. */
  highlighted?: true
  origin?: DoorOrigin
  /** 0-5, a row's colour. Sub-rows share their fold's. */
  colourIndex?: number
  doorKind?: DoorKind
}

export interface LayoutEdge {
  /** A way in's card, or 'controller'. */
  from: string
  /** 'controller', or a card of destinations. */
  to: string
  /** A way in's colour. Absent on the organisation's own lines, which are neutral. */
  colourIndex?: number
  /** From the right edge of one card to the left edge of the next, where the arrowhead's tip goes. */
  x1: number
  y1: number
  x2: number
  y2: number
  /** A way in's line only: the stretch that brings the people to it. Absent where nobody is
   *  recorded as coming through, which is not the same as nobody coming. */
  lead?: { x1: number; y1: number; x2: number; y2: number }
}

/** What one way in connects, in node ids: the relation the lines no longer draw. */
export interface Trail {
  /** The way in: a card, or a sub-row of an open one. */
  id: string
  /** The card whose line carries it. */
  row: string
  people: string[]
  /** Every node standing for a place it sends to: the card, and the sub-row when the card is open. */
  reaches: string[]
}

export interface LayoutView {
  /** The id of the open card of destinations. */
  openGroup?: string | null
  openKind?: DoorKind | null
  selectedId?: string | null
}

export interface LayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  trails: Trail[]
  width: number
  height: number
  /** What stands open, echoed back so the renderer does not re-derive it. */
  openGroup: string | null
  openKind: DoorKind | null
}

export const SHEET_WIDTH = 1000
/** Where each column stands. Exported so the renderer's column heads sit over them. */
export const COLUMN = {
  people: { x: 12, width: 138 },
  doors: { x: 232, width: 224 },
  controller: { x: 538, width: 140 },
  places: { x: 762, width: 226 },
} as const
const TOP = 44
const BOTTOM = 18
const MIN_BODY = 120
/** A card's own row, a sub-row inside it, and the air between two cards. */
const ROW = 30
const SUB = 22
const GAP = 10
const FOOT = 5
const PERSON = 24
/** Lines that meet one card are spread along its edge, this far apart, never on top of each other. */
const PORT = 9
const PEOPLE_PORT = 4
const MIN_CONTROLLER = 56
/** Past this many sub-rows, all but one slot are drawn and the last is a '+N more' row. */
export const MAX_OPEN = 6
/** The most rows the destinations take. Past it the smallest purposes share one row. */
export const MAX_DESTINATIONS = 5

/** Two decimals keeps the SVG readable and the equality tests exact. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}

export interface Destination {
  /** 'own', `group:<purpose>`, 'others' or 'unidentified'. */
  id: string
  mark: Mark
  /** One purpose's row only. */
  purpose?: string
  places: Place[]
  /** 'others' only: the purposes it folds, largest first. */
  purposes?: { name: string; places: Place[] }[]
}

/**
 * The rows on the right-hand side, in the order they are drawn: what the organisation runs itself,
 * then its suppliers by purpose, largest first, then whatever nobody has identified. At most
 * MAX_DESTINATIONS rows: past that, the smallest purposes share one row, never fewer than two of
 * them, because a fold of one hides a name and saves nothing.
 *
 * Every place stands in exactly one row. A host the scan could not identify is counted with the
 * unidentified even where its address suggested a purpose: counted under the purpose as well, the
 * same place was announced on two rows ("Marketing, 5 not yet identified") and read as ten.
 * A door is already a card on the left and the controller is the organisation; neither is here.
 *
 * Exported because the detail panel lists the same members the map counts, and two copies of this
 * rule would drift the moment one of them changed.
 */
export function destinations(project: Project): Destination[] {
  const controller = controllerName(project)
  const onTheRight = project.places.filter((p) => p.kind !== 'collection' && p.id !== controller.placeId)
  const unidentified = (p: Place): boolean =>
    p.kind === 'unknown' || p.purposeGroup === NOT_IDENTIFIED || p.purposeGroup === ''
  const own = onTheRight.filter((p) => p.kind === 'internal')
  const open = onTheRight.filter((p) => p.kind !== 'internal' && unidentified(p))
  const supplied = onTheRight.filter((p) => p.kind !== 'internal' && !unidentified(p))
  const purposes = [...new Set(supplied.map((p) => p.purposeGroup))]
    .map((name) => ({ name, places: supplied.filter((p) => p.purposeGroup === name) }))
    .sort((a, b) => b.places.length - a.places.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const slots = MAX_DESTINATIONS - Number(own.length > 0) - Number(open.length > 0)
  const shown = purposes.length <= slots ? purposes : purposes.slice(0, slots - 1)
  const folded = purposes.slice(shown.length)
  return [
    ...(own.length > 0 ? [{ id: 'own', mark: 'internal' as const, places: own }] : []),
    ...shown.map((p) => ({ id: `group:${p.name}`, mark: 'supplier' as const, purpose: p.name, places: p.places })),
    ...(folded.length > 0
      ? [{ id: 'others', mark: 'supplier' as const, places: folded.flatMap((p) => p.places), purposes: folded }]
      : []),
    ...(open.length > 0 ? [{ id: 'unidentified', mark: 'unidentified' as const, places: open }] : []),
  ]
}

function capped<T>(items: T[]): { shown: T[]; hidden: T[] } {
  return items.length > MAX_OPEN
    ? { shown: items.slice(0, MAX_OPEN - 1), hidden: items.slice(MAX_OPEN - 1) }
    : { shown: items, hidden: [] }
}

/** One card of a column, sub-rows and all, written relative to its own top until it is stacked. */
interface Band {
  nodes: LayoutNode[]
  height: number
}

const total = (bands: Band[]): number => bands.reduce((sum, b) => sum + b.height, 0) + GAP * Math.max(0, bands.length - 1)

/** Gives each card its place on the sheet. */
function stack(bands: Band[], top: number): void {
  let y = top
  for (const b of bands) {
    for (const n of b.nodes) {
      n.y = round(n.y + y)
      n.box.y = round(n.box.y + y)
      n.labelBox.y = round(n.labelBox.y + y)
    }
    y += b.height + GAP
  }
}

/** A card: its own row, and under it the sub-rows it shows while open. */
function card(
  column: { x: number; width: number },
  head: Omit<LayoutNode, 'x' | 'y' | 'box' | 'labelBox' | 'anchor'>,
  indent: number,
  reserve: number,
  subs: Omit<LayoutNode, 'x' | 'y' | 'box' | 'labelBox' | 'anchor' | 'parent'>[],
): Band {
  const height = ROW + (subs.length > 0 ? subs.length * SUB + FOOT : 0)
  const markX = column.x + 16
  const nodes: LayoutNode[] = [
    {
      ...head,
      x: markX,
      y: ROW / 2,
      box: { x: column.x, y: 0, width: column.width, height },
      labelBox: { x: column.x + indent, y: ROW / 2 - 9, width: column.width - indent - reserve, height: 17 },
      anchor: 'start',
    },
    ...subs.map((s, i): LayoutNode => {
      const y = ROW + i * SUB + SUB / 2
      return {
        ...s,
        x: markX,
        y,
        box: { x: column.x, y: y - SUB / 2, width: column.width, height: SUB },
        labelBox: { x: column.x + indent, y: y - 8, width: column.width - indent - (s.kind === 'group' ? 34 : 8), height: 15 },
        anchor: 'start',
        parent: head.id,
      }
    }),
  ]
  return { nodes, height }
}

/** Room at the right of a card's own row for its count and the mark that says it opens. */
const reserveFor = (count: number | undefined): number => 24 + (count === undefined ? 0 : String(count).length * 7 + 6)

export function computeLayout(project: Project, view: LayoutView = {}): LayoutResult {
  const selectedId = view.selectedId ?? null
  const doors = deriveDoors(project)
  const pathOf = new Map(tracePaths(project, doors).map((p) => [p.doorId, p]))
  const controller = controllerName(project)
  /** Selection id -> the node that hides it. Filled as rows are folded away. */
  const hiddenBehind = new Map<string, string>()

  // Where it goes.
  const dests = destinations(project)
  const openGroup = view.openGroup != null && dests.some((d) => d.id === view.openGroup) ? view.openGroup : null
  const right: Band[] = []
  /** Every node standing for a place: its card, and its sub-row when the card is open. */
  const standsAt = new Map<string, string[]>()
  for (const d of dests) {
    const open = d.id === openGroup
    // An open card lists its places, except the fold of purposes, which lists the purposes.
    const items: { id: string; kind: 'group' | 'member'; label: string; count?: number; mark: Mark; places: Place[] }[] =
      d.purposes !== undefined
        ? d.purposes.map((p) => ({ id: `group:${p.name}`, kind: 'group', label: p.name, count: p.places.length, mark: d.mark, places: p.places }))
        : d.places.map((p) => ({
            id: `member:${p.id}`,
            kind: 'member',
            label: p.name,
            mark: p.kind === 'internal' ? 'internal' : p.kind === 'unknown' ? 'unidentified' : 'supplier',
            places: [p],
          }))
    const { shown, hidden } = open ? capped(items) : { shown: [], hidden: items }
    const moreId = `more:${d.id}`
    for (const item of items) {
      const visible = shown.includes(item)
      const node = visible ? item.id : open ? moreId : d.id
      const inside = item.places.flatMap((p) => [p.id, `member:${p.id}`])
      // A place is hidden unless its own row is drawn; a purpose's row still hides its places.
      for (const id of [...(visible && item.kind === 'member' ? [] : inside), ...(visible ? [] : [item.id])]) hiddenBehind.set(id, node)
      for (const p of item.places) standsAt.set(p.id, node === d.id ? [d.id] : [d.id, node])
    }
    right.push(
      card(
        COLUMN.places,
        { id: d.id, kind: 'group', label: d.purpose ?? '', count: d.places.length, mark: d.mark, open },
        30,
        reserveFor(d.places.length),
        [
          ...shown.map(({ places: _places, ...row }) => row),
          ...(open && hidden.length > 0 ? [{ id: moreId, kind: 'more' as const, label: '', count: hidden.length }] : []),
        ],
      ),
    )
  }

  // Ways in. Each card carries one line, whatever stands inside it.
  const rows = doorRows(doors)
  const openKind =
    view.openKind != null && rows.some((r) => r.folded && r.kind === view.openKind) ? view.openKind : null
  const left: { band: Band; doors: Door[] }[] = []
  const trails: { id: string; row: string; doors: Door[] }[] = []
  const doorFields = (d: Door) => ({
    id: `door:${d.id}`,
    kind: 'door' as const,
    label: d.kind === 'form' ? barePath(d.label) : d.label,
    origin: d.origin,
    colourIndex: d.colourIndex,
    ...(d.kind === undefined ? {} : { doorKind: d.kind }),
  })
  const hideDoors = (node: string, hidden: Door[]): void => {
    for (const d of hidden) {
      hiddenBehind.set(d.id, node)
      hiddenBehind.set(`door:${d.id}`, node)
    }
  }
  for (const row of rows) {
    const first = row.doors[0]
    if (first === undefined) continue
    if (!row.folded || row.kind === null) {
      left.push({ band: card(COLUMN.doors, doorFields(first), 27, 8, []), doors: row.doors })
      trails.push({ id: `door:${first.id}`, row: `door:${first.id}`, doors: row.doors })
      continue
    }
    const open = row.kind === openKind
    const id = `doorGroup:${row.kind}`
    const { shown, hidden } = open ? capped(row.doors) : { shown: [], hidden: row.doors }
    const moreId = `moreDoors:${row.kind}`
    hideDoors(open ? moreId : id, hidden)
    left.push({
      band: card(
        COLUMN.doors,
        { id, kind: 'doorGroup', label: '', count: row.doors.length, colourIndex: first.colourIndex, doorKind: row.kind, open },
        27,
        reserveFor(undefined),
        [
          ...shown.map(doorFields),
          ...(open && hidden.length > 0
            ? [{ id: moreId, kind: 'more' as const, label: '', count: hidden.length, colourIndex: first.colourIndex, doorKind: row.kind }]
            : []),
        ],
      ),
      doors: row.doors,
    })
    trails.push({ id, row: id, doors: row.doors })
    for (const d of shown) trails.push({ id: `door:${d.id}`, row: id, doors: [d] })
    if (open && hidden.length > 0) trails.push({ id: moreId, row: id, doors: hidden })
  }

  // Whose data. Somebody with no traced way in is not drawn: an unconnected name reads as a person
  // nobody handles, which is a claim this map has no evidence for.
  const reaching = new Set([...pathOf.values()].flatMap((p) => p.subjectIds))
  const subjects = project.subjectGroups.filter((s) => reaching.has(s.id))
  const peopleOf = (ds: Door[]): string[] => {
    const through = new Set(ds.flatMap((d) => pathOf.get(d.id)?.subjectIds ?? []))
    return subjects.filter((s) => through.has(s.id)).map((s) => s.id)
  }

  if (project.places.length === 0 && doors.length === 0 && subjects.length === 0) {
    return { nodes: [], edges: [], trails: [], width: SHEET_WIDTH, height: 0, openGroup: null, openKind: null }
  }

  // The people stand in one card, so the ways in they share are one line each and not one per
  // person. The card grows where one person feeds many ways in, to keep those lines apart.
  const led = left.filter((l) => peopleOf(l.doors).length > 0)
  const peopleHeight = Math.max(subjects.length * PERSON + 6, (led.length - 1) * PEOPLE_PORT + 14)
  // The organisation is only as tall as the lines that meet it need.
  const controllerHeight = Math.max(MIN_CONTROLLER, (Math.max(left.length, right.length) - 1) * PORT + 24)

  const leftBands = left.map((l) => l.band)
  const body = Math.max(total(leftBands), total(right), subjects.length > 0 ? peopleHeight : 0, controllerHeight, MIN_BODY)
  const centre = round(TOP + body / 2)
  stack(leftBands, TOP + (body - total(leftBands)) / 2)
  stack(right, TOP + (body - total(right)) / 2)

  const nodes: LayoutNode[] = []
  if (subjects.length > 0) {
    const col = COLUMN.people
    const top = round(centre - peopleHeight / 2)
    const pitch = peopleHeight / subjects.length
    nodes.push({
      id: 'people',
      kind: 'people',
      label: '',
      x: col.x,
      y: centre,
      box: { x: col.x, y: top, width: col.width, height: peopleHeight },
      labelBox: { x: col.x, y: top, width: 0, height: 0 },
      anchor: 'start',
    })
    subjects.forEach((s, i) => {
      const y = round(top + pitch * (i + 0.5))
      nodes.push({
        id: s.id,
        kind: 'subject',
        label: s.name,
        x: col.x + 15,
        y,
        box: { x: col.x, y: round(y - PERSON / 2), width: col.width, height: PERSON },
        labelBox: { x: col.x + 27, y: y - 8, width: col.width - 27 - 9, height: 15 },
        anchor: 'start',
        parent: 'people',
      })
    })
  }
  for (const b of leftBands) nodes.push(...b.nodes)
  // Always exactly one once there is anything to answer for, even before a document names it. The
  // empty label is the renderer's cue to say "Your organisation"; core holds no words the user reads.
  const org = COLUMN.controller
  nodes.push({
    id: 'controller',
    kind: 'controller',
    label: controller.name ?? '',
    x: org.x + org.width / 2,
    y: centre,
    box: { x: org.x, y: round(centre - controllerHeight / 2), width: org.width, height: controllerHeight },
    labelBox: { x: org.x + 10, y: centre + 3, width: org.width - 20, height: 17 },
    anchor: 'middle',
  })
  for (const b of right) nodes.push(...b.nodes)

  const hider = selectedId === null ? undefined : nodes.find((n) => n.id === hiddenBehind.get(selectedId))
  if (hider !== undefined && !nodes.some((n) => n.id === selectedId)) hider.highlighted = true

  // One line per card, in the order the cards stand, so no two lines of a column ever cross.
  const port = (i: number, n: number, gap: number): number => round(centre + (i - (n - 1) / 2) * gap)
  const edges: LayoutEdge[] = []
  left.forEach((l, i) => {
    const head = l.band.nodes[0]
    if (head === undefined) return
    const k = led.indexOf(l)
    edges.push({
      from: head.id,
      to: 'controller',
      colourIndex: head.colourIndex,
      x1: head.box.x + head.box.width,
      y1: head.y,
      x2: org.x,
      y2: port(i, left.length, PORT),
      ...(k < 0
        ? {}
        : {
            lead: {
              x1: COLUMN.people.x + COLUMN.people.width,
              y1: port(k, led.length, PEOPLE_PORT),
              x2: head.box.x,
              y2: head.y,
            },
          }),
    })
  })
  right.forEach((b, j) => {
    const head = b.nodes[0]
    if (head === undefined) return
    edges.push({ from: 'controller', to: head.id, x1: org.x + org.width, y1: port(j, right.length, PORT), x2: head.box.x, y2: head.y })
  })

  return {
    nodes,
    edges,
    trails: trails.map((t) => ({
      id: t.id,
      row: t.row,
      people: peopleOf(t.doors),
      reaches: [...new Set(t.doors.flatMap((d) => pathOf.get(d.id)?.destinationIds ?? []).flatMap((id) => standsAt.get(id) ?? []))],
    })),
    width: SHEET_WIDTH,
    height: round(TOP + body + BOTTOM),
    openGroup,
    openKind,
  }
}

/**
 * What stays at full strength while one row has the reader's attention: the row, the people who
 * come through it, the ways in that lead to it, the destinations it reaches. Null when nothing is
 * to be dimmed: no focus, a focus that is not on the sheet (greying the whole sheet around nothing
 * is the wrong answer), or the organisation, which everything passes through.
 */
export function traced(layout: LayoutResult, focus: string | null): Set<string> | null {
  const at = layout.nodes.find((n) => n.id === focus)
  if (at === undefined || at.kind === 'controller' || at.kind === 'people') return null
  const lit = new Set<string>([at.id, 'controller', 'people'])
  if (at.parent !== undefined) lit.add(at.parent)
  // Opening a fold must not grey its own rows.
  for (const n of layout.nodes) if (n.parent === at.id) lit.add(n.id)
  for (const t of layout.trails) {
    const through = t.people.includes(at.id)
    const reached = t.reaches.includes(at.id)
    if (t.id !== at.id && t.row !== at.id && !through && !reached) continue
    lit.add(t.id)
    lit.add(t.row)
    // Asked about one person, the others who share a way in are not the answer; nor, asked about
    // one destination, the others the same way in also feeds.
    if (!through) for (const s of t.people) lit.add(s)
    if (!reached) for (const r of t.reaches) lit.add(r)
  }
  return lit
}

/** Whether a line belongs to what `traced` kept: a way in's by its card, the organisation's by where it goes. */
export function tracedEdge(lit: Set<string> | null, e: LayoutEdge): boolean {
  return lit === null || lit.has(e.from === 'controller' ? e.to : e.from)
}
