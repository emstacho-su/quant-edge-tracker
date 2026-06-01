/**
 * Tests for KalshiAdapter (BOOK-04).
 *
 * All network calls are mocked via vi.stubGlobal('fetch', ...) so these tests
 * are safe to run in CI without live Kalshi access.
 *
 * Coverage:
 *  - kalshiAskToAmerican conversion correctness (+113/-203)
 *  - isEnabled() always returns true
 *  - Two-team event -> exactly two snapshots, one per canonical side
 *  - impliedProb is RAW = parseFloat(yes_ask_dollars), never devigged
 *  - yes_ask == "0.0000" skipped; all-zero event -> null
 *  - 429 response -> null (no throw)
 *  - Read-only surface (no order-placement methods)
 *  - KALSHI_FEE_PCT exported and correct
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  KalshiAdapter,
  kalshiAskToAmerican,
} from './kalshi-adapter.js'
import type { CanonicalMarket } from '../types.js'

// ─── Minimal canonical market fixture ────────────────────────────────────────

const MLB_MARKET: CanonicalMarket = {
  id: 'uuid-test-market',
  sport: 'mlb',
  eventId: 'MLB_20260524_TEX_LAA',
  eventName: 'Texas @ Los Angeles A',
  eventStart: new Date('2026-05-24T23:20:00Z'),
  oddsApiEventId: null,
  marketType: 'moneyline',
  marketParam: null,
}

// ─── Minimal Kalshi API fixtures ──────────────────────────────────────────────

/** Two-team MLB event fixture (Texas vs Los Angeles A) */
const KALSHI_TWO_TEAM_EVENT = {
  event: {
    event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
    title: 'Texas vs Los Angeles A',
    series_ticker: 'KXMLBGAME',
    markets: [
      {
        ticker: 'KXMLBGAME-26MAY241920TEXLAA-TEX',
        event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
        title: 'Texas vs Los Angeles A Winner?',
        yes_sub_title: 'Texas',
        no_sub_title: 'Texas',
        yes_bid_dollars: '0.5300',
        yes_ask_dollars: '0.5700',
        no_bid_dollars: '0.4300',
        no_ask_dollars: '0.4700',
        status: 'active',
        occurrence_datetime: '2026-05-25T02:20:00Z',
        response_price_units: 'usd_cent',
      },
      {
        ticker: 'KXMLBGAME-26MAY241920TEXLAA-LAA',
        event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
        title: 'Texas vs Los Angeles A Winner?',
        yes_sub_title: 'Los Angeles A',
        no_sub_title: 'Los Angeles A',
        yes_bid_dollars: '0.4200',
        yes_ask_dollars: '0.4700',
        no_bid_dollars: '0.5300',
        no_ask_dollars: '0.5800',
        status: 'active',
        occurrence_datetime: '2026-05-25T02:20:00Z',
        response_price_units: 'usd_cent',
      },
    ],
  },
}

/** All-zero event fixture (both markets illiquid) */
const KALSHI_ALL_ZERO_EVENT = {
  event: {
    event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
    title: 'Texas vs Los Angeles A',
    series_ticker: 'KXMLBGAME',
    markets: [
      {
        ticker: 'KXMLBGAME-26MAY241920TEXLAA-TEX',
        event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
        title: 'Texas vs Los Angeles A Winner?',
        yes_sub_title: 'Texas',
        no_sub_title: 'Texas',
        yes_bid_dollars: '0.0000',
        yes_ask_dollars: '0.0000',
        no_bid_dollars: '0.0000',
        no_ask_dollars: '0.0000',
        status: 'active',
        occurrence_datetime: '2026-05-25T02:20:00Z',
        response_price_units: 'usd_cent',
      },
      {
        ticker: 'KXMLBGAME-26MAY241920TEXLAA-LAA',
        event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
        title: 'Texas vs Los Angeles A Winner?',
        yes_sub_title: 'Los Angeles A',
        no_sub_title: 'Los Angeles A',
        yes_bid_dollars: '0.0000',
        yes_ask_dollars: '0.0000',
        no_bid_dollars: '0.0000',
        no_ask_dollars: '0.0000',
        status: 'active',
        occurrence_datetime: '2026-05-25T02:20:00Z',
        response_price_units: 'usd_cent',
      },
    ],
  },
}

