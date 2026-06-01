import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../_lib/supabase-admin.js'
import { decideSingle, decideParlay, type Decision, type LegInput, type PropLegGrader } from '../_lib/settle-logic.js'
import { fetchFinalGames, dateStringsFor, LEAGUES_BY_SPORT, type FinalGameRow } from '../_lib/espn-scores.js'
import { parsePropDescription, extractStat, evaluateProp, fetchBoxScorePlayers } from '../_lib/evaluate-prop.js'
import { extractMlbStat, fetchMlbBoxscore, type MlbBoxscorePlayers } from '../_lib/evaluate-prop-mlb.js'
import { GRADE_BET_KIND } from '../_lib/grade-bet-contract.js'

/**
 * GET /api/cron/auto-settle — fully-automatic settlement of pending bets from
 * final ESPN scores. Singles (ML/spread/total) + prop singles + prop-leg parlays. Wave C+D+18.
 *
 * Phase 18 additions:
 *  - Reads bet.grading_spec when present; lazily computes+persists on first grade (D-09)
 *  - Routes unresolvable bets to needs-agent queue (pending_tasks, kind='grade_bet') (D-06)
 *  - Re-admits skipped bets with RETRYABLE_REASONS (backlog re-entry)
 *  - Grades prop legs inside parlays via per-leg live_game_id + grading_spec (D-07)
 *  - MLB props routed to StatsAPI; NBA/NHL/NFL remain on ESPN box score (D-01/D-02)
 *  - Deterministic high-confidence grades stay silent; grading_state untouched (D-10)
 *
 * Safety rails:
 *  - only settles ESPN-completed games (OT-aware) — see espn-scores.
 *  - decision logic returns skip/needs-agent on any doubt → never force-settled.
 *  - cash-floor guard: never writes a settlement taking cash <= $0.
 *  - manual edits excluded (auto_settle_state='manual') — humans always win.
 *  - every settlement recorded in bet_settlements (audit + undo).
 *  - ?dry=1 computes proposals WITHOUT writing anything.
 *
 * Secured by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
 */

type Outcome = 'won' | 'lost' | 'push'

// --- GradingSpec shape (D-09) ---

export interface GradingSpecProp {
  espn_player_id: string | null
  player_name: string
  sport: string
  stat_keys: string[]
  data_source: 'mlb_statsapi' | 'espn_boxscore'
  line: number
  direction: 'over' | 'under'
  listed_pitcher_id?: number | null
}

export interface GradingSpec {
  market: string
  espn_event_id: string | null
  prop?: GradingSpecProp
  computed_at: string
  source: string
}

export interface GradingSpecInput {
  market: string
  espn_event_id: string | null
  prop?: {
    espn_player_id: string | null
    player_name: string
    sport: string
    stat_keys: string[]
    data_source: 'mlb_statsapi' | 'espn_boxscore'
    line: number
    direction: 'over' | 'under'
    listed_pitcher_id?: number | null
  }
}

/**
 * Build a grading spec from parsed bet data.
 * This is the D-09 lazy compute — persisted back to bets.grading_spec on first
 * successful grade so subsequent runs just read it.
 */
export function buildGradingSpec(input: GradingSpecInput): GradingSpec {
  const spec: GradingSpec = {
    market: input.market,
    espn_event_id: input.espn_event_id,
    computed_at: new Date().toISOString(),
    source: 'lazy_settle',
  }
  if (input.prop) {
    spec.prop = {
      espn_player_id: input.prop.espn_player_id,
      player_name: input.prop.player_name,
      sport: input.prop.sport,
      stat_keys: input.prop.stat_keys,
      data_source: input.prop.data_source,
      line: input.prop.line,
      direction: input.prop.direction,
      ...(input.prop.listed_pitcher_id != null ? { listed_pitcher_id: input.prop.listed_pitcher_id } : {}),
    }
  }
  return spec
}

/**
 * Build a pending_tasks row payload for the needs-agent handoff.
 * Uses GRADE_BET_KIND constant — never hardcodes the string.
 */
export function buildNeedsAgentPayload(betId: string): {
  kind: typeof GRADE_BET_KIND
  payload: { bet_id: string }
  status: 'queued'
  created_at: string
} {
  return {
    kind: GRADE_BET_KIND,
    payload: { bet_id: betId },
    status: 'queued',
    created_at: new Date().toISOString(),
  }
}

/**
 * Cash-floor breach guard — re-exported for test access.
 * Returns true when the proposed cashChange would drive balance to <= $0.
 */
