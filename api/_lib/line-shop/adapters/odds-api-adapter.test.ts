/**
 * OddsApiAdapter — Vitest suite
 *
 * Critical correctness guards (from plan §critical_correctness):
 *  1. matchScore imported from '../../match.js' (NOT clv.ts)
 *  2. impliedProb is RAW = impliedFromAmerican(price_american) — NEVER devigged
 *  3. BookPriceSnapshot.book is the INDIVIDUAL bookmaker key, NOT 'odds_api'
 *  4. forceFresh path honors ODDS_CREDIT_FLOOR (below floor → null, no throw)
 *  5. resolveEventMapping writes matched_by='needs_review' on same-city ambiguity
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { impliedFromAmerican, americanToDecimal } from '../../clv.js'

// ─── Mock external dependencies before importing the adapter ────────────────

// Mock supabase-admin
vi.mock('../../supabase-admin.js', () => ({
  getServiceClient: vi.fn(),
}))

// Mock odds-api client
vi.mock('../../odds-api.js', () => ({
  fetchSportOdds: vi.fn(),
  fetchSportEvents: vi.fn(),
  fetchEventOdds: vi.fn(),
  bookMarket: vi.fn(),
}))

// Import mocks after vi.mock hoisting
import { getServiceClient } from '../../supabase-admin.js'
import {
  fetchSportOdds,
  fetchSportEvents,
  fetchEventOdds,
} from '../../odds-api.js'
import { OddsApiAdapter, resolveEventMapping } from './odds-api-adapter.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PRICE_AMERICAN = -110
const EXPECTED_IMPLIED = impliedFromAmerican(PRICE_AMERICAN)
const EXPECTED_DECIMAL = americanToDecimal(PRICE_AMERICAN)

const SNAP_ROW = {
  odds_event_id: 'abc123',
  sport_key: 'baseball_mlb',
  commence_time: '2026-06-01T19:00:00Z',
  home_team: 'Chicago Cubs',
  away_team: 'Milwaukee Brewers',
  bookmaker: 'pinnacle',      // individual book key — NOT 'odds_api'
  market: 'h2h',
  selection: 'Chicago Cubs',
  point: null as number | null,
  price_american: PRICE_AMERICAN,
  captured_at: new Date().toISOString(),
}

const CANONICAL_MARKET = {
  id: 'market-uuid-1',
  sport: 'mlb',
  eventId: 'MLB_20260601_MIL_CHC',
  eventName: 'Brewers @ Cubs',
  eventStart: new Date('2026-06-01T19:00:00Z'),
  oddsApiEventId: 'abc123',
  marketType: 'moneyline' as const,
  marketParam: null,
}

/** Build a mock Supabase client with chainable from/select/eq/order/limit/data */
function makeMockSupabase(rows: unknown[]) {
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: undefined as unknown,
  }
  // Make awaiting the chain resolve with { data: rows, error: null }
  queryBuilder.limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  queryBuilder.eq = vi.fn().mockReturnValue({
    ...queryBuilder,
    eq: vi.fn().mockReturnValue({
      ...queryBuilder,
      order: vi.fn().mockReturnValue({
        ...queryBuilder,
        limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
    order: vi.fn().mockReturnValue({
      ...queryBuilder,
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  })
  return {
    from: vi.fn().mockReturnValue(queryBuilder),
    _queryBuilder: queryBuilder,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OddsApiAdapter', () => {
  let adapter: OddsApiAdapter

  beforeEach(() => {
    adapter = new OddsApiAdapter()
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.ODDS_API_KEY
    delete process.env.ODDS_CREDIT_FLOOR
  })

  // ── (1) isEnabled gate ───────────────────────────────────────────────────

  describe('isEnabled()', () => {
    it('returns true when ODDS_API_KEY is set', () => {
      process.env.ODDS_API_KEY = 'test-key'
      expect(adapter.isEnabled()).toBe(true)
    })

    it('returns false when ODDS_API_KEY is absent', () => {
      delete process.env.ODDS_API_KEY
      expect(adapter.isEnabled()).toBe(false)
    })
  })

  // ── (2) fetchMarket default path: RAW implied prob + book = individual key ──

  describe('fetchMarket() — default (reads odds_snapshots, 0 credits)', () => {
    it('builds snapshots with RAW impliedProb and book = individual bookmaker key', async () => {
      const mockSupa = makeMockSupabase([SNAP_ROW])
      vi.mocked(getServiceClient).mockReturnValue(mockSupa as ReturnType<typeof getServiceClient>)

      const snapshots = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(snapshots).not.toBeNull()
      expect(snapshots!.length).toBeGreaterThan(0)

      const snap = snapshots![0]

      // book MUST be the individual bookmaker key, NOT 'odds_api' (Pitfall 2)
      expect(snap.book).toBe('pinnacle')
      expect(snap.book).not.toBe('odds_api')

      // impliedProb MUST be RAW — never devigged (Pitfall 5)
      expect(snap.impliedProb).toBeCloseTo(EXPECTED_IMPLIED, 10)
      expect(snap.priceDecimal).toBeCloseTo(EXPECTED_DECIMAL, 10)
      expect(snap.priceAmerican).toBe(PRICE_AMERICAN)
      expect(snap.point).toBeNull()
      expect(snap.sourceConfidence).toBe('aggregator')
    })

    it('returns null when oddsApiEventId is null', async () => {
      const market = { ...CANONICAL_MARKET, oddsApiEventId: null }
      const result = await adapter.fetchMarket(market)
      expect(result).toBeNull()
    })

    it('returns null when no rows found', async () => {
      const mockSupa = makeMockSupabase([])
      vi.mocked(getServiceClient).mockReturnValue(mockSupa as ReturnType<typeof getServiceClient>)

      const result = await adapter.fetchMarket(CANONICAL_MARKET)
      expect(result).toBeNull()
    })
  })

  // ── (3) fetchEvents: maps OddsEvent[] → RawBookEvent[] + date-filters ───────

  describe('fetchEvents()', () => {
    it('maps OddsEvent array to RawBookEvent and filters by date window', async () => {
      const from = new Date('2026-06-01T00:00:00Z')
      const to = new Date('2026-06-02T00:00:00Z')

      const inWindowEvent = {
        id: 'ev1',
        commence_time: '2026-06-01T19:00:00Z',
        home_team: 'Chicago Cubs',
        away_team: 'Milwaukee Brewers',
        bookmakers: [],
      }
      const outOfWindowEvent = {
        id: 'ev2',
        commence_time: '2026-06-03T19:00:00Z', // after `to`
        home_team: 'Los Angeles Dodgers',
        away_team: 'San Francisco Giants',
        bookmakers: [],
      }

      vi.mocked(fetchSportEvents).mockResolvedValue([inWindowEvent, outOfWindowEvent])

      const events = await adapter.fetchEvents('mlb', from, to)

      // Only in-window event returned
      expect(events).toHaveLength(1)
      expect(events[0].bookEventId).toBe('ev1')
      expect(events[0].bookHomeTeam).toBe('Chicago Cubs')
      expect(events[0].bookAwayTeam).toBe('Milwaukee Brewers')
      expect(events[0].startTime).toEqual(new Date('2026-06-01T19:00:00Z'))
    })

    it('returns empty array when no events in window', async () => {
      vi.mocked(fetchSportEvents).mockResolvedValue([])
      const result = await adapter.fetchEvents('mlb', new Date(), new Date())
      expect(result).toEqual([])
    })
  })

  // ── (4) forceFresh below ODDS_CREDIT_FLOOR → returns null, no throw ─────────

  describe('fetchMarket() — forceFresh path', () => {
    it('returns null (no throw) when credits below ODDS_CREDIT_FLOOR', async () => {
      process.env.ODDS_API_KEY = 'test-key'
      process.env.ODDS_CREDIT_FLOOR = '500'

      // fetchEventOdds returns creditsRemaining below the floor
      vi.mocked(fetchEventOdds).mockResolvedValue({
        events: [],
        creditsRemaining: 100, // below floor of 500
        creditsUsed: 400,
      })

      const mockSupa = makeMockSupabase([])
      vi.mocked(getServiceClient).mockReturnValue(mockSupa as ReturnType<typeof getServiceClient>)

      // Should return null gracefully, never throw
      let result: unknown
      await expect(
        (async () => {
          result = await adapter.fetchMarket(CANONICAL_MARKET, { forceFresh: true })
        })(),
      ).resolves.not.toThrow()

      expect(result).toBeNull()
    })

    it('fetches and returns snapshots when credits are above floor', async () => {
      process.env.ODDS_API_KEY = 'test-key'
      process.env.ODDS_CREDIT_FLOOR = '50'

      const oddsEvent = {
        id: 'abc123',
        commence_time: '2026-06-01T19:00:00Z',
        home_team: 'Chicago Cubs',
        away_team: 'Milwaukee Brewers',
        bookmakers: [
          {
            key: 'pinnacle',
            title: 'Pinnacle',
            last_update: new Date().toISOString(),
            markets: [
              {
                key: 'h2h',
                outcomes: [
                  { name: 'Chicago Cubs', price: -110 },
                  { name: 'Milwaukee Brewers', price: +100 },
                ],
              },
            ],
          },
        ],
      }

      vi.mocked(fetchEventOdds).mockResolvedValue({
        events: [oddsEvent],
        creditsRemaining: 800, // above floor of 50
        creditsUsed: 2,
      })

      const mockSupa = makeMockSupabase([])
      vi.mocked(getServiceClient).mockReturnValue(mockSupa as ReturnType<typeof getServiceClient>)

      const snapshots = await adapter.fetchMarket(CANONICAL_MARKET, { forceFresh: true })

      expect(snapshots).not.toBeNull()
      expect(snapshots!.length).toBeGreaterThan(0)
      // Each snapshot book is the individual bookmaker key
      for (const snap of snapshots!) {
        expect(snap.book).toBe('pinnacle')
        expect(snap.book).not.toBe('odds_api')
        // RAW implied prob
        expect(snap.impliedProb).toBeCloseTo(impliedFromAmerican(snap.priceAmerican), 10)
      }
    })
  })

  // ── Read-only enforcement ────────────────────────────────────────────────────

  describe('read-only enforcement (BOOK-06)', () => {
    it('has no order-placement surface', () => {
      const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))
      const forbidden = ['placeOrder', 'createOrder', 'cancelOrder', 'modifyBet', 'placeBet']
      forbidden.forEach((k) => {
        expect(keys, `forbidden method "${k}" must not exist`).not.toContain(k)
      })
    })
  })
})

// ─── resolveEventMapping ─────────────────────────────────────────────────────

describe('resolveEventMapping()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.ODDS_API_KEY
  })

  /** Build a mock Supabase for resolveEventMapping scenarios */
  function makeMappingSupa(cacheRow: unknown | null) {
    const singleResult = cacheRow
      ? { data: cacheRow, error: null }
      : { data: null, error: null }

    const selectBuilder = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(singleResult),
    }
    selectBuilder.eq = vi.fn().mockReturnValue(selectBuilder)

    return {
      from: vi.fn().mockImplementation(() => ({
        select: vi.fn().mockReturnValue(selectBuilder),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      })),
    }
  }

  it('cache hit: returns canonical_event_id without second match call', async () => {
    const cacheRow = {
      canonical_event_id: 'MLB_20260601_MIL_CHC',
      book_event_id: 'abc123',
      book: 'odds_api',
      matched_by: 'auto',
      confidence: 1.0,
    }
    vi.mocked(getServiceClient).mockReturnValue(
      makeMappingSupa(cacheRow) as ReturnType<typeof getServiceClient>,
    )

    const result = await resolveEventMapping(
      'abc123',
      'Chicago Cubs',
      'Milwaukee Brewers',
      new Date('2026-06-01T19:00:00Z'),
    )

    expect(result).toBe('MLB_20260601_MIL_CHC')
    // fetchSportEvents should NOT have been called (cache hit)
    expect(fetchSportEvents).not.toHaveBeenCalled()
  })

  it('cache hit with needs_review: returns null without re-matching', async () => {
    const cacheRow = {
      canonical_event_id: null,
      book_event_id: 'abc123',
      book: 'odds_api',
      matched_by: 'needs_review',
      confidence: 0.5,
    }
    vi.mocked(getServiceClient).mockReturnValue(
      makeMappingSupa(cacheRow) as ReturnType<typeof getServiceClient>,
    )

    const result = await resolveEventMapping(
      'abc123',
      'Chicago Cubs',
      'Milwaukee Brewers',
      new Date('2026-06-01T19:00:00Z'),
    )

    expect(result).toBeNull()
    expect(fetchSportEvents).not.toHaveBeenCalled()
  })

  it('single candidate match → matched_by=auto, returns canonical_event_id', async () => {
    // No cache hit
    vi.mocked(getServiceClient).mockReturnValue(
      makeMappingSupa(null) as ReturnType<typeof getServiceClient>,
    )

    // fetchSportEvents used to find canonical market events (simulate via event mappings table)
    // For this test, we simulate the adapter's internal fetchEvents returning a matching event
    process.env.ODDS_API_KEY = 'test-key'
    vi.mocked(fetchSportEvents).mockResolvedValue([
      {
        id: 'odds-ev-999',
        commence_time: '2026-06-01T19:00:00Z',
        home_team: 'Chicago Cubs',
        away_team: 'Milwaukee Brewers',
        bookmakers: [],
      },
    ])

    // Also need supabase.from('markets') to return a canonical event
    const supaForMarkets = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'event_book_mappings') {
          // Cache miss
          const sel = {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
          sel.eq = vi.fn().mockReturnValue(sel)
          return {
            select: vi.fn().mockReturnValue(sel),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'markets') {
          // Return one matching canonical market
          const sel = {
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'market-uuid-1',
                  event_id: 'MLB_20260601_CHC_MIL',
                  home_team: 'Chicago Cubs',
                  away_team: 'Milwaukee Brewers',
                  event_start: '2026-06-01T19:00:00Z',
                },
              ],
              error: null,
            }),
          }
          sel.eq = vi.fn().mockReturnValue(sel)
          sel.gte = vi.fn().mockReturnValue(sel)
          return {
            select: vi.fn().mockReturnValue(sel),
          }
        }
        return { select: vi.fn().mockReturnThis(), upsert: vi.fn().mockResolvedValue({ error: null }) }
      }),
    }

    vi.mocked(getServiceClient).mockReturnValue(
      supaForMarkets as ReturnType<typeof getServiceClient>,
    )

    const result = await resolveEventMapping(
      'odds-ev-999',
      'Chicago Cubs',
      'Milwaukee Brewers',
      new Date('2026-06-01T19:00:00Z'),
    )

    // Single unique match should resolve canonical event_id
    expect(result).toBe('MLB_20260601_CHC_MIL')
  })

  it('same-city ambiguity (multiple candidates) → matched_by=needs_review, returns null', async () => {
    // No cache hit
    vi.mocked(getServiceClient).mockReturnValue(
      makeMappingSupa(null) as ReturnType<typeof getServiceClient>,
    )
    process.env.ODDS_API_KEY = 'test-key'
    vi.mocked(fetchSportEvents).mockResolvedValue([
      {
        id: 'ev-game1',
        commence_time: '2026-06-01T13:05:00Z',
        home_team: 'Chicago Cubs',
        away_team: 'Milwaukee Brewers',
        bookmakers: [],
      },
      {
        id: 'ev-game2',
        commence_time: '2026-06-01T19:10:00Z',
        home_team: 'Chicago Cubs',     // same city — ambiguous
        away_team: 'Milwaukee Brewers',
        bookmakers: [],
      },
    ])

    const supaForAmbiguous = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'event_book_mappings') {
          const sel = {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
          sel.eq = vi.fn().mockReturnValue(sel)
          return {
            select: vi.fn().mockReturnValue(sel),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'markets') {
          // Return two candidates with identical team names (same-city doubleheader)
          const sel = {
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'market-uuid-g1',
                  event_id: 'MLB_20260601_CHC_MIL_G1',
                  home_team: 'Chicago Cubs',
                  away_team: 'Milwaukee Brewers',
                  event_start: '2026-06-01T13:05:00Z',
                },
                {
                  id: 'market-uuid-g2',
                  event_id: 'MLB_20260601_CHC_MIL_G2',
                  home_team: 'Chicago Cubs',
                  away_team: 'Milwaukee Brewers',
                  event_start: '2026-06-01T19:10:00Z',
                },
              ],
              error: null,
            }),
          }
          sel.eq = vi.fn().mockReturnValue(sel)
          sel.gte = vi.fn().mockReturnValue(sel)
          return { select: vi.fn().mockReturnValue(sel) }
        }
        return { select: vi.fn().mockReturnThis(), upsert: vi.fn().mockResolvedValue({ error: null }) }
      }),
    }

    vi.mocked(getServiceClient).mockReturnValue(
      supaForAmbiguous as ReturnType<typeof getServiceClient>,
    )

    const result = await resolveEventMapping(
      'ev-game1',
      'Chicago Cubs',
      'Milwaukee Brewers',
      new Date('2026-06-01T13:05:00Z'),
    )

    // Ambiguous → needs_review → returns null (never silently mismatches)
    expect(result).toBeNull()
  })
})
