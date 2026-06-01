/**
 * KalshiAdapter — implements BookAdapter using Kalshi's PUBLIC REST API.
 *
 * READ-ONLY INVARIANT (BOOK-06):
 * This adapter exposes ONLY data-fetching methods. No order-placement surface
 * (placeOrder, createOrder, cancelOrder, modifyBet, placeBet) exists anywhere
 * in this file. Do not add any mutation method.
 *
 * Key correctness invariants:
 *  1. BASE URL = 'https://external-api.kalshi.com/trade-api/v2' — NO auth needed.
 *     'trading-api.kalshi.com' is DEAD (connection refused 2026-05-21, Pitfall 1).
 *  2. yes_ask_dollars is a decimal string in [0, 1] = implied probability directly.
 *     e.g. "0.4700" = 47% = parseFloat -> 0.47 (NOT cents, despite response_price_units='usd_cent').
 *  3. impliedProb stored RAW = parseFloat(yes_ask_dollars). Never devigged (D-03, Pitfall 2/3).
 *  4. Each Kalshi event has TWO per-team binary markets. Both processed; one snapshot
 *     emitted per canonical side (no duplicates, Pitfall 4).
 *  5. yes_ask_dollars == "0.0000" -> skip (no transactable ask, D-04, Pitfall 6).
 *     Whole-market no-data -> fetchMarket returns null (normal, not an error).
 *  6. 429/503/connection errors -> return null, never throw to caller (Pitfall 6).
 *  7. Writes book_prices only — NEVER odds_snapshots (Anti-pattern from RESEARCH).
 *  8. isEnabled() always true — public API, no key required (D-02, BOOK-04).
 *
 * Team abbreviation conventions (verified live 2026-05-22 via KXMLBGAME, KXNHLGAME):
 *   MLB: "Chicago WS" (White Sox), "Chicago C" (Cubs), "New York Y" (Yankees),
 *        "New York M" (Mets), "Los Angeles D" (Dodgers), "Los Angeles A" (Angels),
 *        "A's" (Oakland/Athletics); all other teams use full city+nickname.
 *   NHL: "MTL Canadiens", "CAR Hurricanes", "VGK Golden Knights", "COL Avalanche"
 *        (abbreviated with 2-3 letter codes for multi-team cities).
 *   NBA/NFL: Use same pattern — abbreviated for same-city teams, full names otherwise.
 *   matchScore handles abbreviations robustly via token overlap.
 *
 * Series tickers (verified via GET /series + sample market fetches 2026-05-21):
 *   mlb -> KXMLBGAME, nhl -> KXNHLGAME, nba -> KXNBAGAME, nfl -> KXNFLGAME,
 *   golf -> KXPGATOUR (outright tournament winner; deferred separate handling path)
 */

import { matchScore } from '../../match.js'
import { americanToDecimal } from '../../clv.js'
import { getServiceClient } from '../../supabase-admin.js'
import type {
  BookAdapter,
  BookName,
  SourceConfidence,
  CanonicalMarket,
  BookPriceSnapshot,
  RawBookEvent,
  Side,
} from './types.js'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Kalshi public REST API base URL (external-api, NOT trading-api which is dead). */
const BASE = 'https://external-api.kalshi.com/trade-api/v2'

/**
 * Verified series tickers (2026-05-21 via GET /series + sample market fetches).
 * Golf (KXPGATOUR) markets are outright futures (100+ player markets per tournament),
 * not head-to-head game moneylines. Included but treated as deferred/outright path.
 */
const SERIES_TICKERS: Record<string, string[]> = {
  mlb: ['KXMLBGAME'],
  nhl: ['KXNHLGAME'],
  nba: ['KXNBAGAME'],
  nfl: ['KXNFLGAME'],
  golf: ['KXPGATOUR'], // outright tournament winner; requires separate side mapping
}

// ─── Raw Kalshi API shapes ────────────────────────────────────────────────────

interface KalshiMarketShape {
  ticker: string
  event_ticker: string
  title: string
  yes_sub_title: string
  no_sub_title?: string
  yes_bid_dollars: string
  yes_ask_dollars: string
  no_bid_dollars?: string
  no_ask_dollars?: string
  status: string
  occurrence_datetime?: string
  response_price_units?: string
}

interface KalshiEventShape {
  event_ticker: string
  title: string
  series_ticker: string
  markets?: KalshiMarketShape[]
}

// ─── Price conversion ─────────────────────────────────────────────────────────