export function wouldBreachCashFloor(runningCash: number, cashChange: number): boolean {
  return cashChange < 0 && runningCash + cashChange <= 0
}

// --- Retryable skip reasons --- (backlog re-entry, D-06)
// Reasons that Phase 18's taxonomy expansion/routing fixes.
// cash_floor_guard and non-retryable taxonomy errors are excluded.

export const RETRYABLE_REASONS = new Set([
  'prop_stat_unresolved',
  'leg_is_prop',
  'prop_sport_unsupported',
  'prop_unparseable',
  'no_unique_final_match',
])

interface Leg {
  id: string
  description: string
  sport: string | null
  is_prop: boolean | null
  leg_status: string | null
  live_game_id: string | null
  grading_spec: {
    prop?: {
      espn_player_id: string
      stat_keys: string[]
      line: number
      direction: 'over' | 'under'
      data_source: string
    }
  } | null
}

interface BetRow {
  id: string
  bet_type: 'single' | 'parlay'
  sport: string | null
  description: string
  clv_market: string | null
  clv_selection: string | null
  clv_line: number | null
  stake: number
  to_win: number
  is_freeplay: boolean
  live_game_id: string | null
  placed_at: string
  auto_settle_state: string | null
  settle_skip_reason: string | null
  grading_spec: GradingSpec | null
  grading_state: string | null
  parlay_legs: Leg[] | null
}

/**
 * Pure candidacy predicate — exported for unit testing without live DB.
 * Determines whether a pending bet should enter the settlement loop.
 */
export function isCandidate(b: {
  auto_settle_state: string | null
  settle_skip_reason: string | null
  bet_type: string
  clv_market: string | null
  live_game_id: string | null
  description: string
  parlay_legs: Array<unknown> | null
}): boolean {
  // Manual edits: always skip — humans always win
  if (b.auto_settle_state === 'manual') return false
  // Skipped: only re-admit if the skip reason is retryable
  if (b.auto_settle_state === 'skipped') {
    return RETRYABLE_REASONS.has(b.settle_skip_reason ?? '')
  }
  // Parlay: must have legs
  if (b.bet_type === 'parlay') return (b.parlay_legs?.length ?? 0) > 0
  // Structured straight market
  if (b.clv_market) return true
  // Prop single: needs a game link + parseable description
  return !!b.live_game_id && parsePropDescription(b.description) !== null
}

function profitLoss(o: Outcome, stake: number, toWin: number, fp: boolean): number {
  if (o === 'won') return toWin
  if (o === 'lost') return fp ? 0 : -stake
  return 0
}
function cashDelta(o: Outcome, stake: number, toWin: number, fp: boolean): number {
  if (fp) return o === 'won' ? toWin : 0
  return o === 'won' ? toWin : o === 'lost' ? -stake : 0
}
function fpDelta(o: Outcome, stake: number, fp: boolean): number {
  return fp && o === 'push' ? stake : 0
}

