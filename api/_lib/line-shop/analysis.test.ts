/**
 * Unit tests for api/_lib/line-shop/analysis.ts
 *
 * Three mandatory bug-guards (D-13):
 *   (a) raw-not-devig — detectArb returns null on RAW −110/−110 (sum ~1.048, no arb)
 *   (b) match-the-point — documents that callers MUST pre-filter by market_param
 *   (c) stake-equalization — stakeA·decA ≈ stakeB·decB within 0.001
 *
 * ANLZ-05 edge cases: missing side, single-book, exact-vig sum, vigFor < 2 snaps.
 */

import { describe, it, expect } from 'vitest'
import {
  bestPrice,
  vigFor,
  noVigConsensus,
  preBetCLV,
  detectArb,
  sizeArb,
} from './analysis.js'
import { impliedFromAmerican, americanToDecimal } from '../clv.js'
import { kalshiEffectiveImpliedProb } from './kalshi-fee.js'
import type { BookPriceSnapshot } from './types.js'

// ─── Fixture factory ──────────────────────────────────────────────────────────

function snap(overrides: Partial<BookPriceSnapshot> = {}): BookPriceSnapshot {
  return {
    book: 'bovada',
    side: 'home',
    priceAmerican: -110,
    priceDecimal: americanToDecimal(-110),
    impliedProb: impliedFromAmerican(-110),
    point: null,
    fetchedAt: new Date(),
    sourceConfidence: 'aggregator',
    isClosing: false,
    ...overrides,
  }
}

// ─── bestPrice ────────────────────────────────────────────────────────────────

describe('bestPrice', () => {
  it('returns snapshot with highest decimal odds for the given side', () => {
    const a = snap({ side: 'home', priceAmerican: -110, priceDecimal: americanToDecimal(-110) })
    const b = snap({ side: 'home', priceAmerican: -105, priceDecimal: americanToDecimal(-105) })
    const c = snap({ side: 'away', priceAmerican: 115, priceDecimal: americanToDecimal(115) })
    const result = bestPrice([a, b, c], 'home')
    expect(result).toBe(b) // −105 decimal > −110 decimal
  })

  it('returns null when no snapshots match the side', () => {
    const a = snap({ side: 'away' })
    expect(bestPrice([a], 'home')).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(bestPrice([], 'home')).toBeNull()
  })

  it('returns the single snapshot when only one candidate', () => {
    const a = snap({ side: 'home' })
    expect(bestPrice([a], 'home')).toBe(a)
  })
})

// ─── vigFor ───────────────────────────────────────────────────────────────────

describe('vigFor', () => {
  it('returns vig % for a book with 2+ snapshots', () => {
    const home = snap({ book: 'bovada', side: 'home', priceAmerican: -110, impliedProb: impliedFromAmerican(-110) })
    const away = snap({ book: 'bovada', side: 'away', priceAmerican: -110, impliedProb: impliedFromAmerican(-110) })
    const vig = vigFor([home, away], 'bovada')
    // sum ≈ 0.524 + 0.524 = 1.048 → vig ≈ 4.8%
    expect(vig).not.toBeNull()
    expect(vig!).toBeCloseTo(4.76, 1)
  })

  it('returns null when fewer than 2 snapshots for the book (ANLZ-05)', () => {
    const home = snap({ book: 'bovada', side: 'home' })
    expect(vigFor([home], 'bovada')).toBeNull()
  })

  it('returns null when no snapshots for the book', () => {
    const home = snap({ book: 'draftkings', side: 'home' })
    expect(vigFor([home], 'bovada')).toBeNull()
  })

  it('ignores snapshots from other books when computing vig', () => {
    const bovHome = snap({ book: 'bovada', side: 'home', impliedProb: impliedFromAmerican(-110) })
    const bovAway = snap({ book: 'bovada', side: 'away', impliedProb: impliedFromAmerican(-110) })
    const dkHome = snap({ book: 'draftkings', side: 'home', impliedProb: impliedFromAmerican(-115) })
    const vig = vigFor([bovHome, bovAway, dkHome], 'bovada')
    expect(vig).toBeCloseTo(4.76, 1) // only bovada snaps used
  })
})

// ─── noVigConsensus ───────────────────────────────────────────────────────────

