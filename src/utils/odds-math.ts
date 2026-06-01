/**
 * Pure odds math utilities — no side effects, no imports.
 *
 * Convention: `toWin` is **profit** (not total payout), matching computeToWin.
 */

/**
 * Derive American odds from a known stake and profit (toWin).
 *
 * - toWin >= stake  →  positive (underdog) odds: +(toWin / stake) * 100
 * - toWin <  stake  →  negative (favorite)  odds: -(stake / toWin) * 100
 * - Returns null for any non-positive or non-finite input.
 */
export function computeOddsFromToWin(stake: number, toWin: number): number | null {
  if (!Number.isFinite(stake) || !Number.isFinite(toWin) || stake <= 0 || toWin <= 0) return null
  const raw = toWin >= stake ? (toWin / stake) * 100 : -(stake / toWin) * 100
  return Math.round(raw)
}
