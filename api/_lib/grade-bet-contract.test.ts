import { describe, it, expect } from 'vitest'
import {
  GRADE_BET_KIND,
  validateGradeResult,
  cashDelta,
  fpDelta,
  profitLoss,
  wouldBreachCashFloor,
  type GradeBetTaskPayload,
  type AgentGradeResult,
  type AgentOutcome,
} from './grade-bet-contract.js'

// ─── GRADE_BET_KIND constant ────────────────────────────────────────────────

describe('GRADE_BET_KIND', () => {
  it('is the literal string grade_bet', () => {
    expect(GRADE_BET_KIND).toBe('grade_bet')
  })
  it('is the correct pending_tasks kind value', () => {
    // The cron enqueue inserts: pending_tasks { kind: GRADE_BET_KIND, payload: { bet_id } }
    // This ensures no typo divergence between the cron and the daemon handler.
    expect(typeof GRADE_BET_KIND).toBe('string')
    expect(GRADE_BET_KIND).toStrictEqual('grade_bet')
  })
})

// ─── GradeBetTaskPayload shape (compile-time contract) ─────────────────────

describe('GradeBetTaskPayload', () => {
  it('accepts a valid payload with bet_id string', () => {
    const payload: GradeBetTaskPayload = { bet_id: 'abc-123' }
    expect(payload.bet_id).toBe('abc-123')
  })
})

// ─── validateGradeResult ────────────────────────────────────────────────────

describe('validateGradeResult', () => {
  const valid: AgentGradeResult = {
    outcome: 'won',
    actual_value: 32.5,
    source: 'mlb_statsapi',
    confidence: 95,
  }

  it('accepts a well-formed AgentGradeResult', () => {
    expect(validateGradeResult(valid)).toBe(true)
  })

  it('accepts all valid outcome values', () => {
    const outcomes: AgentOutcome[] = ['won', 'lost', 'push', 'void']
    for (const outcome of outcomes) {
      expect(validateGradeResult({ ...valid, outcome })).toBe(true)
    }
  })

  it('accepts actual_value of null (stat not found but outcome determined)', () => {
    expect(validateGradeResult({ ...valid, actual_value: null })).toBe(true)
  })

  it('accepts confidence at the boundary values 0 and 100', () => {
    expect(validateGradeResult({ ...valid, confidence: 0 })).toBe(true)
    expect(validateGradeResult({ ...valid, confidence: 100 })).toBe(true)
  })

  // Rejection cases — the V5 input-validation gate: daemon checks these before settling

  it('rejects missing outcome (undefined)', () => {
    const bad = { actual_value: 10, source: 'espn', confidence: 80 }
    expect(validateGradeResult(bad)).toBe(false)
  })

  it('rejects unknown outcome string', () => {
    expect(validateGradeResult({ ...valid, outcome: 'cancelled' })).toBe(false)
    expect(validateGradeResult({ ...valid, outcome: 'unable' })).toBe(false)
    expect(validateGradeResult({ ...valid, outcome: '' })).toBe(false)
  })

  it('rejects confidence below 0', () => {
    expect(validateGradeResult({ ...valid, confidence: -1 })).toBe(false)
  })

  it('rejects confidence above 100', () => {
    expect(validateGradeResult({ ...valid, confidence: 101 })).toBe(false)
  })

  it('rejects non-finite confidence (NaN, Infinity)', () => {
    expect(validateGradeResult({ ...valid, confidence: NaN })).toBe(false)
    expect(validateGradeResult({ ...valid, confidence: Infinity })).toBe(false)
  })

  it('rejects empty source string', () => {
    expect(validateGradeResult({ ...valid, source: '' })).toBe(false)
  })

  it('rejects non-string source', () => {
    expect(validateGradeResult({ ...valid, source: 42 })).toBe(false)
  })

  it('rejects null input', () => {
    expect(validateGradeResult(null)).toBe(false)
  })

  it('rejects non-object input (string, number, array)', () => {
    expect(validateGradeResult('grade_bet')).toBe(false)
    expect(validateGradeResult(42)).toBe(false)
    expect(validateGradeResult([])).toBe(false)
  })

  it('rejects missing confidence field', () => {
    const { confidence: _, ...noConf } = valid
    expect(validateGradeResult(noConf)).toBe(false)
  })

  it('rejects missing source field', () => {
    const { source: _, ...noSrc } = valid
    expect(validateGradeResult(noSrc)).toBe(false)
  })
})

// ─── profitLoss (mirrors auto-settle.ts lines 49–52) ───────────────────────

