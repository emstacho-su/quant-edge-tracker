import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Bet, BankrollEvent, ParsedBet, LegDraft } from '@/lib/types'
import { recomputeChain } from '@/utils/bankroll-helpers'
import { legRowsForInsert } from './leg-rows'
import { resolveEntity } from '@/utils/entity-resolver'
export { computeOddsFromToWin } from '@/utils/odds-math'

type BetStatus = Bet['status']

/**
 * Compute net to_win for a given stake at given American odds.
 * - Positive odds (e.g. +150): to_win = stake * (odds / 100)
 * - Negative odds (e.g. -110): to_win = stake * (100 / |odds|)
 * - Null/zero odds: returns existing to_win unchanged via fallback handled by caller.
 */
export function computeToWin(stake: number, oddsAmerican: number | null): number | null {
  if (oddsAmerican == null || oddsAmerican === 0) return null
  const raw = oddsAmerican > 0
    ? stake * (oddsAmerican / 100)
    : stake * (100 / Math.abs(oddsAmerican))
  return Number(raw.toFixed(2))
}

/**
 * Compute realized profit_loss for a settled bet.
 * Mirrors the convention used by settleBet:
 *  - won: +to_win
 *  - lost (cash): -stake;  lost (fp): 0 (FP stake already consumed at placement)
 *  - push/void: 0
 */
export function computeProfitLoss(
  status: BetStatus,
  stake: number,
  toWin: number,
  isFreeplay: boolean,
): number {
  if (status === 'won') return toWin
  if (status === 'lost') return isFreeplay ? 0 : -stake
  return 0
}

interface EditBetPatch {
  stake?: number
  odds_american?: number | null
  status?: BetStatus
  bet_type?: 'single' | 'parlay'
  /** When provided, replaces ALL of the bet's parlay_legs (straight→parlay conversion or leg re-author). */
  legs?: LegDraft[]
  /**
   * Updated top-level bet description text. The settler/live-tracker parses
   * this string (via parseBetLine / parseProp / parseGolfBet / getCoverStatus),
   * so correcting site-specific schema drift improves auto-grading.
   */
  description?: string
}