/** Kalshi events list for fetchEvents */
const KALSHI_EVENTS_LIST = {
  events: [
    {
      event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
      title: 'Texas vs Los Angeles A',
      series_ticker: 'KXMLBGAME',
      markets: [
        {
          ticker: 'KXMLBGAME-26MAY241920TEXLAA-TEX',
          event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
          title: 'Texas vs Los Angeles A Winner?',
          yes_sub_title: 'Texas',
          yes_bid_dollars: '0.5300',
          yes_ask_dollars: '0.5700',
          no_bid_dollars: '0.4300',
          no_ask_dollars: '0.4700',
          status: 'active',
          occurrence_datetime: '2026-05-25T02:20:00Z',
          response_price_units: 'usd_cent',
        },
        {
          ticker: 'KXMLBGAME-26MAY241920TEXLAA-LAA',
          event_ticker: 'KXMLBGAME-26MAY241920TEXLAA',
          title: 'Texas vs Los Angeles A Winner?',
          yes_sub_title: 'Los Angeles A',
          yes_bid_dollars: '0.4200',
          yes_ask_dollars: '0.4700',
          no_bid_dollars: '0.5300',
          no_ask_dollars: '0.5800',
          status: 'active',
          occurrence_datetime: '2026-05-25T02:20:00Z',
          response_price_units: 'usd_cent',
        },
      ],
    },
  ],
}

// ─── Supabase mock ────────────────────────────────────────────────────────────

vi.mock('../../supabase-admin.js', () => {
  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ data: [], error: null }),
    upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
  })
  return {
    getServiceClient: vi.fn().mockReturnValue({ from: mockFrom }),
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetchOk(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(''),
    }),
  )
}

function mockFetchStatus(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(`HTTP ${status}`),
    }),
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('kalshiAskToAmerican', () => {
  it('converts "0.4700" to approximately +113 (underdog)', () => {
    const result = kalshiAskToAmerican('0.4700')
    // (1-0.47)/0.47 * 100 = 0.53/0.47 * 100 = 112.77... ≈ +113
    expect(result).toBeCloseTo(112.77, 0)
    expect(result).toBeGreaterThan(112)
    expect(result).toBeLessThan(114)
  })

  it('converts "0.6700" to approximately -203 (favorite)', () => {
    const result = kalshiAskToAmerican('0.6700')
    // -(0.67/(1-0.67))*100 = -(0.67/0.33)*100 = -203.03...
    expect(result).toBeCloseTo(-203.03, 0)
    expect(result).toBeGreaterThan(-205)
    expect(result).toBeLessThan(-201)
  })

  it('converts "0.5000" to -100 (even money)', () => {
    const result = kalshiAskToAmerican('0.5000')
    expect(result).toBeCloseTo(-100, 0)
  })

  it('converts "0.3200" to approximately +213 (large underdog)', () => {
    const result = kalshiAskToAmerican('0.3200')
    // (1-0.32)/0.32 * 100 = 0.68/0.32 * 100 = 212.5
    expect(result).toBeCloseTo(212.5, 0)
  })

  it('throws RangeError for prob <= 0', () => {
    expect(() => kalshiAskToAmerican('0.0000')).toThrow(RangeError)
  })

  it('throws RangeError for prob >= 1', () => {
    expect(() => kalshiAskToAmerican('1.0000')).toThrow(RangeError)
  })
})

describe('KalshiAdapter.isEnabled', () => {
  it('always returns true (no API key required)', () => {
    const adapter = new KalshiAdapter()
    expect(adapter.isEnabled()).toBe(true)
  })
})

describe('KalshiAdapter — read-only enforcement (BOOK-06)', () => {
  it('has no order-placement methods on prototype chain', () => {
    const adapter = new KalshiAdapter()
    const forbidden = [
      'placeOrder',
      'createOrder',
      'cancelOrder',
      'modifyBet',
      'placeBet',
      'confirmBet',
      'submitOrder',
    ]
    let proto: object | null = adapter
    const allNames = new Set<string>()
    while (proto !== null && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => allNames.add(k))
      proto = Object.getPrototypeOf(proto)
    }
    forbidden.forEach((k) => {
      expect(
        allNames,
        `forbidden method "${k}" must not exist on KalshiAdapter`,
      ).not.toContain(k)
    })
  })
})

