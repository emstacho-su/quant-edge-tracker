/**
 * AuditScoreChip (05-03 W3.4)
 *
 * Renders a colored pill showing the audit score.
 * Large: "Audit: HIGH 92" | Small: "92" in a colored pill.
 * null score: grey "audit unavailable".
 */

/**
 * Derive the color class from a numeric score.
 * Pure function - exported for unit testing.
 */
export function scoreColorClass(score: number | null): string {
  if (score === null) return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/40'
  if (score >= 90) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
  if (score >= 70) return 'bg-amber-500/15 text-amber-400 border-amber-500/40'
  return 'bg-red-500/15 text-red-400 border-red-500/40'
}

/**
 * Derive the label for the score tier.
 * Pure function - exported for unit testing.
 */
export function scoreTierLabel(score: number | null): string {
  if (score === null) return 'N/A'
  if (score >= 90) return 'HIGH'
  if (score >= 70) return 'MED'
  return 'LOW'
}

export function AuditScoreChip({
  score,
  variant = 'large',
}: {
  score: number | null
  variant?: 'large' | 'small'
}) {
  const colorClass = scoreColorClass(score)
  const tier = scoreTierLabel(score)

  if (score === null) {
    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
        {variant === 'large' ? 'Audit: unavailable' : '?'}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
      {variant === 'large' ? `Audit: ${tier} ${score}` : `${score}`}
    </span>
  )
}
