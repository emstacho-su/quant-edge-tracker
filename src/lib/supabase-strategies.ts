/**
 * Client-side typed helpers over the strategy tracker tables.
 *
 * Reads use the public anon key (RLS allows SELECT on every strategy table).
 * Writes happen through Vercel API routes, not from the browser — see
 * `api/strategies/*` for the service-role insert/update paths.
 */
import { supabase } from '@/lib/supabase'
import type {
  Strategy,
  StrategyListItem,
  StrategyRun,
  StrategyRunAudit,
  StrategyOutcome,
  StrategyStats,
  CalibrationByBucketRow,
  CalibrationByMarketRow,
  CalibrationByConfidenceRow,
  RollingPnlRow,
} from '@/types/strategies'

// ---------------------------------------------------------------------------
// strategies
// ---------------------------------------------------------------------------

/** List all strategies with the most recent run's status/completed_at. */
export async function listStrategies(): Promise<StrategyListItem[]> {
  const { data: strategies, error } = await supabase
    .from('strategies')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  if (!strategies || strategies.length === 0) return []

  const ids = strategies.map((s) => s.id)
  const { data: runs, error: runsErr } = await supabase
    .from('strategy_runs')
    .select('id, strategy_id, status, completed_at, triggered_at')
    .in('strategy_id', ids)
    .order('triggered_at', { ascending: false })
  if (runsErr) throw runsErr

  const lastRunByStrategy = new Map<
    string,
    { id: string; status: StrategyRun['status']; completed_at: string | null }
  >()
  for (const r of runs ?? []) {
    if (!lastRunByStrategy.has(r.strategy_id)) {
      lastRunByStrategy.set(r.strategy_id, {
        id: r.id,
        status: r.status as StrategyRun['status'],
        completed_at: r.completed_at,
      })
    }
  }

  return (strategies as Strategy[]).map((s) => ({
    ...s,
    last_run: lastRunByStrategy.get(s.id) ?? null,
  }))
}

/** Fetch one strategy by id. */
export async function getStrategy(id: string): Promise<Strategy | null> {
  const { data, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as Strategy | null) ?? null
}

// ---------------------------------------------------------------------------
// strategy_runs
// ---------------------------------------------------------------------------

