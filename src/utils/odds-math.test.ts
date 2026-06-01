import { describe, it, expect } from 'vitest'
import { computeOddsFromToWin } from './odds-math'
import { computeToWin } from '@/hooks/use-bets'

describe('computeOddsFromToWin', () => {
  it('returns +150 for underdog (stake=100, toWin=150)', () => {
    expect(computeOddsFromToWin(100, 150)).toBe(150)
  })

  it('returns -200 for favorite (stake=100, toWin=50)', () => {
    expect(computeOddsFromToWin(100, 50)).toBe(-200)
  })

  it('returns +100 for even money (stake=100, toWin=100)', () => {
    expect(computeOddsFromToWin(100, 100)).toBe(100)
  })

  it('returns -220 for heavy favorite (stake=220, toWin=100)', () => {
    expect(computeOddsFromToWin(220, 100)).toBe(-220)
  })

  it('returns null for zero stake', () => {
    expect(computeOddsFromToWin(0, 100)).toBeNull()
  })

  it('returns null for zero return', () => {
    expect(computeOddsFromToWin(100, 0)).toBeNull()
  })

  it('round-trips with computeToWin: stake=100, toWin=150 → odds → toWin=150', () => {
    const odds = computeOddsFromToWin(100, 150)
    expect(odds).not.toBeNull()
    expect(computeToWin(100, odds!)).toBe(150)
  })
})
