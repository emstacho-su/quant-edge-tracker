/**
 * scrape-runner.test.ts
 *
 * Unit tests for scrapeBookOdds() daemon orchestrator.
 * Mocks getServiceClient and enabledAdapters so no real Playwright, Supabase, or
 * network calls occur.
 *
 * Key assertions (BOOK-05, D-06, D-07, Pitfall 5):
 *   - A failing adapter does not abort the batch (fail-soft per-book)
 *   - Only fresh snapshots (fetched_at > now-5min) are passed to detectArb
 *   - Detected arbs are upserted to arb_opportunities
 *   - Returns { booksScraped, marketsWritten, arbsDetected } summary
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ──────────────────────────────────────────────────────────────

// Mock the registry so we control which adapters are "enabled"
vi.mock('./adapters/registry.js', () => ({
  enabledAdapters: vi.fn(() => []),
}))

// Mock supabase-admin to avoid real DB calls
vi.mock('../supabase-admin.js', () => ({
  getServiceClient: vi.fn(),
}))

// Mock analysis to track detectArb calls
vi.mock('./analysis.js', () => ({
  detectArb: vi.fn(() => null),
}))

import { scrapeBookOdds } from './scrape-runner.js'
import { enabledAdapters } from './adapters/registry.js'
import { getServiceClient } from '../supabase-admin.js'
import { detectArb } from './analysis.js'
import type { CanonicalMarket } from './types.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MARKET: CanonicalMarket = {
  id: 'market-uuid-1',
  sport: 'mlb',
  eventId: 'MLB_20260522_MIL_CHC',
  eventName: 'Brewers @ Cubs',
  eventStart: new Date('2026-05-22T18:10:00Z'),
  oddsApiEventId: null,
  marketType: 'moneyline',
  marketParam: null,
}

/** Build a fresh snapshot (fetched 1 minute ago — within the 5-min window). */
function freshSnap(side: 'home' | 'away', priceAmerican: number) {
  const fetchedAt = new Date(Date.now() - 60 * 1000) // 1 min ago
  return {
    book: '7stacks' as const,
    side,
    priceAmerican,
    priceDecimal: priceAmerican > 0 ? 1 + priceAmerican / 100 : 1 - 100 / priceAmerican,
    impliedProb: priceAmerican > 0 ? 100 / (priceAmerican + 100) : (-priceAmerican) / (-priceAmerican + 100),
    point: null,
    fetchedAt,
    sourceConfidence: 'scraped' as const,
    isClosing: false,
  }
}

/** Build a stale snapshot (fetched 6 minutes ago — outside the 5-min window). */
function staleSnap(side: 'home' | 'away', priceAmerican: number) {
  const fetchedAt = new Date(Date.now() - 6 * 60 * 1000) // 6 min ago
  return { ...freshSnap(side, priceAmerican), fetchedAt }
}

/** Build a mock adapter. */
function makeAdapter(
  name: string,
  fetchResult: ReturnType<typeof freshSnap>[] | null | 'throw'
) {
  return {
    name,
    sourceConfidence: 'scraped' as const,
    isEnabled: () => true,
    fetchMarket: vi.fn(async () => {
      if (fetchResult === 'throw') throw new Error(`${name} adapter crashed`)
      return fetchResult
    }),
    fetchEvents: vi.fn(async () => []),
  }
}

// ─── Supabase mock helpers ─────────────────────────────────────────────────────

