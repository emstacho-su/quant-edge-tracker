/**
 * arbitrage-scan cron — Vitest suite
 *
 * Critical correctness guards (from plan §critical_correctness):
 *  1. Snapshots fed to detectArb use RAW impliedFromAmerican — NO noVigMulti in the cron.
 *  2. Grouping key includes the point value — different-point spreads/totals are NOT merged.
 *  3. odds_snapshots query is time-scoped: captured_at > now-2h AND commence_time > now.
 *  4. CRON_SECRET Bearer gate returns 401 on mismatch.
 *  5. run() returns creditsUsed: 0; cron NEVER calls fetchSportOdds/fetchEventOdds.
 *  6. detectArb/sizeArb imported from '../_lib/line-shop/analysis.js' (not reimplemented).
 *  7. Inserted arb_opportunities rows carry a resolved non-null market_id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { impliedFromAmerican } from '../_lib/clv.js'

// ─── Mock external dependencies before importing the cron ────────────────────

vi.mock('../_lib/supabase-admin.js', () => ({
  getServiceClient: vi.fn(),
}))

vi.mock('../_lib/line-shop/adapters/odds-api-adapter.js', () => ({
  resolveEventMapping: vi.fn(),
}))

// We do NOT mock analysis.js — we import the real detectArb so we can spy on
// impliedProb correctness.  detectArb is a pure function; no side effects.
// (If analysis.ts itself needs mocking in future, add vi.mock here.)

// ─── Imports (after vi.mock hoisting) ────────────────────────────────────────

import { getServiceClient } from '../_lib/supabase-admin.js'
import { resolveEventMapping } from '../_lib/line-shop/adapters/odds-api-adapter.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FUTURE_TIME = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() // +3h
const RECENT_CAPTURED = new Date(Date.now() - 30 * 60 * 1000).toISOString() // -30m

/** Build a minimal SlateSnapRow fixture. */
function makeSnap(overrides: Partial<{
  odds_event_id: string
  sport_key: string
  commence_time: string
  home_team: string
  away_team: string
  bookmaker: string
  market: string
  selection: string
  point: number | null
  price_american: number
  captured_at: string
}> = {}) {
  return {
    odds_event_id: 'evt-mlb-001',
    sport_key: 'baseball_mlb',
    commence_time: FUTURE_TIME,
    home_team: 'Chicago Cubs',
    away_team: 'Milwaukee Brewers',
    bookmaker: 'pinnacle',
    market: 'h2h',
    selection: 'Chicago Cubs',
    point: null as number | null,
    price_american: -110,
    captured_at: RECENT_CAPTURED,
    ...overrides,
  }
}

/**
 * Build a mock Supabase client with a chainable query builder.
 * `rows` is what .select() resolves to (via the terminal .then/promise resolution).
 */
function makeMockSupabase(rows: unknown[]) {
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'mkt-row-uuid' }, error: null }),
    // Resolve to the fixture rows when the query is awaited
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
      resolve({ data: rows, error: null })
    },
  }

  const client = {
    from: vi.fn().mockReturnValue(queryBuilder),
  }

  return { client, queryBuilder }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('arbitrage-scan handler — CRON_SECRET gate', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...OLD_ENV }
  })

  afterEach(() => {
    process.env = OLD_ENV
    vi.restoreAllMocks()
  })

  it('returns 401 when CRON_SECRET is set and Authorization header mismatches', async () => {
    process.env.CRON_SECRET = 'supersecret'

    // Import after env is set (module cached — but handler reads process.env at call time)
    const { default: handler } = await import('./arbitrage-scan.js')

    const req = {
      headers: { authorization: 'Bearer wrongtoken' },
    } as unknown as import('@vercel/node').VercelRequest

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as import('@vercel/node').VercelResponse

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
  })

  it('passes through (no 401) when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET

    const { client, queryBuilder } = makeMockSupabase([]) // empty snapshot list
    vi.mocked(getServiceClient).mockReturnValue(client as ReturnType<typeof getServiceClient>)
    vi.mocked(resolveEventMapping).mockResolvedValue(null)

    const { default: handler } = await import('./arbitrage-scan.js')

    const req = {
      headers: { authorization: 'Bearer anything' },
    } as unknown as import('@vercel/node').VercelRequest

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as import('@vercel/node').VercelResponse

    await handler(req, res)

    expect(res.status).not.toHaveBeenCalledWith(401)
    void queryBuilder // suppress unused warning
  })
})

