export type ClvTier = 'standard' | 'prop' | 'futures'

/** Long-running / outright sports (lowercased bet.sport). */
const FUTURES_SPORTS = new Set(['golf', 'pga', 'liv'])

export function tierFor(sport: string | null, isProp: boolean): ClvTier {
  if (isProp) return 'prop'
  if (sport && FUTURES_SPORTS.has(sport.toLowerCase().trim())) return 'futures'
  return 'standard'
}

const MIN = 60_000, HOUR = 3_600_000

/** Minimum interval (ms) between fetches, or null = do not fetch now. msToStart<=0 = started. */
export function cadenceMs(tier: ClvTier, msToStart: number): number | null {
  if (msToStart <= 0) return null
  if (tier === 'standard') {
    if (msToStart > 24 * HOUR) return null
    if (msToStart > 3 * HOUR) return 10 * MIN
    return 5 * MIN
  }
  if (tier === 'prop') {
    if (msToStart > 8 * HOUR) return null
    if (msToStart > 3 * HOUR) return 10 * MIN
    return 5 * MIN
  }
  // futures
  if (msToStart > 24 * HOUR) return 12 * HOUR
  return 90 * MIN
}

export function isDue(tier: ClvTier, msToStart: number, lastUpdatedAtMs: number | null, nowMs: number): boolean {
  const interval = cadenceMs(tier, msToStart)
  if (interval == null) return false
  if (lastUpdatedAtMs == null) return true
  return nowMs - lastUpdatedAtMs >= interval
}