/**
 * Convert a Kalshi YES ask price string to American odds.
 *
 * Kalshi prices are implied probabilities as decimals in [0, 1].
 * e.g. "0.4700" -> 0.47 -> +113 American (underdog)
 *      "0.6700" -> 0.67 -> -203 American (favorite)
 *
 * Formula:
 *   prob >= 0.5 -> -(prob / (1 - prob)) * 100  (negative American, favorite)
 *   prob <  0.5 -> ((1 - prob) / prob) * 100   (positive American, underdog)
 *
 * Throws RangeError for prob <= 0 or >= 1 (internal guard; callers skip
 * yes_ask_dollars == "0.0000" before calling this function).
 *
 * Verified examples (live Kalshi 2026-05-21):
 *   "0.4700" -> +112.77 (~+113)
 *   "0.6700" -> -203.03 (~-203)
 *   "0.5700" -> -132.56 (~-133)
 *   "0.3200" -> +212.5  (~+213)
 */
export function kalshiAskToAmerican(askDollars: string): number {
  const prob = parseFloat(askDollars)
  if (prob <= 0 || prob >= 1) {
    throw new RangeError(`Invalid Kalshi ask: "${askDollars}" (must be in (0, 1))`)
  }
  if (prob >= 0.5) {
    return -(prob / (1 - prob)) * 100
  }
  return ((1 - prob) / prob) * 100
}

// ─── Side resolution ──────────────────────────────────────────────────────────

/**
 * Map a Kalshi market's yes_sub_title to the canonical side ('home' | 'away')
 * by scoring it against the canonical market's home and away team names.
 *
 * Uses matchScore (token overlap) from api/_lib/match.ts to handle:
 *   - Abbreviated Kalshi names ("Chicago WS" -> White Sox)
 *   - NHL codes ("VGK Golden Knights")
 *   - Full team names that partially overlap
 *
 * Returns null when the side is ambiguous (same score) or no match (score=0).
 * Callers skip null sides rather than emitting a bad snapshot (Pitfall 4).
 */
function resolveSide(
  yesSubTitle: string,
  homeTeam: string,
  awayTeam: string,
): Side | null {
  const homeScore = matchScore(yesSubTitle, homeTeam)
  const awayScore = matchScore(yesSubTitle, awayTeam)

  if (homeScore === 0 && awayScore === 0) return null
  if (homeScore === awayScore) return null // ambiguous — skip (Pitfall 4/5)
  return homeScore > awayScore ? 'home' : 'away'
}

/**
 * Parse the home team from a Kalshi event title.
 * Kalshi titles follow the convention: "Away vs Home" for game events.
 * e.g. "Texas vs Los Angeles A" -> home = "Los Angeles A", away = "Texas"
 */
function parseHomeTeam(title: string): string {
  const parts = title.split(' vs ')
  return parts.length >= 2 ? parts[parts.length - 1].trim() : title
}

function parseAwayTeam(title: string): string {
  const parts = title.split(' vs ')
  return parts.length >= 2 ? parts[0].trim() : title
}

// ─── Snapshot construction ────────────────────────────────────────────────────

/**
 * Build BookPriceSnapshot[] from Kalshi markets for a canonical market.
 *
 * - Only processes 'active' markets.
 * - Skips yes_ask_dollars == "0.0000" (no transactable ask, D-04).
 * - Resolves side via matchScore against canonical home/away.
 * - Skips ambiguous/unresolved sides (null from resolveSide).
 * - Deduplicates: if two markets resolve to the same side, only the first is kept.
 *   This prevents duplicate snapshots (Pitfall 4).
 *
 * Returns [] when no transactable, mappable snapshots found.
 */