/** Recent runs for a strategy (most recent first). */
export async function listRuns(strategyId: string, limit = 20): Promise<StrategyRun[]> {
  const { data, error } = await supabase
    .from('strategy_runs')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('triggered_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as StrategyRun[]) ?? []
}

/** Fetch a single run by id. */
export async function getRun(runId: string): Promise<StrategyRun | null> {
  const { data, error } = await supabase
    .from('strategy_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw error
  return (data as StrategyRun | null) ?? null
}

// ---------------------------------------------------------------------------
// strategy_run_audits / strategy_outcomes
// ---------------------------------------------------------------------------

/** Audit row (if any) for a run. */
export async function getRunAudit(runId: string): Promise<StrategyRunAudit | null> {
  const { data, error } = await supabase
    .from('strategy_run_audits')
    .select('*')
    .eq('run_id', runId)
    .maybeSingle()
  if (error) throw error
  return (data as StrategyRunAudit | null) ?? null
}

/** Outcomes for a run, ordered by pick number. */
export async function listOutcomes(runId: string): Promise<StrategyOutcome[]> {
  const { data, error } = await supabase
    .from('strategy_outcomes')
    .select('*')
    .eq('run_id', runId)
    .order('pick_key', { ascending: true })
  if (error) throw error
  return (data as StrategyOutcome[]) ?? []
}

// ---------------------------------------------------------------------------
// Calibration views (SPEC §6.8) — reads from SQL views built in 05-01
// ---------------------------------------------------------------------------

/** Predicted vs realized win rate by probability bucket (for calibration scatter). */
export async function getCalibrationByBucket(
  strategyId: string,
): Promise<CalibrationByBucketRow[]> {
  const { data, error } = await supabase
    .from('strategy_calibration_by_bucket')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('p_bucket', { ascending: true })
  if (error) throw error
  return (data as CalibrationByBucketRow[]) ?? []
}

/** ROI and unit P&L broken down by market type. */
export async function getCalibrationByMarket(
  strategyId: string,
): Promise<CalibrationByMarketRow[]> {
  const { data, error } = await supabase
    .from('strategy_calibration_by_market')
    .select('*')
    .eq('strategy_id', strategyId)
  if (error) throw error
  return (data as CalibrationByMarketRow[]) ?? []
}

/** Audit confidence tier vs realized win rate and predicted probability. */
export async function getCalibrationByConfidence(
  strategyId: string,
): Promise<CalibrationByConfidenceRow[]> {
  const { data, error } = await supabase
    .from('strategy_calibration_by_confidence')
    .select('*')
    .eq('strategy_id', strategyId)
  if (error) throw error
  return (data as CalibrationByConfidenceRow[]) ?? []
}

/**
 * Rolling weekly unit P&L.
 * Live view name: strategy_rolling_pnl_weekly (SQL:264).
 */
export async function getRollingPnlWeekly(
  strategyId: string,
): Promise<RollingPnlRow[]> {
  const { data, error } = await supabase
    .from('strategy_rolling_pnl_weekly')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('week_start', { ascending: true })
  if (error) throw error
  return (data as RollingPnlRow[]) ?? []
}

// ---------------------------------------------------------------------------
// strategy_optimizations
// ---------------------------------------------------------------------------

/** List all optimizations for a strategy, newest first. */
export async function listOptimizations(
  strategyId: string,
): Promise<import('@/types/strategies').StrategyOptimization[]> {
  const { data, error } = await supabase
    .from('strategy_optimizations')
    .select('*')
    .eq('strategy_id', strategyId)
    .order('week_start', { ascending: false })
  if (error) throw error
  return (data as import('@/types/strategies').StrategyOptimization[]) ?? []
}

// ---------------------------------------------------------------------------

/**
 * MAX(settled_at) for a strategy's outcomes — used for the "Last settled" stamp.
 * Joins through strategy_runs to get outcomes for a strategy.
 * Returns null if no outcomes have been settled.
 */
export async function getLastSettledAt(strategyId: string): Promise<string | null> {
  // strategy_outcomes links to strategy_runs, not strategies directly.
  // We use a sub-select: get run IDs for this strategy, then find max settled_at.
  const { data: runs, error: runsErr } = await supabase
    .from('strategy_runs')
    .select('id')
    .eq('strategy_id', strategyId)
  if (runsErr) throw runsErr
  if (!runs || runs.length === 0) return null

  const runIds = (runs as { id: string }[]).map((r) => r.id)
  const { data, error } = await supabase
    .from('strategy_outcomes')
    .select('settled_at')
    .in('run_id', runIds)
    .not('settled_at', 'is', null)
    .order('settled_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as { settled_at: string } | null)?.settled_at ?? null
}

// ---------------------------------------------------------------------------
// strategy_stats_alltime view (migration 11)
// ---------------------------------------------------------------------------

/** Coerce a PostgREST value (numeric columns arrive as strings) to a number. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Coerce a nullable PostgREST numeric to `number | null` (null stays null). */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * All-time aggregate stats for a strategy from the `strategy_stats_alltime`
 * view. Returns null when the strategy has no outcome rows at all (no settled
 * bets yet → caller renders "No settled bets yet."). Numeric columns are
 * coerced from PostgREST strings; `win_rate_pct` / `roi_pct` stay null when the
 * view has no settled denominator.
 */
export async function getStrategyStats(
  strategyId: string,
): Promise<StrategyStats | null> {
  const { data, error } = await supabase
    .from('strategy_stats_alltime')
    .select('*')
    .eq('strategy_id', strategyId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as Record<string, unknown>
  return {
    strategy_id: String(row.strategy_id),
    won: num(row.won),
    lost: num(row.lost),
    push: num(row.push),
    void: num(row.void),
    pending: num(row.pending),
    units_pl: num(row.units_pl),
    stake_units: num(row.stake_units),
    win_rate_pct: numOrNull(row.win_rate_pct),
    roi_pct: numOrNull(row.roi_pct),
  }
}
