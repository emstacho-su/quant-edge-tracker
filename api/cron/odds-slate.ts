import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ingestOddsSlate } from '../_lib/odds-slate.js'

/**
 * GET /api/cron/odds-slate
 *
 * Canonical Odds API slate dump → `odds_snapshots`. Pulls the full slate
 * (every book × market × outcome) for each active sport so the strategy
 * runner can read "today's lines" from the DB instead of live-fetching the
 * Odds API per run.
 *
 * Distinct from /api/cron/line-movement (CLV tracker, pending-bet-scoped).
 * Secured by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
 */

// Sports to keep a canonical slate for. MLB is the only active strategy sport
// today; add Odds API sport keys here as strategies expand.
const SLATE_SPORTS = ['baseball_mlb']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    return res.status(200).json(await ingestOddsSlate(SLATE_SPORTS))
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