function buildSnapshots(
  kalshiMarkets: KalshiMarketShape[],
  canonical: CanonicalMarket,
  fetchedAt: Date,
): BookPriceSnapshot[] {
  const snapshots: BookPriceSnapshot[] = []
  const usedSides = new Set<Side>()

  // Derive home/away from eventName ("Texas @ Los Angeles A" or "Texas vs Los Angeles A")
  // eventName typically follows "@" convention: "Away @ Home"
  // Parse both formats
  let homeTeam: string
  let awayTeam: string

  if (canonical.eventName.includes('@')) {
    const parts = canonical.eventName.split('@')
    awayTeam = parts[0].trim()
    homeTeam = parts[parts.length - 1].trim()
  } else if (canonical.eventName.includes(' vs ')) {
    const parts = canonical.eventName.split(' vs ')
    // Kalshi "vs" convention: Away vs Home
    awayTeam = parts[0].trim()
    homeTeam = parts[parts.length - 1].trim()
  } else {
    // Fallback: treat full name as home team name, leave away empty
    homeTeam = canonical.eventName
    awayTeam = ''
  }

  for (const km of kalshiMarkets) {
    if (km.status !== 'active') continue

    // D-04: skip illiquid markets (no transactable ask)
    if (km.yes_ask_dollars === '0.0000') continue

    const yesAsk = parseFloat(km.yes_ask_dollars)
    if (yesAsk <= 0) continue

    // Resolve canonical side for this market's YES outcome
    const side = resolveSide(km.yes_sub_title, homeTeam, awayTeam)
    if (!side) continue

    // Deduplicate: skip if we already have a snapshot for this side (Pitfall 4)
    if (usedSides.has(side)) continue
    usedSides.add(side)

    let priceAmerican: number
    try {
      priceAmerican = kalshiAskToAmerican(km.yes_ask_dollars)
    } catch {
      // Shouldn't happen after the > 0 check, but be defensive
      continue
    }

    snapshots.push({
      book: 'kalshi' as BookName,
      side,
      priceAmerican,
      priceDecimal: americanToDecimal(priceAmerican),
      // INVARIANT (D-03): RAW implied prob = parseFloat(yes_ask_dollars), NEVER devigged
      impliedProb: yesAsk,
      // Kalshi offers binary YES/NO only — no spread markets (point is always null)
      point: null,
      fetchedAt,
      sourceConfidence: 'api' as SourceConfidence,
      isClosing: false,
    })
  }

  return snapshots
}

// ─── Snapshot → book_prices row ───────────────────────────────────────────────

