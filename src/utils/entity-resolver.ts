/**
 * entity-resolver.ts — Three-tier deterministic entity resolver.
 *
 * Tier 1: Exact alias lookup in the teams table (sport-scoped).
 *   Hit → ResolvedEntity{ tier: 1, confidence: 1.0 }
 *
 * Tier 2: Fuse.js fuzzy match against sport-scoped team list.
 *   Score <= FUZZY_AUTO_ACCEPT_THRESHOLD → ResolvedEntity{ tier: 2 }
 *   Score > threshold → falls through to tier 3
 *
 * Tier 3: Enqueue for async agent resolution.
 *   Inserts into entity_resolution_queue → PendingEntity{ tier: 3, queue_id }
 *
 * SPORT-SCOPING:
 *   All lookups are scoped to `sport` before any comparison. This resolves
 *   the D-03a cross-sport collisions (Cardinals MLB/NFL, Panthers NFL/NHL,
 *   Kings NBA/NHL) without any threshold tuning (Pitfall 5).
 *
 * DEPENDENCY INJECTION:
 *   resolveEntity accepts `deps` for a Supabase client and team list, keeping
 *   unit tests pure — no live DB, no mocking needed at the call site when
 *   the caller passes pre-built fixtures.
 *
 * SECURITY (T-17-04):
 *   The description is treated as data only. It is never concatenated into a
 *   SQL fragment; all Supabase calls use parameterized .eq()/.contains().
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TeamRow } from '../../api/_lib/espn-teams.js'
import {
  buildFuseIndex,
  fuzzyResolve,
  FUZZY_AUTO_ACCEPT_THRESHOLD,
} from './entity-fuzzy'

// ---------------------------------------------------------------------------
// Return type contract (D-01 / D-02 / D-12)
// ---------------------------------------------------------------------------

export type ResolvedEntity = {
  espn_id: string
  name: string
  confidence: number
  tier: 1 | 2
  entity_type: 'team' | 'player'
}

export type PendingEntity = {
  tier: 3
  queue_id: string
}

export type EntityResolution = ResolvedEntity | PendingEntity

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

export interface ResolverDeps {
  /** Supabase client (public or service; injected for testability) */
  supabase: SupabaseClient
  /** Pre-fetched team list for sport-scoped Fuse.js index (avoids extra DB round-trip) */
  teams: TeamRow[]
  /** Bet row UUID — required for tier-3 queue insert (optional for callers that only need tier-1/2) */
  betId?: string
}

// ---------------------------------------------------------------------------
// resolveEntity
// ---------------------------------------------------------------------------

/**
 * Resolve a bet description to a canonical entity in three ordered tiers.
 *
 * @param description - Raw sportsbook token/description (treated as data, never SQL)
 * @param sport       - Sport key ('MLB' | 'NFL' | 'NHL' | 'NBA' | ...)
 * @param deps        - Injected dependencies: supabase client, team list, optional betId
 */
export async function resolveEntity(
  description: string,
  sport: string,
  deps: ResolverDeps,
): Promise<EntityResolution> {
  const { supabase, teams, betId } = deps

  // Normalise the lookup token: lowercase the full description.
  // The tier-1 alias lookup checks token equality (not substring) so the caller
  // should pass a pre-tokenized value, e.g. the team nickname extracted from
  // the description. Here we use the whole lowercased description as the token;
  // paste-parser will pass a narrower token in production.
  const token = description.toLowerCase().trim()

  // -------------------------------------------------------------------------
  // TIER 1: Exact alias lookup (sport-scoped, parameterized .eq + .contains)
  // -------------------------------------------------------------------------
  const { data: exactMatch } = await supabase
    .from('teams')
    .select('espn_id, full_name, abbreviation, sport')
    .eq('sport', sport)
    .contains('aliases', [token])
    .limit(1)
    .single()

  if (exactMatch && exactMatch.espn_id) {
    return {
      espn_id: exactMatch.espn_id,
      name: exactMatch.full_name,
      confidence: 1,
      tier: 1,
      entity_type: 'team',
    }
  }

  // -------------------------------------------------------------------------
  // TIER 2: Fuse.js fuzzy match (sport-scoped index — Pitfall 5 prevention)
  // -------------------------------------------------------------------------
  const sportTeams = teams.filter((t) => t.sport === sport)
  const fuseIndex = buildFuseIndex(sportTeams)
  const fuzzyResult = fuzzyResolve(description, fuseIndex)

  if (fuzzyResult && fuzzyResult.score <= FUZZY_AUTO_ACCEPT_THRESHOLD) {
    const team = fuzzyResult.entity
    return {
      espn_id: team.espn_id ?? '',
      name: team.full_name,
      confidence: 1 - fuzzyResult.score,  // invert Fuse score → confidence (0=perfect → 1.0 confidence)
      tier: 2,
      entity_type: 'team',
    }
  }

  // -------------------------------------------------------------------------
  // TIER 3: Enqueue for async agent resolution (D-12)
  // -------------------------------------------------------------------------
  const { data: queued } = await supabase
    .from('entity_resolution_queue')
    .insert({
      bet_id: betId ?? null,
      description,
      sport,
      status: 'pending',
      created_at: new Date().toISOString(),
    })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queueId: string = (queued as any)?.id ?? `pending-${Date.now()}`

  return {
    tier: 3,
    queue_id: queueId,
  }
}
