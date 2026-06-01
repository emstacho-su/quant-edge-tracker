/**
 * Shared types for the strategy tracker (Phase 05 — milestone).
 *
 * Mirrors the Supabase schema applied by
 * `.planning/phases/05-strategy-tracker/migrations/01-strategy-tracker-schema.sql`.
 *
 * Handwritten (not generated) because this project does not use a generated
 * db-types pipeline. When the schema changes, update this file by hand and
 * also mirror it into `quant-edge-runner/src/types/strategies.ts`
 * (package extraction is a future-milestone refactor — see PLAN W1.2).
 *
 * OutputSummary and related types are now derived from the Zod schema in
 * `./output-summary.schema.ts` (05-03 W1.3). The handwritten interfaces
 * have been removed to eliminate two-source drift.
 */

// Import Zod-derived types for use in this file's interfaces
import type { OutputSummary, AuditFinding } from './output-summary.schema.js'

// Re-export them so consumers can import from either location
export type { OutputSummary, AuditFinding }

// ---------------------------------------------------------------------------
// Status enum literals (match Postgres enum values 1:1)
// ---------------------------------------------------------------------------

export type StrategyStatus = 'active' | 'draft' | 'archived'

export type StrategyRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type StrategyRunTrigger = 'user' | 'cron-rerun'

export type StrategyAuditConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'n/a'

export type StrategyOutcomeSettlement =
  | 'pending'
  | 'won'
  | 'lost'
  | 'push'
  | 'void'

export type StrategyOptimizationStatus =
  | 'pending_review'
  | 'approved'
  | 'applying'
  | 'applied'
  | 'rejected'
  | 'failed_apply'

export type PendingTaskStatus = 'queued' | 'running' | 'completed' | 'failed'

// ---------------------------------------------------------------------------
// Table row types
// ---------------------------------------------------------------------------

export interface Strategy {
  id: string
  slug: string
  name: string
  description: string | null
  sport: string
  status: StrategyStatus
  current_git_sha: string | null
  overview_md?: string | null   // Phase 20 — nullable overview markdown
  created_at: string
  updated_at: string
}

export interface StrategyRun {
  id: string
  strategy_id: string
  strategy_version_sha: string | null
  status: StrategyRunStatus
  triggered_by: StrategyRunTrigger
  input_lines_raw: string | null
  input_meta: InputMeta
  output_md: string | null
  output_summary: OutputSummary | null
  /** Live phase heading parsed from output_md by the daemon (e.g. "Phase 5 — Synthesize and size"). Null until the first heading streams in. Added in migration 02 (05-02). */
  current_phase: string | null
  /** User-requested cancel flag. Set true by the cancel API on a running run; the daemon polls it, kills the claude child, and transitions status → 'cancelled'. */
  cancel_requested: boolean
  error_message: string | null
  claude_tokens_in: number | null
  claude_tokens_out: number | null
  triggered_at: string
  started_at: string | null
  completed_at: string | null
}

export interface StrategyRunAudit {
  id: string
  run_id: string
  score: number
  findings: AuditFinding[]
  summary_md: string | null
  completed_at: string
}

export interface StrategyOutcome {
  id: string
  run_id: string
  pick_key: string
  game_key: string
  market: string
  side: string | null
  line: string | null
  predicted_p: number | null
  offered_odds: number | null
  stake_units: number | null
  audit_confidence: StrategyAuditConfidence
  settlement_status: StrategyOutcomeSettlement
  realized_result: Record<string, unknown> | null
  settled_at: string | null
  game_date: string | null
}

export interface StrategyOptimization {
  id: string
  strategy_id: string
  week_start: string
  status: StrategyOptimizationStatus
  proposed_diff: string | null
  synthesis_md: string | null
  evidence_run_ids: string[]
  applied_git_sha: string | null
  reviewer_note: string | null
  reviewed_at: string | null
  applied_at: string | null
  created_at: string
}

