/**
 * Line-shop analysis — pure functions.
 *
 * All odds math is composed from api/_lib/clv.ts (D-01).
 * No fetch, no Supabase, no Date.now() inside math functions (D-05).
 *
 * Key invariants:
 *   D-01: compose clv.ts exports — never reimplement americanToDecimal / impliedFromAmerican / noVigMulti / clvPct
 *   D-02: detectArb uses RAW implied probabilities (with vig) — never devigged
 *   D-03: caller must pre-filter by (market_type, market_param) before calling detectArb
 *   D-04: sizeArb formula: stakeA = S·decB/(decA+decB), stakeB = S·decA/(decA+decB)
 */

import {
  impliedFromAmerican,
  americanToDecimal,
  noVigMulti,
  clvPct,
} from '../clv.js'

import { kalshiEffectiveImpliedProb, kalshiEffectiveDecimalOdds } from './kalshi-fee.js'

import type { BookPriceSnapshot, ArbOpportunity } from './types.js'

// Re-export for callers that need the clv math alongside analysis results.
export { impliedFromAmerican, americanToDecimal }

// ─── bestPrice ────────────────────────────────────────────────────────────────

/** Best-priced snapshot for the given side (highest decimal odds = most favourable). */
export function bestPrice(
  snapshots: BookPriceSnapshot[],
  side: string,
): BookPriceSnapshot | null {
  const candidates = snapshots.filter((s) => s.side === side)
  if (candidates.length === 0) return null
  return candidates.reduce((best, s) =>
    s.priceDecimal > best.priceDecimal ? s : best,
  )
}

// ─── vigFor ───────────────────────────────────────────────────────────────────

/**
 * Raw vig % for a single book across all sides of a market.
 * Returns null when fewer than 2 snapshots exist for the book.
 */
export function vigFor(snapshots: BookPriceSnapshot[], book: string): number | null {
  const bookSnaps = snapshots.filter((s) => s.book === book)
  if (bookSnaps.length < 2) return null
  const sum = bookSnaps.reduce((acc, s) => acc + s.impliedProb, 0)
  return (sum - 1) * 100
}

// ─── noVigConsensus ───────────────────────────────────────────────────────────

/**
 * No-vig consensus probability for one side across all books.
 * Pinnacle-anchored: if ≥2 Pinnacle snapshots exist, use only Pinnacle's prices.
 * Falls back to all books when Pinnacle is absent or has fewer than 2 snapshots.
 *
 * IMPORTANT: delegates to noVigMulti — never reimplement devig here (D-01).
 */
export function noVigConsensus(
  snapshots: BookPriceSnapshot[],
  side: string,
  anchorBook = 'pinnacle',
): number | null {
  const anchor = snapshots.filter((s) => s.book === anchorBook)
  const source = anchor.length >= 2 ? anchor : snapshots
  const sideSnap = source.find((s) => s.side === side)
  if (!sideSnap) return null
  const allPrices = source.map((s) => s.priceAmerican)
  return noVigMulti(sideSnap.priceAmerican, allPrices)
}

// ─── preBetCLV ────────────────────────────────────────────────────────────────

/**
 * Pre-bet CLV: how much does the best available price beat the no-vig consensus?
 * Positive = beating the market. Delegates to existing clvPct() (D-01).
 */
export function preBetCLV(
  bestSnapshot: BookPriceSnapshot,
  fairProb: number,
): number {
  return clvPct(bestSnapshot.priceAmerican, fairProb)
}

// ─── sizeArb ─────────────────────────────────────────────────────────────────

/**
 * Equalized stake sizing for a two-sided arb.
 *
 * Corrected formula (D-04):
 *   stake_A = S × dec_B / (dec_A + dec_B)
 *   stake_B = S × dec_A / (dec_A + dec_B)
 *
 * Invariant: stake_A × dec_A ≈ stake_B × dec_B (payouts equalize within floating-point).
 * NOTE: stakeA uses decB in the numerator — this is intentional and correct.
 * The MVP-skeleton shipped the wrong formula (decA/(decA+decB) for stakeA) — do not revert.
 */
