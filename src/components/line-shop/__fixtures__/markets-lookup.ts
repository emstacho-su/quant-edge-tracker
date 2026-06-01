/**
 * markets-lookup.ts — modal-internal helper for resolving parsed slate rows
 * to a `markets.id` UUID before the upload payload is assembled.
 *
 * Kept in __fixtures__ rather than src/hooks/ because it is a modal-scoped
 * helper, not a reusable hook surface.  Promotion to a shared hook can happen
 * when a second consumer appears.
 *
 * Security: anon SELECT against `markets` only (RLS public-read per Phase 7 D-12).
 * No writes are performed here — all writes go through useOffshoreSlate + the
 * upload route (CLAUDE.md invariant).
 *
 * Pitfall 6 (RESEARCH): the upload route's book_prices insert requires a valid
 * markets.id FK.  The modal MUST call resolveMarketId for every kept row and
 * surface unresolvable rows to the user before allowing Confirm.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolveMarketType = 'moneyline' | 'spread' | 'total'

export interface ResolveMarketParams {
  sport: string
  eventNameHint: string
  marketType: ResolveMarketType | null
  marketParam: string | null
}

// ─── inferMarketType ──────────────────────────────────────────────────────────

/**
 * Derive the canonical market_type from the side + point values the parser
 * extracted.
 *
 * Rules:
 *   - home | away  + point null  → moneyline
 *   - home | away  + point       → spread
 *   - over | under + point       → total
 *   - anything else              → null (caller should surface as unresolvable)
 *
 * team_total is intentionally excluded — it requires a player/team identifier
 * the parser does not yet extract (Phase 21 scope boundary).
 */
export function inferMarketType(
  side: 'home' | 'away' | 'over' | 'under' | '',
  point: number | null,
): ResolveMarketType | null {
  if (side === 'home' || side === 'away') {
    return point === null ? 'moneyline' : 'spread'
  }
  if (side === 'over' || side === 'under') {
    return point !== null ? 'total' : null
  }
  return null
}

// ─── resolveMarketId ──────────────────────────────────────────────────────────

/**
 * Resolve (sport, eventNameHint, marketType, marketParam) → markets.id via an
 * anon SELECT.
 *
 * Strategy:
 *   1. Filter by sport + market_type + market_param (exact match on non-null).
 *   2. Substring-match event_name against eventNameHint (case-insensitive LIKE).
 *   3. Narrow to events starting within [now - 6h, now + 24h] — the
 *      "current or imminent" window. The markets table accumulates rows for
 *      every game in a series (e.g. STL @ MIL on May 25/26/27), and we only
 *      want today's game. Without this filter, repeat-matchup series yield
 *      ambiguous results and the modal surfaces every slate row as unmatched.
 *   4. Order by event_start ascending, take the soonest within the window.
 *   5. Return null only when no row matches at all.
 *
 * The caller (UploadSlateModal) surfaces null as a yellow "no market match" row
 * and prevents Confirm until the row is dropped or successfully resolved.
 *
 * @param supabase  - anon Supabase client from @/lib/supabase
 * @param params    - resolution parameters
 * @returns         UUID string or null
 */
export async function resolveMarketId(
  supabase: SupabaseClient,
  params: ResolveMarketParams,
): Promise<string | null> {
  const { sport, eventNameHint, marketType, marketParam } = params

  if (!marketType) return null
  if (!eventNameHint.trim()) return null

  // Escape LIKE special characters in the hint to avoid accidental wildcards.
  const escapedHint = eventNameHint
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')

  const nowMs = Date.now()
  const windowStartIso = new Date(nowMs - 6 * 3_600_000).toISOString()
  const windowEndIso = new Date(nowMs + 24 * 3_600_000).toISOString()

  let query = supabase
    .from('markets')
    .select('id')
    .eq('sport', sport)
    .eq('market_type', marketType)
    .ilike('event_name', `%${escapedHint}%`)
    .gte('event_start', windowStartIso)
    .lte('event_start', windowEndIso)
    .order('event_start', { ascending: true })
    .limit(1)

  if (marketParam !== null) {
    query = query.eq('market_param', marketParam)
  }

  const { data, error } = await query

  if (error || !data || data.length === 0) {
    return null
  }

  return (data[0] as { id: string }).id
}

// ─── Fixture data (for tests) ─────────────────────────────────────────────────

/**
 * Minimal fixture markets that tests can inject as mock resolveMarketId return
 * values.  These do not correspond to real Supabase rows.
 */
export const FIXTURE_MARKETS = [
  {
    id: 'aaaaaaaa-0001-0000-0000-000000000001',
    sport: 'mlb',
    market_type: 'moneyline',
    market_param: null,
    event_name: 'Yankees @ Red Sox',
  },
  {
    id: 'aaaaaaaa-0001-0000-0000-000000000002',
    sport: 'mlb',
    market_type: 'total',
    market_param: '8.5',
    event_name: 'Yankees @ Red Sox',
  },
  {
    id: 'aaaaaaaa-0001-0000-0000-000000000003',
    sport: 'nfl',
    market_type: 'spread',
    market_param: '-3.5',
    event_name: 'Chiefs @ Bills',
  },
] as const
