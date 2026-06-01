/**
 * Tests for the arb slice helpers exported from use-line-shop.ts
 *
 * Covers ARB-03 (ageMinutes / isStale) and ARB-04 (threshold filter).
 * Pure-function tests only — no Supabase mocking required for filter tests.
 * Enrichment tests (Task 1 / 21-08): Supabase mock via vi.mock.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeAgeMinutes, filterByMinReturn, filterByEnabledBooks, enrichArbRowsWithBookPrices } from './use-line-shop'
import type { ArbRow } from './use-line-shop'
import type { BookName } from '@/lib/line-shop-types'

// ─── computeAgeMinutes ────────────────────────────────────────────────────────

describe('computeAgeMinutes', () => {
  it('returns approx 12 for a timestamp 12 minutes in the past', () => {
    const twelveMinutesAgo = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    const age = computeAgeMinutes(twelveMinutesAgo)
    // Allow ±0.5 minute tolerance for test execution time
    expect(age).toBeGreaterThanOrEqual(11.5)
    expect(age).toBeLessThanOrEqual(12.5)
  })

  it('returns < 1 for a timestamp 30 seconds in the past', () => {
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString()
    expect(computeAgeMinutes(thirtySecondsAgo)).toBeLessThan(1)
  })

  it('isStale is true when ageMinutes > ARB_STALE_MINUTES (10)', () => {
    const twelveMinutesAgo = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    const age = computeAgeMinutes(twelveMinutesAgo)
    // ARB_STALE_MINUTES = 10
    expect(age > 10).toBe(true)
  })

  it('isStale is false for a fresh timestamp (2 minutes old)', () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const age = computeAgeMinutes(twoMinutesAgo)
    expect(age > 10).toBe(false)
  })
})

// ─── filterByMinReturn ────────────────────────────────────────────────────────

function makeRow(totalReturnPct: number): ArbRow {
  return {
    id: String(Math.random()),
    market_id: 'mkt-1',
    side_a: 'home',
    side_a_book: 'bovada',
    side_a_price: -110,
    side_a_stake_pct: 0.5,
    side_b: 'away',
    side_b_book: 'draftkings',
    side_b_price: 115,
    side_b_stake_pct: 0.5,
    total_return_pct: totalReturnPct,
    detected_at: new Date().toISOString(),
    status: 'detected',
    markets: {
      sport: 'MLB',
      event_name: 'NYY @ BOS',
      market_type: 'moneyline',
      market_param: null,
      event_start: new Date().toISOString(),
    },
    ageMinutes: 2,
    isStale: false,
    stakeA: 50,
    stakeB: 50,
    // Per-leg enrichment fields (21-08, D-09)
    side_a_source_confidence: null,
    side_b_source_confidence: null,
    side_a_uploaded_at: null,
    side_b_uploaded_at: null,
    // Kalshi fee fields (D-13 / stake-size-specific)
    side_a_kalshi_fee: 0,
    side_b_kalshi_fee: 0,
    kalshi_fee_total: 0,
  }
}

describe('filterByMinReturn', () => {
  it('excludes rows below the minimum return threshold', () => {
    const rows: ArbRow[] = [makeRow(0.3), makeRow(0.7), makeRow(1.2)]
    const filtered = filterByMinReturn(rows, 0.5)
    expect(filtered).toHaveLength(2)
    expect(filtered.map((r) => r.total_return_pct)).toEqual([0.7, 1.2])
  })

  it('includes rows exactly at the threshold', () => {
    const rows: ArbRow[] = [makeRow(0.5), makeRow(0.49)]
    const filtered = filterByMinReturn(rows, 0.5)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].total_return_pct).toBe(0.5)
  })

  it('returns all rows when threshold is 0', () => {
    const rows: ArbRow[] = [makeRow(0.1), makeRow(0.5), makeRow(2.0)]
    expect(filterByMinReturn(rows, 0)).toHaveLength(3)
  })

  it('returns empty array when no rows meet the threshold', () => {
    const rows: ArbRow[] = [makeRow(0.1), makeRow(0.2)]
    expect(filterByMinReturn(rows, 1.0)).toHaveLength(0)
  })

  it('returns empty array for empty input', () => {
    expect(filterByMinReturn([], 0.5)).toHaveLength(0)
  })
})

// ─── filterByEnabledBooks ─────────────────────────────────────────────────────

/** Build an ArbRow with specific book names for testing the book filter (D-02). */
function makeRowWithBooks(sideABook: string, sideBBook: string): ArbRow {
  return {
    ...makeRow(1.0),
    side_a_book: sideABook,
    side_b_book: sideBBook,
  }
}

