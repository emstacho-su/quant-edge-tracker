/**
 * Unit tests for api/line-shop/prices.ts — BOOK-02 + timeout behavior.
 *
 * These tests mock enabledAdapters() and getServiceClient() so no real
 * network or DB calls are made. The two critical behaviors tested:
 *
 *   1. missingBooks: enabled adapters that returned null appear in
 *      missingBooks, never silently omitted (BOOK-02, D-06).
 *   2. Timeout: an adapter that takes longer than ADAPTER_TIMEOUT_MS
 *      is treated as missing (resolves to null), not awaited indefinitely (SHOP-07, D-02).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { americanToDecimal, impliedFromAmerican } from '../_lib/clv.js'
import type { BookPriceSnapshot, CanonicalMarket } from '../_lib/line-shop/types.js'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// We need to mock at the module level before importing the handler.
// Vitest hoists vi.mock calls, so these run before any imports.

vi.mock('../_lib/line-shop/adapters/registry.js', () => ({
  enabledAdapters: vi.fn(),
}))

vi.mock('../_lib/supabase-admin.js', () => ({
  getServiceClient: vi.fn(),
}))

// Import the mocked modules so we can configure them per-test
import { enabledAdapters } from '../_lib/line-shop/adapters/registry.js'
import { getServiceClient } from '../_lib/supabase-admin.js'

// Import the function under test after mocks are in place
import { runPrices } from './prices.js'

// ─── Fixture factory ──────────────────────────────────────────────────────────

const MARKET: CanonicalMarket = {
  id: 'market-uuid-1',
  sport: 'mlb',
  eventId: 'MLB_20260521_MIL_CHC',
  eventName: 'Brewers @ Cubs',
  eventStart: new Date('2026-05-21T18:10:00Z'),
  oddsApiEventId: 'odds-event-abc',
  marketType: 'moneyline',
  marketParam: null,
}

function snap(overrides: Partial<BookPriceSnapshot> = {}): BookPriceSnapshot {
  const priceAmerican = overrides.priceAmerican ?? -110
  return {
    book: 'bovada',
    side: 'home',
    priceAmerican,
    priceDecimal: americanToDecimal(priceAmerican),
    impliedProb: impliedFromAmerican(priceAmerican),
    point: null,
    fetchedAt: new Date(),
    sourceConfidence: 'aggregator',
    isClosing: false,
    ...overrides,
  }
}

// Minimal Supabase mock that returns the market by ID
function mockSupabaseWithMarket(market: CanonicalMarket) {
  const supabaseMock = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: {
      id: market.id,
      sport: market.sport,
      event_id: market.eventId,
      event_name: market.eventName,
      event_start: market.eventStart instanceof Date ? market.eventStart.toISOString() : market.eventStart,
      odds_api_event_id: market.oddsApiEventId,
      market_type: market.marketType,
      market_param: market.marketParam,
    }, error: null }),
    single: vi.fn().mockResolvedValue({ data: {
      id: market.id,
      sport: market.sport,
      event_id: market.eventId,
      event_name: market.eventName,
      event_start: market.eventStart instanceof Date ? market.eventStart.toISOString() : market.eventStart,
      odds_api_event_id: market.oddsApiEventId,
      market_type: market.marketType,
      market_param: market.marketParam,
    }, error: null }),
  }
  vi.mocked(getServiceClient).mockReturnValue(supabaseMock as ReturnType<typeof getServiceClient>)
  return supabaseMock
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runPrices — missingBooks (BOOK-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseWithMarket(MARKET)
  })

  it('includes the name of the adapter that returned null in missingBooks', async () => {
    const snapshotA = snap({ book: 'bovada', side: 'home' })
    const snapshotB = snap({ book: 'bovada', side: 'away', priceAmerican: 100 })

    vi.mocked(enabledAdapters).mockReturnValue([
      {
        name: 'bovada',
        sourceConfidence: 'aggregator',
        isEnabled: () => true,
        fetchMarket: async () => [snapshotA, snapshotB],
        fetchEvents: async () => [],
      },
      {
        name: 'draftkings',
        sourceConfidence: 'aggregator',
        isEnabled: () => true,
        fetchMarket: async () => null, // no market for this book
        fetchEvents: async () => [],
      },
    ])

    const result = await runPrices({ market_id: MARKET.id })
    expect(result.missingBooks).toContain('draftkings')
    expect(result.missingBooks).not.toContain('bovada')
  })

  it('does NOT silently omit a null adapter — snapshots only contains non-null results', async () => {
    const snapshotA = snap({ book: 'pinnacle', side: 'home', priceAmerican: -108 })
    const snapshotB = snap({ book: 'pinnacle', side: 'away', priceAmerican: -108 })

    vi.mocked(enabledAdapters).mockReturnValue([
      {
        name: 'pinnacle',
        sourceConfidence: 'aggregator',
        isEnabled: () => true,
        fetchMarket: async () => [snapshotA, snapshotB],
        fetchEvents: async () => [],
      },
      {
        name: 'fanduel',
        sourceConfidence: 'aggregator',
        isEnabled: () => true,
        fetchMarket: async () => null,
        fetchEvents: async () => [],
      },
    ])

    const result = await runPrices({ market_id: MARKET.id })

    // snapshots should only include pinnacle rows
    expect(result.snapshots.every((s) => s.book === 'pinnacle')).toBe(true)
    // fanduel returns null → goes to missingBooks
    expect(result.missingBooks).toEqual(['fanduel'])
  })

  it('returns empty missingBooks when all enabled adapters return snapshots', async () => {
    const pSnaps = [snap({ book: 'pinnacle', side: 'home' }), snap({ book: 'pinnacle', side: 'away', priceAmerican: 100 })]
    const bSnaps = [snap({ book: 'bovada', side: 'home' }), snap({ book: 'bovada', side: 'away', priceAmerican: 100 })]

    vi.mocked(enabledAdapters).mockReturnValue([
      { name: 'pinnacle', sourceConfidence: 'aggregator', isEnabled: () => true, fetchMarket: async () => pSnaps, fetchEvents: async () => [] },
      { name: 'bovada', sourceConfidence: 'aggregator', isEnabled: () => true, fetchMarket: async () => bSnaps, fetchEvents: async () => [] },
    ])

    const result = await runPrices({ market_id: MARKET.id })
    expect(result.missingBooks).toHaveLength(0)
    expect(result.snapshots).toHaveLength(4)
  })
})

describe('runPrices — per-adapter timeout (SHOP-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockSupabaseWithMarket(MARKET)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('treats a slow adapter as missing (resolves to null before timeout elapses)', async () => {
    const fastSnap = snap({ book: 'bovada', side: 'home' })

    vi.mocked(enabledAdapters).mockReturnValue([
      {
        name: 'bovada',
        sourceConfidence: 'aggregator',
        isEnabled: () => true,
        fetchMarket: async () => [fastSnap],
        fetchEvents: async () => [],
      },
      {
        name: 'draftkings',
        sourceConfidence: 'aggregator',
        isEnabled: () => true,
        // Slow adapter — never resolves within the timeout window
        fetchMarket: () => new Promise<BookPriceSnapshot[] | null>(() => {
          // Intentionally never resolves
        }),
        fetchEvents: async () => [],
      },
    ])

    // Start the runPrices call (don't await yet)
    const resultPromise = runPrices({ market_id: MARKET.id })

    // Advance timers past the adapter timeout (prices.ts uses ~3000ms)
    await vi.advanceTimersByTimeAsync(5000)

    const result = await resultPromise
    // Slow adapter should appear in missingBooks, not hang indefinitely
    expect(result.missingBooks).toContain('draftkings')
    expect(result.snapshots.some((s) => s.book === 'bovada')).toBe(true)
  })
})

describe('runPrices — response contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseWithMarket(MARKET)
  })

  it('returns analysis with bestPrice and noVigConsensus', async () => {
    const homeSnap = snap({ book: 'pinnacle', side: 'home', priceAmerican: -115 })
    const awaySnap = snap({ book: 'pinnacle', side: 'away', priceAmerican: 105, priceDecimal: americanToDecimal(105), impliedProb: impliedFromAmerican(105) })

    vi.mocked(enabledAdapters).mockReturnValue([
      { name: 'pinnacle', sourceConfidence: 'aggregator', isEnabled: () => true, fetchMarket: async () => [homeSnap, awaySnap], fetchEvents: async () => [] },
    ])

    const result = await runPrices({ market_id: MARKET.id })
    expect(result.analysis).toBeDefined()
    expect(result.analysis.bestPrice['home']).toBeDefined()
    expect(result.analysis.noVigConsensus['home']).toBeTypeOf('number')
  })

  it('includes staleness in milliseconds (non-negative)', async () => {
    const homeSnap = snap({ book: 'bovada', side: 'home', fetchedAt: new Date(Date.now() - 60_000) })

    vi.mocked(enabledAdapters).mockReturnValue([
      { name: 'bovada', sourceConfidence: 'aggregator', isEnabled: () => true, fetchMarket: async () => [homeSnap], fetchEvents: async () => [] },
    ])

    const result = await runPrices({ market_id: MARKET.id })
    expect(result.staleness).toBeGreaterThanOrEqual(0)
  })
})
