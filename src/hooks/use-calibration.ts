/**
 * useCalibration hook (05-04 W4.2)
 *
 * Fires all four calibration view queries + lastSettledAt in parallel via
 * Promise.all and returns a single combined object.
 *
 * No caching — the views are cheap and the tab is loaded infrequently.
 * React Query / SWR adoption is a milestone 06+ refactor.
 */

import { useEffect, useState } from 'react'
import {
  getCalibrationByBucket,
  getCalibrationByMarket,
  getCalibrationByConfidence,
  getRollingPnlWeekly,
  getLastSettledAt,
} from '@/lib/supabase-strategies'
import type { CalibrationData } from '@/types/strategies'

interface UseCalibrationResult {
  data: CalibrationData | null
  loading: boolean
  error: Error | null
}

export function useCalibration(strategyId: string): UseCalibrationResult {
  const [data, setData] = useState<CalibrationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!strategyId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      getCalibrationByBucket(strategyId),
      getCalibrationByMarket(strategyId),
      getCalibrationByConfidence(strategyId),
      getRollingPnlWeekly(strategyId),
      getLastSettledAt(strategyId),
    ])
      .then(([byBucket, byMarket, byConfidence, rollingPnl, lastSettledAt]) => {
        if (cancelled) return
        setData({ byBucket, byMarket, byConfidence, rollingPnl, lastSettledAt })
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [strategyId])

  return { data, loading, error }
}
