export type LegResult = 'pending' | 'won' | 'lost' | 'push' | 'void'
export type ParlayResult = 'won' | 'lost' | 'pending'

/**
 * Derive a parlay's overall result from its leg statuses.
 *  - any leg lost  → lost (a single losing leg kills the parlay)
 *  - any leg pending → pending (not all legs resolved; don't settle yet)
 *  - any leg push/void → null: the parlay collapses to fewer legs at recomputed
 *    odds, which needs reliable per-leg odds — punt to manual settle (safe).
 *  - all legs won → won
 * Returns null for the empty case too.
 */
export function deriveParlayResult(legs: readonly LegResult[]): ParlayResult | null {
  if (legs.length === 0) return null
  if (legs.some((l) => l === 'lost')) return 'lost'
  if (legs.some((l) => l === 'pending')) return 'pending'
  if (legs.some((l) => l === 'push' || l === 'void')) return null
  return 'won'
}
