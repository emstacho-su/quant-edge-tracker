import { evaluateSelection, selectionGameScore, type Outcome } from './evaluate-selection.js'
import { parseBet } from './parse-bet.js'
import { deriveParlayResult, type LegResult } from './parlay-result.js'
import type { FinalGameRow } from './espn-scores.js'

/**
 * Pure settlement decisions for the auto-settle cron. The cron does the DB
 * writes; this decides the outcome. `skip` → mark auto_settle_state='skipped'
 * (needs manual attention); `pending` → leave as-is and retry next run;
 * `settle` → write the outcome; `needs-agent` → enqueue for daemon grading.
 */
export type Decision =
  | { kind: 'settle'; outcome: Outcome; game?: FinalGameRow; confidence?: number; legStatuses?: LegResult[]; propActual?: number }
  | { kind: 'pending' }
  | { kind: 'skip'; reason: string }
  | { kind: 'needs-agent'; reason: string }

/** Pick the unique final game for a selection, or null. espnEventId (when known
 *  to be an ESPN id, e.g. a single's live_game_id) short-circuits the match. */
export function pickGame(
  selection: string | null,
  espnEventId: string | null,
  finals: FinalGameRow[],
): { game: FinalGameRow; confidence: number } | null {
  if (espnEventId) {
    const g = finals.find((f) => f.espnId === espnEventId)
    return g ? { game: g, confidence: 100 } : null
  }
  if (!selection) return null
  let best: FinalGameRow | null = null
  let bestScore = 0
  let tie = false
  for (const g of finals) {
    const s = selectionGameScore(selection, g)
    if (s > bestScore) { bestScore = s; best = g; tie = false }
    else if (s === bestScore && s > 0) tie = true
  }
  if (!best || bestScore === 0 || tie) return null
  return { game: best, confidence: bestScore }
}

export interface SingleInput {
  clv_market: string | null
  clv_selection: string | null
  clv_line: number | null
  live_game_id: string | null
}

export function decideSingle(bet: SingleInput, finals: FinalGameRow[]): Decision {
  const picked = pickGame(bet.clv_selection, bet.live_game_id, finals)
  if (!picked) return { kind: 'skip', reason: 'no_unique_final_match' }
  const outcome = evaluateSelection(
    { market: bet.clv_market, selection: bet.clv_selection, line: bet.clv_line },
    picked.game,
  )
  if (!outcome) return { kind: 'skip', reason: 'unevaluable' }
  return { kind: 'settle', outcome, game: picked.game, confidence: picked.confidence }
}

/** Grading spec prop shape — minimal subset needed for parlay leg routing */
export interface LegPropSpec {
  espn_player_id: string
  stat_keys: string[]
  line: number
  direction: 'over' | 'under'
  data_source: string
}

export interface LegInput {
  description: string
  sport: string | null
  is_prop?: boolean | null
  leg_status?: string | null
  /** Per-leg game link for prop legs — needed for D-07 */
  live_game_id?: string | null
  /** Per-leg grading spec (market + player + stat_keys + line/direction) */
  grading_spec?: { prop?: LegPropSpec } | null
}

/**
 * Optional callback the cron passes to decideParlay so prop legs can be graded
 * with box-score data. The cron builds this function with its box-score caches.
 *
 * Returns:
 *   LegResult ('won'|'lost'|'push'|'void') — game is final and stat was extracted
 *   'pending' — game is not yet graded (e.g. postponed leg mid-check)
 *   null — stat could not be resolved (route whole parlay to needs-agent)
 */
export type PropLegGrader = (leg: LegInput, game: FinalGameRow) => LegResult | 'pending' | null

export function decideParlay(
  legs: LegInput[],
  finalsBySport: Record<string, FinalGameRow[]>,
  propLegGrader?: PropLegGrader,
): Decision {
  if (legs.length === 0) return { kind: 'skip', reason: 'no_legs' }
  const statuses: LegResult[] = []
  for (const leg of legs) {
    // Respect an already-settled leg (e.g. a manual leg edit).
    if (leg.leg_status && leg.leg_status !== 'pending') {
      statuses.push(leg.leg_status as LegResult)
      continue
    }

    if (leg.is_prop) {
      // D-07: Route prop legs correctly instead of skipping the whole parlay.
      // A prop leg needs its own game link + grading spec to be gradeable.
      if (!leg.live_game_id || !leg.grading_spec?.prop) {
        return { kind: 'needs-agent', reason: 'prop_leg_no_game_link' }
      }
      // IMPORTANT (Pitfall 4): use leg.sport for the finals lookup, NOT the parent bet's sport.
      const legFinals = finalsBySport[leg.sport ?? ''] ?? []
      const finalGame = legFinals.find((f) => f.espnId === leg.live_game_id)
      if (!finalGame) {
        // Game not final yet — retry next run
        statuses.push('pending')
        continue
      }
      // Game is final — if a grader callback is provided, call it
      if (propLegGrader) {
        const gradeResult = propLegGrader(leg, finalGame)
        if (gradeResult === null) {
          // Grader couldn't resolve the stat — route whole parlay to agent
          return { kind: 'needs-agent', reason: 'prop_leg_unresolved' }
        }
        if (gradeResult === 'pending') {
          statuses.push('pending')
          continue
        }
        statuses.push(gradeResult)
        continue
      }
      // No grader provided (pure unit tests) — game is final but we can't grade without
      // a grader callback. Push pending so the parlay can be retried with a grader.
      statuses.push('pending')
      continue
    }

    const sport = leg.sport
    if (!sport || !finalsBySport[sport]) return { kind: 'skip', reason: 'leg_sport_unsupported' }
    const parsed = parseBet(leg.description, false)
    if (!parsed.market) return { kind: 'skip', reason: 'leg_unparseable' }
    const picked = pickGame(parsed.selection, null, finalsBySport[sport])
    if (!picked) { statuses.push('pending'); continue } // leg's game not final yet
    const outcome = evaluateSelection(
      { market: parsed.market, selection: parsed.selection, line: parsed.line },
      picked.game,
    )
    if (!outcome) return { kind: 'skip', reason: 'leg_unevaluable' }
    statuses.push(outcome)
  }
  const result = deriveParlayResult(statuses)
  if (result === null) return { kind: 'skip', reason: 'parlay_push_recompute' }
  if (result === 'pending') return { kind: 'pending' }
  return { kind: 'settle', outcome: result, legStatuses: statuses }
}