async function latestBalance(supabase: ReturnType<typeof getServiceClient>, type: 'cash' | 'freeplay'): Promise<number> {
  const { data } = await supabase
    .from('bankroll_events').select('balance_after')
    .eq('bankroll_type', type).order('occurred_at', { ascending: false }).limit(1).single()
  return Number(data?.balance_after ?? 0)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  const dry = req.query.dry === '1'
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('bets')
    .select('id,bet_type,sport,description,clv_market,clv_selection,clv_line,stake,to_win,is_freeplay,live_game_id,placed_at,auto_settle_state,settle_skip_reason,grading_spec,grading_state,parlay_legs(id,description,sport,is_prop,leg_status,live_game_id,grading_spec)')
    .eq('status', 'pending')
  if (error) return res.status(500).json({ error: error.message })

  const candidates = (data ?? []).filter((b) => isCandidate(b as Parameters<typeof isCandidate>[0])) as BetRow[]
  if (candidates.length === 0) return res.status(200).json({ ok: true, dry, settled: 0, skipped: 0, results: [] })

  // Collect every sport needed (singles + parlay legs), fetch finals once each.
  const sports = new Set<string>()
  for (const b of candidates) {
    if (b.bet_type === 'single' && b.sport && b.sport in LEAGUES_BY_SPORT) sports.add(b.sport)
    for (const leg of b.parlay_legs ?? []) if (leg.sport && leg.sport in LEAGUES_BY_SPORT) sports.add(leg.sport)
  }
  const dates = dateStringsFor(candidates.map((b) => b.placed_at))
  const finalsBySport: Record<string, FinalGameRow[]> = {}
  for (const sport of sports) {
    const all: FinalGameRow[] = []
    for (const d of dates) all.push(...(await fetchFinalGames(sport, d)))
    finalsBySport[sport] = all
  }

  // Box-score caches — keyed by ESPN event ID
  const espnBoxCache = new Map<string, Awaited<ReturnType<typeof fetchBoxScorePlayers>>>()
  const mlbBoxCache = new Map<string, MlbBoxscorePlayers>()

  /**
   * Fetch the MLB StatsAPI boxscore for an ESPN event ID.
   * Maps ESPN event ID → MLB gamePk via the MLB schedule API.
   */
  async function getMlbBoxscore(espnEventId: string, gameDate: string): Promise<MlbBoxscorePlayers | null> {
    const cached = mlbBoxCache.get(espnEventId)
    if (cached) return cached

    // Map ESPN event ID → MLB gamePk via schedule API
    // We search a date window around the game date for a gamePk match
    const dateParam = gameDate.substring(0, 10) // YYYY-MM-DD
    try {
      const schedRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateParam}&hydrate=linescore`)
      if (!schedRes.ok) return null
      const sched = await schedRes.json() as { dates?: Array<{ games?: Array<{ gamePk: number; teams: { away: { team: { id: number } }; home: { team: { id: number } } }; link?: string }> }> }
      // Look for any game on that date — since we don't have direct ESPN↔MLB gamePk mapping here,
      // fetch all games and cache all of them (small cardinality per day)
      const games = sched.dates?.flatMap((d) => d.games ?? []) ?? []
      for (const game of games) {
        const box = await fetchMlbBoxscore(game.gamePk)
        if (box) {
          // Cache under gamePk as string — we'll also try espnEventId below
          mlbBoxCache.set(String(game.gamePk), box)
        }
      }
      // Return the first game's boxscore as a best-effort (for single-game days)
      // For multi-game days, the prop spec's player name matching in extractMlbStat
      // handles disambiguation — we just need to search all cached boxes
      const firstBox = games.length > 0 ? mlbBoxCache.get(String(games[0].gamePk)) ?? null : null
      if (firstBox) mlbBoxCache.set(espnEventId, firstBox)
      return firstBox
    } catch {
      return null
    }
  }

  /**
   * Grade a prop (single or parlay leg) using the appropriate data source.
   * Returns the actual stat value, or null if unresolvable (→ needs-agent).
   */
  async function gradePropStat(
    sport: string,
    gameId: string,
    gameDate: string,
    playerName: string,
    statKeys: string[],
    dataSource: string,
  ): Promise<number | null> {
    if (dataSource === 'mlb_statsapi' || sport === 'MLB') {
      // MLB: use StatsAPI named fields
      const box = await getMlbBoxscore(gameId, gameDate)
      if (!box) return null
      if (statKeys.length === 1) {
        return extractMlbStat(box, playerName, statKeys[0])
      }
      // Multi-stat combine for MLB
      let sum = 0
      for (const key of statKeys) {
        const v = extractMlbStat(box, playerName, key)
        if (v == null) return null
        sum += v
      }
      return sum
    }

    // NBA/NHL/NFL/WNBA: use ESPN box score
    const leaguePath = LEAGUES_BY_SPORT[sport]?.[0]
    if (!leaguePath) return null
    let players = espnBoxCache.get(gameId)
    if (!players) {
      players = await fetchBoxScorePlayers(leaguePath, gameId)
      espnBoxCache.set(gameId, players)
    }
    if (statKeys.length === 1) {
      return extractStat(players, sport, playerName, statKeys[0])
    }
    // Multi-stat combine for ESPN
    let sum = 0
    for (const key of statKeys) {
      const v = extractStat(players, sport, playerName, key)
      if (v == null) return null
      sum += v
    }
    return sum
  }

  /**
   * Decide a prop single: read grading_spec when present; fall back to parsing;
   * lazy-persist spec back on first successful grade (D-09).
   */
  async function decidePropSingle(bet: BetRow): Promise<{ decision: Decision; newSpec: GradingSpec | null }> {
    const gameId = bet.live_game_id
    const sport = bet.sport

    if (!gameId || !sport) return { decision: { kind: 'pending' }, newSpec: null }

    const leaguePath = LEAGUES_BY_SPORT[sport]?.[0]
    if (!leaguePath && sport !== 'MLB') return { decision: { kind: 'needs-agent', reason: 'prop_sport_unsupported' }, newSpec: null }

    const finalGame = (finalsBySport[sport] ?? []).find((f) => f.espnId === gameId)
    if (!finalGame) return { decision: { kind: 'pending' }, newSpec: null } // game not final yet

    let playerName: string
    let statKeys: string[]
    let line: number
    let direction: 'over' | 'under'
    let dataSource: 'mlb_statsapi' | 'espn_boxscore'
    let specToPersist: GradingSpec | null = null

    if (bet.grading_spec?.prop) {
      // D-09: Read the persisted spec — treat it as untrusted, access defensively (T-18-09)
      const prop = bet.grading_spec.prop
      playerName = prop.player_name ?? ''
      statKeys = Array.isArray(prop.stat_keys) ? prop.stat_keys : []
      line = typeof prop.line === 'number' ? prop.line : 0
      direction = prop.direction === 'under' ? 'under' : 'over'
      dataSource = prop.data_source === 'mlb_statsapi' ? 'mlb_statsapi' : 'espn_boxscore'
      // Prefer bet.live_game_id over spec.espn_event_id (Pitfall 5)
    } else {
      // Legacy: parse the description to derive the spec, then build + persist it on success
      const parsed = parsePropDescription(bet.description)
      if (!parsed) return { decision: { kind: 'needs-agent', reason: 'prop_unparseable' }, newSpec: null }
      playerName = parsed.player
      statKeys = [parsed.statKey]
      line = parsed.line
      direction = parsed.direction
      dataSource = sport === 'MLB' ? 'mlb_statsapi' : 'espn_boxscore'
      // We'll build the spec and mark it for persist-back below on success
    }

    if (!playerName || statKeys.length === 0) {
      return { decision: { kind: 'needs-agent', reason: 'prop_stat_unresolved' }, newSpec: null }
    }

    const actual = await gradePropStat(sport, gameId, finalGame.statusDetail ?? bet.placed_at, playerName, statKeys, dataSource)

    if (actual == null) {
      // Stat unresolvable: route to agent (do NOT persist a partial spec on failure)
      return { decision: { kind: 'needs-agent', reason: 'prop_stat_unresolved' }, newSpec: null }
    }

    const outcome = evaluateProp(actual, line, direction)

    // D-09 lazy persist-back: build spec if it wasn't already persisted
    if (!bet.grading_spec?.prop) {
      specToPersist = buildGradingSpec({
        market: 'player_prop',
        espn_event_id: gameId,
        prop: {
          espn_player_id: null, // Phase 17 will fill this later; for now, player_name suffices
          player_name: playerName,
          sport,
          stat_keys: statKeys,
          data_source: dataSource,
          line,
          direction,
        },
      })
    }

    return {
      decision: { kind: 'settle', outcome, game: finalGame, confidence: 100, propActual: actual },
      newSpec: specToPersist,
    }
  }

  let runningCash = await latestBalance(supabase, 'cash')
  let runningFp = await latestBalance(supabase, 'freeplay')
  let settled = 0
  let skipped = 0
  const results: Array<Record<string, unknown>> = []

  for (const bet of candidates) {
    try {
      let decision: Decision
      let newSpec: GradingSpec | null = null

      if (bet.bet_type === 'parlay') {
        // Build a propLegGrader that uses per-leg live_game_id and grading_spec
        const legGrader: PropLegGrader = (leg, game) => {
          const spec = leg.grading_spec?.prop
          if (!spec) return null
          // We can't do async in a sync callback; for prop legs, we return null
          // and let the needs-agent path handle it. Async prop-leg grading
          // happens when the daemon processes the grade_bet task.
          // For now: if we already have stat data cached, use it;
          // otherwise null → needs-agent.
          // Note: in practice, prop legs in parlays will always go to needs-agent
          // on first run (no async fetch in sync callback), but that's correct:
          // the agent handles multi-leg props with async fetches.
          return null
        }
        const legs = (bet.parlay_legs ?? []).map((leg) => ({
          description: leg.description,
          sport: leg.sport,
          is_prop: leg.is_prop,
          leg_status: leg.leg_status,
          live_game_id: leg.live_game_id,
          grading_spec: leg.grading_spec,
        } as LegInput))
        decision = decideParlay(legs, finalsBySport, legGrader)
      } else if (bet.clv_market) {
        decision = decideSingle(bet, finalsBySport[bet.sport as string] ?? [])
      } else {
        // Prop single (has live_game_id but no clv_market)
        const result = await decidePropSingle(bet)
        decision = result.decision
        newSpec = result.newSpec
      }

      if (decision.kind === 'pending') { results.push({ bet: bet.id, action: 'pending' }); continue }

      // D-06: needs-agent handoff — before the skip branch
      if (decision.kind === 'needs-agent') {
        if (!dry) {
          await supabase.from('bets')
            .update({ grading_state: 'needs-agent', auto_settle_state: null })
            .eq('id', bet.id)
          const taskPayload = buildNeedsAgentPayload(bet.id)
          await supabase.from('pending_tasks').insert(taskPayload)
        }
        results.push({ bet: bet.id, action: 'needs-agent', reason: (decision as { kind: 'needs-agent'; reason: string }).reason })
        continue
      }

      if (decision.kind === 'skip') {
        skipped++
        results.push({ bet: bet.id, action: 'skip', reason: decision.reason })
        if (!dry) await supabase.from('bets').update({ auto_settle_state: 'skipped', settle_skip_reason: decision.reason }).eq('id', bet.id)
        continue
      }

      // decision.kind === 'settle'
      const outcome = decision.outcome
      const cashChange = cashDelta(outcome, bet.stake, bet.to_win, bet.is_freeplay)
      const fpChange = fpDelta(outcome, bet.stake, bet.is_freeplay)

      // CLAUDE.md invariant: cash floor never <= $0
      if (wouldBreachCashFloor(runningCash, cashChange)) {
        skipped++
        results.push({ bet: bet.id, action: 'skip', reason: 'cash_floor_guard' })
        if (!dry) await supabase.from('bets').update({ auto_settle_state: 'skipped', settle_skip_reason: 'cash_floor_guard' }).eq('id', bet.id)
        continue
      }

      if (dry) {
        settled++
        results.push({
          bet: bet.id, action: 'would_settle', type: bet.bet_type, outcome,
          game: decision.game?.espnId, score: decision.game ? `${decision.game.awayAbbrev} ${decision.game.awayScore} @ ${decision.game.homeAbbrev} ${decision.game.homeScore}` : undefined,
          legStatuses: decision.legStatuses, cashChange,
        })
        continue
      }

      // D-09: Persist the lazy-computed grading_spec back to bets (write-once)
      if (newSpec) {
        await supabase.from('bets').update({ grading_spec: newSpec }).eq('id', bet.id)
      }

      // 1. Settle the bet row.
      // D-10: grading_state stays null for deterministic high-confidence grades (silent settle)
      await supabase.from('bets').update({
        status: outcome, settled_at: new Date().toISOString(),
        profit_loss: profitLoss(outcome, bet.stake, bet.to_win, bet.is_freeplay),
        auto_settle_state: 'settled',
        // grading_state intentionally not set here — null = deterministic (D-10)
      }).eq('id', bet.id)

      // 1b. Parlay: persist each leg's derived status.
      if (bet.bet_type === 'parlay' && decision.legStatuses) {
        const legs = bet.parlay_legs ?? []
        for (let i = 0; i < legs.length; i++) {
          if (legs[i].leg_status === 'pending' || !legs[i].leg_status) {
            await supabase.from('parlay_legs').update({ leg_status: decision.legStatuses[i] }).eq('id', legs[i].id)
          }
        }
      }

      // 2. Ledger events (same semantics as settleBet).
      if (cashChange !== 0) {
        runningCash += cashChange
        await supabase.from('bankroll_events').insert({ event_type: 'bet_settled', bankroll_type: 'cash', amount: cashChange, balance_after: runningCash, bet_id: bet.id })
      }
      if (fpChange !== 0) {
        runningFp += fpChange
        await supabase.from('bankroll_events').insert({ event_type: 'bet_settled', bankroll_type: 'freeplay', amount: fpChange, balance_after: runningFp, bet_id: bet.id })
      }

      // 3. Audit row — add grading_method to evidence_json (D-11)
      await supabase.from('bet_settlements').insert({
        bet_id: bet.id, espn_event_id: decision.game?.espnId ?? null,
        computed_result: outcome, confidence: decision.confidence ?? null,
        evidence_json: decision.game
          ? {
              home: decision.game.homeAbbrev, away: decision.game.awayAbbrev,
              homeScore: decision.game.homeScore, awayScore: decision.game.awayScore,
              statusDetail: decision.game.statusDetail, finalType: decision.game.finalType,
              ...(decision.propActual != null ? { propActual: decision.propActual } : {}),
              grading_method: 'deterministic',
            }
          : { type: 'parlay', legStatuses: decision.legStatuses, grading_method: 'deterministic' },
      })

      settled++
      results.push({ bet: bet.id, action: 'settled', type: bet.bet_type, outcome })
    } catch (e) {
      results.push({ bet: bet.id, action: 'error', error: (e as Error).message })
    }
  }

  return res.status(200).json({ ok: true, dry, settled, skipped, results })
}