export function useBets() {
  const [bets, setBets] = useState<Bet[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBets = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('bets')
      .select('*, parlay_legs(*)')
      .order('placed_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch bets:', error.message)
      setLoading(false)
      return
    }

    setBets(data ?? [])
    setLoading(false)
  }, [])

  // ---------------------------------------------------------------------------
  // Settle a bet
  // ---------------------------------------------------------------------------

  const settleBet = useCallback(
    async (betId: string, status: BetStatus) => {
      // 1. Find the bet
      const bet = bets.find((b) => b.id === betId)
      if (!bet) throw new Error(`Bet ${betId} not found in local state`)

      // 2. Calculate profit/loss
      let profitLoss: number
      if (status === 'won') {
        profitLoss = bet.to_win
      } else if (status === 'lost') {
        profitLoss = bet.is_freeplay ? 0 : -bet.stake
      } else {
        // push or void
        profitLoss = 0
      }

      // 3. Update the bet row
      const { error: betError } = await supabase
        .from('bets')
        .update({
          status,
          settled_at: new Date().toISOString(),
          profit_loss: profitLoss,
        })
        .eq('id', betId)

      if (betError) {
        console.error('Failed to settle bet:', betError.message)
        throw new Error(`Failed to settle bet: ${betError.message}`)
      }

      // 4. FP model: FP stake is deducted at PLACEMENT (see insertBets).
      //    Settlement only moves cash and refunds voided/pushed FP stakes.
      //    - FP win: +to_win to cash
      //    - FP loss: no change (stake already consumed)
      //    - FP void/push: +stake refund to freeplay
      //    - Cash win: +to_win to cash
      //    - Cash loss: -stake to cash

      const cashChange = bet.is_freeplay
        ? (status === 'won' ? bet.to_win : 0)
        : (status === 'won' ? bet.to_win : status === 'lost' ? -bet.stake : 0)

      const fpChange = bet.is_freeplay && (status === 'void' || status === 'push')
        ? bet.stake
        : 0

      // 5. Update cash balance
      if (cashChange !== 0) {
        const { data: latestCash, error: cashFetchErr } = await supabase
          .from('bankroll_events')
          .select('balance_after')
          .eq('bankroll_type', 'cash')
          .order('occurred_at', { ascending: false })
          .limit(1)
          .single()

        if (cashFetchErr && cashFetchErr.code !== 'PGRST116') {
          console.error('Failed to get cash balance:', cashFetchErr.message)
          throw new Error(`Failed to get cash balance: ${cashFetchErr.message}`)
        }

        const cashBalance = (latestCash?.balance_after ?? 0) + cashChange

        const { error: cashInsertErr } = await supabase
          .from('bankroll_events')
          .insert({
            event_type: 'bet_settled' as const,
            bankroll_type: 'cash',
            amount: cashChange,
            balance_after: cashBalance,
            bet_id: betId,
          })

        if (cashInsertErr) {
          console.error('Failed to insert cash event:', cashInsertErr.message)
          throw new Error(`Failed to insert cash event: ${cashInsertErr.message}`)
        }
      }

      // 6. Update FP balance (stake consumed)
      if (fpChange !== 0) {
        const { data: latestFp, error: fpFetchErr } = await supabase
          .from('bankroll_events')
          .select('balance_after')
          .eq('bankroll_type', 'freeplay')
          .order('occurred_at', { ascending: false })
          .limit(1)
          .single()

        if (fpFetchErr && fpFetchErr.code !== 'PGRST116') {
          console.error('Failed to get FP balance:', fpFetchErr.message)
          throw new Error(`Failed to get FP balance: ${fpFetchErr.message}`)
        }

        const fpBalance = (latestFp?.balance_after ?? 0) + fpChange

        const { error: fpInsertErr } = await supabase
          .from('bankroll_events')
          .insert({
            event_type: 'bet_settled' as const,
            bankroll_type: 'freeplay',
            amount: fpChange,
            balance_after: fpBalance,
            bet_id: betId,
          })

        if (fpInsertErr) {
          console.error('Failed to insert FP event:', fpInsertErr.message)
          throw new Error(`Failed to insert FP event: ${fpInsertErr.message}`)
        }
      }

      // 7. Refetch
      await fetchBets()
    },
    [bets, fetchBets]
  )

  // ---------------------------------------------------------------------------
  // Insert parsed bets
  // ---------------------------------------------------------------------------

  const insertBets = useCallback(
    async (parsedBets: readonly ParsedBet[]) => {
      for (const parsed of parsedBets) {
        // Insert the bet
        const { data: insertedBet, error: betError } = await supabase
          .from('bets')
          .insert({
            sport: parsed.sport,
            bet_type: parsed.bet_type,
            stake: parsed.stake,
            to_win: parsed.to_win,
            odds_american: parsed.odds_american,
            description: parsed.description,
            status: 'pending' as const,
            is_freeplay: parsed.is_freeplay,
            market_id: parsed.market_id ?? null,
            line_shop_used: parsed.line_shop_used ?? false,
            entry_book: parsed.entry_book ?? null,
            no_vig_at_entry: parsed.no_vig_at_entry ?? null,
          })
          .select('id')
          .single()

        if (betError || !insertedBet) {
          console.error('Failed to insert bet:', betError?.message)
          throw new Error(`Failed to insert bet: ${betError?.message}`)
        }

        // D-16: Resolve entity via the library (three-tier resolver).
        // Resolution is additive — existing insertBets behavior (FP event, parlay legs)
        // is unchanged. paste-parser remains synchronous/pure; the library owns final
        // entity assignment here at insert time (D-16 integration point).
        try {
          // Fetch sport-scoped team list for tier-2 fuzzy index
          const { data: teamRows } = await supabase
            .from('teams')
            .select('espn_id, full_name, location, nickname, abbreviation, sport, league, aliases')
            .eq('sport', parsed.sport)

          const resolution = await resolveEntity(
            parsed.description,
            parsed.sport,
            {
              supabase,
              teams: teamRows ?? [],
              betId: insertedBet.id,
            },
          )

          // Persist entity columns (D-12): resolved → set espn_id + status; pending → set status only
          if (resolution.tier === 1 || resolution.tier === 2) {
            const status = resolution.tier === 1
              ? 'resolved'
              : resolution.confidence >= 0.9
                ? 'resolved'
                : 'low_confidence'
            await supabase
              .from('bets')
              .update({
                entity_espn_id: resolution.espn_id,
                entity_type: resolution.entity_type,
                entity_confidence: resolution.confidence,
                entity_resolution_status: status,
              })
              .eq('id', insertedBet.id)
          } else {
            // tier 3 — queue row already inserted by resolveEntity; mark bet as pending
            await supabase
              .from('bets')
              .update({ entity_resolution_status: 'pending' })
              .eq('id', insertedBet.id)
          }
        } catch (resolveErr) {
          // Resolution failure is non-fatal — bet is already persisted; leave entity columns null
          console.warn('Entity resolution failed (non-fatal):', resolveErr)
        }

        // FP stake is consumed immediately at placement.
        if (parsed.is_freeplay) {
          const { data: latestFp, error: fpFetchErr } = await supabase
            .from('bankroll_events')
            .select('balance_after')
            .eq('bankroll_type', 'freeplay')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .single()

          if (fpFetchErr && fpFetchErr.code !== 'PGRST116') {
            console.error('Failed to get FP balance:', fpFetchErr.message)
            throw new Error(`Failed to get FP balance: ${fpFetchErr.message}`)
          }

          const fpBalance =
            Number(latestFp?.balance_after ?? 0) - parsed.stake

          const { error: fpInsertErr } = await supabase
            .from('bankroll_events')
            .insert({
              event_type: 'bet_settled' as const,
              bankroll_type: 'freeplay',
              amount: -parsed.stake,
              balance_after: fpBalance,
              bet_id: insertedBet.id,
              note: 'FP stake consumed at placement',
            })

          if (fpInsertErr) {
            console.error('Failed to insert FP placement event:', fpInsertErr.message)
            throw new Error(
              `Failed to insert FP placement event: ${fpInsertErr.message}`,
            )
          }
        }

        // Insert parlay legs if applicable
        if (parsed.bet_type === 'parlay' && parsed.legs.length > 0) {
          const legs = parsed.legs.map((leg) => ({
            bet_id: insertedBet.id,
            description: leg.description,
            odds_american: leg.odds_american,
            sport: leg.sport,
            leg_status: 'pending' as const,
          }))

          const { error: legError } = await supabase
            .from('parlay_legs')
            .insert(legs)

          if (legError) {
            console.error('Failed to insert parlay legs:', legError.message)
            throw new Error(
              `Failed to insert parlay legs: ${legError.message}`
            )
          }
        }
      }

      await fetchBets()
    },
    [fetchBets]
  )

  // ---------------------------------------------------------------------------
  // Edit any bet retroactively (stake / odds / status). Handles pending too —
  // moving a settled bet back to pending wipes its settlement events; moving
  // pending → settled writes the same events settleBet would have written.
  // ---------------------------------------------------------------------------

  const editBet = useCallback(
    async (betId: string, patch: EditBetPatch) => {
      const bet = bets.find((b) => b.id === betId)
      if (!bet) throw new Error(`Bet ${betId} not found in local state`)

      const newStake = patch.stake ?? bet.stake
      const newOdds =
        patch.odds_american !== undefined ? patch.odds_american : bet.odds_american
      const newStatus = patch.status ?? bet.status

      if (!Number.isFinite(newStake) || newStake <= 0) {
        throw new Error('Stake must be a positive number')
      }

      const recomputedToWin = computeToWin(newStake, newOdds)
      const newToWin = recomputedToWin ?? bet.to_win
      const newProfitLoss =
        newStatus === 'pending'
          ? null
          : computeProfitLoss(newStatus, newStake, newToWin, bet.is_freeplay)

      // settled_at logic: clear when reverting to pending, otherwise keep
      // existing or stamp now() if the bet was previously pending.
      const newSettledAt =
        newStatus === 'pending'
          ? null
          : (bet.settled_at ?? new Date().toISOString())

      // 1. Update the bet row.
      const { error: updateBetErr } = await supabase
        .from('bets')
        .update({
          stake: newStake,
          to_win: newToWin,
          odds_american: newOdds,
          status: newStatus,
          profit_loss: newProfitLoss,
          settled_at: newSettledAt,
          bet_type: patch.bet_type ?? bet.bet_type,
          // A manual edit is authoritative — mark it so the auto-settle cron
          // never overrides a human-edited outcome (stays out of its query).
          auto_settle_state: 'manual',
          // Optional description re-author (omitted from payload entirely when
          // not patched so we never null out an existing description).
          ...(patch.description !== undefined
            ? { description: patch.description }
            : {}),
        })
        .eq('id', betId)
      if (updateBetErr) {
        throw new Error(`Failed to update bet: ${updateBetErr.message}`)
      }

      // 1b. Leg replacement (straight→parlay conversion or leg re-author).
      //     Bankroll-neutral: stake/odds/status are unchanged here, so the
      //     wipe-and-re-emit below produces identical events.
      if (patch.legs !== undefined) {
        const { error: delLegsErr } = await supabase
          .from('parlay_legs')
          .delete()
          .eq('bet_id', betId)
        if (delLegsErr) {
          throw new Error(`Failed to clear legs: ${delLegsErr.message}`)
        }
        if (patch.legs.length > 0) {
          const { error: insLegsErr } = await supabase
            .from('parlay_legs')
            .insert(legRowsForInsert(betId, patch.legs))
          if (insLegsErr) {
            throw new Error(`Failed to insert legs: ${insLegsErr.message}`)
          }
        }
      }

      // 2. Wipe the bet's existing bankroll events (placement + settlement).
      const { error: deleteEventsErr } = await supabase
        .from('bankroll_events')
        .delete()
        .eq('bet_id', betId)
      if (deleteEventsErr) {
        throw new Error(
          `Failed to delete prior events: ${deleteEventsErr.message}`,
        )
      }

      // 3. Re-emit events using the same convention as insertBets + settleBet.
      //    Use the bet's own timestamps so chain order matches reality.
      const placedAt = bet.placed_at
      const settledAt = newSettledAt ?? new Date().toISOString()

      const newEvents: Array<Omit<BankrollEvent, 'id' | 'balance_after'>> = []

      if (bet.is_freeplay) {
        // FP placement always consumes the stake — happens for pending and settled.
        newEvents.push({
          event_type: 'bet_settled',
          bankroll_type: 'freeplay',
          amount: -newStake,
          bet_id: betId,
          occurred_at: placedAt,
          note: 'FP stake consumed at placement',
        })
        if (newStatus === 'won') {
          newEvents.push({
            event_type: 'bet_settled',
            bankroll_type: 'cash',
            amount: newToWin,
            bet_id: betId,
            occurred_at: settledAt,
            note: null,
          })
        } else if (newStatus === 'void' || newStatus === 'push') {
          newEvents.push({
            event_type: 'bet_settled',
            bankroll_type: 'freeplay',
            amount: newStake,
            bet_id: betId,
            occurred_at: settledAt,
            note: 'FP stake refunded',
          })
        }
        // pending or lost FP: no settlement event beyond the placement.
      } else {
        // Cash bets: no event at placement; only emit on settled outcomes
        // that move cash.
        const cashChange =
          newStatus === 'won'
            ? newToWin
            : newStatus === 'lost'
              ? -newStake
              : 0
        if (cashChange !== 0) {
          newEvents.push({
            event_type: 'bet_settled',
            bankroll_type: 'cash',
            amount: cashChange,
            bet_id: betId,
            occurred_at: settledAt,
            note: null,
          })
        }
      }

      if (newEvents.length > 0) {
        const { error: insertEventsErr } = await supabase
          .from('bankroll_events')
          .insert(
            newEvents.map((e) => ({
              ...e,
              balance_after: 0, // chain rebuild fixes this
            })),
          )
        if (insertEventsErr) {
          throw new Error(
            `Failed to insert new events: ${insertEventsErr.message}`,
          )
        }
      }

      // 4. Rebuild balance_after for both bankroll types.
      const { data: fresh, error: fetchErr } = await supabase
        .from('bankroll_events')
        .select('*')
        .order('occurred_at', { ascending: true })
      if (fetchErr) {
        throw new Error(`Failed to refetch events: ${fetchErr.message}`)
      }

      for (const type of ['cash', 'freeplay'] as const) {
        const drift = recomputeChain(fresh ?? [], type)
        for (const d of drift) {
          const { error: updErr } = await supabase
            .from('bankroll_events')
            .update({ balance_after: d.expected })
            .eq('id', d.id)
          if (updErr) {
            throw new Error(`Chain rebuild failed: ${updErr.message}`)
          }
        }
      }

      await fetchBets()
    },
    [bets, fetchBets],
  )

  // ---------------------------------------------------------------------------
  // Lock a bet to a specific live game (ESPN event id). Once locked, the live
  // page no longer re-matches the bet against the scoreboard, so a settled
  // game can't roll forward to the next entry in a series.
  // ---------------------------------------------------------------------------

  const linkBetToGame = useCallback(
    async (betId: string, gameId: string, sport: string) => {
      const { error } = await supabase
        .from('bets')
        .update({
          live_game_id: gameId,
          live_game_sport: sport,
          live_game_locked_at: new Date().toISOString(),
        })
        .eq('id', betId)
        .is('live_game_id', null)
      if (error) {
        console.error('Failed to lock bet to game:', error.message)
        return
      }
      setBets((prev) =>
        prev.map((b) =>
          b.id === betId && b.live_game_id == null
            ? {
                ...b,
                live_game_id: gameId,
                live_game_sport: sport,
                live_game_locked_at: new Date().toISOString(),
              }
            : b,
        ),
      )
    },
    [],
  )

  useEffect(() => {
    fetchBets()
  }, [fetchBets])

  return {
    bets,
    loading,
    settleBet,
    editBet,
    insertBets,
    linkBetToGame,
    refetch: fetchBets,
  }
}