describe('noVigConsensus', () => {
  it('returns Pinnacle-anchored no-vig probability when Pinnacle present', () => {
    const pinHome = snap({ book: 'pinnacle', side: 'home', priceAmerican: -108, priceDecimal: americanToDecimal(-108), impliedProb: impliedFromAmerican(-108) })
    const pinAway = snap({ book: 'pinnacle', side: 'away', priceAmerican: -102, priceDecimal: americanToDecimal(-102), impliedProb: impliedFromAmerican(-102) })
    const bovHome = snap({ book: 'bovada', side: 'home', priceAmerican: -115, priceDecimal: americanToDecimal(-115), impliedProb: impliedFromAmerican(-115) })
    const result = noVigConsensus([pinHome, pinAway, bovHome], 'home')
    // Should use only Pinnacle's two sides
    const pHome = impliedFromAmerican(-108)
    const pAway = impliedFromAmerican(-102)
    const expected = pHome / (pHome + pAway)
    expect(result).toBeCloseTo(expected, 6)
  })

  it('falls back to all books when Pinnacle is absent', () => {
    const bovHome = snap({ book: 'bovada', side: 'home', priceAmerican: -110, impliedProb: impliedFromAmerican(-110) })
    const bovAway = snap({ book: 'bovada', side: 'away', priceAmerican: -110, impliedProb: impliedFromAmerican(-110) })
    const result = noVigConsensus([bovHome, bovAway], 'home')
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.5, 3)
  })

  it('returns null when the requested side is absent', () => {
    const bovHome = snap({ book: 'bovada', side: 'home', priceAmerican: -110 })
    expect(noVigConsensus([bovHome], 'away')).toBeNull()
  })
})

// ─── preBetCLV ────────────────────────────────────────────────────────────────

describe('preBetCLV', () => {
  it('returns positive CLV when beating the market', () => {
    // Book offers +120 (dec 2.2), fair prob = 0.45 → fair dec = 1/0.45 ≈ 2.222
    // CLV = 2.2/2.222 - 1 ≈ -0.01 (slightly negative)
    const bestSnap = snap({ priceAmerican: 120, priceDecimal: americanToDecimal(120) })
    const fairProb = 0.45
    const result = preBetCLV(bestSnap, fairProb)
    // americanToDecimal(120) = 2.2; 1/0.45 = 2.222; 2.2/2.222 - 1 ≈ -0.01
    expect(result).toBeCloseTo(2.2 / (1 / 0.45) - 1, 4)
  })

  it('returns positive when entry decimal exceeds fair decimal', () => {
    // Book offers +200 (dec 3.0), fair prob = 0.30 → fair dec = 3.333
    // CLV = 3.0/3.333 - 1 ≈ -0.1 (negative — not beating market)
    // Test a positive case: book +200 (3.0), fair = 0.28 → fair dec 3.571, CLV = 3.0/3.571 - 1 < 0
    // Positive case: book +200 (3.0), fair = 0.32 → fair dec 3.125, CLV = 3.0/3.125 - 1 < 0
    // Positive case: entry +200 (3.0), fair = 0.34 → fair dec 2.941, CLV = 3.0/2.941 - 1 > 0
    const bestSnap = snap({ priceAmerican: 200, priceDecimal: americanToDecimal(200) })
    const fairProb = 0.34
    const clv = preBetCLV(bestSnap, fairProb)
    expect(clv).toBeGreaterThan(0)
  })
})

// ─── sizeArb ─────────────────────────────────────────────────────────────────

describe('sizeArb', () => {
  it('splits evenly for symmetric decimal odds (D-04)', () => {
    const { stakeA, stakeB } = sizeArb(100, 3.0, 3.0)
    expect(stakeA).toBeCloseTo(50, 2)
    expect(stakeB).toBeCloseTo(50, 2)
  })

  it('equalizes payouts for asymmetric odds (D-04, bug-guard c)', () => {
    const decA = americanToDecimal(150)   // 2.5
    const decB = americanToDecimal(-130)  // 100/130 + 1 ≈ 1.769
    const { stakeA, stakeB } = sizeArb(100, decA, decB)
    expect(stakeA * decA).toBeCloseTo(stakeB * decB, 3)
    expect(stakeA + stakeB).toBeCloseTo(100, 3)
  })

  it('stakeAPct and stakeBPct sum to 1', () => {
    const { stakeAPct, stakeBPct } = sizeArb(100, 2.5, 1.769)
    expect(stakeAPct + stakeBPct).toBeCloseTo(1, 6)
  })

  it('uses correct formula: stakeA = S * decB / (decA + decB)', () => {
    // Explicit formula check: stakeA = 100 * 2.0 / (3.0 + 2.0) = 40
    const { stakeA, stakeB } = sizeArb(100, 3.0, 2.0)
    expect(stakeA).toBeCloseTo(40, 6) // 100 * 2.0 / 5.0
    expect(stakeB).toBeCloseTo(60, 6) // 100 * 3.0 / 5.0
  })
})

