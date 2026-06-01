import { getServiceClient } from './supabase-admin.js'
import { fetchSportOdds, type OddsEvent } from './odds-api.js'

/**
 * Canonical Odds API slate ingestion → `odds_snapshots`.
 *
 * Unlike the CLV `line-movement` cron — which only snapshots Pinnacle outcomes
 * for events tied to a *qualifying pending bet* — this pulls the FULL slate for
 * each requested sport (every event × every bookmaker × every market × every
 * outcome) and appends it to `odds_snapshots`.
 *
 * `odds_snapshots` is the single source of truth for "today's lines": the
 * strategy runner reads today's slate from this table instead of calling the
 * Odds API live per run. Each ingestion appends a fresh `captured_at`; the
 * runner takes the latest `captured_at` per (event, market, selection,
 * bookmaker) for current lines, and the history doubles as line movement.
 *
 * Credit cost per sport = (#markets) × (#regions). Defaults below = 3 × 2 = 6.
 */

export interface SlateSnapRow {
  odds_event_id: string
  sport_key: string
  commence_time: string
  home_team: string
  away_team: string
  bookmaker: string
  market: string
  selection: string
  point: number | null
  price_american: number
  captured_at: string
}

export interface SlateSportResult {
  sportKey: string
  events: number
  snapshots: number
  creditsRemaining: number | null
}

export interface SlateIngestResult {
  capturedAt: string
  sports: SlateSportResult[]
  totalSnapshots: number
}

export async function ingestOddsSlate(
  sportKeys: string[],
  opts: { markets?: string; regions?: string } = {},
): Promise<SlateIngestResult> {
  const markets = opts.markets ?? 'h2h,spreads,totals'
  const regions = opts.regions ?? 'us,eu'
  const supabase = getServiceClient()
  const capturedAt = new Date().toISOString()
  const sports: SlateSportResult[] = []
  let totalSnapshots = 0

  for (const sportKey of sportKeys) {
    const { events, creditsRemaining } = await fetchSportOdds(sportKey, markets, regions)
    const rows = flattenSlate(events, sportKey, capturedAt)
    // Chunk inserts to stay well under PostgREST payload limits.
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('odds_snapshots').insert(rows.slice(i, i + 500))
      if (error) throw new Error(`odds_snapshots insert (${sportKey}): ${error.message}`)
    }
    sports.push({ sportKey, events: events.length, snapshots: rows.length, creditsRemaining })
    totalSnapshots += rows.length
  }

  return { capturedAt, sports, totalSnapshots }
}

function flattenSlate(events: OddsEvent[], sportKey: string, capturedAt: string): SlateSnapRow[] {
  const rows: SlateSnapRow[] = []
  for (const ev of events) {
    for (const bk of ev.bookmakers) {
      for (const mk of bk.markets) {
        for (const oc of mk.outcomes) {
          rows.push({
            odds_event_id: ev.id,
            sport_key: sportKey,
            commence_time: ev.commence_time,
            home_team: ev.home_team,
            away_team: ev.away_team,
            bookmaker: bk.key,
            market: mk.key,
            selection: oc.name,
            point: oc.point ?? null,
            price_american: oc.price,
            captured_at: capturedAt,
          })
        }
      }
    }
  }
  return rows
}