function makeSupabaseMock(freshRows: ReturnType<typeof freshSnap>[]) {
  const upsertArb = vi.fn().mockResolvedValue({ error: null })
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockResolvedValue({ data: freshRows, error: null }),
    upsert: upsertArb,
  }
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'arb_opportunities') {
        return { upsert: upsertArb }
      }
      // book_prices fresh-window query
      return selectChain
    }),
  }
  return { client, upsertArb, selectChain }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('scrapeBookOdds()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns zero summary when no enabled scraper adapters', async () => {
    vi.mocked(enabledAdapters).mockReturnValue([])
    vi.mocked(getServiceClient).mockReturnValue(makeSupabaseMock([]).client as never)

    const result = await scrapeBookOdds([MARKET])
    expect(result).toEqual({ booksScraped: 0, marketsWritten: 0, arbsDetected: 0 })
  })

  it('returns zero summary when enabled adapters have non-scraped sourceConfidence', async () => {
    // An OddsApiAdapter-like adapter with sourceConfidence='aggregator' should be excluded
    const apiAdapter = {
      name: 'odds_api',
      sourceConfidence: 'aggregator' as const,
      isEnabled: () => true,
      fetchMarket: vi.fn(async () => [freshSnap('home', -110)]),
      fetchEvents: vi.fn(async () => []),
    }
    vi.mocked(enabledAdapters).mockReturnValue([apiAdapter])
    vi.mocked(getServiceClient).mockReturnValue(makeSupabaseMock([]).client as never)

    const result = await scrapeBookOdds([MARKET])
    expect(result.booksScraped).toBe(0)
    expect(apiAdapter.fetchMarket).not.toHaveBeenCalled()
  })

  it('scrapes each enabled scraper adapter per market and counts marketsWritten', async () => {
    const adapter = makeAdapter('7stacks', [freshSnap('home', -110)])
    vi.mocked(enabledAdapters).mockReturnValue([adapter])
    const { client } = makeSupabaseMock([freshSnap('home', -110)])
    vi.mocked(getServiceClient).mockReturnValue(client as never)

    const result = await scrapeBookOdds([MARKET])
    expect(adapter.fetchMarket).toHaveBeenCalledWith(MARKET)
    expect(result.booksScraped).toBe(1)
    expect(result.marketsWritten).toBe(1)
  })

  it('fail-soft: a throwing adapter logs and does not abort the batch (D-06, T-11-18)', async () => {
    const badAdapter = makeAdapter('7stacks', 'throw')
    const goodAdapter = makeAdapter('betvegas23', [freshSnap('away', +120)])
    vi.mocked(enabledAdapters).mockReturnValue([badAdapter, goodAdapter])
    const { client } = makeSupabaseMock([freshSnap('away', +120)])
    vi.mocked(getServiceClient).mockReturnValue(client as never)

    const result = await scrapeBookOdds([MARKET])
    // goodAdapter must still have been called despite badAdapter throwing
    expect(goodAdapter.fetchMarket).toHaveBeenCalledWith(MARKET)
    // Only the good adapter's market is counted
    expect(result.booksScraped).toBe(2) // both attempted
    expect(result.marketsWritten).toBe(1) // only good result written
  })

  it('fail-soft: an adapter returning null is skipped cleanly (D-06)', async () => {
    const nullAdapter = makeAdapter('7stacks', null)
    vi.mocked(enabledAdapters).mockReturnValue([nullAdapter])
    vi.mocked(getServiceClient).mockReturnValue(makeSupabaseMock([]).client as never)

    const result = await scrapeBookOdds([MARKET])
    expect(result.marketsWritten).toBe(0)
  })

  it('passes ONLY fresh snapshots (fetched_at > now-5min) to detectArb (Pitfall 5, T-11-19)', async () => {
    // The fresh-window query is what filters snapshots — we verify the gt() call uses a
    // timestamp approximately 5 minutes in the past.
    const adapter = makeAdapter('7stacks', [freshSnap('home', -110)])
    vi.mocked(enabledAdapters).mockReturnValue([adapter])
    const { client, selectChain } = makeSupabaseMock([freshSnap('home', -110)])
    vi.mocked(getServiceClient).mockReturnValue(client as never)

    await scrapeBookOdds([MARKET])

    // gt() should have been called with 'fetched_at' and a timestamp ~5min ago
    expect(selectChain.gt).toHaveBeenCalled()
    const gtCall = selectChain.gt.mock.calls[0]
    expect(gtCall[0]).toBe('fetched_at')
    // The threshold timestamp should be within 10 seconds of 5 minutes ago
    const threshold = new Date(gtCall[1] as string).getTime()
    const fiveMinAgo = Date.now() - 5 * 60 * 1000
    expect(Math.abs(threshold - fiveMinAgo)).toBeLessThan(10_000)
  })

  it('upserts detected arb to arb_opportunities when detectArb returns non-null (BOOK-05, D-07)', async () => {
    const adapter = makeAdapter('7stacks', [freshSnap('home', -110), freshSnap('away', +130)])
    vi.mocked(enabledAdapters).mockReturnValue([adapter])

    const fakeArb = {
      sideA: freshSnap('home', -110),
      sideB: freshSnap('away', +130),
      sumRawImplied: 0.9,
      totalReturnPct: 1.2,
      stakeA: 54,
      stakeB: 46,
      stakeAPct: 0.54,
      stakeBPct: 0.46,
      detectedAt: new Date(),
    }
    vi.mocked(detectArb).mockReturnValue(fakeArb)

    const upsertArb = vi.fn().mockResolvedValue({ error: null })
    const freshRows = [freshSnap('home', -110), freshSnap('away', +130)]
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({ data: freshRows, error: null }),
    }
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'arb_opportunities') return { upsert: upsertArb }
        return selectChain
      }),
    }
    vi.mocked(getServiceClient).mockReturnValue(client as never)

    const result = await scrapeBookOdds([MARKET])
    expect(detectArb).toHaveBeenCalled()
    expect(upsertArb).toHaveBeenCalled()
    expect(result.arbsDetected).toBe(1)
  })

  it('does not upsert when detectArb returns null (no arb)', async () => {
    const adapter = makeAdapter('7stacks', [freshSnap('home', -110)])
    vi.mocked(enabledAdapters).mockReturnValue([adapter])
    vi.mocked(detectArb).mockReturnValue(null)

    const upsertArb = vi.fn().mockResolvedValue({ error: null })
    const freshRows = [freshSnap('home', -110)]
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({ data: freshRows, error: null }),
    }
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'arb_opportunities') return { upsert: upsertArb }
        return selectChain
      }),
    }
    vi.mocked(getServiceClient).mockReturnValue(client as never)

    const result = await scrapeBookOdds([MARKET])
    expect(result.arbsDetected).toBe(0)
    expect(upsertArb).not.toHaveBeenCalled()
  })

  it('returns correct summary shape with booksScraped/marketsWritten/arbsDetected', async () => {
    vi.mocked(enabledAdapters).mockReturnValue([])
    vi.mocked(getServiceClient).mockReturnValue(makeSupabaseMock([]).client as never)

    const result = await scrapeBookOdds([])
    expect(result).toHaveProperty('booksScraped')
    expect(result).toHaveProperty('marketsWritten')
    expect(result).toHaveProperty('arbsDetected')
  })
})