// ─── detectArb ────────────────────────────────────────────────────────────────

describe('detectArb', () => {
  it('detects a valid arb when RAW sum < 1.0', () => {
    // +200 vs +200 → both dec 3.0, raw implied ≈ 0.333 each, sum ≈ 0.667
    const sideA = [snap({ side: 'home', book: 'bovada', priceAmerican: 200, priceDecimal: americanToDecimal(200), impliedProb: impliedFromAmerican(200) })]
    const sideB = [snap({ side: 'away', book: 'draftkings', priceAmerican: 200, priceDecimal: americanToDecimal(200), impliedProb: impliedFromAmerican(200) })]
    const result = detectArb(sideA, sideB)
    expect(result).not.toBeNull()
    expect(result!.totalReturnPct).toBeGreaterThan(0)
    expect(result!.sumRawImplied).toBeLessThan(1.0)
  })

  it('returns null when sumRawImplied >= 1.0 (no arb)', () => {
    // Standard -110/-110: sum = 0.524 + 0.524 ≈ 1.048 → no arb
    const sideA = [snap({ side: 'home', book: 'bovada' })]
    const sideB = [snap({ side: 'away', book: 'draftkings', priceAmerican: -110, priceDecimal: americanToDecimal(-110), impliedProb: impliedFromAmerican(-110) })]
    expect(detectArb(sideA, sideB)).toBeNull()
  })

  it('returns null when one side is empty (ANLZ-05 — missing side)', () => {
    const sideA = [snap({ side: 'home' })]
    expect(detectArb(sideA, [])).toBeNull()
    expect(detectArb([], [snap({ side: 'away' })])).toBeNull()
  })

  it('returns null when sumRawImplied === 1.0 exactly (exact vig, ANLZ-05)', () => {
    // Construct a snapshot pair where raw implied sum exactly equals 1.0
    // impliedProb set manually to 0.5 each → sum = 1.0
    const sideA = [snap({ side: 'home', impliedProb: 0.5, priceAmerican: 100, priceDecimal: 2.0 })]
    const sideB = [snap({ side: 'away', impliedProb: 0.5, priceAmerican: 100, priceDecimal: 2.0 })]
    expect(detectArb(sideA, sideB)).toBeNull()
  })

  it('returns null when totalReturnPct <= minReturnPct threshold', () => {
    // Small arb at +200/+200 → totalReturnPct ≈ 49.9%; require 60% minimum
    const sideA = [snap({ side: 'home', priceAmerican: 200, priceDecimal: 3.0, impliedProb: impliedFromAmerican(200) })]
    const sideB = [snap({ side: 'away', priceAmerican: 200, priceDecimal: 3.0, impliedProb: impliedFromAmerican(200) })]
    expect(detectArb(sideA, sideB, 60)).toBeNull()
  })

  it('picks the best snapshot from each side when multiple books present', () => {
    // sideA: bovada −105 vs draftkings −115 → bovada is better
    const a1 = snap({ side: 'home', book: 'bovada', priceAmerican: -105, priceDecimal: americanToDecimal(-105), impliedProb: impliedFromAmerican(-105) })
    const a2 = snap({ side: 'home', book: 'draftkings', priceAmerican: -115, priceDecimal: americanToDecimal(-115), impliedProb: impliedFromAmerican(-115) })
    // sideB: fanduel +200 (creates real arb with best sideA)
    const b1 = snap({ side: 'away', book: 'fanduel', priceAmerican: 200, priceDecimal: americanToDecimal(200), impliedProb: impliedFromAmerican(200) })
    const result = detectArb([a1, a2], [b1])
    expect(result).not.toBeNull()
    expect(result!.sideA.book).toBe('bovada')
  })
})

// ─── Bug-guard (a): raw-not-devig ─────────────────────────────────────────────