function snapshotToBookPriceRow(snapshot: BookPriceSnapshot, marketId: string) {
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

// ─── Best match for fetchEvents -> canonical market ──────────────────────────

/**
 * From a list of RawBookEvents, find the best-scoring match for the
 * canonical market via matchScore on home/away team names.
 * Returns null when no match has score >= 1.
 */
function findBestMatch(
  events: RawBookEvent[],
  market: CanonicalMarket,
): RawBookEvent | null {
  // Parse canonical home/away from eventName
  let homeTeam: string
  let awayTeam: string

  if (market.eventName.includes('@')) {
    const parts = market.eventName.split('@')
    awayTeam = parts[0].trim()
    homeTeam = parts[parts.length - 1].trim()
  } else {
    homeTeam = market.eventName
    awayTeam = ''
  }

  let bestEvent: RawBookEvent | null = null
  let bestScore = 0

  for (const ev of events) {
    const homeScore = matchScore(ev.bookHomeTeam, homeTeam)
    const awayScore = matchScore(ev.bookAwayTeam, awayTeam)
    const score = homeScore + awayScore
    if (score > bestScore) {
      bestScore = score
      bestEvent = ev
    }
  }

  return bestScore >= 1 ? bestEvent : null
}

// ─── KalshiAdapter ────────────────────────────────────────────────────────────

export class KalshiAdapter implements BookAdapter {
  readonly name: BookName = 'kalshi'
  readonly sourceConfidence: SourceConfidence = 'api'

  /**
   * Kalshi public API requires no credentials — always enabled.
   * Because isEnabled() is always true, all network errors MUST be handled
   * gracefully (return null, never throw) to avoid breaking other adapters (Pitfall 6).
   */
  isEnabled(): boolean {
    return true
  }

  /**
   * Fetch current price snapshots from Kalshi for the given canonical market.
   *
   * Flow:
   *   1. Check event_book_mappings cache for book='kalshi'.
   *   2. Cache miss -> fetchEvents + findBestMatch -> upsert cache.
   *   3. GET /events/{ticker}?with_nested_markets=true for per-team market prices.
   *   4. buildSnapshots: filter active, skip zero asks, resolve sides.
   *   5. Write to book_prices on success.
   *   6. Return snapshots or null (no transactable data = normal outcome).
   *
   * Returns null on: no mapping, empty/illiquid markets, HTTP 429/503, network error.
   * NEVER throws to caller (Pitfall 6).
   */
  async fetchMarket(market: CanonicalMarket): Promise<BookPriceSnapshot[] | null> {
    try {
      const supabase = getServiceClient()
      const fetchedAt = new Date()

      // ── 1. Cache lookup (event_book_mappings, book='kalshi') ─────────────────
      const { data: cached } = await supabase
        .from('event_book_mappings')
        .select('book_event_id, matched_by')
        .eq('canonical_event_id', market.eventId)
        .eq('book', 'kalshi')
        .maybeSingle()

      let kalshiEventTicker: string | null = null

      if (cached !== null) {
        // Cache hit: needs_review = ambiguous, skip
        if ((cached as { matched_by: string }).matched_by === 'needs_review') {
          return null
        }
        kalshiEventTicker = (cached as { book_event_id: string }).book_event_id
      }

      // ── 2. Cache miss: discover via fetchEvents ───────────────────────────────
      if (!kalshiEventTicker) {
        const windowFrom = new Date(market.eventStart.getTime() - 3 * 60 * 60 * 1000)
        const windowTo = new Date(market.eventStart.getTime() + 3 * 60 * 60 * 1000)
        const events = await this.fetchEvents(market.sport, windowFrom, windowTo)
        const match = findBestMatch(events, market)

        if (!match) return null

        kalshiEventTicker = match.bookEventId

        // Upsert cache entry (UNIQUE: canonical_event_id, book)
        await supabase.from('event_book_mappings').upsert(
          {
            canonical_event_id: market.eventId,
            book: 'kalshi',
            book_event_id: kalshiEventTicker,
            matched_by: 'auto',
            confidence: 1.0,
            commence_time: market.eventStart.toISOString(),
            book_home_team: match.bookHomeTeam,
            book_away_team: match.bookAwayTeam,
          },
          { onConflict: 'canonical_event_id,book' },
        )
      }

      // ── 3. Fetch event detail with nested market prices ───────────────────────
      const res = await fetch(
        `${BASE}/events/${kalshiEventTicker}?with_nested_markets=true`,
      )

      if (!res.ok) {
        console.warn(
          `[KalshiAdapter] fetchMarket HTTP ${res.status} for ${kalshiEventTicker}: ${await res.text()}`,
        )
        return null
      }

      const body = (await res.json()) as { event?: KalshiEventShape & { markets?: KalshiMarketShape[] } }
      const eventMarkets = body.event?.markets ?? []

      // ── 4. Build snapshots ────────────────────────────────────────────────────
      const snapshots = buildSnapshots(eventMarkets, market, fetchedAt)

      if (snapshots.length === 0) return null

      // ── 5. Write book_prices ─────────────────────────────────────────────────
      const rows = snapshots.map((s) => snapshotToBookPriceRow(s, market.id))
      const { error: insertError } = await supabase.from('book_prices').insert(rows)
      if (insertError) {
        console.error('[KalshiAdapter] book_prices insert error:', insertError.message)
        // Non-fatal: still return snapshots even if DB write fails
      }

      return snapshots
    } catch (err) {
      // Catch-all: never throw to caller (Pitfall 6)
      console.error('[KalshiAdapter] fetchMarket error:', err)
      return null
    }
  }

  /**
   * Fetch upcoming events from Kalshi for the given sport within [from, to].
   *
   * Uses GET /events?series_ticker=...&status=open&with_nested_markets=true&limit=200
   * to retrieve all open game events with embedded market prices in a single request
   * per series ticker.
   *
   * Date filtering: uses occurrence_datetime from the first nested market (if available)
   * or falls back to including all open events (the fetchMarket cache step handles
   * precise matching later via matchScore).
   *
   * Returns [] for unknown sports (no SERIES_TICKERS entry).
   */
  async fetchEvents(sport: string, from: Date, to: Date): Promise<RawBookEvent[]> {
    const tickers = SERIES_TICKERS[sport.toLowerCase()] ?? []
    if (tickers.length === 0) return []

    const results: RawBookEvent[] = []

    for (const seriesTicker of tickers) {
      try {
        const res = await fetch(
          `${BASE}/events?series_ticker=${seriesTicker}&status=open&with_nested_markets=true&limit=200`,
        )
        if (!res.ok) {
          console.warn(
            `[KalshiAdapter] fetchEvents HTTP ${res.status} for ${seriesTicker}`,
          )
          continue
        }

        const body = (await res.json()) as { events?: KalshiEventShape[] }
        const events = body.events ?? []

        for (const e of events) {
          // Parse home/away from event title ("Away vs Home" convention in Kalshi)
          const homeTeam = parseHomeTeam(e.title)
          const awayTeam = parseAwayTeam(e.title)

          // Get start time from first nested market's occurrence_datetime if available
          let startTime: Date
          const firstMarket = e.markets?.[0]
          if (firstMarket?.occurrence_datetime) {
            startTime = new Date(firstMarket.occurrence_datetime)
          } else {
            // Fallback: include all open events (filter will happen at matching stage)
            startTime = from
          }

          // Date window filter: include events whose startTime is within [from, to]
          if (startTime < from || startTime > to) continue

          results.push({
            bookEventId: e.event_ticker,
            bookHomeTeam: homeTeam,
            bookAwayTeam: awayTeam,
            startTime,
          })
        }
      } catch (err) {
        console.error(`[KalshiAdapter] fetchEvents error for ${seriesTicker}:`, err)
        continue
      }
    }

    return results
  }
}