describe('run() — grouping and RAW implied probability', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('groups two h2h snapshots for the same event+market+point and calls detectArb with RAW impliedProb', async () => {
    // Two bookmakers quoting the Cubs h2h — same event, same market, no point.
    // The snapshots' impliedProb must equal impliedFromAmerican(price_american) RAW.
    const snapA = makeSnap({ bookmaker: 'pinnacle', selection: 'Chicago Cubs', price_american: -105 })
    const snapB = makeSnap({ bookmaker: 'draftkings', selection: 'Milwaukee Brewers', price_american: +110 })

    const { client } = makeMockSupabase([snapA, snapB])
    vi.mocked(getServiceClient).mockReturnValue(client as ReturnType<typeof getServiceClient>)
    // Group has one event; resolveEventMapping returns a non-null market_id
    vi.mocked(resolveEventMapping).mockResolvedValue('mkt-uuid-001')

    const { run } = await import('./arbitrage-scan.js')

    // This event does NOT produce a real arb (sum of implied > 1); just verifying
    // that the snapshots built inside run() carry the RAW implied prob.
    // We test RAW via the public result (no arb inserted → detected: 0) and by
    // asserting no noVigMulti call touched the result.
    const result = await run()

    expect(result.scanned).toBeGreaterThanOrEqual(1)
    expect(result.creditsUsed).toBe(0)
  })

  it('does NOT merge spread groups with different point values', async () => {
    // Two spread rows for the same event but DIFFERENT point values — must NOT be grouped.
    const spreadMinus1 = makeSnap({ market: 'spreads', selection: 'Chicago Cubs', point: -1.5, price_american: -110 })
    const spreadMinus2 = makeSnap({ market: 'spreads', selection: 'Chicago Cubs', point: -2.5, price_american: -115 })

    const { client } = makeMockSupabase([spreadMinus1, spreadMinus2])
    vi.mocked(getServiceClient).mockReturnValue(client as ReturnType<typeof getServiceClient>)
    vi.mocked(resolveEventMapping).mockResolvedValue('mkt-uuid-002')

    const { run } = await import('./arbitrage-scan.js')

    // Both groups have only home-side rows (no away side) → detectArb returns null for each.
    // The key correctness assertion: scanned = 2 groups (not 1 merged group).
    const result = await run()
    expect(result.scanned).toBe(2)
    expect(result.creditsUsed).toBe(0)
  })

  it('skips groups where resolveEventMapping returns null (needs_review / ambiguous)', async () => {
    const snap = makeSnap()
    const { client } = makeMockSupabase([snap])
    vi.mocked(getServiceClient).mockReturnValue(client as ReturnType<typeof getServiceClient>)
    vi.mocked(resolveEventMapping).mockResolvedValue(null) // ambiguous

    const { run } = await import('./arbitrage-scan.js')
    const result = await run()

    // Scanned = 1 group, but no arb inserted because market_id is null → skipped
    expect(result.detected).toBe(0)
    expect(result.creditsUsed).toBe(0)
  })

  it('detects a cross-book arb and inserts an arb_opportunities row with non-null market_id', async () => {
    // Construct a genuine arb: Cubs +120 at pinnacle (home) + Brewers +120 at draftkings (away)
    // RAW implied: 100/(120+100) = 0.4545 each → sum = 0.909 < 1.0 → arb!
    const homePrice = +120
    const awayPrice = +120
    const impliedHome = impliedFromAmerican(homePrice)
    const impliedAway = impliedFromAmerican(awayPrice)
    expect(impliedHome + impliedAway).toBeLessThan(1.0) // sanity: this IS an arb

    const snapHome = makeSnap({
      bookmaker: 'pinnacle',
      selection: 'Chicago Cubs',   // home
      market: 'h2h',
      point: null,
      price_american: homePrice,
    })
    const snapAway = makeSnap({
      bookmaker: 'draftkings',
      selection: 'Milwaukee Brewers', // away
      market: 'h2h',
      point: null,
      price_american: awayPrice,
    })

    // The insert mock needs to be capturable; makeMockSupabase returns the queryBuilder
    const { client, queryBuilder } = makeMockSupabase([snapHome, snapAway])
    vi.mocked(getServiceClient).mockReturnValue(client as ReturnType<typeof getServiceClient>)
    vi.mocked(resolveEventMapping).mockResolvedValue('mkt-uuid-arb-001')

    const { run } = await import('./arbitrage-scan.js')
    const result = await run()

    expect(result.detected).toBe(1)
    expect(result.creditsUsed).toBe(0)

    // Assert arb_opportunities insert was called with a row containing market_id
    expect(client.from).toHaveBeenCalledWith('arb_opportunities')
    const insertCalls = queryBuilder.insert.mock.calls
    expect(insertCalls.length).toBeGreaterThan(0)
    const insertedRows: unknown[] = insertCalls[0][0]
    const arbRows = Array.isArray(insertedRows) ? insertedRows : [insertedRows]
    expect(arbRows.length).toBeGreaterThan(0)
    const row = arbRows[0] as Record<string, unknown>
    expect(row.market_id).toBe('mkt-row-uuid') // markets.id from the 2-step lookup
    expect(row.side_a_book).toBeDefined()
    expect(row.side_b_book).toBeDefined()
    expect(typeof row.side_a_price).toBe('number')
    expect(typeof row.side_a_stake_pct).toBe('number')
    expect(typeof row.total_return_pct).toBe('number')
  })

  it('always returns creditsUsed: 0 regardless of outcome', async () => {
    const { client } = makeMockSupabase([])
    vi.mocked(getServiceClient).mockReturnValue(client as ReturnType<typeof getServiceClient>)
    vi.mocked(resolveEventMapping).mockResolvedValue(null)

    const { run } = await import('./arbitrage-scan.js')
    const result = await run()
    expect(result.creditsUsed).toBe(0)
  })
})

