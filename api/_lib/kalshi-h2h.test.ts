import { describe, it, expect } from 'vitest'
import { kalshiProbToAmerican, kalshiAskToAmerican } from './kalshi-h2h.js'

describe('kalshiProbToAmerican', () => {
  it('converts favorite probabilities to negative American', () => {
    // Pinnacle table: 0.67 → ~-203
    expect(kalshiProbToAmerican(0.67)).toBe(-203)
    // 50.5% → -102 (slight favorite)
    expect(kalshiProbToAmerican(0.505)).toBe(-102)
  })
  it('converts underdog probabilities to positive American', () => {
    // 0.47 → ~+113
    expect(kalshiProbToAmerican(0.47)).toBe(113)
    // 0.32 → +212 (raw 212.499… rounds down via JS Math.round)
    expect(kalshiProbToAmerican(0.32)).toBe(212)
  })
  it('returns null for invalid inputs', () => {
    expect(kalshiProbToAmerican(null)).toBeNull()
    expect(kalshiProbToAmerican(undefined)).toBeNull()
    expect(kalshiProbToAmerican(0)).toBeNull()
    expect(kalshiProbToAmerican(1)).toBeNull()
    expect(kalshiProbToAmerican(-0.1)).toBeNull()
    expect(kalshiProbToAmerican(1.1)).toBeNull()
    expect(kalshiProbToAmerican(Number.NaN)).toBeNull()
  })
  it('handles even-money edge case at 50%', () => {
    // 0.5 → -100 (just barely favorite due to >=0.5 branch)
    expect(kalshiProbToAmerican(0.5)).toBe(-100)
  })
})

describe('kalshiAskToAmerican (string form)', () => {
  it('parses Kalshi yes_ask_dollars strings', () => {
    expect(kalshiAskToAmerican('0.4700')).toBe(113)
    expect(kalshiAskToAmerican('0.6700')).toBe(-203)
  })
  it('returns null for empty / 0.0000', () => {
    expect(kalshiAskToAmerican('0.0000')).toBeNull()
    expect(kalshiAskToAmerican('')).toBeNull()
    expect(kalshiAskToAmerican(null)).toBeNull()
    expect(kalshiAskToAmerican(undefined)).toBeNull()
  })
})
