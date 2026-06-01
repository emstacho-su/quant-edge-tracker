/**
 * grade-bet-contract.ts
 *
 * Shared TypeScript types, constants, and pure helpers for the grade_bet async
 * handoff between the Vercel cron (auto-settle.ts) and the quant-edge-runner
 * daemon's grade_bet task handler.
 *
 * Design constraints:
 *  - Self-contained: MUST NOT import from settle-logic.ts or auto-settle.ts.
 *    This allows the contract module to compile independently of Plan 18-03's
 *    progress, and lets the daemon repo replicate rather than import it.
 *  - Pure functions only: no I/O, no Supabase, no env vars.
 *  - Single source of truth for the pending_tasks kind string (GRADE_BET_KIND)
 *    and the AgentGradeResult shape — the cron enqueue (Plan 18-03) imports
 *    GRADE_BET_KIND; the daemon handler validates results with validateGradeResult.
 *
 * References:
 *  - auto-settle.ts lines 49–60: ledger-delta helper definitions (copied verbatim)
 *  - auto-settle.ts lines 153–158: cash-floor guard logic (encoded in wouldBreachCashFloor)
 *  - 18-RESEARCH.md §5: cron→daemon handoff pattern
 *  - 18-RESEARCH.md §7: agent investigation flow + structured grade shape
 *  - CLAUDE.md hard invariants: cash-floor never ≤ $0, ledger is source of truth
 */

// ─── pending_tasks kind constant ─────────────────────────────────────────────

/**
 * The `kind` value used when the Vercel cron inserts a grade_bet task into
 * `pending_tasks`. The daemon's handleTask switch must match on this literal.
 *
 * Single source of truth: Plan 18-03's enqueue should import this constant
 * rather than hardcoding the string 'grade_bet'.
 *
 * Usage (cron enqueue):
 *   import { GRADE_BET_KIND } from '../_lib/grade-bet-contract.js'
 *   await supabase.from('pending_tasks').insert({
 *     kind: GRADE_BET_KIND,
 *     payload: { bet_id: bet.id } satisfies GradeBetTaskPayload,
 *     status: 'queued',
 *   })
 *
 * Usage (daemon handler):
 *   case GRADE_BET_KIND: await handleGradeBet(task.payload as GradeBetTaskPayload); break
 */
export const GRADE_BET_KIND = 'grade_bet' as const

// ─── Task payload (cron → daemon) ────────────────────────────────────────────

/**
 * The JSON payload stored in pending_tasks.payload for a grade_bet task.
 *
 * Idempotency note: the daemon must fetch the live bet status before writing
 * any settlement. If bets.status !== 'pending', the task is complete — do NOT
 * write a ledger event (Pitfall 7: double-settlement on retry).
 */
export interface GradeBetTaskPayload {
  bet_id: string
}

// ─── Agent outcome types ──────────────────────────────────────────────────────

/**
 * The four settlement outcomes the grading agent may produce.
 *
 * Note: 'unable' is intentionally NOT included here. If the agent cannot
 * determine the correct grade, it should NOT return a result — instead it
 * should mark the task as failed/errored so it can be retried or escalated.
 * The agent's goal is the CORRECT grade, not a best guess (D-03).
 */
export type AgentOutcome = 'won' | 'lost' | 'push' | 'void'

/**
 * The structured grade the daemon agent returns after investigating the bet.
 *
 * This shape is validated by validateGradeResult before any settlement write.
 * The daemon must NOT proceed to write a settlement if validation fails (V5
 * input-validation gate, T-18-15 mitigant).
 *
 * Fields:
 *  - outcome: The graded result. 'void' is used for DNP players, MLB
 *    listed-pitcher changes, and postponed/cancelled games.
 *  - actual_value: The raw stat value extracted (e.g. 32 for "32 strikeouts"),
 *    or null if outcome was determined without a numeric value (e.g. void).
 *  - source: Human-readable description of where the grade came from
 *    (e.g. 'mlb_statsapi', 'espn_boxscore', 'websearch:boxscore').
 *    Must be non-empty — it is the audit trail entry (D-11).
 *  - confidence: 0–100 confidence score. Agent-derived grades that produce
 *    confidence < 80 should be surfaced prominently for spot-check (D-10).
 */
export interface AgentGradeResult {
  outcome: AgentOutcome
  actual_value: number | null
  source: string
  confidence: number
}

// ─── Input validation gate (V5) ──────────────────────────────────────────────