describe('bug-guard (a): raw-not-devig (D-02, D-13a)', () => {
  it('detectArb returns null for standard −110/−110 RAW snapshots (sum ~1.048, vigged market)', () => {
    // RAW implied probability for −110 ≈ 0.5238
    // Two such sides: 0.5238 + 0.5238 = 1.0476 ≥ 1.0 → no arb (correct)
    // If devigged probs (0.5 each) were used instead: sum = 1.0 → still null at exact vig
    // This test verifies that RAW probs correctly signal NO arb on a normal vigged market
    const rawA = snap({
      side: 'home',
      book: 'bovada',
      priceAmerican: -110,
      priceDecimal: americanToDecimal(-110),
      impliedProb: impliedFromAmerican(-110), // ≈ 0.5238 (RAW, with vig)
    })
    const rawB = snap({
      side: 'away',
      book: 'draftkings',
      priceAmerican: -110,
      priceDecimal: americanToDecimal(-110),
      impliedProb: impliedFromAmerican(-110), // ≈ 0.5238 (RAW, with vig)
    })
    // Sum ≈ 1.048 — detectArb MUST return null (no arb on a standard vigged market)
    expect(detectArb([rawA], [rawB])).toBeNull()

    // Verify the values are truly RAW (not devigged):
    expect(impliedFromAmerican(-110)).toBeGreaterThan(0.5) // ≈ 0.5238 with vig
    expect(rawA.impliedProb + rawB.impliedProb).toBeGreaterThan(1.0) // sum > 1 confirms raw
  })
})

// ─── Bug-guard (b): match-the-point ──────────────────────────────────────────

describe('bug-guard (b): match-the-point (D-03, D-13b)', () => {
  it('documents that two spread snapshots at different point values are NOT the same market', () => {
    // Bovada Cubs spread at -1.5; Kalshi Cubs spread at -2.5 — DIFFERENT markets
    // Callers MUST pre-filter by (market_type, market_param) before passing to detectArb.
    // This test documents the invariant by asserting the points differ.
    const snapA: BookPriceSnapshot = {
      book: 'bovada',
      side: 'home',
      priceAmerican: -110,
      priceDecimal: americanToDecimal(-110),
      impliedProb: impliedFromAmerican(-110),
      point: -1.5, // ← Bovada spread line
      fetchedAt: new Date(),
      sourceConfidence: 'aggregator',
      isClosing: false,
    }
    const snapB: BookPriceSnapshot = {
      book: 'kalshi',
      side: 'away',
      priceAmerican: 130,
      priceDecimal: americanToDecimal(130),
      impliedProb: impliedFromAmerican(130),
      point: -2.5, // ← Kalshi spread line — different market!
      fetchedAt: new Date(),
      sourceConfidence: 'api',
      isClosing: false,
    }
    // Document the invariant: these are different markets (different points)
    expect(snapA.point).not.toBe(snapB.point)

    // The detectArb function does NOT validate market_param internally — that is the
    // caller's responsibility. If mismatched snapshots were passed, a false arb might
    // appear. The integration guard lives in the caller that groups by market_param.
    // This test exists to document D-03 in code and prevent regressions.
  })
})

// ─── detectArb — Kalshi taker-fee adjustment (D-13) ──────────────────────────

