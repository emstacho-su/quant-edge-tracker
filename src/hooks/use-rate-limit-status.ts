/**
 * useRateLimitStatus — fetches current rate-limit counters (05-05 W5.3).
 */

import { useState, useEffect } from 'react'

export interface WindowStatus {
  current_count: number
  limit: number
  allowed: boolean
  window_label: '5h' | 'day'
}

export interface RateLimitStatus {
  rolling_5h: WindowStatus
  daily: WindowStatus
}

export interface UseRateLimitStatusResult {
  status: RateLimitStatus | null
  loading: boolean
  error: string | null
}

export function useRateLimitStatus(): UseRateLimitStatusResult {
  const [status, setStatus] = useState<RateLimitStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/admin/rate-limit-status')
      .then((r) => r.json() as Promise<RateLimitStatus | { error: string }>)
      .then((data) => {
        if (cancelled) return
        if ('error' in data) {
          setError(data.error)
        } else {
          setStatus(data)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch rate limit status')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  return { status, loading, error }
}
