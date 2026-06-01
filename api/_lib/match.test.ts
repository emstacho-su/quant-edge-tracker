import { describe, it, expect } from 'vitest'
import { matchScore, findOutcome, findOutcomeNearestPoint } from './match.js'

describe('matchScore', () => {
  it('counts shared significant tokens (3+ chars)', () => {
    expect(matchScore('Baltimore Orioles', 'BAL Orioles')).toBeGreaterThanOrEqual(1)
    expect(matchScore('Tampa Bay Rays', 'BAL Orioles')).toBe(0)
  })
})

describe('findOutcome', () => {
  const outcomes = [
    { name: 'Baltimore Orioles', point: 1.5, price: -170 },
    { name: 'Tampa Bay Rays', point: -1.5, price: 145 },
  ]
  it('finds the exact-point match', () => {
    const r = findOutcome(outcomes, 'BAL Orioles', 1.5)
    expect(r?.you.name).toBe('Baltimore Orioles')
    expect(r?.others).toHaveLength(1)
  })
  it('returns null when the point does not match', () => {
    expect(findOutcome(outcomes, 'BAL Orioles', -1.5)).toBeNull()
  })
})

describe('findOutcomeNearestPoint', () => {
  it('exact match takes precedence', () => {
    const outcomes = [
      { name: 'Oklahoma City Thunder', point: -4, price: 100 },
      { name: 'San Antonio Spurs', point: 4, price: -110 },
      { name: 'Oklahoma City Thunder', point: -5, price: 130 },
      { name: 'San Antonio Spurs', point: 5, price: -145 },
    ]
    const r = findOutcomeNearestPoint(outcomes, 'OKC Thunder', -5)
    expect(r?.pointUsed).toBe(-5)
    expect(r?.you.price).toBe(130)
  })

  it('falls back to the nearest point when exact is missing', () => {
    // Real prod scenario: bet placed at -5; line moved to -4.
    const outcomes = [
      { name: 'Oklahoma City Thunder', point: -4, price: -110 },
      { name: 'San Antonio Spurs', point: 4, price: -110 },
    ]
    const r = findOutcomeNearestPoint(outcomes, 'OKC Thunder', -5)
    expect(r?.pointUsed).toBe(-4)
    expect(r?.you.name).toBe('Oklahoma City Thunder')
    expect(r?.others[0].name).toBe('San Antonio Spurs')
  })

  it('picks the closer half-point when two near alternates exist', () => {
    const outcomes = [
      { name: 'Oklahoma City Thunder', point: -4, price: -110 },
      { name: 'San Antonio Spurs', point: 4, price: -110 },
      { name: 'Oklahoma City Thunder', point: -4.5, price: -120 },
      { name: 'San Antonio Spurs', point: 4.5, price: 100 },
    ]
    // Bet at -5; -4.5 is closer than -4
    const r = findOutcomeNearestPoint(outcomes, 'OKC Thunder', -5)
    expect(r?.pointUsed).toBe(-4.5)
  })

  it('returns null when nothing name-matches', () => {
    const outcomes = [
      { name: 'Baltimore Orioles', point: 1.5, price: -170 },
    ]
    expect(findOutcomeNearestPoint(outcomes, 'OKC Thunder', -5)).toBeNull()
  })

  it('returns null when siblings at the chosen point are missing', () => {
    // Pathological: only one outcome, no sibling — can't de-vig.
    const outcomes = [
      { name: 'Oklahoma City Thunder', point: -4, price: -110 },
    ]
    expect(findOutcomeNearestPoint(outcomes, 'OKC Thunder', -5)).toBeNull()
  })
})
