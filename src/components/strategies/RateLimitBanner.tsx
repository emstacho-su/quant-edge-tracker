/**
 * RateLimitBanner — shows a warning when rate limits are hit (05-05 W5.3).
 *
 * Renders at the top of /strategies list and /strategies/:id detail pages.
 * Public read — no auth required.
 */

import { AlertTriangle } from 'lucide-react'
import { useRateLimitStatus } from '@/hooks/use-rate-limit-status'

export function RateLimitBanner() {
  const { status, loading } = useRateLimitStatus()

  if (loading || !status) return null

  const rollingHit = !status.rolling_5h.allowed
  const dailyHit = !status.daily.allowed

  if (!rollingHit && !dailyHit) return null

  const messages: string[] = []
  if (rollingHit) {
    messages.push(
      `${status.rolling_5h.current_count}/${status.rolling_5h.limit} runs in last 5 hours`,
    )
  }
  if (dailyHit) {
    messages.push(`${status.daily.current_count}/${status.daily.limit} runs today (ET)`)
  }

  const isHard = rollingHit || dailyHit

  return (
    <div
      className={`flex items-start gap-3 rounded border px-4 py-3 text-sm ${
        isHard
          ? 'border-destructive/50 bg-destructive/10 text-destructive'
          : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-500'
      }`}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <span className="font-medium">Rate limit reached: </span>
        {messages.join('; ')}. New runs will fail immediately until the window resets.
      </div>
    </div>
  )
}
