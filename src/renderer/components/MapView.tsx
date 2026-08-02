import type { LayoutNode, LayoutResult } from '../../core/layout'
import { STRINGS } from '../strings'

/**
 * The map: people at the centre, purpose groups in orbit around them, one line per group.
 *
 * A group is a ring rather than a box, and the ring is the reading. Its circumference is
 * divided in proportion: solid for the places somebody has identified, dashed for the share
 * nobody has yet. So "how much of this do we actually know?" is answered by the shape of the
 * mark before any number is read — and it stays answered on a photocopy, because the
 * distinction is a dash and not a hue.
 *
 * Distance from the centre says whose the thing is: the inner orbit is what the organisation
 * runs itself, the outer is everyone else (see computeLayout). Colour repeats that, and
 * repeats it only — green inside, ochre outside — so nothing is lost in black and white.
 */

const HUB_R = 44
/** A group's ring: floor, plus a little for each place, capped so two orbits never collide. */
const NODE_MIN_R = 23
const NODE_MAX_R = 40

interface Props {
  layout: LayoutResult
  selected: string | null
  onSelect: (id: string | null) => void
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

/** Two slanted strokes across the middle of a line: the data crosses out of the area. */
function breakStrokes(
  a: LayoutNode,
  b: LayoutNode,
): { x1: number; y1: number; x2: number; y2: number }[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return [-1, 1].map((k) => {
    const cx = a.x + dx * 0.5 + ux * k * 4
    const cy = a.y + dy * 0.5 + uy * k * 4
    return {
      x1: cx - uy * 5.5 + ux * 2.2,
      y1: cy + ux * 5.5 + uy * 2.2,
      x2: cx + uy * 5.5 - ux * 2.2,
      y2: cy - ux * 5.5 - uy * 2.2,
    }
  })
}

export function MapView({ layout, selected, onSelect }: Props) {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  // Isolation has to isolate something. A selection can name a place no ring stands for, and
  // greying the whole sheet in that case would say the map had gone away.
  const isolating = selected !== null && byId.has(selected)
  const dim = (id: string): string => (isolating && id !== selected ? ' dim' : '')
  const groups = layout.nodes.filter((n) => n.kind === 'group')
  const hub = layout.nodes.find((n) => n.kind === 'subject')

  // The orbits themselves, drawn once each: two groups on the same ring share a radius, and
  // the faint circle through them is what makes "inner" and "outer" legible as structure
  // rather than as an accident of where the tiles landed.
  const orbits = hub
    ? [...new Set(groups.map((g) => Math.round(Math.hypot(g.x - hub.x, g.y - hub.y))))]
        .filter((r) => r > HUB_R)
        .sort((a, b) => a - b)
    : []

  function select(id: string) {
    return {
      role: 'button' as const,
      tabIndex: 0,
      onClick: (ev: React.MouseEvent) => {
        ev.stopPropagation()
        onSelect(id)
      },
      onKeyDown: (ev: React.KeyboardEvent) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return
        ev.preventDefault()
        ev.stopPropagation()
        onSelect(id)
      },
    }
  }

  return (
    <figure className="map">
      {groups.length === 0 ? (
        <figcaption className="map-empty">{STRINGS.mapEmpty}</figcaption>
      ) : (
        <>
          <svg
            className="map-svg"
            viewBox="0 0 800 500"
            preserveAspectRatio="xMidYMid meet"
            onClick={() => onSelect(null)}
          >
            {hub === undefined
              ? null
              : orbits.map((r) => (
                  <circle key={r} className="orbit" cx={hub.x} cy={hub.y} r={r} />
                ))}

            {layout.edges.map((e) => {
              const a = byId.get(e.from)
              const b = byId.get(e.to)
              if (!a || !b) return null
              const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
              const ux = (b.x - a.x) / len
              const uy = (b.y - a.y) / len
              const r = nodeRadius(b.count ?? 0)
              const faded = isolating && e.from !== selected && e.to !== selected ? ' dim' : ''
              const internal = (b.count ?? 0) > 0 && (b.unexplained ?? 0) === 0 && b.internal
              return (
                <g key={`${e.from}->${e.to}`} className={`edge${faded}`}>
                  <line
                    className={`link ${b.internal ? 'link--internal' : 'link--external'}`}
                    style={{ ['--dash' as string]: `${Math.round(len)}` }}
                    x1={a.x + ux * (HUB_R + 5)}
                    y1={a.y + uy * (HUB_R + 5)}
                    x2={b.x - ux * r}
                    y2={b.y - uy * r}
                    data-internal={internal ? 'yes' : undefined}
                  />
                  {b.leavesEEA
                    ? breakStrokes(a, b).map((s, i) => (
                        <line key={i} className="crossing" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                      ))
                    : null}
                </g>
              )
            })}

            {hub === undefined ? null : (
              <g className={`subject${dim(hub.id)}`} {...select(hub.id)}>
                <circle className="disc-halo" cx={hub.x} cy={hub.y} r={HUB_R + 9} />
                <circle className="disc" cx={hub.x} cy={hub.y} r={HUB_R} />
                <text
                  className="disc-label"
                  x={hub.x}
                  y={(hub.count ?? 0) > 0 ? hub.y - 1 : hub.y + 4}
                  textAnchor="middle"
                >
                  {STRINGS.people.toUpperCase()}
                </text>
                {(hub.count ?? 0) > 0 ? (
                  <text className="disc-count" x={hub.x} y={hub.y + 14} textAnchor="middle">
                    {STRINGS.subjectGroupCount(hub.count ?? 0)}
                  </text>
                ) : null}
              </g>
            )}

            {groups.map((n) => {
              const count = n.count ?? 0
              const open = n.unexplained ?? 0
              const r = nodeRadius(count)
              // The ring, divided in proportion: what is identified, then what is not. A group
              // with nothing open is one unbroken circle; one entirely open is all dashes.
              const known = count > 0 ? (count - open) / count : 0
              const split = known * Math.PI * 2
              const full = Math.PI * 2 - 0.0001
              return (
                <g
                  key={n.id}
                  className={`node node--${n.internal ? 'internal' : 'external'}${dim(n.id)}`}
                  {...select(n.id)}
                >
                  <title>{STRINGS.groupTitle(n.label, count)}</title>
                  <circle className="node-fill" cx={n.x} cy={n.y} r={r} />
                  {/* A ring that is entirely one thing is a circle, not an arc: an arc drawn
                      from 0 to 2π starts and ends at the same point and renders as nothing. */}
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
                  <text className="node-count" x={n.x} y={n.y + 6} textAnchor="middle">
                    {count}
                  </text>
                  <text className="node-label" x={n.x} y={n.y + r + 15} textAnchor="middle">
                    {n.label}
                  </text>
                  {n.leavesEEA ? (
                    <text className="node-eea" x={n.x} y={n.y + r + 27} textAnchor="middle">
                      {STRINGS.leavingCount(n.leavesEEA)}
                    </text>
                  ) : null}
                </g>
              )
            })}
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
            <span className="key">
              <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <line className="link" x1="0" y1="9" x2="18" y2="9" />
                <line className="crossing" x1="5" y1="14.5" x2="8" y2="3.5" />
                <line className="crossing" x1="10" y1="14.5" x2="13" y2="3.5" />
              </svg>
              <span>
                <span className="key-term">{STRINGS.keyCrossing}</span>
                <span className="key-gloss">{STRINGS.keyCrossingGloss}</span>
              </span>
            </span>
          </figcaption>
        </>
      )}
    </figure>
  )
}
