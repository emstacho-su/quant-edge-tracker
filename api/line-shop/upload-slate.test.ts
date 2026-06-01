/**
 * Tests for api/line-shop/upload-slate.ts (D-07, D-10, D-11).
 *
 * Wave 0 scaffold turned green by plan 21-05.
 *
 * Mocks:
 *   - ../cron/arbitrage-scan.js → arbToRow (D-10)
 *   - ../_lib/line-shop/arb-detection.js → detectArbsForMarkets (D-10)
 *   - ../_lib/supabase-admin.js → getServiceClient (D-07)
 *   - ../_lib/session.js → requireSession (auth guard)
 *   - ../_lib/clv.js → americanToDecimal, impliedFromAmerican
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock declarations (hoisted by vitest before imports) ─────────────────────

vi.mock('../_lib/supabase-admin.js', () => ({
  getServiceClient: vi.fn(),
}))

vi.mock('../_lib/session.js', () => ({
  requireSession: vi.fn(() => ({ username: 'test' })),
}))

vi.mock('../_lib/line-shop/arb-detection.js', () => ({
  detectArbsForMarkets: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../cron/arbitrage-scan.js', () => ({
  arbToRow: vi.fn((arb: unknown, marketId: string) => ({
    market_id: marketId,
    total_return_pct: 2.5,
    _arb: arb,
  })),
  default: vi.fn(),
}))

vi.mock('../_lib/clv.js', () => ({
  americanToDecimal: vi.fn((a: number) => (a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1)),
  impliedFromAmerican: vi.fn((a: number) =>
    a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100)
  ),
  kalshiEffectiveImpliedProb: vi.fn(),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a chainable Supabase mock that routes table-specific calls. */
function makeChainableDb(options?: {
  updateCount?: number
  updateError?: { message: string } | null
  insertBookPricesError?: { message: string } | null
  insertArbError?: { message: string } | null
  captureInsertedRows?: unknown[]
  captureArbInsertedRows?: unknown[]
  captureUpdateCalls?: Array<{ args: unknown[] }>
}) {
  const {
    updateCount = 0,
    updateError = null,
    insertBookPricesError = null,
    insertArbError = null,
    captureInsertedRows,
    captureArbInsertedRows,
    captureUpdateCalls,
  } = options ?? {}

  const mockFrom = vi.fn((table: string) => {
    if (table === 'book_prices') {
      // Chainable update: .update(...).eq(...).eq(...).is(...)
      const updateChain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockResolvedValue({ error: updateError, count: updateCount }),
      }
      const updateFn = vi.fn((...args: unknown[]) => {
        captureUpdateCalls?.push({ args })
        updateChain.eq = vi.fn().mockReturnThis()
        updateChain.is = vi.fn().mockResolvedValue({ error: updateError, count: updateCount })
        return updateChain
      })

      const insertFn = vi.fn((rows: unknown[]) => {
        captureInsertedRows?.push(...rows)
        return Promise.resolve({ error: insertBookPricesError })
      })

      return { update: updateFn, insert: insertFn }
    }

    if (table === 'arb_opportunities') {
      const insertFn = vi.fn((rows: unknown[]) => {
        captureArbInsertedRows?.push(...rows)
        return Promise.resolve({ error: insertArbError })
      })
      return { insert: insertFn }
    }

    // Fallback for any other table.
    return {
      update: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), is: vi.fn().mockResolvedValue({ error: null, count: 0 }) })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    }
  })

  return mockFrom
}

const VALID_ROW = { market_id: 'mid-1', side: 'home', price_american: -110, point: null }
const VALID_BODY = { book: 'bovada', rows: [VALID_ROW] }

