/**
 * Pure helpers for the expandable /strategies row panel (StrategyRowPanel).
 *
 * Kept side-effect-free so they can be unit-tested without DOM/RTL (the
 * tracker's Vitest is pure-function only). The panel component composes these.
 */

import type {
  OutputSummaryFinalCard,
  StrategyOutcome,
  StrategyOutcomeSettlement,
} from '@/types/strategies'

// ---------------------------------------------------------------------------
// joinPicksToOutcomes — merge final_card picks with their settled outcomes
// ---------------------------------------------------------------------------

/**
 * One display row: the run's `final_card` pick merged with its
 * `strategy_outcome` (matched by `pick_key`). Picks with no matching outcome
 * row yet are `'pending'` with `units_pl: null`.
 */
export interface JoinedPick {
  pick: OutputSummaryFinalCard
  status: StrategyOutcomeSettlement
  /** Realized units P/L from `realized_result.units_pl`; null when unsettled. */
  units_pl: number | null
}

/**
 * Read `realized_result.units_pl` off an outcome, coercing strings (PostgREST
 * numerics arrive as strings) to a number. Returns null when absent / unparseable.
 */
function readUnitsPl(outcome: StrategyOutcome | undefined): number | null {
  if (!outcome || outcome.realized_result == null) return null
  const raw = (outcome.realized_result as Record<string, unknown>)['units_pl']
  if (raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Merge each `final_card` pick with its `strategy_outcome` by `pick_key`.
 *
 * - status comes from the matched outcome's `settlement_status`; picks with no
 *   matching outcome → `'pending'`.
 * - `units_pl` comes from the matched outcome's `realized_result.units_pl`;
 *   `null` when there's no outcome or no value yet.
 *
 * Order follows `finalCard` (the suggested-card order). Outcome lookup is O(1).
 */
export function joinPicksToOutcomes(
  finalCard: OutputSummaryFinalCard[],
  outcomes: StrategyOutcome[],
): JoinedPick[] {
  const byKey = new Map<string, StrategyOutcome>()
  for (const o of outcomes) {
    // First write wins — outcomes are unique per (run, pick_key) in practice.
    if (!byKey.has(o.pick_key)) byKey.set(o.pick_key, o)
  }
  return finalCard.map((pick) => {
    const outcome = byKey.get(pick.pick_key)
    return {
      pick,
      status: outcome ? outcome.settlement_status : 'pending',
      units_pl: readUnitsPl(outcome),
    }
  })
}

// ---------------------------------------------------------------------------
// formatRunDateLabel — "Today h:mmp" / "Yesterday" / absolute date
// ---------------------------------------------------------------------------

/**
 * Compact lowercase am/pm: "9:48p", "12:05a". Pure, locale-independent on the
 * hour/minute (uses the Date's local time fields directly).
 */
function fmtCompactTime(d: Date): string {
  let h = d.getHours()
  const m = d.getMinutes()
  const suffix = h >= 12 ? 'p' : 'a'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${String(m).padStart(2, '0')}${suffix}`
}

/** True when two Dates fall on the same local calendar day. */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Date-label a run timestamp for the picks-zone header:
 * - same day as `now`     → "Today 9:48p"
 * - the calendar day prior → "Yesterday"
 * - otherwise              → absolute "May 19" (month + day)
 *
 * `iso` null/invalid → "—". `now` is injectable for deterministic tests.
 */
export function formatRunDateLabel(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'

  if (sameDay(d, now)) return `Today ${fmtCompactTime(d)}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Yesterday'

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// unitsToUsd — units → dollars (caller formats with USD)
// ---------------------------------------------------------------------------

/**
 * Convert a units value to a raw dollar amount: `units * unitSize`.
 * The caller is responsible for formatting (e.g. `USD.format(...)`), so this
 * stays a pure number transform. A non-finite / non-positive `unitSize`
 * yields 0 (no meaningful dollar conversion).
 */
export function unitsToUsd(units: number, unitSize: number): number {
  if (!Number.isFinite(units) || !Number.isFinite(unitSize)) return 0
  if (unitSize <= 0) return 0
  return units * unitSize
}
