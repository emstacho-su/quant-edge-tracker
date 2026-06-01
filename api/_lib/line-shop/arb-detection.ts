/**
 * api/_lib/line-shop/arb-detection.ts
 *
 * Post-upload arb-detection helper (D-10).
 *
 * Reads BOTH `book_prices` (manual uploads + scraped/aggregator-written rows)
 * AND `odds_snapshots` (the live Odds-API/Kalshi feed used by the scheduled
 * cron). Without merging both sources, manual offshore-slate uploads can't
 * be matched against major-book prices because production `book_prices` is
 * effectively empty outside the manual-upload path.
 *
 * For each affected market: pulls book_prices rows (filtered to live,
 * non-superseded), pulls odds_snapshots for the same market via the
 * markets.odds_api_event_id bridge, normalises both into BookPriceSnapshot,
 * splits by side, runs the existing pure `detectArb`, and returns
 * DetectionResult[].
 *
 * CONTRACT:
 *   - Pure read-and-detect — never writes to `arb_opportunities`.
 *     The upload route (21-05) owns that write via the canonical `arbToRow`
 *     from `api/cron/arbitrage-scan.ts` (RESEARCH Pitfall 4).
 *   - Does NOT call `run()` from arbitrage-scan.ts (RESEARCH Pitfall 2).
 *   - Kalshi fee adjustment is already applied inside `detectArb` (D-13 / plan 21-09)
 *     via `kalshiEffectiveImpliedProb` — no caller-side correction needed here.
 */

import { getServiceClient } from '../supabase-admin.js'
import { americanToDecimal, impliedFromAmerican } from '../clv.js'
import { detectArb } from './analysis.js'
import type { BookPriceSnapshot, ArbOpportunity } from './types.js'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Fresh-window for book_prices rows.
 * Manual uploads land with fetched_at = now(), so a 10-min window reliably
 * captures just-inserted rows while rejecting stale lines (RESEARCH Example 2).
 * Tighter than the cron's 2h window because manual rows are always fresh.
 */
const FRESH_WINDOW_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Fresh-window for odds_snapshots rows.
 * Matches the scheduled cron's 2-hour window — anything older is stale enough
 * that the line has likely moved several times.
 */
const ODDS_SNAPSHOTS_WINDOW_MS = 2 * 60 * 60 * 1000 // 2 hours

/**
 * canonical market_type → odds_snapshots.market mapping.
 * Inverse of REVERSE_MARKET in markets-ingest.ts.
 */
const FORWARD_MARKET: Record<string, string> = {
  moneyline: 'h2h',
  spread: 'spreads',
  total: 'totals',
}

// ─── Exported types ───────────────────────────────────────────────────────────

/** Result of arb detection for a single market. */
export interface DetectionResult {
  marketId: string
  arb: ArbOpportunity
}

// ─── DB row shapes ────────────────────────────────────────────────────────────

interface BookPriceRow {
  market_id: string
  book: string
  side: string
  price_american: number
  price_decimal: number
  implied_prob: number
  point: number | null
  fetched_at: string
  source_confidence: string
  is_closing: boolean
  superseded_at: string | null
}

interface MarketMetaRow {
  id: string
  market_type: string
  market_param: string | null
  odds_api_event_id: string | null
  home_team: string | null
  away_team: string | null
}

interface OddsSnapshotRow {
  odds_event_id: string
  bookmaker: string
  market: string
  selection: string
  point: number | null
  price_american: number
  captured_at: string
}

// ─── Helpers: row → BookPriceSnapshot ────────────────────────────────────────

function rowToSnapshot(row: BookPriceRow): BookPriceSnapshot {
  return {
    book: row.book as BookPriceSnapshot['book'],
    side: row.side as BookPriceSnapshot['side'],
    priceAmerican: row.price_american,
    priceDecimal: row.price_decimal,
    impliedProb: row.implied_prob,
    point: row.point,
    fetchedAt: new Date(row.fetched_at),
    sourceConfidence: row.source_confidence as BookPriceSnapshot['sourceConfidence'],
    isClosing: Boolean(row.is_closing),
  }
}

