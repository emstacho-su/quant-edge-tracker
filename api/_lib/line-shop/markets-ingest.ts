/**
 * Pure ingestion transform: odds_snapshots rows → markets upsert rows.
 * One markets row per (event_id, market_type, market_param). 0 Odds API credits.
 * Only moneyline/spread/total are materialized (props/outrights/team_totals are out of scope).
 */

export interface IngestSnap {
  odds_event_id: string
  sport_key: string
  commence_time: string | null
  home_team: string | null
  away_team: string | null
  market: string
  point: number | null
}

export interface MarketUpsertRow {
  sport: string
  event_id: string
  event_name: string
  event_start: string | null
  market_type: string
  market_param: string
  odds_api_event_id: string
  home_team: string | null
  away_team: string | null
}

const REVERSE_SPORT: Record<string, string> = {
  baseball_mlb: 'mlb', basketball_nba: 'nba', basketball_wnba: 'wnba',
  americanfootball_nfl: 'nfl', americanfootball_ncaaf: 'ncaaf', basketball_ncaab: 'ncaab',
  icehockey_nhl: 'nhl', mma_mixed_martial_arts: 'mma',
}
const REVERSE_MARKET: Record<string, string> = { h2h: 'moneyline', spreads: 'spread', totals: 'total' }
const SUPPORTED_MARKETS = new Set(['h2h', 'spreads', 'totals'])

export function reverseSport(sportKey: string): string {
  return REVERSE_SPORT[sportKey] ?? sportKey
}
export function reverseMarket(market: string): string {
  return REVERSE_MARKET[market] ?? market
}

export function deriveMarketRows(snaps: IngestSnap[]): MarketUpsertRow[] {
  const byKey = new Map<string, MarketUpsertRow>()
  for (const s of snaps) {
    if (!SUPPORTED_MARKETS.has(s.market)) continue
    const market_type = reverseMarket(s.market)
    const market_param = s.point == null ? '' : String(s.point)
    const event_id = s.odds_event_id
    const key = `${event_id}|${market_type}|${market_param}`
    if (byKey.has(key)) continue
    byKey.set(key, {
      sport: reverseSport(s.sport_key),
      event_id,
      event_name: `${s.away_team ?? ''} @ ${s.home_team ?? ''}`.trim(),
      event_start: s.commence_time,
      market_type,
      market_param,
      odds_api_event_id: event_id,
      home_team: s.home_team,
      away_team: s.away_team,
    })
  }
  return Array.from(byKey.values())
}
