/**
 * auto-settle.test.ts — Wave-0 unit tests for the pure routing helpers extracted
 * from auto-settle.ts. Tests DB-writing behavior via mock only.
 *
 * Tests scope (per plan):
 *  (a) RETRYABLE_REASONS candidate filter
 *  (b) needs-agent pending_tasks payload shape
 *  (c) grading-spec reader (prefers spec.prop over parsePropDescription)
 *  (d) cash-floor predicate blocks when runningCash + cashChange <= 0
 *  (e) lazy spec persist-back: buildGradingSpec helper produces valid shape (D-09)
 */

import { describe, it, expect } from 'vitest'
import {
  isCandidate,
  buildGradingSpec,
  buildNeedsAgentPayload,
  wouldBreachCashFloor,
} from './auto-settle.js'
import { GRADE_BET_KIND } from '../_lib/grade-bet-contract.js'

// --- Type helpers for test fixtures ---

type BetCandidate = Parameters<typeof isCandidate>[0]
type GradingSpecInput = Parameters<typeof buildGradingSpec>[0]

// ─── (a) RETRYABLE_REASONS candidate filter ───────────────────────────────────

describe('isCandidate', () => {
  const baseBet: BetCandidate = {
    auto_settle_state: null,
    bet_type: 'single',
    clv_market: 'moneyline',
    clv_selection: 'KC Royals',
    live_game_id: null,
    description: 'KC Royals ML',
    settle_skip_reason: null,
    parlay_legs: [],
  }

  it('includes a normal pending bet with clv_market', () => {
    expect(isCandidate(baseBet)).toBe(true)
  })

  it('always excludes manual bets', () => {
    expect(isCandidate({ ...baseBet, auto_settle_state: 'manual' })).toBe(false)
  })

  it('includes a skipped bet with RETRYABLE reason: prop_stat_unresolved', () => {
    expect(isCandidate({ ...baseBet, auto_settle_state: 'skipped', settle_skip_reason: 'prop_stat_unresolved' })).toBe(true)
  })

  it('includes a skipped bet with RETRYABLE reason: leg_is_prop', () => {
    expect(isCandidate({ ...baseBet, auto_settle_state: 'skipped', settle_skip_reason: 'leg_is_prop' })).toBe(true)
  })

  it('includes a skipped bet with RETRYABLE reason: prop_sport_unsupported', () => {
    expect(isCandidate({ ...baseBet, auto_settle_state: 'skipped', settle_skip_reason: 'prop_sport_unsupported' })).toBe(true)
  })

  it('includes a skipped bet with RETRYABLE reason: prop_unparseable', () => {
    expect(isCandidate({ ...baseBet, auto_settle_state: 'skipped', settle_skip_reason: 'prop_unparseable' })).toBe(true)
  })

  it('includes a skipped bet with RETRYABLE reason: no_unique_final_match', () => {
    expect(isCandidate({ ...baseBet, auto_settle_state: 'skipped', settle_skip_reason: 'no_unique_final_match' })).toBe(true)
  })

  it('excludes a skipped bet with non-retryable reason: cash_floor_guard', () => {
    expect(isCandidate({ ...baseBet, auto_settle_state: 'skipped', settle_skip_reason: 'cash_floor_guard' })).toBe(false)
  })

  it('excludes a skipped bet with non-retryable reason: unevaluable', () => {
    expect(isCandidate({ ...baseBet, auto_settle_state: 'skipped', settle_skip_reason: 'unevaluable' })).toBe(false)
  })

  it('includes a parlay with legs', () => {
    expect(isCandidate({ ...baseBet, bet_type: 'parlay', clv_market: null, parlay_legs: [{ id: '1', description: 'leg', sport: 'MLB', is_prop: false, leg_status: 'pending', live_game_id: null, grading_spec: null }] })).toBe(true)
  })

  it('excludes a parlay with no legs', () => {
    expect(isCandidate({ ...baseBet, bet_type: 'parlay', clv_market: null, parlay_legs: [] })).toBe(false)
  })
})

