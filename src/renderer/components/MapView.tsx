import type { LayoutNode, LayoutResult } from '../../core/layout'
import { STRINGS } from '../strings'

/**
 * The map, read as a sentence, left to right: whose data, through which door, to the controller,
 * onward to whom. Distance says direction. Every line carries an arrowhead at its destination, so
 * nothing on the sheet is ambiguous about which way data moves.
 *
 * A door's colour travels: the line from the person, through the door, through the controller, out
 * to the destination is one colour, and two doors feeding one destination are two parallel lines a
 * reader can follow apart. Colour repeats the story and never solely carries it -- the label and
 * the position say the same thing, and in print each colour also takes its own dash pattern.
 *
 * A purpose group is still a ring, and the ring is still the reading: its circumference divides
 * solid for what somebody has identified, dashed for the share nobody has yet. Green stroke for
 * what the organisation runs itself, ochre for a supplier -- ownership, which distance used to
 * carry and no longer does.
 */

const CONTROLLER_R = 17
const DOOR_W = 13
const DOOR_H = 24
const NODE_MIN_R = 13
const NODE_MAX_R = 21
const SUBJECT_R = 10
const MEMBER_R = 9

interface Props {
  layout: LayoutResult
  selected: string | null
  onSelect: (id: string | null) => void
  openGroup: string | null
  onToggleGroup: (group: string | null) => void
}

function nodeRadius(count: number): number {
  return Math.min(NODE_MAX_R, NODE_MIN_R + Math.sqrt(Math.max(count, 0)) * 4.5)
}

/** An arc of the ring, from `a0` to `a1` radians, clockwise from twelve o'clock. */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number): [number, number] => [
    cx + r * Math.cos(a - Math.PI / 2),
    cy + r * Math.sin(a - Math.PI / 2),
  ]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** How far in from a node's centre a line should stop, so the arrowhead sits off the mark. */
function inset(node: LayoutNode | undefined): number {
  if (node === undefined) return 0
  if (node.kind === 'controller') return CONTROLLER_R + 4
  if (node.kind === 'door') return DOOR_W
  if (node.kind === 'subject') return SUBJECT_R + 2
  if (node.kind === 'member') return MEMBER_R + 4
  return nodeRadius(node.count ?? 0) + 4
}