/**
 * Derive home/away/over/under from an odds_snapshots row's `selection` field.
 * For h2h/spreads, `selection` is the team name; for totals it's "Over"/"Under".
 * Mirrors the matching logic in api/cron/arbitrage-scan.ts.
 */
function resolveSnapshotSide(
  selection: string,
  homeTeam: string | null,
  awayTeam: string | null,
  market: string,
): 'home' | 'away' | 'over' | 'under' | null {
  const sel = selection.trim().toLowerCase()
  if (market === 'totals') {
    if (sel === 'over') return 'over'
    if (sel === 'under') return 'under'
    return null
  }
  if (homeTeam) {
    const h = homeTeam.toLowerCase()
    if (sel === h || h.includes(sel) || sel.includes(h)) return 'home'
  }
  if (awayTeam) {
    const a = awayTeam.toLowerCase()
    if (sel === a || a.includes(sel) || sel.includes(a)) return 'away'
  }
  return null
}

function snapshotRowToBookPriceSnapshot(
  row: OddsSnapshotRow,
  market: MarketMetaRow,
): BookPriceSnapshot | null {
  const side = resolveSnapshotSide(row.selection, market.home_team, market.away_team, row.market)
  if (side === null) return null
  return {
    book: row.bookmaker as BookPriceSnapshot['book'],
    side,
    priceAmerican: row.price_american,
    priceDecimal: americanToDecimal(row.price_american),
    impliedProb: impliedFromAmerican(row.price_american),
    point: row.point,
    fetchedAt: new Date(row.captured_at),
    sourceConfidence: 'aggregator',
    isClosing: false,
  }
}

// ─── Helper: dedupeByBook ─────────────────────────────────────────────────────

/**
 * Keep the snapshot with the latest fetchedAt per book.
 * Each book contributes exactly one price per side so detectArb gets
 * clean non-redundant inputs.
 */
