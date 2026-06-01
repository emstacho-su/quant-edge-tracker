/**
 * scrape-runner.ts
 *
 * Daemon-side orchestrator: scrapeBookOdds(markets).
 *
 * Iterates enabled scraper adapters per active market, writes book_prices
 * (via the adapter), then runs inline fresh-window arb detection and upserts
 * any found arb to arb_opportunities.
 *
 * DAEMON INTEGRATION (quant-edge-runner sibling repo):
 *   import { scrapeBookOdds } from './api/_lib/line-shop/scrape-runner.js'
 *   // Option A — time-based (recommended, RESEARCH Open Q #3):
 *   setInterval(() => scrapeBookOdds(activeMarkets), 5 * 60 * 1000)
 *   // Option B — task-kind (if tasks.ts already exists):
 *   case 'scrape_book_odds': await scrapeBookOdds(task.markets); break
 *
 * Never call this function from Vercel serverless routes — adapters are
 * disabled on Vercel and will silently return null (BOOK-05, D-02).
 *
 * Phase 11-03  BOOK-05  D-06  D-07  Pitfall 5 (fresh-window)
 */

import { enabledAdapters } from './adapters/registry.js'
import { detectArb } from './analysis.js'
import { getServiceClient } from '../supabase-admin.js'
import type { CanonicalMarket, BookPriceSnapshot } from './types.js'

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum return % for an arb to be recorded (0.5 = 0.5%).
 *
 * There is NO Kalshi leg in Phase 11 — no fee-netting is needed here.
 * The fee-aware getMinReturnPct() helper (from Phase 10/12) will replace
 * this constant when Kalshi or Phase 12 lands and introduces a fee leg.
 *
 * (Plan correction: Phase 10 is not started; getMinReturnPct does not exist.
 * Using a local constant instead — documented as plan deviation.)
 */
const ARB_MIN_RETURN_PCT = 0.5

/** Fresh-window: snapshots older than 5 minutes are excluded from arb detection (Pitfall 5). */
const FRESH_WINDOW_MS = 5 * 60 * 1000

// ─── Summary shape ────────────────────────────────────────────────────────────

export interface ScrapeRunSummary {
  /** Number of enabled scraper adapters attempted (including those that failed). */
  booksScraped: number
  /** Number of (adapter × market) pairs that returned at least one snapshot. */
  marketsWritten: number
  /** Number of arb opportunities detected and upserted. */
  arbsDetected: number
}

// ─── scrapeBookOdds ───────────────────────────────────────────────────────────

/**
 * Orchestrate a single scrape pass over all enabled scraper adapters.
 *
 * For each enabled adapter whose sourceConfidence === 'scraped':
 *   1. Call adapter.fetchMarket(market) — the adapter writes book_prices and
 *      returns the snapshots it wrote (or null on failure).
 *   2. After fetching, query book_prices for fresh rows (fetched_at > now-5min)
 *      for this market and run detectArb on them.
 *   3. Upsert any detected arb to arb_opportunities.
 *
 * Each adapter call is wrapped in try/catch: a failure logs and continues (D-06).
 * The Vercel arb cron picks up any written rows on its next tick.
 *
 * @param markets Active CanonicalMarket[] to scrape (caller sources from DB).
 * @returns ScrapeRunSummary — counts for monitoring/alerting.
 */
export async function scrapeBookOdds(markets: CanonicalMarket[]): Promise<ScrapeRunSummary> {
  const scraperAdapters = enabledAdapters().filter((a) => a.sourceConfidence === 'scraped')

  const summary: ScrapeRunSummary = {
    booksScraped: scraperAdapters.length,
    marketsWritten: 0,
    arbsDetected: 0,
  }

  if (scraperAdapters.length === 0 || markets.length === 0) {
    return summary
  }

  const db = getServiceClient()

  for (const adapter of scraperAdapters) {
    for (const market of markets) {
      let snapshots: BookPriceSnapshot[] | null = null

      // Fail-soft: one adapter failure must never abort the batch (D-06, T-11-18)
      try {
        snapshots = await adapter.fetchMarket(market)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[scrape-runner] Adapter '${adapter.name}' threw for market '${market.id}':`, msg)
        // continue to next market/adapter
        continue
      }

      if (snapshots === null || snapshots.length === 0) {
        continue
      }

      summary.marketsWritten++

      // Fresh-window arb detection (Pitfall 5: only rows fetched within the last 5 min)
      const freshThreshold = new Date(Date.now() - FRESH_WINDOW_MS).toISOString()

      const { data: freshRows, error: fetchError } = await db
        .from('book_prices')
        .select('*')
        .eq('market_id', market.id)
        .gt('fetched_at', freshThreshold)

      if (fetchError) {
        console.error(`[scrape-runner] book_prices fresh-window query error for market '${market.id}':`, fetchError.message)
        continue
      }

      if (!freshRows || freshRows.length < 2) {
        continue // Not enough fresh rows for arb detection
      }

      // Map DB rows back to BookPriceSnapshot shape for detectArb
      const freshSnaps: BookPriceSnapshot[] = freshRows.map((row: Record<string, unknown>) => ({
        book: row.book as BookPriceSnapshot['book'],
        side: row.side as BookPriceSnapshot['side'],
        priceAmerican: row.price_american as number,
        priceDecimal: row.price_decimal as number,
        impliedProb: row.implied_prob as number,
        point: row.point as number | null,
        fetchedAt: new Date(row.fetched_at as string),
        sourceConfidence: row.source_confidence as BookPriceSnapshot['sourceConfidence'],
        isClosing: Boolean(row.is_closing),
      }))

      // Split by side for two-sided arb detection
      const sides = [...new Set(freshSnaps.map((s) => s.side))]
      if (sides.length < 2) continue

      const sideASnaps = freshSnaps.filter((s) => s.side === sides[0])
      const sideBSnaps = freshSnaps.filter((s) => s.side === sides[1])

      // Reuse detectArb from analysis.ts — no reimplementation (D-07)
      const arb = detectArb(sideASnaps, sideBSnaps, ARB_MIN_RETURN_PCT)

      if (arb === null) continue

      // Upsert the arb to arb_opportunities
      const { error: arbError } = await db.from('arb_opportunities').upsert({
        market_id: market.id,
        side_a_book: arb.sideA.book,
        side_a_side: arb.sideA.side,
        side_a_price_american: arb.sideA.priceAmerican,
        side_b_book: arb.sideB.book,
        side_b_side: arb.sideB.side,
        side_b_price_american: arb.sideB.priceAmerican,
        sum_raw_implied: arb.sumRawImplied,
        total_return_pct: arb.totalReturnPct,
        stake_a: arb.stakeA,
        stake_b: arb.stakeB,
        detected_at: arb.detectedAt.toISOString(),
      })

      if (arbError) {
        console.error(`[scrape-runner] arb_opportunities upsert error for market '${market.id}':`, arbError.message)
        continue
      }

      summary.arbsDetected++
    }
  }

  return summary
}
