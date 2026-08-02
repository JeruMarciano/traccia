import type { LayoutNode, LayoutResult } from '../../core/layout'
import { STRINGS } from '../strings'

/**
 * The map. People at the centre, purpose groups one remove out, one line per group.
 *
 * The drawing uses four marks and nothing else: a filled disc for people, a ruled tile for a
 * group, a solid cell for a figure somebody recorded, a dashed cell for a figure nobody can
 * explain yet, and a break mark across a line whose data leaves the EEA. The key underneath
 * names all four, because the notation is not common knowledge and the sheet is often read on
 * paper by someone seeing it for the first time.
 */

const DISC_R = 46
const TILE_W = 152
/** Name and place count. */
const TILE_HEAD = 34
const ROW_H = 16
const PAD = 10
const CELL_W = 15
const CELL_H = 11

interface Props {
  layout: LayoutResult
  selected: string | null
  onSelect: (id: string | null) => void
}

interface Row {
  figure: number
  label: string
  /** Dashed: a count of things nobody has answered for yet. */
  open: boolean
}

function rowsOf(n: LayoutNode): Row[] {
  const rows: Row[] = []
  if (n.leavesEEA) rows.push({ figure: n.leavesEEA, label: STRINGS.outsideEEA, open: false })
  if (n.unexplained) {
    rows.push({ figure: n.unexplained, label: STRINGS.notYetIdentified, open: true })
  }
  return rows
}

function tileHeight(rows: number): number {
  return rows === 0 ? TILE_HEAD : TILE_HEAD + rows * ROW_H + 5
}

/** Two slanted strokes across the middle of a line: the data crosses out of the area. */
function breakStrokes(a: LayoutNode, b: LayoutNode): { x1: number; y1: number; x2: number; y2: number }[] {
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
  // Isolation has to isolate something. A register entry can name a place that no tile stands
  // for yet, and greying the whole sheet in that case would say the map had gone away.
  const isolating = selected !== null && byId.has(selected)
  const dim = (id: string): string => (isolating && id !== selected ? ' dim' : '')
  const groups = layout.nodes.filter((n) => n.kind === 'group')

  return (
    <figure className="map">
      <svg className="map-svg" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid meet"
           onClick={() => onSelect(null)}>
        {layout.edges.map((e) => {
          const a = byId.get(e.from)
          const b = byId.get(e.to)
          if (!a || !b) return null
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
          const inset = a.kind === 'subject' ? DISC_R + 4 : 0
          const faded = isolating && e.from !== selected && e.to !== selected ? ' dim' : ''
          return (
            <g key={`${e.from}->${e.to}`} className={`edge${faded}`}>
              <line className="link"
                    x1={a.x + ((b.x - a.x) / len) * inset}
                    y1={a.y + ((b.y - a.y) / len) * inset}
                    x2={b.x} y2={b.y} />
              {b.leavesEEA
                ? breakStrokes(a, b).map((s, i) => (
                    <line key={i} className="crossing" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                  ))
                : null}
            </g>
          )
        })}

        {layout.nodes.map((n) => {
          if (n.kind === 'subject') {
            const count = n.count ?? 0
            return (
              <g key={n.id} className={`subject${dim(n.id)}`} role="button" tabIndex={0}
                 onClick={(ev) => {
                   ev.stopPropagation()
                   onSelect(n.id)
                 }}
                 onKeyDown={(ev) => {
                   if (ev.key !== 'Enter' && ev.key !== ' ') return
                   ev.preventDefault()
                   ev.stopPropagation()
                   onSelect(n.id)
                 }}>
                <circle className="disc" cx={n.x} cy={n.y} r={DISC_R} />
                <text className="disc-label" x={n.x} y={count > 0 ? n.y - 1 : n.y + 4}
                      textAnchor="middle">
                  {STRINGS.people.toUpperCase()}
                </text>
                {count > 0 ? (
                  <text className="disc-count" x={n.x} y={n.y + 14} textAnchor="middle">
                    {STRINGS.subjectGroupCount(count)}
                  </text>
                ) : null}
              </g>
            )
          }

          const rows = rowsOf(n)
          const h = tileHeight(rows.length)
          const x0 = n.x - TILE_W / 2
          const y0 = n.y - h / 2
          return (
            <g key={n.id} className={`tile${dim(n.id)}`} role="button" tabIndex={0}
               onClick={(ev) => {
                 ev.stopPropagation()
                 onSelect(n.id)
               }}
               onKeyDown={(ev) => {
                 if (ev.key !== 'Enter' && ev.key !== ' ') return
                 ev.preventDefault()
                 ev.stopPropagation()
                 onSelect(n.id)
               }}>
              <title>{STRINGS.groupTitle(n.label, n.count ?? 0)}</title>
              <rect className="tile-box" x={x0} y={y0} width={TILE_W} height={h} />
              <text className="tile-name" x={x0 + PAD} y={y0 + 14}>
                {n.label.toUpperCase()}
              </text>
              <text className="tile-count" x={x0 + PAD} y={y0 + 27}>
                {STRINGS.placesInGroup(n.count ?? 0)}
              </text>
              {rows.length > 0 ? (
                <line className="tile-div" x1={x0} y1={y0 + TILE_HEAD} x2={x0 + TILE_W}
                      y2={y0 + TILE_HEAD} />
              ) : null}
              {rows.map((row, i) => {
                const top = y0 + TILE_HEAD + 3 + i * ROW_H
                return (
                  <g key={row.label}>
                    <rect className={row.open ? 'cell cell--open' : 'cell'} x={x0 + PAD + 0.5}
                          y={top + 0.5} width={CELL_W} height={CELL_H} />
                    <text className="cell-figure" x={x0 + PAD + CELL_W / 2} y={top + 8.5}
                          textAnchor="middle">
                      {row.figure}
                    </text>
                    <text className="tile-row" x={x0 + PAD + CELL_W + 8} y={top + 8.5}>
                      {row.label}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>

      {groups.length === 0 ? (
        <figcaption className="map-empty">{STRINGS.mapEmpty}</figcaption>
      ) : (
        <figcaption className="legend">
          <span className="key">
            <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <circle className="disc" cx="9" cy="9" r="8" />
            </svg>
            <span>
              <span className="key-term">{STRINGS.keyPeople}</span>
              <span className="key-gloss">{STRINGS.keyPeopleGloss}</span>
            </span>
          </span>
          <span className="key">
            <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <rect className="cell" x="0.5" y="3.5" width="17" height="11" />
            </svg>
            <span>
              <span className="key-term">{STRINGS.keyRecorded}</span>
              <span className="key-gloss">{STRINGS.keyRecordedGloss}</span>
            </span>
          </span>
          <span className="key">
            <svg className="key-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <rect className="cell cell--open" x="0.5" y="3.5" width="17" height="11" />
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
      )}
    </figure>
  )
}
