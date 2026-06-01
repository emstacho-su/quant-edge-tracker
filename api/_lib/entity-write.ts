/**
 * entity-write.ts — Service-client write helpers for the entity resolution layer (D-13).
 *
 * Server-only module — uses the service-role Supabase client which bypasses RLS.
 * Never import this in browser-bundled code (process.env access would fail).
 *
 * SECURITY (T-17-05):
 *   - Uses getServiceClient() which throws at construction time if env vars are missing.
 *   - Writes only specific columns; inputs are treated as DATA (never SQL fragments).
 *
 * ESM CONVENTION:
 *   All local imports within api/ use the .js extension (Vercel ESM convention).
 */

import { getServiceClient } from './supabase-admin.js'
import type { ResolvedEntity } from '../../src/utils/entity-resolver.js'

// ---------------------------------------------------------------------------
// Shared return type
// ---------------------------------------------------------------------------

export interface WriteResult {
  ok: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// PlayerRow type (matches the `players` table schema from 17-01 migration)
// ---------------------------------------------------------------------------

export interface PlayerRow {
  espn_id: string
  sport: string
  full_name: string
  short_name?: string | null
  team_espn_id?: string | null
  position?: string | null
  jersey?: string | null
  active?: boolean
  source?: string
  source_id?: string | null
  agent_derived?: boolean
  updated_at?: string
}

// ---------------------------------------------------------------------------
// upsertPlayers
// ---------------------------------------------------------------------------

/**
 * Upsert a batch of player rows into the `players` table.
 * Conflict key: espn_id (unique per player across all sports — D-04 canonical key).
 */
export async function upsertPlayers(rows: PlayerRow[]): Promise<WriteResult> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('players')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'espn_id' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// upsertTeamAlias
// ---------------------------------------------------------------------------

/**
 * Upsert a single alias into the `team_aliases` join table.
 *
 * @param teamId  - UUID of the team row in `teams`
 * @param alias   - The alias string to add (e.g. 'stl', 'cards', 'cardinals')
 * @param source  - Provenance tag: 'seed' | 'agent_derived' | 'manual'
 *
 * D-13: agent write-backs must pass source='agent_derived' so the origin is
 * permanently recorded and auditable.
 */
export async function upsertTeamAlias(
  teamId: string,
  alias: string,
  source: 'seed' | 'agent_derived' | 'manual',
): Promise<WriteResult> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('team_aliases')
    .upsert(
      { team_id: teamId, alias, source },
      { onConflict: 'team_id,alias' },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// writeBetResolution
// ---------------------------------------------------------------------------

/**
 * Stamp a resolved entity onto a bet row.
 *
 * When called for an agent-derived result, the caller should set
 * resolution.entity_resolution_status = 'agent_derived' (D-13).
 * For deterministic tier-1/tier-2 results the status defaults to 'resolved'.
 */
export async function writeBetResolution(
  betId: string,
  resolution: ResolvedEntity & { entity_resolution_status?: string },
): Promise<WriteResult> {
  const supabase = getServiceClient()
  const status =
    resolution.entity_resolution_status ??
    (resolution.tier === 2 ? 'resolved' : 'resolved')

  const { error } = await supabase
    .from('bets')
    .update({
      entity_espn_id: resolution.espn_id,
      entity_resolution_status: status,
      entity_type: resolution.entity_type,
      entity_confidence: resolution.confidence,
    })
    .eq('id', betId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// markResolutionQueueDone
// ---------------------------------------------------------------------------

/**
 * Mark an entity_resolution_queue row as resolved after the agent writes back.
 *
 * @param queueId - UUID of the queue row
 * @param espnId  - The resolved ESPN entity ID
 */
export async function markResolutionQueueDone(
  queueId: string,
  espnId: string,
): Promise<WriteResult> {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('entity_resolution_queue')
    .update({
      status: 'resolved',
      result_espn_id: espnId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', queueId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