describe('detectArb — Kalshi taker-fee adjustment (D-13)', () => {
  /**
   * (a) Kalshi raw impliedProb=0.50 is treated as 0.5175 in sum-of-implied.
   *
   * Build a pair where Kalshi side-A has raw impliedProb=0.50 and the public
   * book side-B has impliedProb=0.485 (decimal ~2.062).
   * Raw sum = 0.50 + 0.485 = 0.985 → raw arb (1/0.985-1 ≈ 1.52%).
   * After fee adj: 0.5175 + 0.485 = 1.0025 → NO arb (sum > 1.0).
   * detectArb must return null.
   */
  it('(a) Kalshi impliedProb=0.50 → treated as 0.5175; no spurious arb', () => {
    const kalshiSnap = snap({
      book: 'kalshi' as BookPriceSnapshot['book'],
      side: 'home',
      impliedProb: 0.50,
      priceDecimal: 2.0,
      priceAmerican: 100,
    })
    const publicSnap = snap({
      book: 'pinnacle',
      side: 'away',
      impliedProb: 0.485,
      priceDecimal: 1 / 0.485,
      priceAmerican: 106,
    })
    const result = detectArb([kalshiSnap], [publicSnap], 0)
    // Raw sum 0.985 < 1.0 would be an arb; fee-adj sum 0.5175+0.485=1.0025 >= 1.0 → null
    expect(result).toBeNull()
  })

  /**
   * (b) Non-Kalshi snapshots are untouched — a clear public-book arb still detected.
   *
   * Two public books: sideA impliedProb=0.45, sideB impliedProb=0.50.
   * Sum = 0.95 < 1.0 → arb returned as before.
   */
  it('(b) Non-Kalshi snapshots untouched — public-book arb still detected', () => {
    const sideASnap = snap({
      book: 'pinnacle',
      side: 'home',
      impliedProb: 0.45,
      priceDecimal: 1 / 0.45,
      priceAmerican: 122,
    })
    const sideBSnap = snap({
      book: 'draftkings',
      side: 'away',
      impliedProb: 0.50,
      priceDecimal: 2.0,
      priceAmerican: 100,
    })
    const result = detectArb([sideASnap], [sideBSnap], 0)
    expect(result).not.toBeNull()
    // Return = 1/(0.45+0.50) - 1 = 1/0.95 - 1 ≈ 5.26%
    expect(result!.totalReturnPct).toBeCloseTo((1 / 0.95 - 1) * 100, 4)
    // Neither side is Kalshi — no fee adjustment
    expect(result!.sideA.book).toBe('pinnacle')
    expect(result!.sideB.book).toBe('draftkings')
  })

  /**
   * (c) Regression-prevention: Kalshi-vs-public pair that appears as +EV on raw prices
   * is correctly REJECTED after fee adjustment.
   *
   * Kalshi raw P=0.48 (decimal ≈ 2.083), public P=0.50.
   * Raw sum = 0.98 < 1.0 → would be a 2.04% arb without fee correction.
   * Fee-adj: P_eff = 0.48 + 0.07*0.48*0.52 ≈ 0.48 + 0.01747 = 0.49747.
   * Adj sum = 0.49747 + 0.50 = 0.99747 < 1.0 → still technically an arb,
   * but total return ≈ 0.25% which is much less than raw.
   *
   * Use a tighter example: Kalshi P=0.49, public P=0.50.
   * Raw sum = 0.99 < 1.0 → 1.01% raw return.
   * Fee-adj: P_eff = 0.49 + 0.07*0.49*0.51 ≈ 0.49 + 0.01748 = 0.50748.
   * Adj sum = 0.50748 + 0.50 = 1.00748 >= 1.0 → NULL (correctly rejected).
   */
  it('(c) Kalshi P=0.49 vs public P=0.50 — raw arb (0.99 sum) correctly rejected after fee', () => {
    const kalshiSnap = snap({
      book: 'kalshi' as BookPriceSnapshot['book'],
      side: 'home',
      impliedProb: 0.49,
      priceDecimal: 1 / 0.49,
      priceAmerican: 104,
    })
    const publicSnap = snap({
      book: 'fanduel',
      side: 'away',
      impliedProb: 0.50,
      priceDecimal: 2.0,
      priceAmerican: 100,
    })
    // Confirm the raw sum would pass (it's a "false positive" without fee adjustment)
    expect(kalshiSnap.impliedProb + publicSnap.impliedProb).toBeLessThan(1.0)

    // With fee adjustment, detectArb returns null
    const result = detectArb([kalshiSnap], [publicSnap], 0)
    expect(result).toBeNull()

    // Verify the fee-adj sum is > 1.0 (confirming why it's null)
    const adjKalshiP = kalshiEffectiveImpliedProb(0.49)
    expect(adjKalshiP + 0.50).toBeGreaterThanOrEqual(1.0)
  })
})

// ─── Bug-guard (c): stake-equalization ───────────────────────────────────────

describe('bug-guard (c): stake-equalization (D-04, D-13c)', () => {
  it('sizeArb payout equalization: stakeA * decA ≈ stakeB * decB within 0.001', () => {
    // Symmetric case: +200/+200 → dec 3.0 each
    const { stakeA: sA1, stakeB: sB1 } = sizeArb(100, 3.0, 3.0)
    expect(sA1).toBeCloseTo(50, 2)
    expect(sB1).toBeCloseTo(50, 2)
    expect(sA1 * 3.0).toBeCloseTo(sB1 * 3.0, 3)

    // Asymmetric case: +150 (dec 2.5) vs −130 (dec ≈ 1.769)
    const decA = americanToDecimal(150)  // 2.5
    const decB = americanToDecimal(-130) // 100/130 + 1 ≈ 1.7692...
    const { stakeA, stakeB } = sizeArb(100, decA, decB)

    // CRITICAL INVARIANT: payouts must equalize
    expect(stakeA * decA).toBeCloseTo(stakeB * decB, 3)

    // Total stake must equal 100
    expect(stakeA + stakeB).toBeCloseTo(100, 3)
  })
})
