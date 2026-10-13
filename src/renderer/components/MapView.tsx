import { COLUMN, traced, tracedEdge, type LayoutEdge, type LayoutNode, type LayoutResult, type Mark } from '../../core/layout'
import type { DoorKind } from '../../core/types'
import { drawnText, fontSizeOf, rowText } from '../mapText'
import { MAP_TEXT } from '../mapMetrics'
import { STRINGS } from '../strings'

/**
 * The map, read as a sentence, left to right: whose data, through which way in, into the
 * organisation, out to where it goes. Every stop is a card; a way in draws one line to the
 * organisation and the organisation one line to each row of destinations.
 *
 * Which way in reaches which destination is not a line. It is answered on request: the row under
 * the pointer, or the selected one, keeps what it is connected to at full strength and the rest
 * steps back.
 *
 * Everything here is drawn from the layout: where a card stands, the box its label may fill, the
 * ends of every line. This component decides nothing about position. It picks the words (through
 * mapText) and the marks.
 *
 * Colour repeats the story and never solely carries it: position and label say the same thing,
 * each kind of destination has its own shape of mark, and in print each way in's colour also
 * takes its own dash pattern.
 */

/**
 * A house, drawn in a 16x16 box: roof, then the body with a doorway cut out of it. Drawn rather
 * than fetched, like everything else here, because the app ships without a single outbound request
 * and an icon set would be one.
 */
const HOME_PATH =
  'M 8 1.6 L 15.2 8.2 L 13 8.2 L 13 14.4 L 9.6 14.4 L 9.6 10.6 L 6.4 10.6 L 6.4 14.4 L 3 14.4 L 3 8.2 L 0.8 8.2 Z'
/** One corner for every card on the sheet. */
const RADIUS = 6
const PERSON_R = 4.5
const DOOR_W = 5
const DOOR_H = 16
/** The arrowhead, tip to base. A line stops inside it, so nothing pokes through the tip. */
const HEAD = 6

interface Props {
  layout: LayoutResult
  selected: string | null
  onSelect: (id: string | null) => void
  openGroup: string | null
  onToggleGroup: (group: string | null) => void
  openKind: DoorKind | null
  onToggleKind: (kind: DoorKind | null) => void
  /** The row under the pointer. Held by the caller, like the selection, so this stays a pure drawing. */
  hovered?: string | null
  onHover?: (id: string | null) => void
}

/**
 * The link of a flow diagram: both control points at the horizontal midpoint, so a line leaves and
 * arrives level whatever the drop between its ends. `inset` stops it short of an arrowhead.
 */
function linePath(e: { x1: number; y1: number; x2: number; y2: number }, inset = 0): string {
  const end = e.x2 - inset
  const mid = (e.x1 + end) / 2
  return e.y1 === e.y2 ? `M ${e.x1} ${e.y1} H ${end}` : `M ${e.x1} ${e.y1} C ${mid} ${e.y1} ${mid} ${e.y2} ${end} ${e.y2}`
}

const colourClass = (prefix: string, index: number | undefined): string =>
  `${prefix}--${index === undefined ? 'neutral' : index}`

/** A destination's mark. The shape is the reading: a block for the organisation's own, a ring for
 *  a supplier's, a dashed ring for what nobody has identified. */
function mark(kind: Mark | undefined, x: number, y: number, r: number) {
  return kind === 'internal' ? (
    <rect className="mark mark--internal" x={x - r} y={y - r} width={2 * r} height={2 * r} rx="1.5" />
  ) : (
    <circle className={`mark mark--${kind ?? 'supplier'}`} cx={x} cy={y} r={r} />
  )
}

