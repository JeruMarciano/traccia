import type { Gap } from '../../core/types'
import { STRINGS } from '../strings'

interface Props {
  gaps: Gap[]
  onHover: (subject: string | null) => void
}

export function RegisterPanel({ gaps, onHover }: Props) {
  return (
    <aside style={{ width: 280, borderLeft: '1px solid #D8D4CB', padding: 16 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
        {STRINGS.registerHeading(gaps.length)}
      </h2>
      {gaps.length === 0 ? (
        <p style={{ fontSize: 12, color: '#9C978E' }}>{STRINGS.registerEmpty}</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {gaps.map((g) => (
            <li key={g.id}
                onMouseEnter={() => onHover(g.subject)}
                onMouseLeave={() => onHover(null)}
                style={{ padding: '10px 0', borderBottom: '1px solid #D8D4CB' }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{g.question}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6B6459' }}>{g.why}</p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
