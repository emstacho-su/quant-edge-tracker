/**
 * OddsApiAdapter — implements BookAdapter using the Odds API aggregator.
 *
 * READ-ONLY INVARIANT (BOOK-06, D-10):
 * This adapter exposes ONLY data-fetching methods. No order-placement surface
 * (placeOrder, createOrder, cancelOrder, modifyBet, placeBet) exists anywhere
 * in this file. Do not add any mutation method.
 *
 * Key correctness invariants (from plan §critical_correctness):
 *  1. matchScore imported from '../../match.js' (NOT clv.ts)
 *  2. impliedProb is RAW = impliedFromAmerican(price_american) — NEVER devigged
 *  3. BookPriceSnapshot.book = individual bookmaker key (e.g. 'pinnacle'), NOT 'odds_api'
 *  4. forceFresh honors ODDS_CREDIT_FLOOR — below floor returns null, never throws
 *  5. resolveEventMapping writes matched_by='needs_review' on same-city ambiguity
 */

import { fetchSportOdds, fetchSportEvents, fetchEventOdds } from '../../odds-api.js'
import type { OddsEvent } from '../../odds-api.js'
import { matchScore } from '../../match.js'
import { americanToDecimal, impliedFromAmerican } from '../../clv.js'
import { getServiceClient } from '../../supabase-admin.js'
import type { SlateSnapRow } from '../../odds-slate.js'
import type {
  BookAdapter,
  BookName,
  SourceConfidence,
  CanonicalMarket,
  BookPriceSnapshot,
  RawBookEvent,
  Side,
} from './types.js'

