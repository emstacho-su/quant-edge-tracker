import { describe, it, expect } from 'vitest'
import { computeTwoSidedVig, vigForParsedBet } from './import-vig'
import type { ParsedBet } from '@/lib/types'

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

function makeParsedBet(overrides: Partial<ParsedBet> = {}): ParsedBet {
  return {
    stake: 110,
    to_win: 100,
    bet_type: 'single',
    description: 'Test bet',
    odds_american: -110,
    sport: 'MLB',
    legs: [],
    is_freeplay: false,
    ...overrides,
  } as ParsedBet
}

// ---------------------------------------------------------------------------
// computeTwoSidedVig
// ---------------------------------------------------------------------------

describe('computeTwoSidedVig', () => {
  it('returns approx 4.76 for symmetric -110/-110 (standard vig)', () => {
    // impliedFromAmerican(-110) = 110/210 ≈ 0.52381
    // vig = (0.52381 + 0.52381 - 1) * 100 ≈ 4.76%
    const result = computeTwoSidedVig(-110, -110)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(4.76, 1)
  })

  it('returns a number for asymmetric +150/-170 lines', () => {
    // impliedFromAmerican(+150) = 100/250 = 0.4
    // impliedFromAmerican(-170) = 170/270 ≈ 0.6296
    // vig = (0.4 + 0.6296 - 1) * 100 ≈ 2.96
    const result = computeTwoSidedVig(150, -170)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(2.96, 1)
  })

  it('returns null when oddsA is null', () => {
    expect(computeTwoSidedVig(null, -110)).toBeNull()
  })

  it('returns null when oddsB is null', () => {
    expect(computeTwoSidedVig(-110, null)).toBeNull()
  })

  it('returns null when oddsA is undefined', () => {
    expect(computeTwoSidedVig(undefined, -110)).toBeNull()
  })

  it('returns null when oddsB is undefined', () => {
    expect(computeTwoSidedVig(-110, undefined)).toBeNull()
  })

  it('returns null when both sides are null', () => {
    expect(computeTwoSidedVig(null, null)).toBeNull()
  })

  it('returns null when oddsA is NaN', () => {
    expect(computeTwoSidedVig(NaN, -110)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// vigForParsedBet
// ---------------------------------------------------------------------------

describe('vigForParsedBet', () => {
  it('returns null for a parlay regardless of odds', () => {
    const parlay = makeParsedBet({ bet_type: 'parlay', odds_american: -110 })
    expect(vigForParsedBet(parlay)).toBeNull()
  })

  it('returns null for a single bet (paste-parser provides only one side)', () => {
    // The paste-parser only captures one side of the line — two-sided vig
    // cannot be computed from a single ParsedBet. Honest display is '—'.
    const single = makeParsedBet({ bet_type: 'single', odds_american: -110 })
    expect(vigForParsedBet(single)).toBeNull()
  })

  it('returns null for a single bet with null odds', () => {
    const single = makeParsedBet({ bet_type: 'single', odds_american: null })
    expect(vigForParsedBet(single)).toBeNull()
  })
})