export function MapView({ layout, selected, onSelect, openGroup, onToggleGroup, openKind, onToggleKind, hovered, onHover }: Props) {
  if (layout.nodes.length === 0) {
    return (
      <figure className="map">
        <figcaption className="map-empty">{STRINGS.mapEmpty}</figcaption>
      </figure>
    )
  }

  // What has the reader's attention: the row under the pointer or, failing that, what stands for
  // the selection on the sheet: the selected row itself or, when it is behind a fold, the row the
  // layout highlighted in its place. With neither on the sheet nothing is dimmed, rather than
  // everything.
  const focus =
    (hovered != null && layout.nodes.some((n) => n.id === hovered) ? hovered : null) ??
    layout.nodes.find((n) => n.id === selected || n.highlighted === true)?.id ??
    null
  const lit = traced(layout, focus)
  const state = (n: LayoutNode): string =>
    `${n.id === selected ? ' selected' : ''}${n.highlighted === true ? ' highlighted' : ''}${lit !== null && !lit.has(n.id) ? ' dim' : ''}`

  function press(id: string, act: () => void) {
    return {
      role: 'button' as const,
      tabIndex: 0,
      onClick: (ev: React.MouseEvent) => {
        ev.stopPropagation()
        act()
      },
      onKeyDown: (ev: React.KeyboardEvent) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return
        ev.preventDefault()
        ev.stopPropagation()
        act()
      },
      onMouseEnter: () => onHover?.(id),
      onMouseLeave: () => onHover?.(null),
    }
  }

  /** The row's words in its box, shortened to fit; the whole of them in the tooltip. */
  function label(n: LayoutNode, extra = '') {
    const box = n.labelBox
    return (
      <>
        <title>{rowText(n)}</title>
        <text
          className={`row-label${n.parent !== undefined ? ' row-label--sub' : ''}${extra}`}
          x={n.anchor === 'middle' ? box.x + box.width / 2 : box.x}
          y={box.y + box.height - 3}
          fontSize={fontSizeOf(n)}
          textAnchor={n.anchor}
        >
          {drawnText(n)}
        </text>
      </>
    )
  }

  const right = (n: LayoutNode): number => n.box.x + n.box.width
  const box = (n: LayoutNode, className: string) => (
    <rect className={className} x={n.box.x} y={n.box.y} width={n.box.width} height={n.box.height} rx={RADIUS} />
  )
  /** A sub-row's band inside its card: what the pointer hits, and what a selection tints. */
  const band = (n: LayoutNode) => (
    <rect className="sub-box" x={n.box.x + 3} y={n.box.y + 1} width={n.box.width - 6} height={n.box.height - 2} rx={RADIUS - 2} />
  )
  /** How many a row holds, quietly, at its right-hand end. */
  const count = (n: LayoutNode, inset: number) =>
    n.count === undefined ? null : (
      <text className="count" x={right(n) - inset} y={n.y + 4} fontSize={MAP_TEXT.sub} textAnchor="end">
        {n.count}
      </text>
    )
  /** The mark that says a card opens, and under an open one the rule that sets its rows apart. */
  function opens(n: LayoutNode) {
    const x = right(n) - 15
    return (
      <>
        <path
          className="chevron"
          d={n.open === true ? `M ${x - 4} ${n.y - 2} l 4 4 l 4 -4` : `M ${x - 2} ${n.y - 4} l 4 4 l -4 4`}
        />
        {n.open === true ? <path className="card-rule" d={`M ${n.box.x} ${2 * n.y - n.box.y} H ${right(n)}`} /> : null}
      </>
    )
  }
  const doorMark = (n: LayoutNode) => (
    <rect
      className={`door-mark door-mark--${n.kind === 'doorGroup' ? 'discovered' : (n.origin ?? 'unsourced')}`}
      x={n.x - DOOR_W / 2}
      y={n.y - DOOR_H / 2}
      width={DOOR_W}
      height={DOOR_H}
      rx="1"
    />
  )

  function drawNode(n: LayoutNode) {
    switch (n.kind) {
      case 'people':
        return (
          <g key={n.id} className="people">
            {box(n, 'card-box')}
          </g>
        )
      case 'subject':
        return (
          <g key={n.id} data-id={n.id} className={`subject${state(n)}`} {...press(n.id, () => onSelect(n.id))}>
            {band(n)}
            <circle className="disc" cx={n.x} cy={n.y} r={PERSON_R} />
            {label(n)}
          </g>
        )
      case 'door':
        return (
          <g
            key={n.id}
            data-id={n.id}
            className={`door door--${n.colourIndex ?? 0}${n.parent !== undefined ? ' door--sub' : ''}${state(n)}`}
            {...press(n.id, () => onSelect(n.id))}
          >
            {n.parent !== undefined ? band(n) : box(n, 'card-box')}
            {n.parent !== undefined ? null : doorMark(n)}
            {label(n)}
          </g>
        )
      case 'doorGroup': {
        const kind = n.doorKind ?? 'form'
        return (
          <g
            key={n.id}
            data-id={n.id}
            className={`fold door--${n.colourIndex ?? 0}${state(n)}`}
            aria-expanded={n.open === true}
            {...press(n.id, () => {
              onSelect(n.id)
              onToggleKind(openKind === kind ? null : kind)
            })}
          >
            {box(n, 'card-box')}
            {doorMark(n)}
            {label(n)}
            {opens(n)}
          </g>
        )
      }
      case 'more': {
        // The row it hangs from is what it stands for: selecting that lists everything it hides.
        const stands = n.id.slice(n.id.indexOf(':') + 1)
        const ofDoors = n.id.startsWith('moreDoors:')
        return (
          <g key={n.id} data-id={n.id} className={`more${state(n)}`} {...press(n.id, () => onSelect(ofDoors ? `doorGroup:${stands}` : stands))}>
            {band(n)}
            {label(n, ' row-soft')}
          </g>
        )
      }
      case 'controller':
        return (
          <g key={n.id} data-id={n.id} className={`controller${state(n)}`} {...press(n.id, () => onSelect(n.id))}>
            {box(n, 'card-box')}
            <path className="home" d={HOME_PATH} transform={`translate(${n.x - 8} ${n.y - 19})`} />
            {label(n)}
          </g>
        )
      case 'group':
        // A purpose inside the fold of purposes is a sub-row: it is selected, and does not open.
        return n.parent !== undefined ? (
          <g key={n.id} data-id={n.id} className={`member node--sub${state(n)}`} {...press(n.id, () => onSelect(n.id))}>
            {band(n)}
            {mark(n.mark, n.x, n.y, 3.5)}
            {label(n)}
            {count(n, 12)}
          </g>
        ) : (
          <g
            key={n.id}
            data-id={n.id}
            className={`node node--${n.mark ?? 'supplier'}${n.open === true ? ' node--open' : ''}${state(n)}`}
            aria-expanded={n.open === true}
            {...press(n.id, () => {
              onSelect(n.id)
              onToggleGroup(openGroup === n.id ? null : n.id)
            })}
          >
            {box(n, 'card-box')}
            {mark(n.mark, n.x, n.y, 4.5)}
            {label(n)}
            {count(n, 26)}
            {opens(n)}
          </g>
        )
      case 'member':
        return (
          <g key={n.id} data-id={n.id} className={`member${state(n)}`} {...press(n.id, () => onSelect(n.id))}>
            {band(n)}
            {mark(n.mark, n.x, n.y, 3.5)}
            {label(n)}
          </g>
        )
    }
  }

  const heads: [{ x: number; width: number }, string][] = [
    [COLUMN.people, STRINGS.headPeople],
    [COLUMN.doors, STRINGS.headDoors],
    [COLUMN.controller, STRINGS.headController],
    [COLUMN.places, STRINGS.headPlaces],
  ]
  const arrow = (e: LayoutEdge) => `M ${e.x2} ${e.y2} l ${-HEAD} ${-HEAD / 2} v ${HEAD} z`

  return (
    <figure className="map">
      <div className="map-scroll">
        <svg
          className="map-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMin meet"
          onMouseLeave={() => onHover?.(null)}
          onClick={() => {
            onSelect(null)
            onToggleGroup(null)
            onToggleKind(null)
          }}
        >
          {heads.map(([column, words]) => (
            <g key={words}>
              <text className="col-head" x={column.x} y="15">
                {words}
              </text>
              <path className="col-rule" d={`M ${column.x} 23.5 h ${column.width}`} />
            </g>
          ))}

          {layout.edges.map((e) => (
            <g key={`${e.from}->${e.to}`} className={`line${tracedEdge(lit, e) ? '' : ' dim'}`}>
              {e.lead === undefined ? null : <path className={`path ${colourClass('path', e.colourIndex)}`} d={linePath(e.lead)} />}
              {/* A touch past the arrowhead's base, so no seam shows between the two. */}
              <path className={`path ${colourClass('path', e.colourIndex)}`} d={linePath(e, HEAD - 1)} />
              <path className={`head ${colourClass('head', e.colourIndex)}`} d={arrow(e)} />
            </g>
          ))}

          {layout.nodes.map(drawNode)}
        </svg>
      </div>

      <figcaption className="legend">
        <span className="key">
          <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle className="disc" cx="9" cy="9" r="6" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyPeople}</span>
            <span className="key-gloss">{STRINGS.keyPeopleGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark key-mark--wide door door--0" width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
            <rect className="door-mark door-mark--discovered" x="3" y="2" width="6" height="14" rx="1" />
            <rect className="door-mark door-mark--declared" x="12" y="2" width="6" height="14" rx="1" />
            <rect className="door-mark door-mark--unsourced" x="21" y="2" width="6" height="14" rx="1" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyDoor}</span>
            <span className="key-gloss">{STRINGS.keyDoorGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path className="path path--neutral" d="M 1 9 H 12" />
            <path className="head head--neutral" d="M 17 9 l -6 -3 v 6 z" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyDirection}</span>
            <span className="key-gloss">{STRINGS.keyDirectionGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            {mark('internal', 9, 9, 6)}
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyInternal}</span>
            <span className="key-gloss">{STRINGS.keyInternalGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            {mark('supplier', 9, 9, 6)}
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyExternal}</span>
            <span className="key-gloss">{STRINGS.keyExternalGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            {mark('unidentified', 9, 9, 6)}
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyOpen}</span>
            <span className="key-gloss">{STRINGS.keyOpenGloss}</span>
          </span>
        </span>
      </figcaption>
    </figure>
  )
}