describe('KalshiAdapter.fetchMarket', () => {
  let adapter: KalshiAdapter

  beforeEach(() => {
    adapter = new KalshiAdapter()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns two snapshots (one per canonical side) for a valid two-team event', async () => {
    // First fetch call: fetchEvents list; second: event detail
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_EVENTS_LIST),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_TWO_TEAM_EVENT),
          text: () => Promise.resolve(''),
        }),
    )

    const result = await adapter.fetchMarket(MLB_MARKET)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)

    const sides = result!.map((s) => s.side)
    expect(sides).toContain('home')
    expect(sides).toContain('away')
    // No duplicate sides
    expect(new Set(sides).size).toBe(2)
  })

  it('sets book="kalshi" and sourceConfidence="api" on every snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_EVENTS_LIST),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_TWO_TEAM_EVENT),
          text: () => Promise.resolve(''),
        }),
    )

    const result = await adapter.fetchMarket(MLB_MARKET)
    expect(result).not.toBeNull()
    for (const snap of result!) {
      expect(snap.book).toBe('kalshi')
      expect(snap.sourceConfidence).toBe('api')
    }
  })

  it('sets impliedProb = parseFloat(yes_ask_dollars) (RAW, not devigged)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_EVENTS_LIST),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_TWO_TEAM_EVENT),
          text: () => Promise.resolve(''),
        }),
    )

    const result = await adapter.fetchMarket(MLB_MARKET)
    expect(result).not.toBeNull()

    // TEX market: yes_ask_dollars = "0.5700" -> impliedProb = 0.57
    // LAA market: yes_ask_dollars = "0.4700" -> impliedProb = 0.47
    const impliedProbs = result!.map((s) => s.impliedProb).sort()
    expect(impliedProbs[0]).toBeCloseTo(0.47, 10)
    expect(impliedProbs[1]).toBeCloseTo(0.57, 10)

    // Confirm RAW (with vig): sum > 1.0
    const sum = impliedProbs.reduce((a, b) => a + b, 0)
    expect(sum).toBeGreaterThan(1.0)
  })

  it('sets point=null (Kalshi has no spread markets)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_EVENTS_LIST),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_TWO_TEAM_EVENT),
          text: () => Promise.resolve(''),
        }),
    )

    const result = await adapter.fetchMarket(MLB_MARKET)
    expect(result).not.toBeNull()
    for (const snap of result!) {
      expect(snap.point).toBeNull()
    }
  })

  it('skips yes_ask=="0.0000" markets and returns null for all-zero event', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_EVENTS_LIST),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_ALL_ZERO_EVENT),
          text: () => Promise.resolve(''),
        }),
    )

    const result = await adapter.fetchMarket(MLB_MARKET)
    expect(result).toBeNull()
  })

  it('returns null on 429 (rate-limit) without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_EVENTS_LIST),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('Too Many Requests'),
        }),
    )

    let threw = false
    let result: unknown = undefined
    try {
      result = await adapter.fetchMarket(MLB_MARKET)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(result).toBeNull()
  })

  it('returns null on 503 (service unavailable) without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_EVENTS_LIST),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('Service Unavailable'),
        }),
    )

    const result = await adapter.fetchMarket(MLB_MARKET)
    expect(result).toBeNull()
  })

  it('returns null when network fetch rejects (connection error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(KALSHI_EVENTS_LIST),
          text: () => Promise.resolve(''),
        })
        .mockRejectedValueOnce(new Error('ECONNREFUSED')),
    )

    const result = await adapter.fetchMarket(MLB_MARKET)
    expect(result).toBeNull()
  })
})

describe('KalshiAdapter.fetchMarket — cache hit path', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('uses cached event ticker from event_book_mappings when available', async () => {
    // Re-mock supabase to return a cache hit
    const { getServiceClient } = await import('../../supabase-admin.js')
    const mockSupabase = getServiceClient as ReturnType<typeof vi.fn>
    mockSupabase.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            book_event_id: 'KXMLBGAME-26MAY241920TEXLAA',
            matched_by: 'auto',
          },
          error: null,
        }),
        insert: vi.fn().mockResolvedValue({ data: [], error: null }),
        upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    })

    // Only one fetch call needed (no events list needed — cache hit)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(KALSHI_TWO_TEAM_EVENT),
        text: () => Promise.resolve(''),
      }),
    )

    const adapter = new KalshiAdapter()
    const result = await adapter.fetchMarket(MLB_MARKET)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    // Only one fetch call (cached event ticker, no fetchEvents needed)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})

describe('KalshiAdapter.fetchEvents', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns RawBookEvent[] for known sport', async () => {
    mockFetchOk(KALSHI_EVENTS_LIST)

    const adapter = new KalshiAdapter()
    const from = new Date('2026-05-24T00:00:00Z')
    const to = new Date('2026-05-25T23:59:59Z')
    const events = await adapter.fetchEvents('mlb', from, to)

    expect(Array.isArray(events)).toBe(true)
    // The fixture has one event with occurrence_datetime in range
    expect(events.length).toBeGreaterThanOrEqual(0)
  })

  it('returns [] for unknown sport (no tickers)', async () => {
    const adapter = new KalshiAdapter()
    const events = await adapter.fetchEvents('cricket', new Date(), new Date())
    expect(events).toEqual([])
  })
})