export interface PendingTask {
  id: string
  kind: PendingTaskPayload['kind']
  payload: PendingTaskPayload['payload']
  status: PendingTaskStatus
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

// ---------------------------------------------------------------------------
// JSONB shapes (per SPEC §6.6, §6.7)
// ---------------------------------------------------------------------------

export interface InputMeta {
  paste: boolean
  odds_api: boolean
  books?: string[]
  [k: string]: unknown
}

// OutputSummary sub-types are Zod-derived (single source of truth).
// OutputSummary and AuditFinding are imported at the top of this file.
// Other sub-types re-exported here for UI consumers.
export type {
  Pick as OutputSummaryFinalCard,
  Parlay as OutputSummaryParlay,
  PitcherNote as OutputSummaryPitcherNote,
  SituationalNote as OutputSummarySituationalNote,
  CoverageVerdict as OutputSummaryCoverage,
  AuditSeminar as OutputSummaryAuditSeminar,
} from './output-summary.schema.js'

// Re-export OutputSummarySchema for runtime validation (e.g. RunViewer)
export { OutputSummarySchema } from './output-summary.schema.js'

// ---------------------------------------------------------------------------
// Calibration view row types (SPEC §6.8, read from SQL views built in 05-01)
// ---------------------------------------------------------------------------

/** Row from strategy_calibration_by_bucket view */
export interface CalibrationByBucketRow {
  strategy_id: string
  p_bucket: number
  avg_predicted: number
  realized_win_rate: number | null
  n: number
}

/** Row from strategy_calibration_by_market view */
export interface CalibrationByMarketRow {
  strategy_id: string
  market: string
  n: number
  total_stake_units: number
  total_units_pl: number
  roi_pct: number
}

/** Row from strategy_calibration_by_confidence view */
export interface CalibrationByConfidenceRow {
  strategy_id: string
  audit_confidence: string
  n: number
  avg_predicted: number
  realized_win_rate: number | null
}

/** Row from strategy_rolling_pnl_weekly view */
export interface RollingPnlRow {
  strategy_id: string
  week_start: string
  bets: number
  units_pl: number
  cumulative_units_pl: number
}

/** Combined calibration data returned by useCalibration hook */
export interface CalibrationData {
  byBucket: CalibrationByBucketRow[]
  byMarket: CalibrationByMarketRow[]
  byConfidence: CalibrationByConfidenceRow[]
  rollingPnl: RollingPnlRow[]
  lastSettledAt: string | null
}

/**
 * Row from the `strategy_stats_alltime` view (migration 11).
 * All-time per-strategy aggregate over settled outcomes. Powers the metrics
 * strip on the expandable /strategies row panel. `win_rate_pct` / `roi_pct`
 * are null when there is no settled denominator (rendered as "—").
 * Tracker-only — the runner does not consume this.
 */
export interface StrategyStats {
  strategy_id: string
  won: number
  lost: number
  push: number
  void: number
  pending: number
  units_pl: number
  stake_units: number
  win_rate_pct: number | null
  roi_pct: number | null
}

// ---------------------------------------------------------------------------
// pending_tasks payload discriminated union
// ---------------------------------------------------------------------------

export type PendingTaskPayload =
  | {
      kind: 'scaffold_strategy'
      payload: { strategy_id: string; slug: string }
    }
  | {
      kind: 'apply_optimization'
      payload: { optimization_id: string }
    }

// ---------------------------------------------------------------------------
// API response shapes (Vercel → browser)
// ---------------------------------------------------------------------------

/** GET /api/strategies — list with last-run hint. */
export interface StrategyListItem extends Strategy {
  last_run: Pick<StrategyRun, 'id' | 'status' | 'completed_at'> | null
}

/** GET /api/strategies/[id] — detail with recent runs. */
export interface StrategyDetail {
  strategy: Strategy
  recent_runs: StrategyRun[]
}

/** POST /api/strategies/[id]/run — enqueue response. */
export interface EnqueueRunResponse {
  run_id: string
}

/** POST /api/strategies — create body. */
export interface CreateStrategyBody {
  slug: string
  name: string
  description?: string
  sport: string
}
