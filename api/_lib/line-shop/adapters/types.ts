/**
 * BookAdapter contract layer — adapter types for the line-shop subsystem.
 *
 * READ-ONLY INVARIANT (BOOK-06, D-10):
 * The BookAdapter interface exposes ONLY data-fetching methods.
 * No order-placement surface (placeOrder, createOrder, cancelOrder,
 * modifyBet, placeBet, or any mutation method) exists or may ever be added
 * to this interface or any file that implements it. Violations must be caught
 * in code review and by the read-only enforcement test in registry.test.ts.
 */

import type {
  BookName,
  SourceConfidence,
  MarketType,
  Side,
  CanonicalMarket,
  BookPriceSnapshot,
} from '../types.js'

// Re-export core unions for adapter-module convenience
export type { BookName, SourceConfidence, MarketType, Side, CanonicalMarket, BookPriceSnapshot }

// ─── Raw book event ───────────────────────────────────────────────────────────

/**
 * Minimal event shape returned by a book adapter's fetchEvents call.
 * Callers map this to a CanonicalMarket via a separate matcher/resolver step.
 */
export interface RawBookEvent {
  bookEventId: string
  bookHomeTeam: string
  bookAwayTeam: string
  startTime: Date
}

// ─── Book adapter interface ───────────────────────────────────────────────────

/**
 * READ-ONLY adapter contract for a single sportsbook data source (BOOK-01, BOOK-06).
 *
 * Implementing classes MUST:
 *   - Return null from fetchMarket when the book has no line for the market (graceful absence).
 *   - Return [] from fetchEvents when no events are found in the window.
 *   - Hard-return false from isEnabled() when the adapter is disabled/unimplemented.
 *
 * Implementing classes MUST NOT:
 *   - Add any method that places, modifies, or cancels a wager.
 *   - Import or call any order-management API.
 *
 * The interface intentionally contains ONLY: name, sourceConfidence, isEnabled,
 * fetchMarket, fetchEvents — and nothing else (D-09, D-10).
 */
export interface BookAdapter {
  /** Stable identifier for this book — matches BookName union. */
  readonly name: BookName

  /** How reliable is this adapter's data? 'api' > 'aggregator' > 'scraped'. */
  readonly sourceConfidence: SourceConfidence

  /** Whether this adapter is operational and should be included in the enabled set. */
  isEnabled(): boolean

  /**
   * Fetch current price snapshots from this book for the given canonical market.
   * Returns null when the book has no line for this market (normal, not an error).
   */
  fetchMarket(market: CanonicalMarket): Promise<BookPriceSnapshot[] | null>

  /**
   * Fetch upcoming events from this book for the given sport within [from, to].
   * Returns [] when the book reports no events in the window.
   */
  fetchEvents(sport: string, from: Date, to: Date): Promise<RawBookEvent[]>
}