export function sizeArb(
  totalStake: number,
  decA: number,
  decB: number,
): { stakeA: number; stakeB: number; stakeAPct: number; stakeBPct: number } {
  const sum = decA + decB
  const stakeA = (totalStake * decB) / sum
  const stakeB = (totalStake * decA) / sum
  return {
    stakeA,
    stakeB,
    stakeAPct: stakeA / totalStake,
    stakeBPct: stakeB / totalStake,
  }
}

// ─── detectArb ────────────────────────────────────────────────────────────────

/**
 * Detect two-sided arbitrage opportunity.
 *
 * NOTE: impliedProb on BookPriceSnapshot MUST be RAW (with vig).
 * Using no-vig / devigged probs here will produce false positives on every
 * market because devigged probs sum to ~1.0 by construction (D-02).
 *
 * Snapshots MUST all share the same (market_type, market_param). The caller
 * is responsible for pre-filtering. Cross-point comparisons are NOT arbs (D-03).
 *
 * D-13: Kalshi snapshots are fee-adjusted before sum-of-implied math.
 * We construct fresh adjusted copies (never mutate in place — snapshots are
 * read-mostly and shared with callers like dedupeByBook which keys on identity).
 * The returned ArbOpportunity's sideA/sideB reflect fee-adjusted impliedProb so
 * display layers show prices consistent with the arb math.
 *
 * Returns null when:
 *   - Either side has no snapshots
 *   - sumRawImplied ≥ 1.0 (no arb exists after fee adjustment)
 *   - totalReturnPct ≤ minReturnPct (below the minimum return threshold)
 */
export function detectArb(
  sideASnaps: BookPriceSnapshot[], // all snapshots for side A at the same market_param
  sideBSnaps: BookPriceSnapshot[], // all snapshots for side B at the same market_param
  minReturnPct = 0,
): ArbOpportunity | null {
  if (sideASnaps.length === 0 || sideBSnaps.length === 0) return null

  // D-13: fee-adjust Kalshi snapshots before sum-of-implied (price-level, not threshold-level).
  // Fresh copies only — do NOT mutate snap.impliedProb in place.
  // Both impliedProb AND priceDecimal need patching so the downstream sizeArb()
  // call below produces a fee-aware stake split (sizeArb keys off priceDecimal,
  // not impliedProb — without this patch, the staking ignores the taker fee
  // even though the detection threshold accounts for it).
  const adjA = sideASnaps.map((s) =>
    s.book === 'kalshi'
      ? {
          ...s,
          impliedProb: kalshiEffectiveImpliedProb(s.impliedProb),
          priceDecimal: kalshiEffectiveDecimalOdds(s.priceDecimal),
        }
      : s,
  )
  const adjB = sideBSnaps.map((s) =>
    s.book === 'kalshi'
      ? {
          ...s,
          impliedProb: kalshiEffectiveImpliedProb(s.impliedProb),
          priceDecimal: kalshiEffectiveDecimalOdds(s.priceDecimal),
        }
      : s,
  )

  const bestA = bestPrice(adjA, adjA[0]!.side)
  const bestB = bestPrice(adjB, adjB[0]!.side)
  if (!bestA || !bestB) return null

  // Use RAW implied probabilities (D-02) — never devigged values
  // (Kalshi's impliedProb is already fee-adjusted above; others are untouched)
  const sumRaw = bestA.impliedProb + bestB.impliedProb
  if (sumRaw >= 1.0) return null

  const totalReturnPct = (1 / sumRaw - 1) * 100
  if (totalReturnPct <= minReturnPct) return null

  return {
    sideA: bestA,
    sideB: bestB,
    sumRawImplied: sumRaw,
    totalReturnPct,
    ...sizeArb(100, bestA.priceDecimal, bestB.priceDecimal),
    detectedAt: new Date(),
  }
}