/**
 * Runtime shape check for AgentGradeResult.
 *
 * The daemon MUST call this before writing any settlement. An LLM-derived
 * grade must be validated against the bounded contract before it is allowed
 * to write real money outcomes (T-18-15: unbounded/malformed agent grade).
 *
 * Returns true only when:
 *  - x is a non-null, non-array object
 *  - outcome is one of the four valid AgentOutcome literals
 *  - actual_value is a finite number or null
 *  - source is a non-empty string
 *  - confidence is a finite number in [0, 100]
 */
export function validateGradeResult(x: unknown): x is AgentGradeResult {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false
  const obj = x as Record<string, unknown>

  const validOutcomes: readonly string[] = ['won', 'lost', 'push', 'void']
  if (!validOutcomes.includes(obj['outcome'] as string)) return false

  const av = obj['actual_value']
  if (av !== null && (typeof av !== 'number' || !isFinite(av))) return false

  if (typeof obj['source'] !== 'string' || obj['source'].length === 0) return false

  const conf = obj['confidence']
  if (typeof conf !== 'number' || !isFinite(conf) || conf < 0 || conf > 100) return false

  return true
}

// ─── Ledger-delta helpers (copied verbatim from auto-settle.ts lines 49–60) ──
//
// These are exported so the daemon can reference the canonical implementation
// in tests without importing from the Vercel layer. The daemon's grade_bet
// handler MUST replicate these exactly — copy, do not import.
//
// The test suite in grade-bet-contract.test.ts asserts that these produce the
// same results as the cron's functions for all (outcome × fp) combinations,
// ensuring both repos share an asserted contract.

/**
 * Compute the profit/loss amount recorded on the bet row.
 *
 * won  → toWin (win amount, not stake return)
 * lost → fp ? 0 : -stake  (FP stake consumed at placement; cash nets the loss)
 * push → 0  (stake returned via cashDelta for cash, via fpDelta for FP)
 * void → 0  (same ledger semantics as push for this helper)
 */
export function profitLoss(
  o: AgentOutcome,
  stake: number,
  toWin: number,
  fp: boolean,
): number {
  if (o === 'won') return toWin
  if (o === 'lost') return fp ? 0 : -stake
  return 0
}

/**
 * Compute the delta to the CASH bankroll_events entry for this settlement.
 *
 * FP bets: won → +toWin to cash (FP win pays cash); lost/push → 0 (no cash effect)
 * Cash bets: won → +toWin; lost → -stake; push → 0 (stake returns implicitly)
 * void: 0 for both FP and cash (stake is returned via a separate reversal or not counted)
 */
export function cashDelta(
  o: AgentOutcome,
  stake: number,
  toWin: number,
  fp: boolean,
): number {
  if (fp) return o === 'won' ? toWin : 0
  return o === 'won' ? toWin : o === 'lost' ? -stake : 0
}

/**
 * Compute the delta to the FREEPLAY bankroll_events entry for this settlement.
 *
 * Only FP bets produce an fpDelta — and only on push (stake returned to FP balance).
 * FP win goes to cash (cashDelta); FP lost stake was consumed at placement.
 */
export function fpDelta(o: AgentOutcome, stake: number, fp: boolean): number {
  return fp && o === 'push' ? stake : 0
}

// ─── Cash-floor gate (W3 agent-path fixture) ─────────────────────────────────

/**
 * Returns true when the proposed cashChange would drive the running cash
 * balance to ≤ $0 — the mandatory cash-floor guard for the agent settlement
 * path (T-18-13 mitigant, CLAUDE.md hard invariant #1).
 *
 * The daemon's grade_bet handler MUST call this before writing any bankroll_events
 * row for a losing cash bet. If it returns true:
 *  - DO NOT write the settlement
 *  - Set bets.grading_state back to 'needs-agent' (or 'needs-human')
 *  - Log for operator attention
 *
 * Mirrors auto-settle.ts lines 153–158:
 *   if (cashChange < 0 && runningCash + cashChange <= 0) → skip
 *
 * @param runningCash  The current cash balance (from latestBalance('cash'))
 * @param cashChange   The proposed delta (negative for a lost cash bet)
 * @returns            true = do NOT settle; false = safe to proceed
 */
export function wouldBreachCashFloor(
  runningCash: number,
  cashChange: number,
): boolean {
  return cashChange < 0 && runningCash + cashChange <= 0
}
