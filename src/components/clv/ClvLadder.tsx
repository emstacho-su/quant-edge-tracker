import { ladderPositions, formatOdds, type LadderMarker } from '@/lib/clv'

export interface LadderEntry extends LadderMarker {
  /** which marker this is — drives color/shape */
  tone: 'you' | 'fair' | 'best'
  american: number
  label: string
  sublabel?: string
}

/** Horizontal price ladder: markers spaced by win-probability, labelled in American odds.
 *  Lower implied prob (better value) sits on the left. A shaded band spans you↔best. */
export function ClvLadder({
  markers,
  worse,
  gapLabel,
}: {
  markers: LadderEntry[]
  /** true = your price is worse than fair (band is red, on the right); false = green/left */
  worse: boolean
  /** label drawn over the band (e.g. "overpay −21¢") */
  gapLabel?: string | null
}) {
  const W = 320
  const positioned = ladderPositions(markers)
  const xOf = (key: string) => {
    const m = positioned.find((p) => p.key === key)
    return m ? 20 + m.x * (W - 40) : null
  }
  const youX = xOf('you')
  const fairX = xOf('fair')
  const bestX = xOf('best')
  const trackY = 36
  // When the below-track labels (fair, best) sit close, drop "best" to a second row
  // so the text never overlaps.
  const bestClose = fairX != null && bestX != null && Math.abs(bestX - fairX) < 60
  // The colored gap bar + label always reference YOU vs FAIR (the no-vig signal).
  // Bar previously spanned you↔best, which conflicted with the cents-vs-fair label
  // and read as "behind Nc" when you were actually beating best but losing fair.
  // 'best' remains a separate dot on the ladder for context.
  const youFairClose =
    youX != null && fairX != null && Math.abs(youX - fairX) < 60
  const topPad = youFairClose && gapLabel ? 14 : 0
  const gapY = youFairClose ? trackY - 26 : trackY - 10

  return (
    <div>
      <div className="flex justify-between px-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">
        <span>← better value</span>
        <span>worse value →</span>
      </div>
      <svg
        viewBox={`0 ${-topPad} ${W} ${(bestClose ? 86 : 70) + topPad}`}
        className="block w-full"
      >
        <line x1={20} y1={trackY} x2={W - 20} y2={trackY} stroke="#3f3f46" strokeWidth={2} />
        {youX != null && fairX != null && (
          <>
            <rect
              x={Math.min(youX, fairX)}
              y={trackY - 6}
              width={Math.abs(youX - fairX)}
              height={12}
              fill={worse ? 'rgba(248,113,113,.18)' : 'rgba(52,211,153,.18)'}
            />
            {gapLabel && (
              <text x={(youX + fairX) / 2} y={gapY} fontSize={9} textAnchor="middle" fill={worse ? '#f87171' : '#34d399'}>
                {gapLabel}
              </text>
            )}
          </>
        )}
        {positioned.map((p) => {
          const x = 20 + p.x * (W - 40)
          const m = markers.find((mm) => mm.key === p.key)!
          const color = m.tone === 'you' ? '#fbbf24' : m.tone === 'best' ? '#34d399' : '#e4e4e7'
          // 'you' labels above the track; 'fair'/'best' below. 'best' drops a row when it
          // sits close to 'fair' (bestClose) so the two never overlap.
          const labelY = m.tone === 'you' ? trackY - 12 : m.tone === 'best' && bestClose ? trackY + 36 : trackY + 20
          const subY = m.tone === 'best' && bestClose ? trackY + 46 : trackY + 30
          return (
            <g key={p.key}>
              {m.tone === 'fair' ? (
                <line x1={x} y1={trackY - 8} x2={x} y2={trackY + 8} stroke={color} strokeWidth={2} />
              ) : m.tone === 'best' ? (
                <circle cx={x} cy={trackY} r={5} fill="none" stroke={color} strokeWidth={2} />
              ) : (
                <circle cx={x} cy={trackY} r={5.5} fill={color} />
              )}
              <text x={x} y={labelY} fontSize={10} fontWeight={m.tone === 'best' ? 400 : 700} textAnchor="middle" fill={color}>
                {m.label} {formatOdds(m.american)}
              </text>
              {m.sublabel && (
                <text x={x} y={subY} fontSize={8} textAnchor="middle" fill="#71717a">{m.sublabel}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