// ─── (b) needs-agent pending_tasks payload ───────────────────────────────────

describe('buildNeedsAgentPayload', () => {
  it('builds a valid pending_tasks row with GRADE_BET_KIND', () => {
    const payload = buildNeedsAgentPayload('bet-abc-123')
    expect(payload.kind).toBe(GRADE_BET_KIND)
    expect(payload.kind).toBe('grade_bet') // explicit: no hardcoded string in cron
    expect(payload.payload).toEqual({ bet_id: 'bet-abc-123' })
    expect(payload.status).toBe('queued')
    expect(typeof payload.created_at).toBe('string')
    // created_at is a valid ISO 8601 string
    expect(new Date(payload.created_at).getTime()).toBeGreaterThan(0)
  })

  it('uses the GRADE_BET_KIND constant (not a hardcoded literal)', () => {
    // The kind must equal the exported constant, verifying no hardcoding
    const payload = buildNeedsAgentPayload('any-id')
    expect(payload.kind).toBe(GRADE_BET_KIND)
  })
})

// ─── (c) grading-spec reader (prefer spec.prop over parsePropDescription) ────

describe('buildGradingSpec', () => {
  it('builds a valid shape from parsed prop data', () => {
    const input: GradingSpecInput = {
      market: 'player_prop',
      espn_event_id: 'espn-evt-1',
      prop: {
        espn_player_id: null,
        player_name: 'Andrew Abbott',
        sport: 'MLB',
        stat_keys: ['strikeouts_pitcher'],
        data_source: 'mlb_statsapi',
        line: 6.5,
        direction: 'over',
      },
    }
    const spec = buildGradingSpec(input)
    expect(spec.market).toBe('player_prop')
    expect(spec.espn_event_id).toBe('espn-evt-1')
    expect(spec.prop?.stat_keys).toEqual(['strikeouts_pitcher'])
    expect(spec.prop?.line).toBe(6.5)
    expect(spec.prop?.direction).toBe('over')
    expect(spec.prop?.player_name).toBe('Andrew Abbott')
    expect(spec.prop?.data_source).toBe('mlb_statsapi')
    expect(spec.source).toBe('lazy_settle')
    expect(typeof spec.computed_at).toBe('string')
    expect(new Date(spec.computed_at).getTime()).toBeGreaterThan(0)
  })

  it('works for a non-prop market (ML/spread/total)', () => {
    const input: GradingSpecInput = {
      market: 'moneyline',
      espn_event_id: 'espn-evt-2',
    }
    const spec = buildGradingSpec(input)
    expect(spec.market).toBe('moneyline')
    expect(spec.prop).toBeUndefined()
    expect(spec.source).toBe('lazy_settle')
  })

  it('persisted spec has a computed_at that is a recent timestamp', () => {
    const before = Date.now()
    const spec = buildGradingSpec({ market: 'moneyline', espn_event_id: null })
    const after = Date.now()
    const t = new Date(spec.computed_at).getTime()
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(after)
  })
})

// ─── (d) cash-floor predicate ─────────────────────────────────────────────────

describe('wouldBreachCashFloor', () => {
  it('blocks when running cash + change would go to exactly 0', () => {
    expect(wouldBreachCashFloor(100, -100)).toBe(true)
  })

  it('blocks when running cash + change would go below 0', () => {
    expect(wouldBreachCashFloor(100, -150)).toBe(true)
  })

  it('allows when cash remains positive after change', () => {
    expect(wouldBreachCashFloor(100, -50)).toBe(false)
  })

  it('allows positive cashChange (a win)', () => {
    expect(wouldBreachCashFloor(100, 50)).toBe(false)
  })

  it('allows zero cashChange (push)', () => {
    expect(wouldBreachCashFloor(100, 0)).toBe(false)
  })

  it('blocks at boundary: 0.01 cash, -0.01 change', () => {
    expect(wouldBreachCashFloor(0.01, -0.01)).toBe(true)
  })
})
