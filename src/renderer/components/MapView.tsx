import { COLUMN, type LayoutEdge, type LayoutNode, type LayoutResult } from '../../core/layout'
import type { DoorKind } from '../../core/types'
import { drawnText, fontSizeOf, rowSuffix, rowText } from '../mapText'
import { STRINGS } from '../strings'

/**
 * The map, read as a sentence, left to right: whose data, through which way in, across the
 * organisation, to where it goes. The organisation is a bar; a way in's line crosses it at the way
 * in's own height and runs on to its destinations, one colour from the person to the place.
 *
 * Everything here is drawn from the layout: where a row stands, the box its label may fill, the
 * ends of every line. This component decides nothing about position. It picks the words (through
 * mapText) and the marks.
 *
 * Colour repeats the story and never solely carries it: position and label say the same thing,
 * and in print each colour also takes its own dash pattern.
 */

/**
 * A house, drawn in a 16x16 box: roof, then the body with a doorway cut out of it. Drawn rather
 * than fetched, like everything else here, because the app ships without a single outbound request
 * and an icon set would be one.
 */
const HOME_PATH =
  'M 8 1.6 L 15.2 8.2 L 13 8.2 L 13 14.4 L 9.6 14.4 L 9.6 10.6 L 6.4 10.6 L 6.4 14.4 L 3 14.4 L 3 8.2 L 0.8 8.2 Z'
const PERSON_R = 8
const HOUSE_R = 13
const RING_R = 11
const MEMBER_R = 4.5
const DOOR_W = 7
const DOOR_H = 18

interface Props {
  layout: LayoutResult
  selected: string | null
  onSelect: (id: string | null) => void
  openGroup: string | null
  onToggleGroup: (group: string | null) => void
  openKind: DoorKind | null
  onToggleKind: (kind: DoorKind | null) => void
}

/** Level lines are straight; the rest leave and arrive level, with a curve between. */
function linePath(e: LayoutEdge): string {
  return e.y1 === e.y2
    ? `M ${e.x1} ${e.y1} H ${e.x2}`
    : `M ${e.x1} ${e.y1} C ${e.c1x} ${e.y1} ${e.c2x} ${e.y2} ${e.x2} ${e.y2}`
}

const colourClass = (prefix: string, index: number | undefined): string =>
  `${prefix}--${index === undefined ? 'neutral' : index}`

