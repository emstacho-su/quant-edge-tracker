import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireSession } from '../_lib/session.js'
import { run } from '../cron/line-movement.js'

/**
 * POST /api/clv/refresh
 *
 * On-demand sibling of the line-movement cron. Gated by signed session cookie
 * (the same gate that protects /import write actions) so the logged-in browser
 * can trigger a fresh fetch — e.g. when the tab regains focus after the laptop
 * was asleep — without needing CRON_SECRET.
 *
 * Server-side cooldown: 60s per process to keep an aggressive focus listener
 * from burning Odds API credits if the user flicks tabs.
 */

let lastRunAt = 0
const COOLDOWN_MS = 60_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const session = requireSession(req, res)
  if (!session) return

  const now = Date.now()
  const sinceLast = now - lastRunAt
  if (sinceLast < COOLDOWN_MS) {
    return res.status(200).json({ skipped: 'cooldown', retryAfterMs: COOLDOWN_MS - sinceLast })
  }
  lastRunAt = now

  try {
    return res.status(200).json(await run())
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