function dedupeByBook(snaps: BookPriceSnapshot[]): BookPriceSnapshot[] {
  const byBook = new Map<string, BookPriceSnapshot>()
  for (const snap of snaps) {
    const existing = byBook.get(snap.book)
    if (!existing || snap.fetchedAt > existing.fetchedAt) {
      byBook.set(snap.book, snap)
    }
  }
  return Array.from(byBook.values())
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Detect arbitrage opportunities across the supplied markets.
 *
 * Reads `book_prices` filtered to:
 *   - market_id IN marketIds
 *   - fetched_at > now - 10 min  (fresh-window: manual rows land with fetched_at=now())
 *   - superseded_at IS NULL       (21-01 migration column; live rows only)
 *
 * For each market: splits rows by distinct side values, dedupes per book,
 * calls `detectArb`, and accumulates DetectionResult entries for non-null arbs.
 *
 * Markets with fewer than 2 distinct sides are silently skipped.
 *
 * @param marketIds   UUIDs of markets to scan (from the just-uploaded rows)
 * @param minReturnPct  Minimum arb return % (default 0, same as prices.ts:241 semantic)
 * @returns DetectionResult[] — one entry per market where an arb was found
 * @throws  When the Supabase query errors (route's try/catch becomes the 500 gate)
 */
export async function detectArbsForMarkets(
  marketIds: string[],
  minReturnPct = 0,
): Promise<DetectionResult[]> {
  // Early-return: no markets → no DB round-trip needed.
  if (marketIds.length === 0) return []

  const db = getServiceClient()
  const bpThreshold = new Date(Date.now() - FRESH_WINDOW_MS).toISOString()
  const snapThreshold = new Date(Date.now() - ODDS_SNAPSHOTS_WINDOW_MS).toISOString()

  // ── Query 1: book_prices for affected markets (manual uploads + adapters) ──
  const { data: bpData, error: bpErr } = await db
    .from('book_prices')
    .select('*')
    .in('market_id', marketIds)
    .gt('fetched_at', bpThreshold)
    .is('superseded_at', null)

  if (bpErr) throw new Error(`detectArbsForMarkets book_prices: ${bpErr.message}`)
  const bpRows = (bpData ?? []) as BookPriceRow[]

  // ── Query 2: markets metadata so we can bridge to odds_snapshots ──
  const { data: mktData, error: mktErr } = await db
    .from('markets')
    .select('id, market_type, market_param, odds_api_event_id, home_team, away_team')
    .in('id', marketIds)
  if (mktErr) throw new Error(`detectArbsForMarkets markets: ${mktErr.message}`)
  const marketRows = (mktData ?? []) as MarketMetaRow[]
  const marketsById = new Map(marketRows.map((m) => [m.id, m]))

  // ── Query 3: odds_snapshots for the same odds_event_ids ──
  const oddsEventIds = [
    ...new Set(
      marketRows
        .map((m) => m.odds_api_event_id)
        .filter((x): x is string => Boolean(x)),
    ),
  ]

  let snapRows: OddsSnapshotRow[] = []
  if (oddsEventIds.length > 0) {
    const { data: snapData, error: snapErr } = await db
      .from('odds_snapshots')
      .select('odds_event_id, bookmaker, market, selection, point, price_american, captured_at')
      .in('odds_event_id', oddsEventIds)
      .gt('captured_at', snapThreshold)
    if (snapErr) throw new Error(`detectArbsForMarkets odds_snapshots: ${snapErr.message}`)
    snapRows = (snapData ?? []) as OddsSnapshotRow[]
  }

  // Index odds_snapshots by odds_event_id for quick lookup per market.
  const snapsByEvent = new Map<string, OddsSnapshotRow[]>()
  for (const s of snapRows) {
    const arr = snapsByEvent.get(s.odds_event_id) ?? []
    arr.push(s)
    snapsByEvent.set(s.odds_event_id, arr)
  }

  // Group book_prices rows by market_id.
  const bpByMarket = new Map<string, BookPriceRow[]>()
  for (const row of bpRows) {
    const arr = bpByMarket.get(row.market_id) ?? []
    arr.push(row)
    bpByMarket.set(row.market_id, arr)
  }

  const results: DetectionResult[] = []

  // Iterate every affected market — not just the ones with book_prices rows —
  // so a market that has ONLY odds_snapshots coverage still gets evaluated
  // (relevant for re-detection after a market is first uploaded).
  for (const marketId of marketIds) {
    const market = marketsById.get(marketId)
    if (!market) continue

    const bpForMarket = bpByMarket.get(marketId) ?? []

    // Build odds_snapshots snapshots filtered to this market's
    // (market_type → market) and (market_param → point).
    const targetOddsMarket = FORWARD_MARKET[market.market_type]
    const targetPoint = market.market_param == null || market.market_param === ''
      ? null
      : market.market_param
    let snapSnapshots: BookPriceSnapshot[] = []
    if (market.odds_api_event_id && targetOddsMarket) {
      const eventSnaps = snapsByEvent.get(market.odds_api_event_id) ?? []
      const matched = eventSnaps.filter((s) => {
        if (s.market !== targetOddsMarket) return false
        const snapPointKey = s.point == null ? null : String(s.point)
        return snapPointKey === targetPoint
      })
      for (const s of matched) {
        const snap = snapshotRowToBookPriceSnapshot(s, market)
        if (snap !== null) snapSnapshots.push(snap)
      }
    }

    const bpSnapshots = bpForMarket.map(rowToSnapshot)
    const allSnaps = [...bpSnapshots, ...snapSnapshots]
    if (allSnaps.length === 0) continue

    // Collect distinct sides across BOTH sources.
    const distinctSides = [...new Set(allSnaps.map((s) => s.side))]
    if (distinctSides.length < 2) continue

    const [sideAKey, sideBKey] = distinctSides as [string, string]
    const sideA = allSnaps.filter((s) => s.side === sideAKey)
    const sideB = allSnaps.filter((s) => s.side === sideBKey)

    // Dedupe per book (latest fetchedAt wins) so each book contributes one price per side.
    const dedupedA = dedupeByBook(sideA)
    const dedupedB = dedupeByBook(sideB)

    // detectArb applies Kalshi fee at the price level (D-13 / 21-09).
    const arb = detectArb(dedupedA, dedupedB, minReturnPct)
    if (arb !== null) {
      results.push({ marketId, arb })
    }
  }

  return results
}
