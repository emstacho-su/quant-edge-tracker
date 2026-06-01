/**
 * account-ledger.ts — Pure ledger-derivation utilities
 *
 * These functions compute summary figures from the `bankroll_events` ledger.
 * They are intentionally free of React/I/O so they can be unit-tested without
 * the `useBankroll()` hook.
 *
 * INVARIANT: Never reads `settings.starting_cash_balance` or
 * `settings.starting_fp_balance` — those keys were dropped. All values are
 * derived exclusively from the events array (CLAUDE.md invariant #2).
 */

import type { BankrollEvent } from '@/lib/types'

// `withdraw_destination` is intersected as optional so existing fixtures and
// callers (which only care about totalDeposits / totalWithdrawals / etc.) don't
// need to thread it through — totalVault is the only util that reads it.
type LedgerEvent = Pick<BankrollEvent, 'event_type' | 'bankroll_type' | 'amount'> & {
  withdraw_destination?: string | null
}

/**
 * Total cash deposited into the sportsbook account.
 *
 * Counts ONLY events where:
 *   - event_type === 'deposit'
 *   - bankroll_type === 'cash'
 *
 * Excludes: withdrawal, starting_balance, manual_adjustment, promo,
 * bet_settled, and any freeplay events.
 */
export function totalDeposits(events: LedgerEvent[]): number {
  return events
    .filter((e) => e.event_type === 'deposit' && e.bankroll_type === 'cash')
    .reduce((sum, e) => sum + e.amount, 0)
}

/**
 * Total cash withdrawn from the sportsbook account (positive magnitude).
 *
 * Counts ONLY events where:
 *   - event_type === 'withdrawal'
 *   - bankroll_type === 'cash'
 *
 * Returns the POSITIVE magnitude withdrawn — uses `Math.abs` because the
 * ledger stores withdrawal amounts as negative numbers in practice. Robust
 * either way (positive or negative source amounts both yield the magnitude).
 *
 * Excludes: deposit, manual_adjustment (corrections, not capital flows),
 * starting_balance, promo, bet_settled, and any freeplay events.
 */
export function totalWithdrawals(events: LedgerEvent[]): number {
  return events
    .filter((e) => e.event_type === 'withdrawal' && e.bankroll_type === 'cash')
    .reduce((sum, e) => sum + Math.abs(e.amount), 0)
}

/**
 * Net cash you've put into the account — your principal "at risk."
 *
 *   cashAtRisk = totalDeposits − totalWithdrawals
 *
 * Excludes profits/losses from bets and any `manual_adjustment` events
 * (those are corrections, not capital flows). Can go negative if you've
 * withdrawn more than you've deposited (e.g., booked winnings and pulled
 * them out).
 */
export function cashAtRisk(events: LedgerEvent[]): number {
  return totalDeposits(events) - totalWithdrawals(events)
}

/**
 * Vault — sum of cash withdrawals that are sitting in checking / Venmo and
 * could be reloaded into a sportsbook. Only counts withdrawals explicitly
 * tagged `withdraw_destination === 'vault'`. Free-text destinations (paying
 * out a friend, fees, etc.) are excluded — they're cash that's gone out and
 * NOT reload-ready.
 *
 * Returns the POSITIVE magnitude (uses `Math.abs` like `totalWithdrawals`).
 */
export function totalVault(events: LedgerEvent[]): number {
  return events
    .filter(
      (e) =>
        e.event_type === 'withdrawal' &&
        e.bankroll_type === 'cash' &&
        e.withdraw_destination === 'vault',
    )
    .reduce((sum, e) => sum + Math.abs(e.amount), 0)
}

/**
 * Total freeplay assigned to the account all-time.
 *
 * Counts events where:
 *   - event_type ∈ {'promo', 'starting_balance'}
 *   - bankroll_type === 'freeplay'
 *
 * CRITICAL: Excludes `bet_settled` freeplay events — those are FP
 * stake-consumption events, NOT FP grants. Including them would double-count
 * FP (CLAUDE.md gotcha / RESEARCH Pitfall 5).
 */
export function totalFpAssigned(events: LedgerEvent[]): number {
  return events
    .filter(
      (e) =>
        (e.event_type === 'promo' || e.event_type === 'starting_balance') &&
        e.bankroll_type === 'freeplay',
    )
    .reduce((sum, e) => sum + e.amount, 0)
}
