import { describe, it, expect } from 'vitest'
import {
  joinPicksToOutcomes,
  formatRunDateLabel,
  unitsToUsd,
} from './strategy-panel'
import type {
  OutputSummaryFinalCard,
  StrategyOutcome,
} from '@/types/strategies'

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function pick(overrides: Partial<OutputSummaryFinalCard> = {}): OutputSummaryFinalCard {
  return {
    game: 'NYY @ BOS',
    market: 'ML',
    line: -120,
    stake_u: 1.5,
    pick_key: 'nyy-bos-ml',
    n: 1,
    stack: 'T1',
    edge_pct: 3.2,
    ...overrides,
  }
}

function outcome(overrides: Partial<StrategyOutcome> = {}): StrategyOutcome {
  return {
    id: crypto.randomUUID(),
    run_id: 'run-1',
    pick_key: 'nyy-bos-ml',
    game_key: 'nyy-bos',
    market: 'ML',
    side: 'NYY',
    line: '-120',
    predicted_p: 0.56,
    offered_odds: -120,
    stake_units: 1.5,
    audit_confidence: 'HIGH',
    settlement_status: 'pending',
    realized_result: null,
    settled_at: null,
    game_date: '2026-05-21',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// joinPicksToOutcomes
// ---------------------------------------------------------------------------

describe('joinPicksToOutcomes', () => {
  it('matches a pick to its outcome by pick_key (status + units_pl)', () => {
    const fc = [pick({ pick_key: 'a' })]
    const out = [
      outcome({
        pick_key: 'a',
        settlement_status: 'won',
        realized_result: { units_pl: 1.25 },
      }),
    ]
    const joined = joinPicksToOutcomes(fc, out)
    expect(joined).toHaveLength(1)
    expect(joined[0].pick.pick_key).toBe('a')
    expect(joined[0].status).toBe('won')
    expect(joined[0].units_pl).toBe(1.25)
  })

  it('falls back to pending / null when a pick has no outcome', () => {
    const fc = [pick({ pick_key: 'orphan' })]
    const joined = joinPicksToOutcomes(fc, [])
    expect(joined[0].status).toBe('pending')
    expect(joined[0].units_pl).toBeNull()
  })

  it('preserves final_card order regardless of outcome order', () => {
    const fc = [
      pick({ pick_key: 'a', n: 1 }),
      pick({ pick_key: 'b', n: 2 }),
      pick({ pick_key: 'c', n: 3 }),
    ]
    const out = [
      outcome({ pick_key: 'c', settlement_status: 'lost', realized_result: { units_pl: -2 } }),
      outcome({ pick_key: 'a', settlement_status: 'won', realized_result: { units_pl: 1 } }),
    ]
    const joined = joinPicksToOutcomes(fc, out)
    expect(joined.map((j) => j.pick.pick_key)).toEqual(['a', 'b', 'c'])
    expect(joined.map((j) => j.status)).toEqual(['won', 'pending', 'lost'])
    expect(joined.map((j) => j.units_pl)).toEqual([1, null, -2])
  })

  it('coerces a string units_pl (PostgREST numeric) to a number', () => {
    const fc = [pick({ pick_key: 'a' })]
    const out = [
      outcome({
        pick_key: 'a',
        settlement_status: 'won',
        // realized_result is jsonb<Record<string, unknown>>; numerics can serialize as strings
        realized_result: { units_pl: '0.77' } as unknown as Record<string, unknown>,
      }),
    ]
    const joined = joinPicksToOutcomes(fc, out)
    expect(joined[0].units_pl).toBe(0.77)
  })

  it('treats a push as settled with units_pl 0', () => {
    const fc = [pick({ pick_key: 'a' })]
    const out = [
      outcome({ pick_key: 'a', settlement_status: 'push', realized_result: { units_pl: 0 } }),
    ]
    const joined = joinPicksToOutcomes(fc, out)
    expect(joined[0].status).toBe('push')
    expect(joined[0].units_pl).toBe(0)
  })

  it('returns null units_pl when realized_result is present but has no units_pl key', () => {
    const fc = [pick({ pick_key: 'a' })]
    const out = [
      outcome({ pick_key: 'a', settlement_status: 'won', realized_result: { foo: 1 } }),
    ]
    const joined = joinPicksToOutcomes(fc, out)
    expect(joined[0].status).toBe('won')
    expect(joined[0].units_pl).toBeNull()
  })

  it('returns null units_pl when realized_result.units_pl is unparseable', () => {
    const fc = [pick({ pick_key: 'a' })]
    const out = [
      outcome({
        pick_key: 'a',
        settlement_status: 'won',
        realized_result: { units_pl: 'not-a-number' } as unknown as Record<string, unknown>,
      }),
    ]
    const joined = joinPicksToOutcomes(fc, out)
    expect(joined[0].units_pl).toBeNull()
  })

  it('returns an empty array for an empty final_card (full pass)', () => {
    expect(joinPicksToOutcomes([], [outcome()])).toEqual([])
  })

  it('uses the first outcome when duplicate pick_keys exist', () => {
    const fc = [pick({ pick_key: 'a' })]
    const out = [
      outcome({ pick_key: 'a', settlement_status: 'won', realized_result: { units_pl: 1 } }),
      outcome({ pick_key: 'a', settlement_status: 'lost', realized_result: { units_pl: -1 } }),
    ]
    const joined = joinPicksToOutcomes(fc, out)
    expect(joined[0].status).toBe('won')
    expect(joined[0].units_pl).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// formatRunDateLabel
// ---------------------------------------------------------------------------

describe('formatRunDateLabel', () => {
  const now = new Date(2026, 4, 21, 14, 0, 0) // 2026-05-21 2:00p local

  it('labels a same-day timestamp "Today h:mmp" (pm)', () => {
    const iso = new Date(2026, 4, 21, 21, 48, 0).toISOString() // 9:48p
    expect(formatRunDateLabel(iso, now)).toBe('Today 9:48p')
  })

  it('labels a same-day morning timestamp with the "a" suffix', () => {
    const iso = new Date(2026, 4, 21, 9, 5, 0).toISOString() // 9:05a
    expect(formatRunDateLabel(iso, now)).toBe('Today 9:05a')
  })

  it('renders midnight as 12:00a and noon as 12:00p', () => {
    const midnight = new Date(2026, 4, 21, 0, 0, 0).toISOString()
    const noon = new Date(2026, 4, 21, 12, 0, 0).toISOString()
    expect(formatRunDateLabel(midnight, now)).toBe('Today 12:00a')
    expect(formatRunDateLabel(noon, now)).toBe('Today 12:00p')
  })

  it('zero-pads single-digit minutes', () => {
    const iso = new Date(2026, 4, 21, 13, 7, 0).toISOString() // 1:07p
    expect(formatRunDateLabel(iso, now)).toBe('Today 1:07p')
  })

  it('labels the previous calendar day "Yesterday"', () => {
    const iso = new Date(2026, 4, 20, 18, 0, 0).toISOString()
    expect(formatRunDateLabel(iso, now)).toBe('Yesterday')
  })

  it('falls back to an absolute month/day for older dates', () => {
    const iso = new Date(2026, 4, 18, 18, 0, 0).toISOString()
    expect(formatRunDateLabel(iso, now)).toBe(
      new Date(2026, 4, 18, 18, 0, 0).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
    )
  })

  it('handles a yesterday that crosses a month boundary', () => {
    const monthStart = new Date(2026, 5, 1, 10, 0, 0) // June 1
    const iso = new Date(2026, 4, 31, 22, 0, 0).toISOString() // May 31
    expect(formatRunDateLabel(iso, monthStart)).toBe('Yesterday')
  })

  it('returns "—" for null / undefined / invalid input', () => {
    expect(formatRunDateLabel(null, now)).toBe('—')
    expect(formatRunDateLabel(undefined, now)).toBe('—')
    expect(formatRunDateLabel('not-a-date', now)).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// unitsToUsd
// ---------------------------------------------------------------------------

describe('unitsToUsd', () => {
  it('multiplies units by the unit size', () => {
    expect(unitsToUsd(2, 30)).toBe(60)
    expect(unitsToUsd(1.5, 30)).toBe(45)
  })

  it('preserves sign for negative P/L', () => {
    expect(unitsToUsd(-2.5, 30)).toBe(-75)
  })

  it('returns 0 for zero units', () => {
    expect(unitsToUsd(0, 30)).toBe(0)
  })

  it('returns 0 when unit size is zero or negative (no meaningful conversion)', () => {
    expect(unitsToUsd(5, 0)).toBe(0)
    expect(unitsToUsd(5, -10)).toBe(0)
  })

  it('returns 0 for non-finite inputs', () => {
    expect(unitsToUsd(Number.NaN, 30)).toBe(0)
    expect(unitsToUsd(5, Number.NaN)).toBe(0)
    expect(unitsToUsd(Number.POSITIVE_INFINITY, 30)).toBe(0)
  })

  it('handles fractional unit sizes', () => {
    expect(unitsToUsd(3, 12.5)).toBe(37.5)
  })
})
