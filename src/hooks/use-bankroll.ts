import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { BankrollEvent, BankrollEventType, BankrollType } from '@/lib/types'
import { recomputeChain } from '@/utils/bankroll-helpers'

export interface NewBankrollEvent {
  event_type: BankrollEventType
  bankroll_type: BankrollType
  amount: number
  occurred_at: string
  note: string | null
  /**
   * Only meaningful for `event_type === 'withdrawal'`. 'vault' counts toward
   * the Account Info Vault stat (reload-ready cash sitting in checking/Venmo).
   * Free text describes any other destination (paying a friend, fees, etc.).
   * Ignored / coerced to NULL for non-withdrawal events.
   */
  withdraw_destination?: string | null
}

async function rebuildChainInDb(
  fresh: BankrollEvent[],
  bankrollType: BankrollType,
): Promise<void> {
  const drift = recomputeChain(fresh, bankrollType)
  for (const d of drift) {
    const { error } = await supabase
      .from('bankroll_events')
      .update({ balance_after: d.expected })
      .eq('id', d.id)
    if (error) throw new Error(`Chain rebuild failed: ${error.message}`)
  }
}

export function useBankroll() {
  const [events, setEvents] = useState<BankrollEvent[]>([])
  const [loading, setLoading] = useState(true)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('bankroll_events')
      .select('*')
      .order('occurred_at', { ascending: true })

    if (error) {
      console.error('Failed to fetch bankroll events:', error.message)
      setLoading(false)
      return
    }

    setEvents(data ?? [])
    setLoading(false)
  }, [])

  // Derive current balances from the last event of each bankroll type
  const cashBalance = useMemo(() => {
    const cashEvents = events.filter((e) => e.bankroll_type === 'cash')
    return cashEvents.length > 0
      ? cashEvents[cashEvents.length - 1].balance_after
      : 0
  }, [events])

  const fpBalance = useMemo(() => {
    const fpEvents = events.filter((e) => e.bankroll_type === 'freeplay')
    return fpEvents.length > 0
      ? fpEvents[fpEvents.length - 1].balance_after
      : 0
  }, [events])

  // Insert a manual ledger event (deposit / withdrawal / promo / manual_adjustment).
  // Caller is responsible for sign convention: withdrawals/adjustments must be
  // pre-signed (negative for outflow). Always rebuilds the chain afterwards.
  const addEvent = useCallback(
    async (input: NewBankrollEvent) => {
      // Insert with placeholder balance_after; chain rebuild will correct it.
      // withdraw_destination is only persisted for withdrawal events (coerced
      // to NULL otherwise) so the column stays meaningful — see types.ts.
      const { error: insertErr } = await supabase
        .from('bankroll_events')
        .insert({
          event_type: input.event_type,
          bankroll_type: input.bankroll_type,
          amount: input.amount,
          balance_after: 0,
          bet_id: null,
          occurred_at: input.occurred_at,
          note: input.note,
          withdraw_destination:
            input.event_type === 'withdrawal'
              ? input.withdraw_destination ?? null
              : null,
        })
      if (insertErr) throw new Error(`Failed to insert event: ${insertErr.message}`)

      const { data: fresh, error: fetchErr } = await supabase
        .from('bankroll_events')
        .select('*')
        .order('occurred_at', { ascending: true })
      if (fetchErr) throw new Error(`Failed to refetch: ${fetchErr.message}`)

      await rebuildChainInDb(fresh ?? [], input.bankroll_type)
      await fetchEvents()
    },
    [fetchEvents],
  )

  // Update an existing manual event's amount, occurred_at, or note.
  // Bet-settled events should be edited via the bet settle/void flow instead.
  const updateEvent = useCallback(
    async (
      id: string,
      patch: { amount?: number; occurred_at?: string; note?: string | null },
    ) => {
      const target = events.find((e) => e.id === id)
      if (!target) throw new Error(`Event ${id} not found`)
      if (target.event_type === 'bet_settled') {
        throw new Error('Bet-settled events must be edited via the bet flow')
      }

      const { error: updateErr } = await supabase
        .from('bankroll_events')
        .update(patch)
        .eq('id', id)
      if (updateErr) throw new Error(`Failed to update event: ${updateErr.message}`)

      const { data: fresh, error: fetchErr } = await supabase
        .from('bankroll_events')
        .select('*')
        .order('occurred_at', { ascending: true })
      if (fetchErr) throw new Error(`Failed to refetch: ${fetchErr.message}`)

      await rebuildChainInDb(fresh ?? [], target.bankroll_type)
      await fetchEvents()
    },
    [events, fetchEvents],
  )

  const deleteEvent = useCallback(
    async (id: string) => {
      const target = events.find((e) => e.id === id)
      if (!target) throw new Error(`Event ${id} not found`)
      if (target.event_type === 'bet_settled') {
        throw new Error('Bet-settled events must be removed via the bet flow')
      }

      const { error: deleteErr } = await supabase
        .from('bankroll_events')
        .delete()
        .eq('id', id)
      if (deleteErr) throw new Error(`Failed to delete event: ${deleteErr.message}`)

      const { data: fresh, error: fetchErr } = await supabase
        .from('bankroll_events')
        .select('*')
        .order('occurred_at', { ascending: true })
      if (fetchErr) throw new Error(`Failed to refetch: ${fetchErr.message}`)

      await rebuildChainInDb(fresh ?? [], target.bankroll_type)
      await fetchEvents()
    },
    [events, fetchEvents],
  )

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  return {
    events,
    cashBalance,
    fpBalance,
    loading,
    refetch: fetchEvents,
    addEvent,
    updateEvent,
    deleteEvent,
  }
}
