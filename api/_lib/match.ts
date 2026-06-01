/**
 * Generic, sport-agnostic matcher: matches a bet's team/player selection to an
 * Odds API event/outcome by normalized token overlap (works for MLB/NBA/NHL/NFL
 * team names AND individual athletes in MMA/tennis).
 */

function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return norm(s).split(' ').filter((t) => t.length > 2)
}

/** Count of shared significant tokens between two names. */
export function matchScore(a: string, b: string): number {
  const ta = new Set(tokens(a))
  let n = 0
  for (const t of tokens(b)) if (ta.has(t)) n++
  return n
}

/**
 * From a market's outcomes, pick the one matching the bet selection (and the
 * exact point for spreads) plus its sibling outcomes (for no-vig).
 */
export function findOutcome<T extends { name: string; point?: number }>(
  outcomes: T[],
  betSelection: string,
  point?: number | null,
): { you: T; others: T[] } | null {
  let best: T | null = null
  let bestScore = 0
  for (const o of outcomes) {
    if (point != null && o.point !== point) continue
    const s = matchScore(o.name, betSelection)
    if (s > bestScore) {
      bestScore = s
      best = o
    }
  }
  if (!best || bestScore < 1) return null
  const chosen = best
  return { you: chosen, others: outcomes.filter((o) => o !== chosen) }
}

/**
 * Same as findOutcome but with a graceful nearest-point fallback for
 * spread/total bets. When the exact point isn't available (book moved the
 * line, or only quotes an adjacent half-point), look for the bet's selection
 * at the nearest available point. Returns the chosen outcome plus its
 * siblings at the SAME point so no-vig de-vigging stays consistent.
 *
 * Use case: bet was placed at OKC -5; current Pinnacle quote has shifted to
 * OKC -4. We approximate the fair at -4 rather than skip tracking entirely.
 * The approximation slightly biases CLV (a -5 line is harder than -4) — the
 * caller can flag this if they want to surface "point shifted" to the user.
 */
export function findOutcomeNearestPoint<T extends { name: string; point?: number }>(
  outcomes: T[],
  betSelection: string,
  point: number,
): { you: T; others: T[]; pointUsed: number } | null {
  // 1) try exact-point first
  const exact = findOutcome(outcomes, betSelection, point)
  if (exact) return { ...exact, pointUsed: point }
  // 2) find candidates with name-match; pick the one whose point is closest
  let bestCandidate: T | null = null
  let bestScore = 0
  let bestDist = Infinity
  for (const o of outcomes) {
    if (o.point == null) continue
    const nameScore = matchScore(o.name, betSelection)
    if (nameScore < 1) continue
    const dist = Math.abs(o.point - point)
    // Prefer higher name score; among ties, prefer closer point.
    if (nameScore > bestScore || (nameScore === bestScore && dist < bestDist)) {
      bestCandidate = o
      bestScore = nameScore
      bestDist = dist
    }
  }
  if (!bestCandidate || bestCandidate.point == null) return null
  const pointUsed = bestCandidate.point
  // Sibling outcome — completes the 2-way pair for no-vig de-vigging.
  // Spread/runline convention: opposite-team outcome at -point (mirrored).
  // Totals convention: Over/Under at the SAME point (different selection).
  // Try the spread convention first; if no -point match exists, fall back to
  // same-point siblings filtered to a different selection name.
  let others = outcomes.filter((o) => o !== bestCandidate && o.point === -pointUsed)
  if (others.length < 1) {
    others = outcomes.filter(
      (o) => o !== bestCandidate && o.point === pointUsed && matchScore(o.name, bestCandidate!.name) === 0,
    )
  }
  if (others.length < 1) return null
  return { you: bestCandidate, others, pointUsed }
}