export function MapView({ layout, selected, onSelect, openGroup, onToggleGroup, openKind, onToggleKind }: Props) {
  if (layout.nodes.length === 0) {
    return (
      <figure className="map">
        <figcaption className="map-empty">{STRINGS.mapEmpty}</figcaption>
      </figure>
    )
  }

  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  // What stands for the selection on the sheet: the selected row itself or, when it is behind a
  // fold, the row the layout highlighted in its place. Isolation has to isolate something: with
  // neither on the sheet nothing is dimmed, rather than everything.
  const focus = layout.nodes.find((n) => n.id === selected || n.highlighted === true)?.id ?? null
  // A row is lit when it is the focus or hangs from it: opening a fold must not grey its own rows.
  const lit = (id: string | undefined): boolean =>
    id !== undefined && (id === focus || byId.get(id)?.parent === focus)
  const state = (n: LayoutNode): string =>
    `${n.highlighted === true ? ' highlighted' : ''}${focus !== null && !lit(n.id) ? ' dim' : ''}`
  const faded = (e: LayoutEdge): string =>
    focus !== null && !lit(e.from) && !lit(e.to) && !lit(e.door) ? ' dim' : ''

  function press(act: () => void) {
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
    }
  }

  /** The row's words in its box, shortened to fit; the whole of them in the tooltip. */
  function label(n: LayoutNode, extra = '', caret: string | null = null) {
    const { text, suffix } = drawnText(n)
    const box = n.labelBox
    return (
      <>
        <title>{`${rowText(n)}${rowSuffix(n) === '' ? '' : ` · ${rowSuffix(n)}`}`}</title>
        <text
          className={`row-label${n.parent !== undefined ? ' row-label--sub' : ''}${extra}`}
          x={n.anchor === 'end' ? box.x + box.width : box.x}
          y={box.y + box.height - 3}
          fontSize={fontSizeOf(n)}
          textAnchor={n.anchor}
        >
          {text}
          {suffix === '' ? null : <tspan className="row-soft">{` · ${suffix}`}</tspan>}
          {caret === null ? null : (
            <tspan className="row-soft" dx="6" aria-hidden="true">
              {caret}
            </tspan>
          )}
        </text>
      </>
    )
  }

  /** The bracket from a row down to one of its sub-rows. */
  function bracket(n: LayoutNode, dropFrom: number, reach: number) {
    const parent = n.parent === undefined ? undefined : byId.get(n.parent)
    if (parent === undefined) return null
    return <path className="bracket" d={`M ${parent.x} ${parent.y + dropFrom} V ${n.y} H ${n.x + reach}`} />
  }

  function drawNode(n: LayoutNode) {
    switch (n.kind) {
      case 'subject':
        return (
          <g key={n.id} data-id={n.id} className={`subject${state(n)}`} {...press(() => onSelect(n.id))}>
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
            {...press(() => onSelect(n.id))}
          >
            {n.parent !== undefined ? (
              bracket(n, DOOR_H / 2, -4)
            ) : (
              <rect
                className={`door-mark door-mark--${n.origin ?? 'unsourced'}`}
                x={n.x - DOOR_W / 2}
                y={n.y - DOOR_H / 2}
                width={DOOR_W}
                height={DOOR_H}
              />
            )}
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
            {...press(() => {
              onSelect(n.id)
              onToggleKind(openKind === kind ? null : kind)
            })}
          >
            <rect className="door-mark door-mark--discovered" x={n.x - DOOR_W / 2} y={n.y - DOOR_H / 2} width={DOOR_W} height={DOOR_H} />
            {label(n, '', n.open === true ? '▾' : '▸')}
          </g>
        )
      }
      case 'more': {
        const ofDoors = n.id.startsWith('moreDoors:')
        const stands = ofDoors ? `doorGroup:${n.doorKind ?? 'form'}` : `group:${n.id.slice('more:'.length)}`
        return (
          <g
            key={n.id}
            data-id={n.id}
            className={`more${ofDoors ? ` door--${n.colourIndex ?? 0}` : ''}${state(n)}`}
            {...press(() => onSelect(stands))}
          >
            {ofDoors ? bracket(n, DOOR_H / 2, -4) : bracket(n, RING_R, -MEMBER_R - 3)}
            {label(n, ' row-soft')}
          </g>
        )
      }
      case 'controller':
        return (
          <g key={n.id} data-id={n.id} className={`controller${state(n)}`} {...press(() => onSelect(n.id))}>
            <circle className="disc" cx={n.x} cy={n.y} r={HOUSE_R} />
            <path className="disc-home" d={HOME_PATH} transform={`translate(${n.x - 8} ${n.y - 8})`} />
            {label(n)}
          </g>
        )
      case 'group': {
        const total = n.count ?? 0
        const circumference = 2 * Math.PI * RING_R
        // The ring, divided in proportion: solid for what somebody has identified, dashed for the
        // share nobody has yet. The dashed ring lies under the solid arc, so a group with nothing
        // open is one unbroken circle and one entirely open is all dashes.
        const known = total > 0 ? (total - (n.unexplained ?? 0)) / total : 0
        return (
          <g
            key={n.id}
            data-id={n.id}
            className={`node node--${n.internal ? 'internal' : 'external'}${n.open === true ? ' node--open' : ''}${state(n)}`}
            aria-expanded={n.open === true}
            {...press(() => {
              onSelect(n.id)
              onToggleGroup(openGroup === n.label ? null : n.label)
            })}
          >
            <circle className="ring" cx={n.x} cy={n.y} r={RING_R} />
            <circle
              className="ring-known"
              cx={n.x}
              cy={n.y}
              r={RING_R}
              strokeDasharray={`${(circumference * known).toFixed(2)} ${circumference.toFixed(2)}`}
              transform={`rotate(-90 ${n.x} ${n.y})`}
            />
            <text className="ring-count" x={n.x} y={n.y + 4} textAnchor="middle">
              {total}
            </text>
            {label(n)}
          </g>
        )
      }
      case 'member':
        return (
          <g
            key={n.id}
            data-id={n.id}
            className={`member node--${n.internal ? 'internal' : 'external'}${state(n)}`}
            {...press(() => onSelect(n.id))}
          >
            {bracket(n, RING_R, -MEMBER_R - 3)}
            <circle
              className={`member-mark${(n.unexplained ?? 0) > 0 ? ' member-mark--open' : ''}`}
              cx={n.x}
              cy={n.y}
              r={MEMBER_R}
            />
            {label(n, (n.unexplained ?? 0) > 0 ? ' row-soft' : '')}
          </g>
        )
    }
  }

  const controller = byId.get('controller')
  const spine = controller?.spine

  return (
    <figure className="map">
      <div className="map-scroll">
        <svg
          className="map-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMin meet"
          onClick={() => {
            onSelect(null)
            onToggleGroup(null)
            onToggleKind(null)
          }}
        >
          <text className="col-head" x={COLUMN.person + PERSON_R} y="14" textAnchor="end">
            {STRINGS.headPeople}
          </text>
          <text className="col-head" x={COLUMN.door - DOOR_W / 2} y="14">
            {STRINGS.headDoors}
          </text>
          <text className="col-head" x={COLUMN.ring - RING_R} y="14">
            {STRINGS.headPlaces}
          </text>

          {spine === undefined ? null : (
            <rect className="spine" x={spine.x} y={spine.y} width={spine.width} height={spine.height} rx={spine.width / 2} />
          )}

          {layout.edges.map((e, i) => (
            <g key={`${e.from}->${e.to}-${i}`} className={`line${faded(e)}`}>
              <path className={`path ${colourClass('path', e.colourIndex)}`} d={linePath(e)} />
              {/* Inside the bar: from the height the door came in at to the point this line leaves from. */}
              {e.entryY === undefined || spine === undefined ? null : (
                <path
                  className={`path ${colourClass('path', e.colourIndex)}`}
                  d={`M ${spine.x} ${e.entryY} L ${spine.x + spine.width} ${e.y1}`}
                />
              )}
              {e.arrow ? (
                <path className={`head ${colourClass('head', e.colourIndex)}`} d={`M ${e.x2} ${e.y2} l -7 -3.5 v 7 z`} />
              ) : null}
            </g>
          ))}

          {layout.nodes.map(drawNode)}
        </svg>
      </div>

      <figcaption className="legend">
        <span className="key">
          <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle className="disc" cx="9" cy="9" r="7" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyPeople}</span>
            <span className="key-gloss">{STRINGS.keyPeopleGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark key-mark--wide door door--0" width="30" height="18" viewBox="0 0 30 18" aria-hidden="true">
            <rect className="door-mark door-mark--discovered" x="3" y="2" width="6" height="14" />
            <rect className="door-mark door-mark--declared" x="12" y="2" width="6" height="14" />
            <rect className="door-mark door-mark--unsourced" x="21" y="2" width="6" height="14" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyDoor}</span>
            <span className="key-gloss">{STRINGS.keyDoorGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path className="path path--neutral" d="M 0 9 H 16" />
            <path className="head head--neutral" d="M 16 9 l -7 -3.5 v 7 z" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyDirection}</span>
            <span className="key-gloss">{STRINGS.keyDirectionGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark node node--internal" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle className="ring-known" cx="9" cy="9" r="7" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyInternal}</span>
            <span className="key-gloss">{STRINGS.keyInternalGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark node node--external" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle className="ring-known" cx="9" cy="9" r="7" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyExternal}</span>
            <span className="key-gloss">{STRINGS.keyExternalGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark node node--external" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle className="ring" cx="9" cy="9" r="7" />
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