// ─── Bookmaker key constants ──────────────────────────────────────────────────
// Expected keys per live Odds API (verification DEFERRED — no local ODDS_API_KEY;
// verify on the daemon/Vercel host). See SUMMARY for details.
// Format: { eu: [...], us: [...] }
export const BOOKMAKER_KEYS = {
  eu: ['pinnacle'],
  us: ['bovada', 'betus', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us'],
} as const

// ─── Sport key mapping ────────────────────────────────────────────────────────

const SPORT_KEY_MAP: Record<string, string> = {
  mlb: 'baseball_mlb',
  nba: 'basketball_nba',
  nfl: 'americanfootball_nfl',
  nhl: 'icehockey_nhl',
  golf: 'golf_masters_tournament_winner',
  soccer: 'soccer_usa_mls',
}

function oddsApiSportKey(sport: string): string {
  return SPORT_KEY_MAP[sport.toLowerCase()] ?? sport
}

// ─── Market key mapping ────────────────────────────────────────────────────────

const MARKET_KEY_MAP: Record<string, string> = {
  moneyline: 'h2h',
  spread: 'spreads',
  runline: 'spreads',
  puckline: 'spreads',
  total: 'totals',
  team_total: 'team_totals',
  outright: 'outrights',
}

function oddsApiMarketKey(marketType: string): string {
  return MARKET_KEY_MAP[marketType] ?? marketType
}

// ─── Selection → Side mapping ─────────────────────────────────────────────────

function selectionToSide(selection: string, homeTeam: string, awayTeam: string): Side {
  const sel = selection.toLowerCase()
  const home = homeTeam.toLowerCase()
  const away = awayTeam.toLowerCase()
  if (sel === 'over') return 'over'
  if (sel === 'under') return 'under'
  if (sel === 'yes') return 'yes'
  if (sel === 'no') return 'no'
  // Team-name matching for home/away
  const homeScore = matchScore(selection, homeTeam)
  const awayScore = matchScore(selection, awayTeam)
  if (homeScore > 0 && homeScore >= awayScore) return 'home'
  if (awayScore > 0) return 'away'
  // Fallback: substring check
  if (home.includes(sel) || sel.includes(home)) return 'home'
  if (away.includes(sel) || sel.includes(away)) return 'away'
  return 'home' // last resort
}

// ─── Snapshot construction ────────────────────────────────────────────────────

/** Build BookPriceSnapshot[] from odds_snapshots rows (default path, 0 credits). */
function snapshotsFromRows(rows: SlateSnapRow[]): BookPriceSnapshot[] {
  return rows.map((row): BookPriceSnapshot => ({
    // INVARIANT: book = individual bookmaker key (row.bookmaker), NOT 'odds_api' (Pitfall 2)
    book: row.bookmaker as BookName,
    side: selectionToSide(row.selection, row.home_team, row.away_team),
    priceAmerican: row.price_american,
    priceDecimal: americanToDecimal(row.price_american),
    // INVARIANT: RAW implied prob — never devigged (Pitfall 5)
    impliedProb: impliedFromAmerican(row.price_american),
    point: row.point,
    fetchedAt: new Date(row.captured_at),
    sourceConfidence: 'aggregator',
    isClosing: new Date(row.commence_time) < new Date(row.captured_at),
  }))
}

/** Normalize a live OddsEvent's bookmaker data into BookPriceSnapshot[]. */
function normalizeEventToSnapshots(
  event: OddsEvent,
  marketKey: string,
  fetchedAt: Date,
): BookPriceSnapshot[] {
  const snapshots: BookPriceSnapshot[] = []
  for (const bk of event.bookmakers) {
    const mk = bk.markets.find((m) => m.key === marketKey)
    if (!mk) continue
    for (const oc of mk.outcomes) {
      snapshots.push({
        // INVARIANT: book = individual bookmaker key, NOT adapter name (Pitfall 2)
        book: bk.key as BookName,
        side: selectionToSide(oc.name, event.home_team, event.away_team),
        priceAmerican: oc.price,
        priceDecimal: americanToDecimal(oc.price),
        // INVARIANT: RAW implied prob — never devigged (Pitfall 5)
        impliedProb: impliedFromAmerican(oc.price),
        point: oc.point ?? null,
        fetchedAt,
        sourceConfidence: 'aggregator',
        isClosing: new Date(event.commence_time) < fetchedAt,
      })
    }
  }
  return snapshots
}

/** Map a BookPriceSnapshot to a book_prices insert row. */
function snapshotToBookPriceRow(
  snapshot: BookPriceSnapshot,
  marketId: string,
) {
  return {
    market_id: marketId,
    book: snapshot.book,
    side: snapshot.side,
    price_american: snapshot.priceAmerican,
    price_decimal: snapshot.priceDecimal,
    implied_prob: snapshot.impliedProb,
    point: snapshot.point,
    fetched_at: snapshot.fetchedAt.toISOString(),
    source_confidence: snapshot.sourceConfidence,
    is_closing: snapshot.isClosing,
  }
}

// ─── OddsApiAdapter ───────────────────────────────────────────────────────────

export class OddsApiAdapter implements BookAdapter {
  readonly name: BookName = 'odds_api'
  readonly sourceConfidence: SourceConfidence = 'aggregator'

  /** Returns true when ODDS_API_KEY is present in the environment. */
  isEnabled(): boolean {
    return !!process.env.ODDS_API_KEY
  }

  /**
   * Fetch upcoming events for a sport within [from, to].
   * Uses the 0-credit fetchSportEvents endpoint.
   */
  async fetchEvents(sport: string, from: Date, to: Date): Promise<RawBookEvent[]> {
    const sportKey = oddsApiSportKey(sport)
    const events = await fetchSportEvents(sportKey)
    return events
      .filter((e) => {
        const t = new Date(e.commence_time)
        return t >= from && t <= to
      })
      .map((e) => ({
        bookEventId: e.id,
        bookHomeTeam: e.home_team,
        bookAwayTeam: e.away_team,
        startTime: new Date(e.commence_time),
      }))
  }

  /**
   * Fetch price snapshots for a canonical market.
   *
   * Default (opts.forceFresh = false): reads odds_snapshots (0 credits).
   * forceFresh = true: calls the Odds API live and writes to book_prices.
   *   - If creditsRemaining < ODDS_CREDIT_FLOOR → returns null (degraded mode, no throw).
   *
   * NOTE: The second arg is additive and backward-compatible with the BookAdapter interface
   * (which declares fetchMarket(market: CanonicalMarket)). Phase 9 callers may pass opts.
   */
  async fetchMarket(
    market: CanonicalMarket,
    opts?: { forceFresh?: boolean },
  ): Promise<BookPriceSnapshot[] | null> {
    if (market.oddsApiEventId === null) return null

    const forceFresh = opts?.forceFresh ?? false

    if (!forceFresh) {
      return this._fetchFromSnapshot(market)
    } else {
      return this._fetchFresh(market)
    }
  }

  // ── Default path: read odds_snapshots ────────────────────────────────────────

  private async _fetchFromSnapshot(market: CanonicalMarket): Promise<BookPriceSnapshot[] | null> {
    const supabase = getServiceClient()
    const marketKey = oddsApiMarketKey(market.marketType)

    const { data, error } = await supabase
      .from('odds_snapshots')
      .select('*')
      .eq('odds_event_id', market.oddsApiEventId!)
      .eq('market', marketKey)
      .order('captured_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('[OddsApiAdapter] odds_snapshots query error:', error.message)
      return null
    }

    const rows = (data ?? []) as SlateSnapRow[]
    if (rows.length === 0) return null

    return snapshotsFromRows(rows)
  }

  // ── forceFresh path: call Odds API → write book_prices ───────────────────────

  private async _fetchFresh(market: CanonicalMarket): Promise<BookPriceSnapshot[] | null> {
    const creditFloor = Number(process.env.ODDS_CREDIT_FLOOR ?? 500)
    const marketKey = oddsApiMarketKey(market.marketType)
    const sportKey = oddsApiSportKey(market.sport)
    const fetchedAt = new Date()

    // Probe credits first with a single-event call
    let result
    try {
      result = await fetchEventOdds(sportKey, market.oddsApiEventId!, marketKey, 'us,eu')
    } catch (err) {
      console.error('[OddsApiAdapter] fetchEventOdds error:', err)
      return null
    }

    // INVARIANT: below credit floor → degraded mode, return null, never throw (ARB-05, D-06)
    if (result.creditsRemaining !== null && result.creditsRemaining < creditFloor) {
      console.warn(
        `[OddsApiAdapter] degraded: creditsRemaining=${result.creditsRemaining} < floor=${creditFloor}`,
      )
      return null
    }

    const snapshots: BookPriceSnapshot[] = []
    for (const ev of result.events) {
      snapshots.push(...normalizeEventToSnapshots(ev, marketKey, fetchedAt))
    }

    if (snapshots.length === 0) return null

    // Write to book_prices (service-role)
    const supabase = getServiceClient()
    const rows = snapshots.map((s) => snapshotToBookPriceRow(s, market.id))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from('book_prices')
        .insert(rows.slice(i, i + 500))
      if (error) {
        console.error('[OddsApiAdapter] book_prices insert error:', error.message)
      }
    }

    return snapshots
  }
}

