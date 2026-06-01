/**
 * CLV / no-vig math (pure functions, server-side copy).
 * Mirror of src/lib/clv.ts — keep the two in sync.
 */

// D-13: Kalshi's contribution to the sharp-subset reference must be fee-adjusted.
// The aggregation function (bestPriceAcrossBooks) lives in api/cron/line-movement.ts
// and imports kalshiEffectiveImpliedProb directly. This re-export makes the module
// a single import target for callers that need both CLV math and Kalshi fee-adjustment.
export { kalshiEffectiveImpliedProb } from './line-shop/kalshi-fee.js'

export function americanToDecimal(a: number): number {
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1
}

/** Implied probability (with vig) of an American price. */
export function impliedFromAmerican(a: number): number {
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100)
}

/** No-vig fair probability of side A given both sides' American prices. */
export function noVigProb(aPrice: number, bPrice: number): number {
  const pa = impliedFromAmerican(aPrice)
  const pb = impliedFromAmerican(bPrice)
  const sum = pa + pb
  return sum > 0 ? pa / sum : pa
}

/** No-vig fair prob of a selection over all outcomes of a market (2-way or 3-way). */
export function noVigMulti(youPrice: number, allPrices: number[]): number {
  const pYou = impliedFromAmerican(youPrice)
  const sum = allPrices.reduce((s, p) => s + impliedFromAmerican(p), 0)
  return sum > 0 ? pYou / sum : pYou
}

/**
 * CLV% = (your payout decimal / fair closing decimal) − 1.
 * Positive ⇒ you beat the closing (no-vig) price.
 */
export function clvPct(yourAmerican: number, closeFairProb: number): number {
  if (!closeFairProb) return 0
  const dYou = americanToDecimal(yourAmerican)
  const dCloseFair = 1 / closeFairProb
  return dYou / dCloseFair - 1
}

/** CLV in probability points = closing fair prob − your entry implied prob. */
export function clvProbPoints(yourAmerican: number, closeFairProb: number): number {
  return closeFairProb - impliedFromAmerican(yourAmerican)
}

/** Sharp/major book subset for PLM "best available" (mirror of src/lib/clv.ts).
 *  Caesars = williamhill_us. Pinnacle's actual price is eligible. Kalshi is a
 *  CFTC-regulated event-contracts exchange with no per-bet vig — its ask price
 *  IS the implied probability, making it a clean sharp reference for h2h. */
export const SHARP_BOOKS = ['pinnacle', 'kalshi', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us'] as const

/** PLM% = your payout decimal / best-available decimal − 1. + ⇒ line moved your way. */
export function plmPct(yourAmerican: number, bestAmerican: number): number {
  return americanToDecimal(yourAmerican) / americanToDecimal(bestAmerican) - 1
}

/** PLM in probability points = best-available implied − your entry implied. */
export function plmProbPoints(yourAmerican: number, bestAmerican: number): number {
  return impliedFromAmerican(bestAmerican) - impliedFromAmerican(yourAmerican)
}
