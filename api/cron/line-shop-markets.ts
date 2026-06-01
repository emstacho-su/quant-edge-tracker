import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../_lib/supabase-admin.js'
import { deriveMarketRows, type IngestSnap } from '../_lib/line-shop/markets-ingest.js'

/**
 * GET /api/cron/line-shop-markets
 *
 * DB-only (0 Odds API credits): materializes the `markets` registry from
 * odds_snapshots for upcoming events, so /line-shop price resolution + the
 * arbitrage scanner have canonical market rows to resolve against.
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

export async function run(): Promise<{ scanned: number; upserted: number }> {
  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()

  // Paginate past PostgREST's 1000-row cap; only upcoming events.
  const snaps: IngestSnap[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('odds_snapshots')
      .select('odds_event_id, sport_key, commence_time, home_team, away_team, market, point')
      .gt('commence_time', nowIso)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`odds_snapshots query: ${error.message}`)
    const rows = (data ?? []) as IngestSnap[]
    snaps.push(...rows)
    if (rows.length < PAGE) break
  }

  const marketRows = deriveMarketRows(snaps)
  let upserted = 0
  for (let i = 0; i < marketRows.length; i += 500) {
    const { error } = await supabase
      .from('markets')
      .upsert(marketRows.slice(i, i + 500), { onConflict: 'event_id,market_type,market_param' })
    if (error) throw new Error(`markets upsert: ${error.message}`)
    upserted += Math.min(500, marketRows.length - i)
  }

  return { scanned: snaps.length, upserted }
}