// ─── resolveEventMapping ──────────────────────────────────────────────────────

/**
 * Lazy event-mapping resolver: maps an Odds API event (oddsEventId + teams + time)
 * to a canonical event_id from the `markets` table, caching results in
 * `event_book_mappings`.
 *
 * Cache hit: returns canonical_event_id (or null if matched_by='needs_review').
 * Cache miss: queries `markets` table, scores via matchScore (>= 1):
 *   - Exactly one match → matched_by='auto', confidence=1.0, returns event_id.
 *   - Multiple matches (same-city ambiguity) → matched_by='needs_review',
 *     confidence=0.5, returns null. NEVER silently mismatches (DATA-03, D-04).
 *   - Zero matches → no upsert, returns null.
 *
 * @param oddsEventId  Odds API event id (e.g. 'abc123')
 * @param oddsHomeTeam Home team from Odds API event
 * @param oddsAwayTeam Away team from Odds API event
 * @param commenceTime Start time of the event
 * @param book         Adapter identifier for the cache (default 'odds_api')
 */
export async function resolveEventMapping(
  oddsEventId: string,
  oddsHomeTeam: string,
  oddsAwayTeam: string,
  commenceTime: Date,
  book: BookName = 'odds_api',
): Promise<string | null> {
  const supabase = getServiceClient()

  // ── Cache lookup (unique on book_event_id, book) ──────────────────────────
  const { data: cached } = await supabase
    .from('event_book_mappings')
    .select('canonical_event_id, matched_by')
    .eq('book_event_id', oddsEventId)
    .eq('book', book)
    .maybeSingle()

  if (cached !== null) {
    if (cached.matched_by === 'needs_review') return null
    return (cached as { canonical_event_id: string | null }).canonical_event_id ?? null
  }

  // ── Cache miss: query markets in a ±3h window ─────────────────────────────
  const windowStart = new Date(commenceTime.getTime() - 3 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(commenceTime.getTime() + 3 * 60 * 60 * 1000).toISOString()

  const { data: candidates, error: mktErr } = await supabase
    .from('markets')
    .select('event_id, home_team, away_team')
    .gte('event_start', windowStart)
    .lte('event_start', windowEnd)

  if (mktErr || !candidates) return null

  // markets has multiple rows per event (one per market_type/param); collapse to
  // distinct events before scoring so a multi-market event is not read as ambiguity.
  interface Row { event_id: string; home_team: string | null; away_team: string | null }
  const byEvent = new Map<string, Row>()
  for (const r of candidates as Row[]) {
    if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, r)
  }

  const scored = Array.from(byEvent.values())
    .map((c) => ({
      c,
      score: matchScore(oddsHomeTeam, c.home_team ?? '') + matchScore(oddsAwayTeam, c.away_team ?? ''),
    }))
    .filter((s) => s.score >= 1)

  if (scored.length === 0) return null

  const maxScore = Math.max(...scored.map((s) => s.score))
  const top = scored.filter((s) => s.score === maxScore)

  // Multiple DISTINCT events tie → genuine ambiguity → needs_review (never mismatch).
  if (top.length > 1) {
    await supabase.from('event_book_mappings').upsert(
      { book_event_id: oddsEventId, book, canonical_event_id: null, matched_by: 'needs_review', match_confidence: 0.5 },
      { onConflict: 'book_event_id,book' },
    )
    return null
  }

  const best = top[0]
  await supabase.from('event_book_mappings').upsert(
    { book_event_id: oddsEventId, book, canonical_event_id: best.c.event_id, matched_by: 'auto', match_confidence: 1.0 },
    { onConflict: 'book_event_id,book' },
  )
  return best.c.event_id
}
