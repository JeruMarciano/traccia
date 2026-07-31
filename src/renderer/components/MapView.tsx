import type { LayoutResult } from '../../core/layout'

interface Props {
  layout: LayoutResult
  selected: string | null
  onSelect: (id: string | null) => void
}

export function MapView({ layout, selected, onSelect }: Props) {
  return (
    <svg viewBox="0 0 800 500" style={{ width: '100%', display: 'block' }}
         onClick={() => onSelect(null)}>
      {layout.edges.map((e) => {
        const a = layout.nodes.find((n) => n.id === e.from)
        const b = layout.nodes.find((n) => n.id === e.to)
        if (!a || !b) return null
        return (
          <line key={`${e.from}->${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#17171A" strokeWidth={1.5} />
        )
      })}

      {layout.nodes.map((n) => {
        const dim = selected !== null && selected !== n.id
        if (n.kind === 'subject') {
          return (
            <g key={n.id} opacity={dim ? 0.25 : 1}>
              <circle cx={n.x} cy={n.y} r={44} fill="#17171A" />
              <text x={n.x} y={n.y + 4} textAnchor="middle" fill="#F7F6F2" fontSize={13}>
                {n.label}
              </text>
            </g>
          )
        }
        return (
          <g key={n.id} opacity={dim ? 0.25 : 1} style={{ cursor: 'pointer' }}
             onClick={(ev) => { ev.stopPropagation(); onSelect(n.id) }}>
            <rect x={n.x - 70} y={n.y - 28} width={140} height={56}
                  fill="#F7F6F2" stroke="#17171A" strokeWidth={1.5} />
            <rect x={n.x - 70} y={n.y - 28} width={140} height={7} fill="#17171A" />
            <text x={n.x - 58} y={n.y + 1} fontSize={10.5} fontWeight={700}>{n.label}</text>
            <text x={n.x - 58} y={n.y + 15} fontSize={9} fill="#9C978E">{n.count} places</text>
            {n.leavesEEA ? (
              <>
                <rect x={n.x + 20} y={n.y + 5} width={22} height={15} fill="#E2411E" />
                <text x={n.x + 31} y={n.y + 16} textAnchor="middle" fontSize={9} fill="#F7F6F2">
                  {n.leavesEEA}
                </text>
              </>
            ) : null}
            {n.unexplained ? (
              <>
                <rect x={n.x + 46} y={n.y + 5} width={22} height={15}
                      fill="none" stroke="#E2411E" strokeWidth={1.5} />
                <text x={n.x + 57} y={n.y + 16} textAnchor="middle" fontSize={9} fill="#E2411E">
                  {n.unexplained}?
                </text>
              </>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
