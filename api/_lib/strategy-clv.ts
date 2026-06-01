/**
 * Strategy-outcomes CLV grader (pure functions).
 *
 * DB-read-only: reads pre-ingested Pinnacle lines from odds_snapshots.
 * Makes NO Odds-API calls and has no credit-floor logic.
 */
import { noVigMulti, clvPct, clvProbPoints } from './clv.js'

export interface PinnOutcome {
  selection: string
  point: number | null
  price_american: number
}

/**
 * De-vigs Pinnacle closing lines for a given selection + point.
 * Returns the no-vig fair probability, or null if the selection isn't found
 * in the snapshot group or if there aren't at least 2 sides.
 */
export function closingFairForSelection(
  outcomes: PinnOutcome[],
  selection: string,
  point: number | null,
): number | null {
  // Moneyline (point == null): use all h2h prices.
  // Spread/total: restrict to the matching line by |point| so alt lines don't
  // pollute the no-vig normalization. The two sides of a spread carry opposite
  // signs (+1.5 / -1.5), so match on absolute value.
  const group =
    point == null
      ? outcomes
      : outcomes.filter((x) => x.point != null && Math.abs(x.point) === Math.abs(point))
  if (group.length < 2) return null
  const side = group.find((x) => x.selection === selection)?.price_american
  if (side == null) return null
  return noVigMulti(side, group.map((x) => x.price_american))
}

/**
 * Computes CLV metrics for a strategy outcome given its offered odds and
 * the closing no-vig fair probability derived from Pinnacle snapshots.
 */
export function gradeOutcome(a: { offered_odds: number; closingFair: number }): {
  pinnacle_close_fair: number
  clv_pct: number
  clv_prob_points: number
  beat_close: boolean
} {
  const pct = clvPct(a.offered_odds, a.closingFair)
  return {
    pinnacle_close_fair: a.closingFair,
    clv_pct: pct,
    clv_prob_points: clvProbPoints(a.offered_odds, a.closingFair),
    beat_close: pct > 0,
  }
}