describe('profitLoss', () => {
  describe('cash bet (fp = false)', () => {
    it('won → returns toWin', () => {
      expect(profitLoss('won', 100, 91, false)).toBe(91)
    })
    it('lost → returns -stake', () => {
      expect(profitLoss('lost', 100, 91, false)).toBe(-100)
    })
    it('push → returns 0', () => {
      expect(profitLoss('push', 100, 91, false)).toBe(0)
    })
    it('void → returns 0 (same as push for ledger purposes)', () => {
      expect(profitLoss('void', 100, 91, false)).toBe(0)
    })
  })

  describe('freeplay bet (fp = true)', () => {
    it('won → returns toWin (freeplay wins pay the win amount)', () => {
      expect(profitLoss('won', 25, 23, true)).toBe(23)
    })
    it('lost → returns 0 (freeplay lost = stake consumed at placement, no additional loss)', () => {
      expect(profitLoss('lost', 25, 23, true)).toBe(0)
    })
    it('push → returns 0', () => {
      expect(profitLoss('push', 25, 23, true)).toBe(0)
    })
  })
})

// ─── cashDelta (mirrors auto-settle.ts lines 54–57) ─────────────────────────

describe('cashDelta', () => {
  describe('cash bet (fp = false)', () => {
    it('won → +toWin', () => {
      expect(cashDelta('won', 100, 91, false)).toBe(91)
    })
    it('lost → -stake', () => {
      expect(cashDelta('lost', 100, 91, false)).toBe(-100)
    })
    it('push → 0', () => {
      expect(cashDelta('push', 100, 91, false)).toBe(0)
    })
    it('void → 0', () => {
      expect(cashDelta('void', 100, 91, false)).toBe(0)
    })
  })

  describe('freeplay bet (fp = true)', () => {
    it('won → +toWin (FP win pays cash)', () => {
      expect(cashDelta('won', 25, 23, true)).toBe(23)
    })
    it('lost → 0 (FP loss does not affect cash)', () => {
      expect(cashDelta('lost', 25, 23, true)).toBe(0)
    })
    it('push → 0 (FP push handled via fpDelta, not cashDelta)', () => {
      expect(cashDelta('push', 25, 23, true)).toBe(0)
    })
  })
})

// ─── fpDelta (mirrors auto-settle.ts lines 59–60) ───────────────────────────

describe('fpDelta', () => {
  it('fp push → returns stake back to FP balance', () => {
    expect(fpDelta('push', 25, true)).toBe(25)
  })
  it('fp won → 0 (FP win goes to cash via cashDelta)', () => {
    expect(fpDelta('won', 25, true)).toBe(0)
  })
  it('fp lost → 0 (FP stake consumed at placement)', () => {
    expect(fpDelta('lost', 25, true)).toBe(0)
  })
  it('cash push → 0 (push on cash returns stake via cashDelta = 0, no FP effect)', () => {
    expect(fpDelta('push', 100, false)).toBe(0)
  })
  it('cash won → 0', () => {
    expect(fpDelta('won', 100, false)).toBe(0)
  })
  it('cash lost → 0', () => {
    expect(fpDelta('lost', 100, false)).toBe(0)
  })
})

// ─── wouldBreachCashFloor — W3 agent-path cash-floor gate ───────────────────
//
// The daemon must call this before writing any settlement. A losing grade that
// takes running cash ≤ $0 MUST NOT proceed — route to needs-agent/needs-human.
//
// Mirrors auto-settle.ts lines 153–158:
//   if (cashChange < 0 && runningCash + cashChange <= 0) → skip
//
// W3 test fixture: the daemon implementer can run these locally to verify
// their replication of the cash-floor check produces identical results.

describe('wouldBreachCashFloor (W3 agent-path fixture)', () => {
  // Exact $0 boundary — would drive cash to exactly $0 → blocked
  it('runningCash=50, cashChange=-50 → true (drives cash to exactly $0)', () => {
    expect(wouldBreachCashFloor(50, -50)).toBe(true)
  })

  // One dollar above floor → allowed
  it('runningCash=50, cashChange=-49 → false (cash stays at $1)', () => {
    expect(wouldBreachCashFloor(50, -49)).toBe(false)
  })

  // Winning grade never triggers the floor
  it('runningCash=50, cashChange=+120 → false (a win never breaches)', () => {
    expect(wouldBreachCashFloor(50, 120)).toBe(false)
  })

  // Deep loss below zero → blocked
  it('runningCash=50, cashChange=-200 → true (drives cash well below $0)', () => {
    expect(wouldBreachCashFloor(50, -200)).toBe(true)
  })

  // Already at $0 running cash — any negative change blocked
  it('runningCash=0, cashChange=-1 → true', () => {
    expect(wouldBreachCashFloor(0, -1)).toBe(true)
  })

  // No-change (push on cash bet) → never blocked
  it('runningCash=50, cashChange=0 → false (push produces no change)', () => {
    expect(wouldBreachCashFloor(50, 0)).toBe(false)
  })

  // Tiny positive running cash — only the exact floor case is blocked
  it('runningCash=0.01, cashChange=-0.01 → true (drives cash to exactly $0)', () => {
    expect(wouldBreachCashFloor(0.01, -0.01)).toBe(true)
  })

  it('runningCash=0.01, cashChange=-0.005 → false (cash stays positive)', () => {
    expect(wouldBreachCashFloor(0.01, -0.005)).toBe(false)
  })
})
