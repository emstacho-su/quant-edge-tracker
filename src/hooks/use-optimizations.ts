/**
 * useOptimizations hook — fetches strategy_optimizations for a strategy (05-05 W4.2).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { listOptimizations } from '@/lib/supabase-strategies'
import type { StrategyOptimization } from '@/types/strategies'

export interface UseOptimizationsResult {
  optimizations: StrategyOptimization[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useOptimizations(strategyId: string): UseOptimizationsResult {
  const [optimizations, setOptimizations] = useState<StrategyOptimization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Generation counter — any in-flight fetch from any trigger (mount, refetch, focus)
  // is invalidated when reqId.current advances. This prevents stale setState on unmount
  // regardless of which code path triggered the fetch. WR-05 fix.
  const reqId = useRef(0)

  const fetchOptimizations = useCallback(() => {
    if (!strategyId) return
    const myId = ++reqId.current
    setLoading(true)
    setError(null)
    listOptimizations(strategyId)
      .then((data) => {
        if (myId === reqId.current) {
          setOptimizations(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (myId === reqId.current) {
          setError(err instanceof Error ? err.message : 'Failed to load optimizations')
          setLoading(false)
        }
      })
  }, [strategyId])

  useEffect(() => {
    fetchOptimizations()
    // Advance the counter on unmount so any in-flight fetch is ignored
    return () => { reqId.current++ }
  }, [fetchOptimizations])

  // Refresh on window focus
  useEffect(() => {
    const handleFocus = () => { fetchOptimizations() }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [fetchOptimizations])

  return { optimizations, loading, error, refetch: fetchOptimizations }
}
