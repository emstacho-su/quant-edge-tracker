import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Bet } from '@/lib/types'
import type { OddsSnapshot } from '@/lib/clv'

/**
 * Loads pending bets (with their CLV fields) and the Pinnacle + book line-movement
 * snapshots for their matched events. CLV is computed server-side by the cron;
 * this hook just reads it.
 */
export function useClv() {
  const [bets, setBets] = useState<Bet[]>([])
  const [snapshots, setSnapshots] = useState<OddsSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    // Pull every pending bet regardless of clv_status (so 'pending' / 'unsupported'
    // picks show up too — not just the ones the cron has already started
    // snapshotting). Also fetch settled bets that already have a captured close
    // (clv_status='locked') so the cumulative beat-the-close tally can count them.
    const [pendingRes, lockedRes] = await Promise.all([
      supabase
        .from('bets')
        .select('*')
        .eq('status', 'pending')
        .order('event_commence_time', { ascending: true, nullsFirst: false }),
      supabase
        .from('bets')
        .select('*')
        .neq('status', 'pending')
        .eq('clv_status', 'locked')
        .order('event_commence_time', { ascending: true, nullsFirst: false }),
    ])
    if (pendingRes.error) {
      console.error('useClv: failed to fetch pending bets:', pendingRes.error.message)
      setLoading(false)
      return
    }
    if (lockedRes.error) {
      console.error('useClv: failed to fetch locked-settled bets:', lockedRes.error.message)
    }
    const b = ([...(pendingRes.data ?? []), ...(lockedRes.data ?? [])]) as Bet[]
    setBets(b)

    // Snapshots are only needed for the live cards (pending bets) — settled bets
    // contribute to cumulative counts but have no card.
    const ids = Array.from(
      new Set(
        b.filter((x) => x.status === 'pending')
          .map((x) => x.odds_event_id)
          .filter((x): x is string => Boolean(x)),
      ),
    )
    if (ids.length) {
      const { data: snapData, error: snapErr } = await supabase
        .from('odds_snapshots')
        .select('*')
        .in('odds_event_id', ids)
        .order('captured_at', { ascending: true })
      if (snapErr) console.error('useClv: failed to fetch snapshots:', snapErr.message)
      setSnapshots((snapData ?? []) as OddsSnapshot[])
    } else {
      setSnapshots([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Re-pull from Supabase when the tab regains focus (e.g. after laptop wake).
  // Two-shot: refetch immediately to pick up whatever's already stored, then
  // again ~7s later to catch the snapshots written by the on-focus cron trigger
  // (AuthProvider POSTs /api/clv/refresh on the same focus event; the cron run
  // typically completes in 3–8s). 10s throttle on the leading refetch keeps
  // quick tab flicks from spamming the DB.
  useEffect(() => {
    let lastFetchAt = Date.now()
    const THROTTLE_MS = 10_000
    const POST_CRON_DELAY_MS = 7_000
    let trailingTimer: ReturnType<typeof setTimeout> | null = null
    const maybeRefetch = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastFetchAt < THROTTLE_MS) return
      lastFetchAt = now
      void fetchAll()
      if (trailingTimer) clearTimeout(trailingTimer)
      trailingTimer = setTimeout(() => { void fetchAll() }, POST_CRON_DELAY_MS)
    }
    document.addEventListener('visibilitychange', maybeRefetch)
    window.addEventListener('focus', maybeRefetch)
    return () => {
      document.removeEventListener('visibilitychange', maybeRefetch)
      window.removeEventListener('focus', maybeRefetch)
      if (trailingTimer) clearTimeout(trailingTimer)
    }
  }, [fetchAll])

  return { bets, snapshots, loading, refetch: fetchAll }
}
