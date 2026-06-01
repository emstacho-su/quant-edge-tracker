import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../_lib/supabase-admin.js'
import { closingFairForSelection, gradeOutcome } from '../_lib/strategy-clv.js'

/**
 * GET /api/cron/strategy-clv
 *
 * DB-read-only CLV grader for strategy_outcomes. Reads pre-ingested Pinnacle
 * lines from odds_snapshots — makes NO Odds-API calls and has no credit-floor
 * logic. Runs every 15 min; locks outcomes once their event has commenced.
 *
 * Secured by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    return res.status(200).json(await run())
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}

export async function run() {
  const supabase = getServiceClient()

  const { data: rows } = await supabase
    .from('strategy_outcomes')
    .select('id, odds_event_id, clv_market, clv_selection, clv_point, offered_odds, clv_status')
    .not('odds_event_id', 'is', null)
    .in('clv_status', ['pending', 'tracking'])

  let graded = 0
  let skipped = 0
  let errors = 0

  for (const r of rows ?? []) {
    const { data: snaps } = await supabase
      .from('odds_snapshots')
      .select('selection, point, price_american, captured_at, commence_time')
      .eq('odds_event_id', r.odds_event_id)
      .eq('bookmaker', 'pinnacle')
      .eq('market', r.clv_market)
      .order('captured_at', { ascending: false })
      .limit(50) // bound history; the latest captured_at group is still fully captured

    if (!snaps?.length) continue

    const latestTs = snaps[0].captured_at
    const latest = snaps.filter((s) => s.captured_at === latestTs)
    const closingFair = closingFairForSelection(latest, r.clv_selection, r.clv_point)
    const commence = snaps[0].commence_time

    if (closingFair == null) {
      const { error } = await supabase
        .from('strategy_outcomes')
        .update({ clv_status: 'unsupported', clv_updated_at: new Date().toISOString() })
        .eq('id', r.id)
      if (error) errors++
      else skipped++
      continue
    }

    const g = gradeOutcome({ offered_odds: r.offered_odds, closingFair })
    const locked = commence != null && new Date(commence) <= new Date()

    const { error } = await supabase
      .from('strategy_outcomes')
      .update({
        ...g,
        event_commence_time: commence ?? null,
        clv_status: locked ? 'locked' : 'tracking',
        clv_updated_at: new Date().toISOString(),
      })
      .eq('id', r.id)

    if (error) errors++
    else graded++
  }

  return { total: rows?.length ?? 0, graded, skipped, errors }
}
