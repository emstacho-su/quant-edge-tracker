/**
 * GET /api/admin/rate-limit-status
 *
 * Public read — returns current rolling window and daily quota counts so the UI
 * can render a warning banner when limits are hit (05-05 W5.3b).
 *
 * SQL is duplicated from quant-edge-runner/src/limits.ts — package extraction
 * punted to milestone 06+ (acceptable at single-user scale).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../_lib/supabase-admin.js'

const DEFAULT_MAX_5H_RUNS = 8
const DEFAULT_MAX_DAILY_RUNS = 25

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const supabase = getServiceClient()

    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()

    // ET midnight — DST-correct via Intl offset probe (handles EST −05:00 / EDT −04:00).
    // Hardcoding -05:00 would miss any run placed in the first EDT hour after midnight
    // (mid-March through early November, including today). CR-01 fix.
    const nowUtc = new Date()
    const etDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(nowUtc)
    // Treat etDateStr as UTC midnight, then probe what ET-hour that corresponds to.
    // The probe tells us the UTC→ET offset so we can find the true ET midnight in UTC.
    const asUtcMidnight = new Date(`${etDateStr}T00:00:00Z`)
    const etHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour12: false, hour: '2-digit',
      }).format(asUtcMidnight),
    )
    const offsetHours = etHour === 0 ? 0 : 24 - etHour
    const etMidnightUtc = new Date(asUtcMidnight.getTime() + offsetHours * 3_600_000)

    // Filter on triggered_at (non-null for every row, including queued runs) rather than
    // started_at (null for queued runs) so the banner counts the full backlog.
    // WR-01 fix — mirrors the runner's limits.ts which counts by enqueue time.
    const [rollingRes, dailyRes] = await Promise.all([
      supabase
        .from('strategy_runs')
        .select('id', { count: 'exact', head: true })
        .gte('triggered_at', fiveHoursAgo),
      supabase
        .from('strategy_runs')
        .select('id', { count: 'exact', head: true })
        .gte('triggered_at', etMidnightUtc.toISOString()),
    ])

    if (rollingRes.error) return res.status(500).json({ error: rollingRes.error.message })
    if (dailyRes.error) return res.status(500).json({ error: dailyRes.error.message })

    const rolling5hLimit = DEFAULT_MAX_5H_RUNS
    const dailyLimit = DEFAULT_MAX_DAILY_RUNS

    return res.status(200).json({
      rolling_5h: {
        current_count: rollingRes.count ?? 0,
        limit: rolling5hLimit,
        allowed: (rollingRes.count ?? 0) < rolling5hLimit,
        window_label: '5h',
      },
      daily: {
        current_count: dailyRes.count ?? 0,
        limit: dailyLimit,
        allowed: (dailyRes.count ?? 0) < dailyLimit,
        window_label: 'day',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