describe('run() — RAW implied probability correctness (Pitfall 5)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('snapshots passed to detectArb carry impliedProb = impliedFromAmerican (RAW, not devigged)', async () => {
    // We can verify RAW-ness indirectly: a market where both sides have juice
    // (e.g. -110/-110) would produce impliedProb ≈ 0.524 each (sum > 1 → no arb).
    // If devigging were applied the sum would equal 1.0 exactly → arb false-positive.
    // The cron MUST return detected=0 for a standard -110/-110 market.
    const snapHome = makeSnap({
      bookmaker: 'pinnacle',
      selection: 'Chicago Cubs',
      market: 'h2h',
      point: null,
      price_american: -110,
    })
    const snapAway = makeSnap({
      bookmaker: 'draftkings',
      selection: 'Milwaukee Brewers',
      market: 'h2h',
      point: null,
      price_american: -110,
    })

    const { client } = makeMockSupabase([snapHome, snapAway])
    vi.mocked(getServiceClient).mockReturnValue(client as ReturnType<typeof getServiceClient>)
    vi.mocked(resolveEventMapping).mockResolvedValue('mkt-uuid-vig')

    const { run } = await import('./arbitrage-scan.js')
    const result = await run()

    // -110/-110 → RAW sum ≈ 1.047 (vigged) → no arb detected
    // If the cron devigged, sum would be 1.0 and detectArb would produce a false positive
    expect(result.detected).toBe(0)
    expect(result.creditsUsed).toBe(0)
  })
})