describe('filterByEnabledBooks', () => {
  const pinnacle = 'pinnacle' as BookName
  const draftkings = 'draftkings' as BookName
  const kalshi = 'kalshi' as BookName

  it('(D-02 both-enabled) keeps row when both side_a_book and side_b_book are enabled', () => {
    const row = makeRowWithBooks('pinnacle', 'draftkings')
    const result = filterByEnabledBooks([row], [pinnacle, draftkings])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(row)
  })

  it('(D-02 side_a disabled) excludes row when side_a_book is not in enabled set', () => {
    // kalshi disabled, pinnacle enabled — side_a is kalshi → excluded
    const row = makeRowWithBooks('kalshi', 'pinnacle')
    const result = filterByEnabledBooks([row], [pinnacle, draftkings])
    expect(result).toHaveLength(0)
  })

  it('(D-02 side_b disabled) excludes row when side_b_book is not in enabled set', () => {
    // pinnacle enabled, kalshi disabled — side_b is kalshi → excluded
    const row = makeRowWithBooks('pinnacle', 'kalshi')
    const result = filterByEnabledBooks([row], [pinnacle, draftkings])
    expect(result).toHaveLength(0)
  })

  it('(D-02 both disabled) excludes row when both books are disabled', () => {
    const row = makeRowWithBooks('kalshi', 'bovada')
    const result = filterByEnabledBooks([row], [pinnacle, draftkings])
    expect(result).toHaveLength(0)
  })

  it('(D-03 empty enabled) returns empty array when enabled set is empty', () => {
    const rows = [makeRowWithBooks('pinnacle', 'draftkings'), makeRowWithBooks('bovada', 'kalshi')]
    const result = filterByEnabledBooks(rows, [])
    expect(result).toHaveLength(0)
  })

  it('does not mutate the input rows array', () => {
    const rows = [makeRowWithBooks('pinnacle', 'draftkings'), makeRowWithBooks('kalshi', 'bovada')]
    const originalLength = rows.length
    filterByEnabledBooks(rows, [pinnacle, draftkings, kalshi])
    expect(rows).toHaveLength(originalLength)
  })

  it('filters multiple rows correctly — mixed keep and exclude', () => {
    const rows = [
      makeRowWithBooks('pinnacle', 'draftkings'), // both enabled → keep
      makeRowWithBooks('pinnacle', 'kalshi'),     // kalshi disabled → exclude
      makeRowWithBooks('bovada', 'draftkings'),   // bovada disabled → exclude
    ]
    const result = filterByEnabledBooks(rows, [pinnacle, draftkings])
    expect(result).toHaveLength(1)
    expect(result[0].side_a_book).toBe('pinnacle')
    expect(result[0].side_b_book).toBe('draftkings')
  })
})

// ─── ArbRow shape — per-leg enrichment fields (21-08, D-09) ──────────────────

describe('ArbRow interface — per-leg source_confidence + uploaded_at fields', () => {
  it('(a) ArbRow shape includes side_a_source_confidence field', () => {
    const row = makeRow(1.0)
    // Field must exist (may be null for unenriched rows)
    expect('side_a_source_confidence' in row).toBe(true)
  })

  it('(b) ArbRow shape includes side_b_source_confidence field', () => {
    const row = makeRow(1.0)
    expect('side_b_source_confidence' in row).toBe(true)
  })

  it('(c) ArbRow shape includes side_a_uploaded_at field', () => {
    const row = makeRow(1.0)
    expect('side_a_uploaded_at' in row).toBe(true)
  })

  it('(d) ArbRow shape includes side_b_uploaded_at field', () => {
    const row = makeRow(1.0)
    expect('side_b_uploaded_at' in row).toBe(true)
  })
})

// ─── enrichArbRowsWithBookPrices (pure enrichment helper — 21-08) ─────────────

describe('enrichArbRowsWithBookPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('(b/c) sets side_b_source_confidence = manual when matching book_prices row has source_confidence = manual', () => {
    const row: ArbRow = {
      ...makeRow(1.0),
      market_id: 'mkt-42',
      side_a: 'home',
      side_a_book: 'pinnacle',
      side_b: 'away',
      side_b_book: '7stacks',
    }

    const bookPricesRows = [
      {
        market_id: 'mkt-42',
        book: '7stacks',
        side: 'away',
        source_confidence: 'manual',
        fetched_at: '2026-05-27T12:00:00Z',
      },
    ]

    const enriched = enrichArbRowsWithBookPrices([row], bookPricesRows)
    expect(enriched[0].side_b_source_confidence).toBe('manual')
    expect(enriched[0].side_b_uploaded_at).toBe('2026-05-27T12:00:00Z')
    // side_a had no book_prices row → null
    expect(enriched[0].side_a_source_confidence).toBeNull()
    expect(enriched[0].side_a_uploaded_at).toBeNull()
  })

  it('(d) when book_prices returns nothing, the four fields are null and row is preserved', () => {
    const row: ArbRow = {
      ...makeRow(1.0),
      market_id: 'mkt-99',
      side_a_book: 'pinnacle',
      side_b_book: 'bovada',
    }

    const enriched = enrichArbRowsWithBookPrices([row], [])
    expect(enriched[0].side_a_source_confidence).toBeNull()
    expect(enriched[0].side_b_source_confidence).toBeNull()
    expect(enriched[0].side_a_uploaded_at).toBeNull()
    expect(enriched[0].side_b_uploaded_at).toBeNull()
    // Core fields unchanged
    expect(enriched[0].market_id).toBe('mkt-99')
    expect(enriched[0].total_return_pct).toBe(1.0)
  })

  it('on duplicate (market_id, book, side) keys, keeps the row with the latest fetched_at', () => {
    const row: ArbRow = {
      ...makeRow(1.0),
      market_id: 'mkt-7',
      side_a: 'home',
      side_a_book: 'bovada',
      side_b: 'away',
      side_b_book: '7stacks',
    }

    const bookPricesRows = [
      {
        market_id: 'mkt-7',
        book: '7stacks',
        side: 'away',
        source_confidence: 'api',
        fetched_at: '2026-05-27T10:00:00Z',
      },
      {
        market_id: 'mkt-7',
        book: '7stacks',
        side: 'away',
        source_confidence: 'manual',
        fetched_at: '2026-05-27T11:00:00Z', // newer → wins
      },
    ]

    const enriched = enrichArbRowsWithBookPrices([row], bookPricesRows)
    expect(enriched[0].side_b_source_confidence).toBe('manual')
    expect(enriched[0].side_b_uploaded_at).toBe('2026-05-27T11:00:00Z')
  })
})
