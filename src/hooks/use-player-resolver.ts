import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Client-side player → team resolver, backed by the `players` table seeded in
 * Phase 17. Used by /today's prop matcher to look up a player by name when the
 * bet description omits the `(TEAM)` annotation (the only signal the static
 * `TEAM_TO_SPORTS` map can use).
 *
 * Loads once on mount: every active player + the per-sport team list (to map
 * each player's `team_espn_id` → its abbreviation). Tens of thousands of rows
 * across all sports is still a single-digit MB payload — fine for a single-user
 * tracker, and avoids per-bet round-trips during matching.
 */

export interface PlayerHit {
  fullName: string
  sport: string
  teamAbbrev: string | null
}

export interface PlayerResolver {
  resolve(name: string, hint?: { sport?: string }): PlayerHit | null
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Index keys for a player — full name, short name, and bare last name when
 *  long enough to be reasonably unambiguous. */
function nameKeys(fullName: string, shortName: string | null): string[] {
  const keys = new Set<string>()
  const full = normalize(fullName)
  keys.add(full)
  if (shortName) keys.add(normalize(shortName))
  const parts = full.split(/\s+/)
  if (parts.length >= 2 && parts[parts.length - 1].length >= 5) {
    keys.add(parts[parts.length - 1])
  }
  return [...keys].filter(Boolean)
}

export function usePlayerResolver(): PlayerResolver | null {
  const [resolver, setResolver] = useState<PlayerResolver | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      // PostgREST caps result rows (Supabase defaults to 1000) — the players
      // table is ~6k rows, so a naive select drops most of the league. Page
      // through in 1000-row windows until we get a short page.
      const PAGE_SIZE = 1000
      const players: { full_name: string; short_name: string | null; sport: string; team_espn_id: string | null }[] = []
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('players')
          .select('full_name, short_name, sport, team_espn_id')
          .eq('active', true)
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1)
        if (error) {
          console.error('usePlayerResolver: players page failed', error.message)
          break
        }
        const page = data ?? []
        players.push(...page)
        if (page.length < PAGE_SIZE) break
        if (!alive) return
      }

      const { data: teams } = await supabase
        .from('teams')
        .select('sport, espn_id, abbreviation')
      if (!alive) return

      const teamAbbrevByKey = new Map<string, string>()
      for (const t of teams ?? []) {
        if (t?.abbreviation && t?.espn_id && t?.sport) {
          teamAbbrevByKey.set(`${t.sport}|${t.espn_id}`, t.abbreviation)
        }
      }

      const byKey = new Map<string, PlayerHit[]>()
      for (const p of players) {
        if (!p?.full_name || !p?.sport) continue
        const abbrev =
          p.team_espn_id ? teamAbbrevByKey.get(`${p.sport}|${p.team_espn_id}`) ?? null : null
        const hit: PlayerHit = {
          fullName: p.full_name,
          sport: p.sport,
          teamAbbrev: abbrev,
        }
        for (const key of nameKeys(p.full_name, p.short_name)) {
          const list = byKey.get(key) ?? []
          list.push(hit)
          byKey.set(key, list)
        }
      }

      setResolver({
        resolve(name, hint) {
          const key = normalize(name)
          const candidates = byKey.get(key) ?? []
          if (candidates.length === 0) return null
          // Sport hint disambiguates cross-sport name collisions (rare but
          // real — e.g. Michael Jordan baseball player + NBA player).
          if (hint?.sport) {
            const match = candidates.find((c) => c.sport === hint.sport)
            if (match) return match
          }
          if (candidates.length === 1) return candidates[0]
          // Ambiguous without a sport hint — refuse to guess.
          return null
        },
      })
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  return resolver
}