export function MapView({ layout, selected, onSelect, openGroup, onToggleGroup }: Props) {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  // Isolation has to isolate something. A selection can name a place no mark stands for, and
  // greying the whole sheet in that case would say the map had gone away.
  const isolating = selected !== null && byId.has(selected)
  const dim = (id: string): string => (isolating && id !== selected ? ' dim' : '')

  const subjects = layout.nodes.filter((n) => n.kind === 'subject')
  const doors = layout.nodes.filter((n) => n.kind === 'door')
  const controller = layout.nodes.find((n) => n.kind === 'controller')
  const groups = layout.nodes.filter((n) => n.kind === 'group')
  const opened = groups.filter((n) => n.open === true)
  const closed = groups.filter((n) => n.open !== true)
  const members = layout.nodes.filter((n) => n.kind === 'member')

  function select(id: string, alsoToggle?: string) {
    const act = (): void => {
      onSelect(id)
      if (alsoToggle !== undefined) onToggleGroup(openGroup === alsoToggle ? null : alsoToggle)
    }
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

  if (layout.nodes.length === 0) {
    return (
      <figure className="map">
        <figcaption className="map-empty">{STRINGS.mapEmpty}</figcaption>
      </figure>
    )
  }

  return (
    <figure className="map">
      <svg
        className="map-svg"
        viewBox="0 0 800 500"
        preserveAspectRatio="xMidYMid meet"
        onClick={() => {
          onSelect(null)
          onToggleGroup(null)
        }}
      >
        <defs>
          <marker
            id="arrow"
            className="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>

        {layout.edges.map((e, i) => {
          const a = byId.get(e.from)
          const b = byId.get(e.to)
          if (!a || !b) return null
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
          const ux = (b.x - a.x) / len
          const uy = (b.y - a.y) / len
          const faded = isolating && e.from !== selected && e.to !== selected ? ' dim' : ''
          const colour = e.colourIndex === undefined ? 'path--neutral' : `path--${e.colourIndex}`
          return (
            <line
              key={`${e.from}->${e.to}-${i}`}
              className={`path ${colour}${faded}`}
              markerEnd="url(#arrow)"
              x1={a.x + ux * inset(a)}
              y1={a.y + uy * inset(a)}
              x2={b.x - ux * inset(b)}
              y2={b.y - uy * inset(b)}
            />
          )
        })}

        {subjects.map((n) => (
          <g key={n.id} className={`subject${dim(n.id)}`} {...select(n.id)}>
            <circle className="disc" cx={n.x} cy={n.y} r={SUBJECT_R} />
            <text className="subject-label" x={n.x} y={n.y + SUBJECT_R + 14} textAnchor="middle">
              {n.label}
            </text>
          </g>
        ))}

        {doors.map((n) => (
          <g key={n.id} className={`door door--${n.colourIndex ?? 0}${dim(n.id)}`} {...select(n.id)}>
            <rect
              className="door-mark"
              x={n.x - DOOR_W / 2}
              y={n.y - DOOR_H / 2}
              width={DOOR_W}
              height={DOOR_H}
              rx="2"
            />
            <text className="door-label" x={n.x} y={n.y + DOOR_H / 2 + 14} textAnchor="middle">
              {n.label}
            </text>
            <text className="door-origin" x={n.x} y={n.y + DOOR_H / 2 + 26} textAnchor="middle">
              {n.origin === 'discovered' ? STRINGS.doorDiscovered : STRINGS.doorDeclared}
            </text>
          </g>
        ))}

        {controller === undefined ? null : (
          <g className={`controller${dim(controller.id)}`} {...select(controller.id)}>
            <circle className="disc-halo" cx={controller.x} cy={controller.y} r={CONTROLLER_R + 7} />
            <circle className="disc" cx={controller.x} cy={controller.y} r={CONTROLLER_R} />
            {/* The name sits under the disc, not inside it. At this size the disc holds a mark,
                not a sentence, and a name shrunk to fit inside would be unreadable. */}
            <text
              className="controller-label"
              x={controller.x}
              y={controller.y + CONTROLLER_R + 15}
              textAnchor="middle"
            >
              {controller.label === '' ? STRINGS.yourOrganisation : controller.label}
            </text>
          </g>
        )}

        {/* An open ring: a faint boundary drawn round its members, still clickable, because it
            is the way back to the closed reading. Its count sits at the centre, so what the ring
            holds stays legible with the members set out around it. */}
        {opened.map((n) => {
          const boundary = (n.openRadius ?? nodeRadius(n.count ?? 0)) + MEMBER_R + 7
          return (
            <g
              key={n.id}
              className={`node node--${n.internal ? 'internal' : 'external'} node--opened${dim(n.id)}`}
              {...select(n.id, n.label)}
            >
              <title>{STRINGS.groupTitle(n.label, n.count ?? 0)}</title>
              <circle className="node-boundary" cx={n.x} cy={n.y} r={boundary} />
              <circle className="node-fill node-fill--opened" cx={n.x} cy={n.y} r={13} />
              <text className="node-count node-count--opened" x={n.x} y={n.y + 4} textAnchor="middle">
                {n.count ?? 0}
              </text>
              <text className="node-label" x={n.x} y={n.y + boundary + 14} textAnchor="middle">
                {n.label}
              </text>
            </g>
          )
        })}

        {closed.map((n) => {
          const count = n.count ?? 0
          const open = n.unexplained ?? 0
          const r = nodeRadius(count)
          // The ring, divided in proportion: what is identified, then what is not. A group with
          // nothing open is one unbroken circle; one entirely open is all dashes.
          const known = count > 0 ? (count - open) / count : 0
          const split = known * Math.PI * 2
          const full = Math.PI * 2 - 0.0001
          return (
            <g
              key={n.id}
              className={`node node--${n.internal ? 'internal' : 'external'}${dim(n.id)}`}
              {...select(n.id, n.label)}
            >
              <title>{STRINGS.groupTitle(n.label, count)}</title>
              <circle className="node-fill" cx={n.x} cy={n.y} r={r} />
              {/* A ring that is entirely one thing is a circle, not an arc: an arc drawn from 0 to
                  2π starts and ends at the same point and renders as nothing. */}
              {open === 0 ? (
                <circle className="node-arc" cx={n.x} cy={n.y} r={r} fill="none" />
              ) : open === count ? (
                <circle className="node-arc node-arc--open" cx={n.x} cy={n.y} r={r} fill="none" />
              ) : (
                <>
                  <path className="node-arc" d={arcPath(n.x, n.y, r, 0, split)} />
                  <path className="node-arc node-arc--open" d={arcPath(n.x, n.y, r, split, full)} />
                </>
              )}
              <text className="node-count" x={n.x} y={n.y + 5} textAnchor="middle">
                {count}
              </text>
              <text className="node-label" x={n.x} y={n.y + r + 15} textAnchor="middle">
                {n.label}
              </text>
            </g>
          )
        })}

        {members.map((n) => (
          <g
            key={n.id}
            className={`node node--${n.internal ? 'internal' : 'external'}${dim(n.id)}`}
            {...select(n.id)}
          >
            <circle
              className={`node-member${(n.unexplained ?? 0) > 0 ? ' node-member--open' : ''}`}
              cx={n.x}
              cy={n.y}
              r={MEMBER_R}
            />
            <text className="node-label" x={n.x} y={n.y + MEMBER_R + 14} textAnchor="middle">
              {n.label}
            </text>
          </g>
        ))}
      </svg>

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
          <svg className="key-mark door door--0" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect className="door-mark" x="6" y="2" width="6" height="14" rx="1" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyDoor}</span>
            <span className="key-gloss">{STRINGS.keyDoorGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <line className="path path--neutral" x1="0" y1="9" x2="13" y2="9" markerEnd="url(#arrow)" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyDirection}</span>
            <span className="key-gloss">{STRINGS.keyDirectionGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg
            className="key-mark node node--internal"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
          >
            <circle className="node-arc" cx="9" cy="9" r="7" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyInternal}</span>
            <span className="key-gloss">{STRINGS.keyInternalGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg
            className="key-mark node node--external"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
          >
            <circle className="node-arc" cx="9" cy="9" r="7" />
          </svg>
          <span>
            <span className="key-term">{STRINGS.keyExternal}</span>
            <span className="key-gloss">{STRINGS.keyExternalGloss}</span>
          </span>
        </span>
        <span className="key">
          <svg
            className="key-mark node node--external"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
          >
            <circle className="node-arc node-arc--open" cx="9" cy="9" r="7" />
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
