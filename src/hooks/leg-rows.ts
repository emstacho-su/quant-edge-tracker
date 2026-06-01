import type { LegDraft } from '@/lib/types'

/**
 * Pure mapping of leg drafts → parlay_legs insert rows. Extracted from editBet
 * so the row shape is unit-testable without a Supabase client.
 */
export function legRowsForInsert(betId: string, legs: LegDraft[]) {
  return legs.map((l) => ({
    bet_id: betId,
    description: l.description,
    sport: l.sport,
    odds_american: l.odds_american,
    clv_market: l.clv_market,
    clv_selection: l.clv_selection,
    clv_line: l.clv_line,
    leg_status: 'pending' as const,
  }))
}
