/**
 * Kalshi taker-fee math — single source of truth (server copy).
 * Mirror of src/lib/kalshi-fee.ts — keep in sync.
 *
 * Fee schedule (Feb 2026 Kalshi Fee Schedule PDF, verified D-13):
 *   Taker: per_contract_fee_cents = ceil(0.07 × P × (1 − P) × 100)
 *   Maker: per_contract_fee_cents = ceil(0.0175 × P × (1 − P) × 100)
 *
 * Un-rounded form used at the price-comparison layer:
 *   P_eff = P + mult × P × (1 − P)
 *
 * Fee impact characteristics:
 *   - Peaks at 1.75% of contract value at P = 0.50
 *   - Drops to ~0.63% at P = 0.10 / 0.90
 *   - Approaches 0% at the extremes (P = 0, P = 1)
 *   - Symmetric: feeImpact(p) === feeImpact(1 − p)
 *
 * The old KALSHI_FEE_PCT = 0.007 constant (D-06) was wrong on both
 * magnitude (0.7% flat vs 1.75% peak) and shape (flat vs price-dependent).
 * It has been removed from kalshi-adapter.ts and this module supersedes it.
 *
 * STORAGE RULE (D-13): book_prices rows stay raw. All fee adjustment is
 * computed at read time. No DB migration, no mutation of ingested data.
 */

/** Taker fee multiplier (0.07 = 7%). */
export const KALSHI_TAKER_MULT = 0.07

/**
 * Maker fee multiplier (0.0175 = 1.75%).
 * Exported for future-proofing; unused by any caller in Phase 21.
 * We do not post resting orders, so maker semantics are out-of-scope.
 */
export const KALSHI_MAKER_MULT = 0.0175

/**
 * Effective implied probability after Kalshi taker (or maker) fee.
 *
 * Formula: P_eff = P + mult × P × (1 − P)
 *
 * Guards: returns P unchanged when P ≤ 0 or P ≥ 1 (no fee at the extremes,
 * and these are invalid probability values anyway).
 *
 * @param p    - Raw implied probability in (0, 1)
 * @param side - 'taker' (default) or 'maker'
 */
export function kalshiEffectiveImpliedProb(p: number, side: 'taker' | 'maker' = 'taker'): number {
  if (p <= 0 || p >= 1) return p
  const mult = side === 'maker' ? KALSHI_MAKER_MULT : KALSHI_TAKER_MULT
  return p + mult * p * (1 - p)
}

/**
 * Effective decimal odds after Kalshi taker (or maker) fee.
 *
 * Converts decimal → implied prob → applies fee → converts back.
 * decimal odds d corresponds to implied prob P = 1/d.
 *
 * Guards: returns decimal unchanged when decimal ≤ 1 (invalid decimal odds).
 *
 * @param decimal - Raw decimal odds (e.g. 2.0 for even-money)
 * @param side    - 'taker' (default) or 'maker'
 */
export function kalshiEffectiveDecimalOdds(decimal: number, side: 'taker' | 'maker' = 'taker'): number {
  if (decimal <= 1) return decimal
  const p = 1 / decimal
  const pEff = kalshiEffectiveImpliedProb(p, side)
  // pEff > 0 guaranteed since p > 0 and mult > 0, so division is safe
  return 1 / pEff
}

/**
 * Compute the actual dollar fee a Kalshi taker will pay for a given stake.
 * Server-side mirror of src/lib/kalshi-fee.ts; keep in sync.
 *
 * Kalshi YES/NO contracts cost $P each and settle at $1 on win / $0 on loss.
 * The fee is integer-cent-ceiling per contract × number of contracts purchased.
 *
 * Use this for display ("you will pay $X in fees on this Kalshi leg"),
 * NOT for price-comparison / stake-split math — use kalshiEffective*
 * (un-rounded form) for that, per D-13.
 */
export function kalshiFeeForStake(
  stake: number,
  impliedProb: number,
  side: 'taker' | 'maker' = 'taker',
): { contracts: number; feePerContractCents: number; totalFeeDollars: number } {
  if (stake <= 0 || impliedProb <= 0 || impliedProb >= 1) {
    return { contracts: 0, feePerContractCents: 0, totalFeeDollars: 0 }
  }
  const mult = side === 'maker' ? KALSHI_MAKER_MULT : KALSHI_TAKER_MULT
  const feePerContractCents = Math.ceil(mult * impliedProb * (1 - impliedProb) * 100)
  const contracts = Math.floor(stake / impliedProb)
  const totalFeeDollars = (contracts * feePerContractCents) / 100
  return { contracts, feePerContractCents, totalFeeDollars }
}
