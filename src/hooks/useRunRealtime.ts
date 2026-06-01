import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { StrategyRun } from '@/types/strategies'

type LiveSource = 'idle' | 'realtime' | 'polling' | 'closed'

interface UseRunRealtimeResult {
  run: StrategyRun | null
  source: LiveSource
}

/**
 * Subscribe to a single `strategy_runs` row by id. Returns the latest row
 * and the source label (realtime channel vs polling fallback).
 *
 * Falls back to a 3s polling loop if the Realtime channel fails to connect
 * (defensive — Realtime is enabled per-table in Supabase and the user may
 * not have toggled it for `strategy_runs` yet).
 *
 * Stops both channels once the run reaches a terminal state (completed/failed).
 */
export function useRunRealtime(
  runId: string | null,
  initial: StrategyRun | null,
): UseRunRealtimeResult {
  const [run, setRun] = useState<StrategyRun | null>(initial)
  const [source, setSource] = useState<LiveSource>('idle')
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Keep `run` in sync with the initial server-fetched row when it changes.
  useEffect(() => {
    setRun(initial)
  }, [initial])

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    let stopped = false

    function stopPolling() {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }

    async function fetchOnce() {
      const { data, error } = await supabase
        .from('strategy_runs')
        .select('*')
        .eq('id', runId)
        .maybeSingle()
      if (cancelled || error || !data) return
      const next = data as StrategyRun
      setRun(next)
      if (next.status === 'completed' || next.status === 'failed') {
        stopped = true
        stopPolling()
        setSource('closed')
      }
    }

    function startPolling() {
      if (stopped || pollTimerRef.current) return
      setSource('polling')
      pollTimerRef.current = setInterval(() => {
        if (!stopped) void fetchOnce()
      }, 3000)
    }

    // Realtime subscription
    const channel = supabase
      .channel(`strategy_runs:${runId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'strategy_runs',
          filter: `id=eq.${runId}`,
        },
        (payload) => {
          if (cancelled) return
          const next = payload.new as StrategyRun
          setRun(next)
          if (next.status === 'completed' || next.status === 'failed') {
            stopped = true
            stopPolling()
            setSource('closed')
          }
        },
      )
      .subscribe((status) => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') {
          setSource('realtime')
          stopPolling() // realtime took over
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          if (!stopped) startPolling()
        }
      })

    // Always start with one immediate fetch (handles between-mount-and-subscribe gap)
    void fetchOnce()

    // Defensive fallback: if we haven't transitioned to 'realtime' within 2s,
    // start polling too. The realtime callback above will stopPolling() when
    // it eventually wins.
    const fallbackTimer = setTimeout(() => {
      if (!cancelled && !stopped && source !== 'realtime') startPolling()
    }, 2000)

    return () => {
      cancelled = true
      stopped = true
      clearTimeout(fallbackTimer)
      stopPolling()
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  return { run, source }
}
