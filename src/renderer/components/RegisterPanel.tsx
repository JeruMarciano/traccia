import type { Gap } from '../../core/types'
import { STRINGS } from '../strings'

/**
 * The register: what the map cannot answer yet, in the order worth answering.
 *
 * Rank is already carried by position, which only says "above" and "below". The gauge says how
 * much: three cells, filled from the left, so two entries next to each other can be told apart
 * at a glance and the mark survives a photocopy. It is drawn rather than styled with a
 * background so it still prints when background graphics are switched off.
 *
 * Separators are dashed, the same mark the map uses for a figure nobody can explain yet: every
 * line here is open, and none of it is a finding.
 */

function Gauge({ severity }: { severity: 1 | 2 | 3 }) {
  const filled = 4 - severity
  return (
    <svg className="entry-gauge" width="21" height="11" viewBox="0 0 21 11" role="img"
         aria-label={STRINGS.priority(severity)}>
      {[0, 1, 2].map((i) => (
        <rect key={i} className={i < filled ? 'gauge-cell gauge-cell--on' : 'gauge-cell'}
              x={i * 8 + 0.5} y={0.5} width={4} height={10} />
      ))}
    </svg>
  )
}

interface Props {
  gaps: Gap[]
  onHover: (subject: string | null) => void
}

export function RegisterPanel({ gaps, onHover }: Props) {
  return (
    <aside className="register">
      <h2 className="register-head">
        <span>{STRINGS.registerHeading}</span>
        <span className="register-count">{gaps.length}</span>
      </h2>
      {gaps.length === 0 ? (
        <p className="register-empty">{STRINGS.registerEmpty}</p>
      ) : (
        <>
          <p className="register-caption">{STRINGS.registerCaption}</p>
          <ol className="register-list">
            {gaps.map((g) => (
              // An entry about the project as a whole has no place to point at, so it is not
              // reachable by keyboard: focusing it would isolate nothing.
              <li key={g.id}
                  className={g.subject === null ? 'entry' : 'entry entry--linked'}
                  tabIndex={g.subject === null ? undefined : 0}
                  onMouseEnter={() => onHover(g.subject)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(g.subject)}
                  onBlur={() => onHover(null)}>
                <Gauge severity={g.severity} />
                <div>
                  <p className="entry-q">{g.question}</p>
                  <p className="entry-why">{g.why}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  )
}
