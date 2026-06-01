/**
 * ScraperAdapter stub — always disabled in Phase 7.
 *
 * Real implementation lives in the quant-edge-runner daemon (Phase 12).
 * This class satisfies the BookAdapter interface structurally so the registry
 * can register it without any concrete network code being present.
 *
 * isEnabled() returns false on Vercel and in all Phase 7–11 contexts.
 * fetchMarket() returns null (graceful absence — no market, not an error).
 * fetchEvents() returns [] (no events — graceful, not an error).
 *
 * DO NOT add placeOrder, createOrder, cancelOrder, modifyBet, or placeBet
 * to this class. This stub is READ-ONLY by structural enforcement (BOOK-06).
 */

import type {
  BookAdapter,
  BookName,
  SourceConfidence,
  CanonicalMarket,
  BookPriceSnapshot,
  RawBookEvent,
} from './types.js'

export class ScraperAdapter implements BookAdapter {
  readonly name: BookName = '7stacks'
  readonly sourceConfidence: SourceConfidence = 'scraped'

  isEnabled(): boolean {
    return false // TODO: Phase 12 — return !process.env.VERCEL && !!process.env.SCRAPER_ENABLED
  }

  async fetchMarket(_market: CanonicalMarket): Promise<BookPriceSnapshot[] | null> {
    return null // TODO: Phase 12
  }

  async fetchEvents(_sport: string, _from: Date, _to: Date): Promise<RawBookEvent[]> {
    return [] // TODO: Phase 12
  }
}
