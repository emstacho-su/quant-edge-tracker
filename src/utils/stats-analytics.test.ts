import { describe, it, expect } from 'vitest'
import {
  impliedProbability,
  classifyOddsBracket,
  classifyUnitBucket,
  computeEdgeStats,
  computeLineTypePerformance,
  computeUnitSizePerformance,
  computeWinRateTrend,
  computeSportPerformance,
} from './stats-analytics'
import type { Bet } from '@/lib/types'

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

function makeBet(overrides: Partial<Bet> = {}): Bet {
  return {
    id: crypto.randomUUID(),
    sport: 'NHL',
    bet_type: 'single',
    stake: 22,
    to_win: 20,
    odds_american: -110,
    description: 'Test ML',
    status: 'won',
    is_freeplay: false,
    placed_at: '2026-04-01T12:00:00Z',
    settled_at: '2026-04-01T18:00:00Z',
    profit_loss: 20,
    notes: null,
    live_game_id: null,
    live_game_sport: null,
    live_game_locked_at: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// impliedProbability
// ---------------------------------------------------------------------------

describe('impliedProbability', () => {
  it('converts negative odds (favorites)', () => {
    expect(impliedProbability(-200)).toBeCloseTo(0.6667, 3)
    expect(impliedProbability(-110)).toBeCloseTo(0.5238, 3)
    expect(impliedProbability(-100)).toBeCloseTo(0.5, 3)
  })

  it('converts positive odds (underdogs)', () => {
    expect(impliedProbability(150)).toBeCloseTo(0.4, 3)
    expect(impliedProbability(100)).toBeCloseTo(0.5, 3)
    expect(impliedProbability(300)).toBeCloseTo(0.25, 3)
  })

  it('handles extreme favorites', () => {
    expect(impliedProbability(-10000)).toBeCloseTo(0.9901, 3)
  })

  it('handles extreme underdogs', () => {
    expect(impliedProbability(10000)).toBeCloseTo(0.0099, 3)
  })
})

// ---------------------------------------------------------------------------
// classifyOddsBracket
// ---------------------------------------------------------------------------

describe('classifyOddsBracket', () => {
  it('classifies heavy favorites', () => {
    expect(classifyOddsBracket(-350)).toBe('heavy-fav')
    expect(classifyOddsBracket(-300)).toBe('heavy-fav')
  })

  it('classifies moderate favorites', () => {
    expect(classifyOddsBracket(-299)).toBe('moderate-fav')
    expect(classifyOddsBracket(-200)).toBe('moderate-fav')
    expect(classifyOddsBracket(-150)).toBe('moderate-fav')
  })

  it('classifies slight favorites', () => {
    expect(classifyOddsBracket(-149)).toBe('slight-fav')
    expect(classifyOddsBracket(-110)).toBe('slight-fav')
    expect(classifyOddsBracket(-101)).toBe('slight-fav')
  })

  it('classifies coin flips', () => {
    expect(classifyOddsBracket(-100)).toBe('coin-flip')
    expect(classifyOddsBracket(100)).toBe('coin-flip')
  })

  it('classifies slight underdogs', () => {
    expect(classifyOddsBracket(101)).toBe('slight-dog')
    expect(classifyOddsBracket(130)).toBe('slight-dog')
    expect(classifyOddsBracket(149)).toBe('slight-dog')
  })

  it('classifies moderate underdogs', () => {
    expect(classifyOddsBracket(150)).toBe('moderate-dog')
    expect(classifyOddsBracket(200)).toBe('moderate-dog')
    expect(classifyOddsBracket(299)).toBe('moderate-dog')
  })

  it('classifies big underdogs', () => {
    expect(classifyOddsBracket(300)).toBe('big-dog')
    expect(classifyOddsBracket(500)).toBe('big-dog')
  })
})

// ---------------------------------------------------------------------------
// computeEdgeStats
// ---------------------------------------------------------------------------

describe('computeEdgeStats', () => {
  it('returns zeroed stats for empty array', () => {
    const result = computeEdgeStats([])
    expect(result.overall.totalBets).toBe(0)
    expect(result.overall.edge).toBe(0)
    expect(result.bySport).toEqual([])
    expect(result.byBracket).toHaveLength(7)
    result.byBracket.forEach((b) => expect(b.totalBets).toBe(0))
  })

  it('computes edge for a single winning bet', () => {
    const bets = [makeBet({ odds_american: -200, status: 'won' })]
    const result = computeEdgeStats(bets)

    expect(result.overall.totalBets).toBe(1)
    expect(result.overall.wins).toBe(1)
    expect(result.overall.actualWinRate).toBeCloseTo(100, 0)
    expect(result.overall.expectedWinRate).toBeCloseTo(66.67, 0)
    expect(result.overall.edge).toBeCloseTo(33.33, 0)
  })

  it('computes edge for mixed results', () => {
    const bets = [
      makeBet({ odds_american: -200, status: 'won', sport: 'NHL' }),
      makeBet({ odds_american: -200, status: 'lost', sport: 'NHL', profit_loss: -22 }),
      makeBet({ odds_american: 150, status: 'won', sport: 'MLB' }),
    ]
    const result = computeEdgeStats(bets)

    // 2 wins out of 3 decided = 66.67%
    expect(result.overall.actualWinRate).toBeCloseTo(66.67, 0)
    expect(result.bySport).toHaveLength(2)
  })

  it('excludes pending bets and null odds', () => {
    const bets = [
      makeBet({ status: 'pending', odds_american: -110 }),
      makeBet({ status: 'won', odds_american: null }),
      makeBet({ status: 'won', odds_american: -150 }),
    ]
    const result = computeEdgeStats(bets)
    expect(result.overall.totalBets).toBe(1)
  })

  it('excludes parlays from odds-based analysis', () => {
    const bets = [
      makeBet({ bet_type: 'parlay', odds_american: null, status: 'won' }),
      makeBet({ bet_type: 'single', odds_american: -110, status: 'won' }),
    ]
    const result = computeEdgeStats(bets)
    expect(result.overall.totalBets).toBe(1)
  })

  it('groups into correct brackets', () => {
    const bets = [
      makeBet({ odds_american: -350, status: 'won' }),
      makeBet({ odds_american: 200, status: 'lost', profit_loss: -22 }),
    ]
    const result = computeEdgeStats(bets)

    const heavyFav = result.byBracket.find((b) => b.bracketKey === 'heavy-fav')
    const modDog = result.byBracket.find((b) => b.bracketKey === 'moderate-dog')

    expect(heavyFav?.totalBets).toBe(1)
    expect(heavyFav?.wins).toBe(1)
    expect(modDog?.totalBets).toBe(1)
    expect(modDog?.losses).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// computeLineTypePerformance
// ---------------------------------------------------------------------------

describe('computeLineTypePerformance', () => {
  it('classifies parlays by bet_type', () => {
    const bets = [
      makeBet({ bet_type: 'parlay', description: 'NYY ML / BOS ML', status: 'won' }),
    ]
    const result = computeLineTypePerformance(bets, 11)
    expect(result.find((r) => r.label === 'Parlay')).toBeTruthy()
  })

  it('classifies moneyline descriptions', () => {
    const bets = [
      makeBet({ description: 'NYY ML', status: 'won', odds_american: -150 }),
    ]
    const result = computeLineTypePerformance(bets, 11)
    expect(result.find((r) => r.label === 'Moneyline')?.bets).toBe(1)
  })

  it('classifies spread descriptions', () => {
    const bets = [
      makeBet({ description: 'PHX Suns -5.5', status: 'lost', profit_loss: -22 }),
    ]
    const result = computeLineTypePerformance(bets, 11)
    expect(result.find((r) => r.label === 'Spread')?.bets).toBe(1)
  })

  it('classifies over/under descriptions', () => {
    const bets = [
      makeBet({ description: 'TOR - MEM o220', status: 'won' }),
      makeBet({ description: 'BOS - NYK u215.5', status: 'lost', profit_loss: -22 }),
    ]
    const result = computeLineTypePerformance(bets, 11)
    expect(result.find((r) => r.label === 'Over')?.bets).toBe(1)
    expect(result.find((r) => r.label === 'Under')?.bets).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// computeWinRateTrend
// ---------------------------------------------------------------------------

describe('computeWinRateTrend', () => {
  it('returns empty for no bets', () => {
    expect(computeWinRateTrend([])).toEqual([])
  })

  it('groups by week and computes rates', () => {
    const bets = [
      makeBet({ settled_at: '2026-04-01T12:00:00Z', status: 'won', odds_american: -150 }),
      makeBet({ settled_at: '2026-04-02T12:00:00Z', status: 'lost', odds_american: -150, profit_loss: -22 }),
      makeBet({ settled_at: '2026-04-08T12:00:00Z', status: 'won', odds_american: -110 }),
    ]
    const result = computeWinRateTrend(bets)

    expect(result.length).toBeGreaterThanOrEqual(1)
    // First week: 1 win, 1 loss = 50%
    expect(result[0].betsInPeriod).toBe(2)
    expect(result[0].actualWinRate).toBeCloseTo(50, 0)
  })

  it('excludes pending bets and null odds', () => {
    const bets = [
      makeBet({ status: 'pending', odds_american: -110 }),
      makeBet({ status: 'won', odds_american: null }),
    ]
    const result = computeWinRateTrend(bets)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// classifyUnitBucket
// ---------------------------------------------------------------------------

describe('classifyUnitBucket', () => {
  it('buckets common stake-to-unit ratios into ranges', () => {
    expect(classifyUnitBucket(5.5, 11)).toBe('lt-1u')   // 0.5u → <1u
    expect(classifyUnitBucket(10.99, 11)).toBe('lt-1u') // just under 1u → <1u
    expect(classifyUnitBucket(11, 11)).toBe('1-2u')     // exactly 1u → 1–2u
    expect(classifyUnitBucket(16.5, 11)).toBe('1-2u')   // 1.5u → 1–2u
    expect(classifyUnitBucket(22, 11)).toBe('2-3u')     // exactly 2u → 2–3u
    expect(classifyUnitBucket(28, 11)).toBe('2-3u')     // 2.5u → 2–3u
    expect(classifyUnitBucket(33, 11)).toBe('3-5u')     // exactly 3u → 3–5u
    expect(classifyUnitBucket(44, 11)).toBe('3-5u')     // 4u → 3–5u
    expect(classifyUnitBucket(55, 11)).toBe('5u+')      // exactly 5u → 5u+
    expect(classifyUnitBucket(180, 11)).toBe('5u+')     // anything 5u+
  })

  it('uses half-open intervals — upper bound goes to next bucket', () => {
    // Exactly at boundary: 1.0u → 1–2u (not <1u)
    expect(classifyUnitBucket(11, 11)).toBe('1-2u')
    // Just below boundary: 0.9999u → <1u
    expect(classifyUnitBucket(10.999, 11)).toBe('lt-1u')
  })

  it('returns null for invalid unit size', () => {
    expect(classifyUnitBucket(11, 0)).toBeNull()
    expect(classifyUnitBucket(11, -1)).toBeNull()
    expect(classifyUnitBucket(11, NaN)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// computeUnitSizePerformance
// ---------------------------------------------------------------------------

describe('computeUnitSizePerformance', () => {
  it('returns one row per bucket, zero counts for empty buckets', () => {
    const bets = [
      makeBet({ stake: 22, profit_loss: 20, status: 'won', odds_american: -110 }),  // 2u win → 2–3u
      makeBet({ stake: 22, profit_loss: -22, status: 'lost', odds_american: -110 }), // 2u loss → 2–3u
    ]
    const rows = computeUnitSizePerformance(bets, 11)
    expect(rows).toHaveLength(5) // 5 range buckets
    const twoToThree = rows.find((r) => r.bucketKey === '2-3u')!
    expect(twoToThree.bets).toBe(2)
    expect(twoToThree.wins).toBe(1)
    expect(twoToThree.losses).toBe(1)
    expect(twoToThree.winPct).toBe(50)
    expect(twoToThree.profitLoss).toBe(-2)
    expect(twoToThree.units).toBeCloseTo(-2 / 11, 4)

    const oneToTwo = rows.find((r) => r.bucketKey === '1-2u')!
    expect(oneToTwo.bets).toBe(0)
  })

  it('excludes parlays and freeplays from the buckets', () => {
    const bets = [
      makeBet({ stake: 22, status: 'won', bet_type: 'parlay' }),
      makeBet({ stake: 22, status: 'won', is_freeplay: true }),
      makeBet({ stake: 22, status: 'won' }),
    ]
    const rows = computeUnitSizePerformance(bets, 11)
    const twoToThree = rows.find((r) => r.bucketKey === '2-3u')!
    expect(twoToThree.bets).toBe(1)
  })

  it('computes expected win rate from implied probability', () => {
    // Two 5u bets at -200 → expected win rate ≈ 66.7%
    const bets = [
      makeBet({ stake: 55, odds_american: -200, status: 'won', profit_loss: 27.5 }),
      makeBet({ stake: 55, odds_american: -200, status: 'lost', profit_loss: -55 }),
    ]
    const rows = computeUnitSizePerformance(bets, 11)
    const fivePlus = rows.find((r) => r.bucketKey === '5u+')!
    expect(fivePlus.bets).toBe(2)
    expect(fivePlus.expectedWinRate).toBeCloseTo(66.67, 1)
    expect(fivePlus.winPct).toBe(50)
    expect(fivePlus.edge).toBeCloseTo(50 - 66.67, 1)
  })

  it('returns empty array when unitSize is 0', () => {
    const bets = [makeBet({ stake: 22, status: 'won' })]
    expect(computeUnitSizePerformance(bets, 0)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// computeSportPerformance
// ---------------------------------------------------------------------------

describe('computeSportPerformance', () => {
  it('computes units and roi correctly (regression: matches old computePerformance output)', () => {
    // 1W-1L NHL set at -110/22u stake: pl = 20 + (-22) = -2
    // roi = -2/44 * 100 = -4.545...%; units = -2/22 = -0.0909...
    const bets = [
      makeBet({ sport: 'NHL', stake: 22, odds_american: -110, status: 'won', profit_loss: 20 }),
      makeBet({ sport: 'NHL', stake: 22, odds_american: -110, status: 'lost', profit_loss: -22 }),
    ]
    const rows = computeSportPerformance(bets, 22)
    expect(rows).toHaveLength(1)
    const nhl = rows[0]
    expect(nhl.label).toBe('NHL')
    expect(nhl.bets).toBe(2)
    expect(nhl.wins).toBe(1)
    expect(nhl.losses).toBe(1)
    expect(nhl.roi).toBeCloseTo((-2 / 44) * 100, 3)
    expect(nhl.units).toBeCloseTo(-2 / 22, 4)
  })

  it('computes expectedWinRate from implied probability of -110 bets (~52.38)', () => {
    // Two settled -110 bets: implied = 110/210 ≈ 0.5238 each; avg ≈ 52.38%
    const bets = [
      makeBet({ sport: 'NHL', stake: 22, odds_american: -110, status: 'won', profit_loss: 20 }),
      makeBet({ sport: 'NHL', stake: 22, odds_american: -110, status: 'lost', profit_loss: -22 }),
    ]
    const rows = computeSportPerformance(bets, 22)
    expect(rows[0].expectedWinRate).toBeCloseTo(52.38, 1)
  })

  it('returns expectedWinRate=0 and edge=0 when no settled bet has odds_american', () => {
    const bets = [
      makeBet({ sport: 'NHL', stake: 22, odds_american: null, status: 'won', profit_loss: 20 }),
      makeBet({ sport: 'NHL', stake: 22, odds_american: null, status: 'lost', profit_loss: -22 }),
    ]
    const rows = computeSportPerformance(bets, 22)
    expect(rows[0].expectedWinRate).toBe(0)
    expect(rows[0].edge).toBe(0)
  })

  it('computes edge as winPct - expectedWinRate', () => {
    // 1W 1L at -110 → winPct=50%, expectedWinRate≈52.38%, edge≈-2.38%
    const bets = [
      makeBet({ sport: 'NHL', stake: 22, odds_american: -110, status: 'won', profit_loss: 20 }),
      makeBet({ sport: 'NHL', stake: 22, odds_american: -110, status: 'lost', profit_loss: -22 }),
    ]
    const rows = computeSportPerformance(bets, 22)
    const row = rows[0]
    expect(row.edge).toBeCloseTo(row.winPct - row.expectedWinRate, 5)
  })
})
