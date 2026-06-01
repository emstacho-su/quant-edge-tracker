/**
 * Tests for src/lib/kalshi-fee.ts (client copy).
 *
 * Mirrors api/_lib/line-shop/kalshi-fee.test.ts — identical coverage.
 * Both copies must have identical math; these tests enforce it.
 */

import { describe, it, expect } from 'vitest'
import {
  KALSHI_TAKER_MULT,
  KALSHI_MAKER_MULT,
  kalshiEffectiveImpliedProb,
  kalshiEffectiveDecimalOdds,
} from './kalshi-fee'

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('KALSHI_TAKER_MULT is 0.07', () => {
    expect(KALSHI_TAKER_MULT).toBe(0.07)
  })

  it('KALSHI_MAKER_MULT is 0.0175', () => {
    expect(KALSHI_MAKER_MULT).toBe(0.0175)
  })
})

// ─── kalshiEffectiveImpliedProb ───────────────────────────────────────────────

describe('kalshiEffectiveImpliedProb', () => {
  it('P=0.10 → P_eff matches formula P + 0.07*P*(1-P)', () => {
    const p = 0.10
    const expected = p + 0.07 * p * (1 - p)
    expect(kalshiEffectiveImpliedProb(p)).toBeCloseTo(expected, 10)
    expect(kalshiEffectiveImpliedProb(p)).toBeCloseTo(0.1063, 6)
  })

  it('P=0.50 → P_eff = 0.5175 exactly', () => {
    const result = kalshiEffectiveImpliedProb(0.50)
    expect(result).toBe(0.5175)
  })

  it('P=0.90 → P_eff matches formula', () => {
    const p = 0.90
    const expected = p + 0.07 * p * (1 - p)
    expect(kalshiEffectiveImpliedProb(p)).toBeCloseTo(expected, 10)
    expect(kalshiEffectiveImpliedProb(p)).toBeCloseTo(0.9063, 6)
  })

  it('identity at P=0 (no fee)', () => {
    expect(kalshiEffectiveImpliedProb(0)).toBe(0)
  })

  it('identity at P=1 (no fee)', () => {
    expect(kalshiEffectiveImpliedProb(1)).toBe(1)
  })

  it('symmetry: feeImpact(p) === feeImpact(1-p)', () => {
    const p = 0.30
    const feeP = kalshiEffectiveImpliedProb(p) - p
    const feeQ = kalshiEffectiveImpliedProb(1 - p) - (1 - p)
    expect(feeP).toBeCloseTo(feeQ, 10)
  })

  it('symmetry at P=0.25 vs P=0.75', () => {
    const p = 0.25
    const feeP = kalshiEffectiveImpliedProb(p) - p
    const feeQ = kalshiEffectiveImpliedProb(1 - p) - (1 - p)
    expect(feeP).toBeCloseTo(feeQ, 10)
  })

  it('maker variant at P=0.5 returns 0.504375', () => {
    const result = kalshiEffectiveImpliedProb(0.5, 'maker')
    expect(result).toBeCloseTo(0.504375, 8)
  })

  it('negative P returns P unchanged (guard)', () => {
    expect(kalshiEffectiveImpliedProb(-0.1)).toBe(-0.1)
  })

  it('P > 1 returns P unchanged (guard)', () => {
    expect(kalshiEffectiveImpliedProb(1.1)).toBe(1.1)
  })
})

// ─── kalshiEffectiveDecimalOdds ───────────────────────────────────────────────

describe('kalshiEffectiveDecimalOdds', () => {
  it('decimal=2.0 (P=0.50) → ~1.9323671497584541', () => {
    const result = kalshiEffectiveDecimalOdds(2.0)
    expect(result).toBeCloseTo(1.9323671497584541, 6)
  })

  it('decimal=10.0 (P=0.10) → ~9.41', () => {
    const result = kalshiEffectiveDecimalOdds(10.0)
    expect(result).toBeCloseTo(1 / 0.1063, 4)
  })

  it('decimal↔implied roundtrip consistency', () => {
    const d = 2.0
    const adjustedDecimal = kalshiEffectiveDecimalOdds(d)
    const impliedFromAdjusted = 1 / adjustedDecimal
    const directAdjusted = kalshiEffectiveImpliedProb(1 / d)
    expect(impliedFromAdjusted).toBeCloseTo(directAdjusted, 10)
  })

  it('decimal=1 returns 1 unchanged (guard)', () => {
    expect(kalshiEffectiveDecimalOdds(1)).toBe(1)
  })

  it('decimal < 1 returns unchanged (guard)', () => {
    expect(kalshiEffectiveDecimalOdds(0.9)).toBe(0.9)
  })

  it('fee reduces decimal odds (adjusted decimal < raw decimal)', () => {
    const raw = 3.0
    const adjusted = kalshiEffectiveDecimalOdds(raw)
    expect(adjusted).toBeLessThan(raw)
  })

  it('maker variant produces smaller adjustment than taker', () => {
    const d = 2.0
    const taker = kalshiEffectiveDecimalOdds(d, 'taker')
    const maker = kalshiEffectiveDecimalOdds(d, 'maker')
    expect(taker).toBeLessThan(maker)
    expect(maker).toBeLessThan(d)
  })
})
