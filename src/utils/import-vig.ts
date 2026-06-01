/**
 * Import vig helper — two-sided vig computation for the Import preview table.
 *
 * IMPORTANT: The paste-parser captures only ONE side's odds per bet (the user's
 * side). Two-sided vig computation requires BOTH sides of the market. Because we
 * only have one side for virtually every ImportedBet row, vigForParsedBet always
 * returns null, rendering '—' in the Import preview. This is the HONEST display.
 *
 * The computeTwoSidedVig helper is exported so it can be unit-tested and reused
 * in future contexts where both sides may be available (e.g., line-shop markets).
 *
 * Formula (when both sides present):
 *   vig = (impliedFromAmerican(oddsA) + impliedFromAmerican(oddsB) - 1) * 100
 *
 * Reuses `impliedFromAmerican` from src/lib/clv.ts — do NOT re-derive the
 * implied-probability formula here (RESEARCH §"Don't Hand-Roll").
 */

import { impliedFromAmerican } from '@/lib/clv'
import type { ParsedBet } from '@/lib/types'

/**
 * Compute the two-sided vig percentage given American odds for both sides of
 * a market. Returns null if either side is missing or non-finite (so the
 * caller can render '—' instead of a fabricated number).
 *
 * @param oddsA - American odds for side A (e.g. -110)
 * @param oddsB - American odds for side B (e.g. -110)
 * @returns vig as a percentage (e.g. 4.55), or null when not computable
 */
export function computeTwoSidedVig(
  oddsA: number | null | undefined,
  oddsB: number | null | undefined,
): number | null {
  if (oddsA == null || !isFinite(oddsA)) return null
  if (oddsB == null || !isFinite(oddsB)) return null
  const pA = impliedFromAmerican(oddsA)
  const pB = impliedFromAmerican(oddsB)
  return (pA + pB - 1) * 100
}

/**
 * Return the vig for a ParsedBet — always null in the current implementation
 * because the paste-parser captures only one side of the line.
 *
 * Parlays → null (multi-leg; per-market vig undefined).
 * Singles → null (one-sided paste; the opposing side's odds are not available).
 *
 * When the caller receives null, it renders '—' to signal that vig is
 * genuinely unknown rather than fabricating a one-sided number.
 */
export function vigForParsedBet(_bet: ParsedBet): number | null {
  // Parlay: multi-leg, vig per market is undefined.
  // Single: paste-parser only captures the user's side — the other side's odds
  // are not present in ParsedBet, so two-sided vig cannot be computed.
  // In both cases we return null → display '—'.
  return null
}