function makeReqRes(body: unknown, method = 'POST') {
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const req = {
    method,
    headers: { cookie: 'session=test' },
    body,
  }
  const res = { status, setHeader: vi.fn(), json }
  return { req, res, status, json }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/line-shop/upload-slate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when session is missing (unauthed)', async () => {
    const { requireSession } = await import('../_lib/session.js')
    // Simulate no session: requireSession sends 401 and returns null.
    ;(requireSession as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'Unauthorized' })
        return null
      }
    )

    const { getServiceClient } = await import('../_lib/supabase-admin.js')
    ;(getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: makeChainableDb() })

    const { req, res, status } = makeReqRes(VALID_BODY)
    const mod = await import('./upload-slate.js')
    await mod.default(req as never, res as never)

    expect(status).toHaveBeenCalledWith(401)
    // DB must NOT have been touched.
    expect(getServiceClient).not.toHaveBeenCalled()
  })

  it('rejects unknown book with 400 (D-11)', async () => {
    const { getServiceClient } = await import('../_lib/supabase-admin.js')
    ;(getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: makeChainableDb() })

    const { req, res, status, json } = makeReqRes({
      book: 'unknown_book',
      rows: [VALID_ROW],
    })
    const mod = await import('./upload-slate.js')
    await mod.default(req as never, res as never)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid book' }))
  })

  it('rejects empty rows array with 400', async () => {
    const { getServiceClient } = await import('../_lib/supabase-admin.js')
    ;(getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: makeChainableDb() })

    const { req, res, status, json } = makeReqRes({ book: 'bovada', rows: [] })
    const mod = await import('./upload-slate.js')
    await mod.default(req as never, res as never)

    expect(status).toHaveBeenCalledWith(400)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'no rows' }))
  })

  it("supersedes prior live manual rows for the chosen book (D-08)", async () => {
    const { getServiceClient } = await import('../_lib/supabase-admin.js')
    const captureUpdateCalls: Array<{ args: unknown[] }> = []
    const mockFrom = makeChainableDb({ updateCount: 3, captureUpdateCalls })
    ;(getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom })

    const { req, res } = makeReqRes(VALID_BODY)
    const mod = await import('./upload-slate.js')
    await mod.default(req as never, res as never)

    // from('book_prices') must have been called at least for the update step.
    const bookPricesCalls = (mockFrom as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'book_prices'
    )
    expect(bookPricesCalls.length).toBeGreaterThanOrEqual(1)
    // Update must have been called (captured as first call).
    expect(captureUpdateCalls.length).toBeGreaterThanOrEqual(1)
    // The superseded_at payload must be present.
    const updatePayload = captureUpdateCalls[0]!.args[0] as Record<string, unknown>
    expect(updatePayload).toHaveProperty('superseded_at')
  })

  it("writes book_prices rows with source_confidence='manual' and is_account_line=true (D-07)", async () => {
    const { getServiceClient } = await import('../_lib/supabase-admin.js')
    const insertedRows: unknown[] = []
    const mockFrom = makeChainableDb({ captureInsertedRows: insertedRows })
    ;(getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom })

    const { req, res } = makeReqRes(VALID_BODY)
    const mod = await import('./upload-slate.js')
    await mod.default(req as never, res as never)

    expect(insertedRows.length).toBeGreaterThan(0)
    for (const row of insertedRows) {
      const r = row as Record<string, unknown>
      expect(r['source_confidence']).toBe('manual')
      expect(r['is_account_line']).toBe(true)
    }
  })

  it('calls detectArbsForMarkets and writes arb_opportunities via arbToRow (D-10)', async () => {
    const { detectArbsForMarkets } = await import('../_lib/line-shop/arb-detection.js')
    const { arbToRow } = await import('../cron/arbitrage-scan.js')

    const fakeArb = {
      sideA: { book: 'bovada', side: 'home', priceAmerican: -103 },
      sideB: { book: 'betus', side: 'away', priceAmerican: -103 },
      totalReturnPct: 1.5,
    }
    ;(detectArbsForMarkets as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { marketId: 'mid-1', arb: fakeArb },
    ])

    const { getServiceClient } = await import('../_lib/supabase-admin.js')
    const arbInsertedRows: unknown[] = []
    const mockFrom = makeChainableDb({ captureArbInsertedRows: arbInsertedRows })
    ;(getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom })

    const { req, res } = makeReqRes(VALID_BODY)
    const mod = await import('./upload-slate.js')
    await mod.default(req as never, res as never)

    // detectArbsForMarkets must have been called with the affected market IDs.
    expect(detectArbsForMarkets).toHaveBeenCalledWith(expect.arrayContaining(['mid-1']))

    // arbToRow must have been called to shape the insert payload.
    expect(arbToRow).toHaveBeenCalled()

    // arb_opportunities must have received the arbToRow output.
    expect(arbInsertedRows.length).toBeGreaterThan(0)
  })

  it('returns { inserted, superseded, arbs_detected } on success', async () => {
    const { getServiceClient } = await import('../_lib/supabase-admin.js')
    const mockFrom = makeChainableDb({ updateCount: 2 })
    ;(getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom })

    const { req, res, status, json } = makeReqRes({
      book: 'betus',
      rows: [
        { market_id: 'mid-1', side: 'home', price_american: -110, point: null },
        { market_id: 'mid-2', side: 'over', price_american: 120, point: 3.5 },
      ],
    })
    const mod = await import('./upload-slate.js')
    await mod.default(req as never, res as never)

    expect(status).toHaveBeenCalledWith(200)
    const responseBody = json.mock.calls[0]?.[0] as Record<string, unknown>
    expect(responseBody).toHaveProperty('inserted', 2)
    expect(responseBody).toHaveProperty('superseded', 2)
    expect(responseBody).toHaveProperty('arbs_detected', 0)
  })

  it('returns 405 for non-POST methods', async () => {
    const { req, res, status } = makeReqRes(VALID_BODY, 'GET')
    const mod = await import('./upload-slate.js')
    await mod.default(req as never, res as never)
    expect(status).toHaveBeenCalledWith(405)
  })
})
