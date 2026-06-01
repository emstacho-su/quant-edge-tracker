/**
 * Failing test scaffold for api/_lib/line-shop/arb-detection.ts (D-10).
 *
 * Wave 0 purpose: establish red tests so 21-04 turns them green.
 *
 * Tests assert detectArbsForMarkets behavior:
 *   - Returns empty when fewer than 2 distinct sides exist for a market.
 *   - Splits rows by side and calls detectArb exactly once per market with 2+ sides.
 *   - Returns DetectionResult[] carrying the matched marketId.
 *
 * The production module is intentionally absent (21-04 creates it).
 * Dynamic import below throws until then — that is the intended RED state.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ─── Mock supabase-admin so tests never hit the real DB ───────────────────────

vi.mock('../supabase-admin.js', () => ({
  getServiceClient: vi.fn(),
}))

// ─── Mock analysis.detectArb to spy on invocation without real computation ───

vi.mock('./analysis.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./analysis.js')>()
  return {
    ...actual,
    detectArb: vi.fn(),
    getMinReturnPct: vi.fn(() => 0.5),
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    market_id: 'mid-1',
    book: 'bovada',
    side: 'home',
    price_american: -110,
    price_decimal: 1.909,
    implied_prob: 0.524,
    point: null,
    fetched_at: new Date().toISOString(),
    source_confidence: 'manual',
    is_closing: false,
    superseded_at: null,
    ...overrides,
  }
}

/**
 * Build a table-routed Supabase mock that returns a different chain depending
 * on which table is queried. Each chain is a thenable that resolves to
 * `{data, error: null}` after any sequence of select/in/gt/is calls.
 */
function buildTableMock(tables: Record<string, unknown[]>) {
  function makeChain(data: unknown[]) {
    const chain = {
      select: vi.fn(() => chain),
      in: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      is: vi.fn(() => chain),
      // Awaiting the chain resolves to a Supabase-shaped response.
      then: (
        onFulfilled: (v: { data: unknown[]; error: null }) => unknown,
      ) => Promise.resolve({ data, error: null }).then(onFulfilled),
    }
    return chain
  }
  return vi.fn((table: string) => makeChain(tables[table] ?? []))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectArbsForMarkets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty when fewer than 2 distinct sides exist for a market (D-10)', async () => {
    // book_prices has one row (one side); markets meta missing odds_api_event_id
    // so no odds_snapshots query gets satisfied either. Only one side total → skip.
    const mockFrom = buildTableMock({
      book_prices: [makeRow()],
      markets: [
        {
          id: 'mid-1',
          market_type: 'moneyline',
          market_param: '',
          odds_api_event_id: null,
          home_team: 'Yankees',
          away_team: 'Red Sox',
        },
      ],
      odds_snapshots: [],
    })

    const { getServiceClient } = await import('../supabase-admin.js')
    ;(getServiceClient as Mock).mockReturnValue({ from: mockFrom })

    const mod = await import('./arb-detection.js')
    const { detectArbsForMarkets } = mod

    const result = await detectArbsForMarkets(['mid-1'])
    expect(result).toEqual([])
  })

  it('calls detectArb on split sides and returns DetectionResult[] (D-10)', async () => {
    const rows = [
      makeRow({ book: 'bovada', side: 'home', price_american: -103, implied_prob: 0.507 }),
      makeRow({ book: 'betus', side: 'home', price_american: -105, implied_prob: 0.512 }),
      makeRow({ book: 'bovada', side: 'away', price_american: -103, implied_prob: 0.507 }),
      makeRow({ book: 'betus', side: 'away', price_american: -101, implied_prob: 0.502 }),
    ]

    const mockFrom = buildTableMock({
      book_prices: rows,
      markets: [
        {
          id: 'mid-1',
          market_type: 'moneyline',
          market_param: '',
          odds_api_event_id: null,
          home_team: 'Yankees',
          away_team: 'Red Sox',
        },
      ],
      odds_snapshots: [],
    })

    const { getServiceClient } = await import('../supabase-admin.js')
    ;(getServiceClient as Mock).mockReturnValue({ from: mockFrom })

    const { detectArb } = await import('./analysis.js')
    const fakeArb = {
      sideA: { book: 'bovada', side: 'home', priceAmerican: -103 },
      sideB: { book: 'betus', side: 'away', priceAmerican: -101 },
      totalReturnPct: 0.9,
      sumRawImplied: 1.009,
    }
    ;(detectArb as Mock).mockReturnValueOnce(fakeArb)

    const mod = await import('./arb-detection.js')
    const { detectArbsForMarkets } = mod

    const result = await detectArbsForMarkets(['mid-1'])

    expect(detectArb).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    const detection = result[0] as { marketId: string; arb: unknown }
    expect(detection.marketId).toBe('mid-1')
  })

  it('bridges book_prices with odds_snapshots so a 7stacks-only market can arb against odds-api books', async () => {
    // book_prices has ONLY a 7stacks home row (side='home'). odds_snapshots has
    // pinnacle h2h rows for the same odds_event_id — the new bridge logic must
    // pull those in so detectArb sees a complete two-sided market.
    const bp = [
      makeRow({ book: '7stacks', side: 'home', price_american: 110, implied_prob: 0.476 }),
    ]
    const odds = [
      {
        odds_event_id: 'ev-123',
        bookmaker: 'pinnacle',
        market: 'h2h',
        selection: 'Yankees',
        point: null,
        price_american: -120,
        captured_at: new Date().toISOString(),
      },
      {
        odds_event_id: 'ev-123',
        bookmaker: 'pinnacle',
        market: 'h2h',
        selection: 'Red Sox',
        point: null,
        price_american: 110,
        captured_at: new Date().toISOString(),
      },
    ]

    const mockFrom = buildTableMock({
      book_prices: bp,
      markets: [
        {
          id: 'mid-1',
          market_type: 'moneyline',
          market_param: '',
          odds_api_event_id: 'ev-123',
          home_team: 'Yankees',
          away_team: 'Red Sox',
        },
      ],
      odds_snapshots: odds,
    })

    const { getServiceClient } = await import('../supabase-admin.js')
    ;(getServiceClient as Mock).mockReturnValue({ from: mockFrom })

    const { detectArb } = await import('./analysis.js')
    ;(detectArb as Mock).mockReturnValueOnce({
      sideA: { book: '7stacks', side: 'home', priceAmerican: 110 },
      sideB: { book: 'pinnacle', side: 'away', priceAmerican: 110 },
      totalReturnPct: 4.76,
      sumRawImplied: 0.952,
    })

    const { detectArbsForMarkets } = await import('./arb-detection.js')
    const result = await detectArbsForMarkets(['mid-1'])

    expect(detectArb).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect((result[0] as { marketId: string }).marketId).toBe('mid-1')
  })
})
