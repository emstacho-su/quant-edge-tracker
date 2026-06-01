import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Bulk import utility — one-time import of graded bet data into Supabase
//
// Usage (browser console or temp UI):
//   import { bulkImportBets } from '@/utils/bulk-import'
//   await bulkImportBets([{ stake: 20, to_win: 18.5, ... }])
// ---------------------------------------------------------------------------

interface BulkBetLeg {
  readonly description: string
  readonly odds_american: number | null
  readonly sport: string | null
}

interface BulkBet {
  readonly stake: number
  readonly to_win: number
  readonly description: string
  readonly odds_american: number | null
  readonly sport: string
  readonly bet_type: 'single' | 'parlay'
  readonly is_freeplay: boolean
  readonly status: 'won' | 'lost' | 'push' | 'void' | 'pending'
  readonly placed_at: string // ISO date
  readonly profit_loss?: number | null
  readonly legs?: readonly BulkBetLeg[]
}

interface ImportResult {
  readonly total: number
  readonly inserted: number
  readonly errors: readonly string[]
}

/**
 * Calculate profit/loss for a settled bet.
 *
 * - won: +to_win
 * - lost: freeplay bets lose nothing, cash bets lose -stake
 * - push/void: 0
 * - pending: null (not settled)
 */
function calculateProfitLoss(bet: BulkBet): number | null {
  if (bet.status === 'pending') return null
  if (bet.status === 'won') return bet.to_win
  if (bet.status === 'lost') return bet.is_freeplay ? 0 : -bet.stake
  // push or void
  return 0
}

/**
 * Insert a bankroll event for a settled bet.
 *
 * Fetches the latest balance for the appropriate bankroll type (cash or freeplay)
 * and creates a new event with the updated balance.
 */
async function insertBankrollEvent(
  betId: string,
  bet: BulkBet,
  profitLoss: number
): Promise<void> {
  const bankrollType = bet.is_freeplay ? 'freeplay' : 'cash'

  // Get current balance from latest event for this bankroll type
  const { data: latestEvent, error: fetchError } = await supabase
    .from('bankroll_events')
    .select('balance_after')
    .eq('bankroll_type', bankrollType)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') {
    // PGRST116 = no rows — acceptable for first event
    throw new Error(`Failed to get latest balance: ${fetchError.message}`)
  }

  const currentBalance = latestEvent?.balance_after ?? 0
  const newBalance = currentBalance + profitLoss

  const { error: insertError } = await supabase
    .from('bankroll_events')
    .insert({
      event_type: 'bet_settled' as const,
      bankroll_type: bankrollType,
      amount: profitLoss,
      balance_after: newBalance,
      bet_id: betId,
      occurred_at: bet.placed_at,
    })

  if (insertError) {
    throw new Error(`Failed to insert bankroll event: ${insertError.message}`)
  }
}

/**
 * Bulk import an array of graded bets into Supabase.
 *
 * For each bet:
 * 1. Inserts into the `bets` table
 * 2. Inserts parlay legs into `parlay_legs` (if applicable)
 * 3. Creates `bankroll_events` entries for settled bets
 *
 * Returns a summary of the import: total, inserted count, and any errors.
 */
export async function bulkImportBets(
  bets: readonly BulkBet[]
): Promise<ImportResult> {
  const errors: string[] = []
  let inserted = 0

  for (const bet of bets) {
    try {
      const profitLoss = bet.profit_loss ?? calculateProfitLoss(bet)
      const isSettled = bet.status !== 'pending'

      // 1. Insert the bet
      const { data: insertedBet, error: betError } = await supabase
        .from('bets')
        .insert({
          sport: bet.sport,
          bet_type: bet.bet_type,
          stake: bet.stake,
          to_win: bet.to_win,
          odds_american: bet.odds_american,
          description: bet.description,
          status: bet.status,
          is_freeplay: bet.is_freeplay,
          placed_at: bet.placed_at,
          settled_at: isSettled ? bet.placed_at : null,
          profit_loss: profitLoss,
        })
        .select('id')
        .single()

      if (betError || !insertedBet) {
        errors.push(`Bet "${bet.description}": ${betError?.message ?? 'No data returned'}`)
        continue
      }

      // 2. Insert parlay legs if applicable
      if (bet.bet_type === 'parlay' && bet.legs && bet.legs.length > 0) {
        const legs = bet.legs.map((leg) => ({
          bet_id: insertedBet.id,
          description: leg.description,
          odds_american: leg.odds_american,
          sport: leg.sport,
          leg_status: bet.status === 'pending' ? ('pending' as const) : bet.status,
        }))

        const { error: legError } = await supabase
          .from('parlay_legs')
          .insert(legs)

        if (legError) {
          errors.push(`Parlay legs for "${bet.description}": ${legError.message}`)
        }
      }

      // 3. Create bankroll event for settled bets
      if (isSettled && profitLoss !== null) {
        try {
          await insertBankrollEvent(insertedBet.id, bet, profitLoss)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`Bankroll event for "${bet.description}": ${msg}`)
        }
      }

      inserted += 1
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`Bet "${bet.description}": ${msg}`)
    }
  }

  return {
    total: bets.length,
    inserted,
    errors,
  }
}
