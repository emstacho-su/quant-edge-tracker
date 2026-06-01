/**
 * seed-rosters.mjs
 * One-shot seeder: MLB active rosters (all 30 teams) + Tennis active field (ATP + WTA).
 *
 * Run: node scripts/seed-rosters.mjs
 * Requires: VITE_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY in .env / .env.local
 *
 * =============================================================================
 * ESPN-ID CAVEAT FOR MLB (important — read before running at cut-over / Plan 07)
 * =============================================================================
 * The players table requires espn_id UNIQUE NOT NULL (canonical D-04 key).
 * MLB StatsAPI returns person.id (the MLB-internal player id, e.g. 605400 for Aaron Nola),
 * which is NOT the ESPN athlete id (e.g. ESPN id for Aaron Nola is 32978).
 *
 * Strategy used here: espn_id is populated using the ESPN Core API athlete lookup:
 *   GET https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/seasons/2025/athletes/{mlbPersonId}
 * This endpoint accepts MLB person ids in its "alternateIds" → not reliable by person id.
 *
 * SAFER APPROACH implemented here (fallback when ESPN lookup is unavailable):
 *   espn_id = "mlb:" + person.id  (prefixed string, e.g. "mlb:605400")
 *   This is a placeholder that satisfies the UNIQUE NOT NULL constraint without
 *   violating it. A follow-up enrichment pass (Plan 07 or daemon) resolves
 *   each placeholder to the real ESPN athlete id by name+team matching via:
 *   GET https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/{espnTeamId}/roster
 *   and matching on full_name. The placeholder prefix "mlb:" makes placeholders
 *   easy to identify and update.
 *
 * For Tennis/Golf/MMA (D-08): competitor.id IS the ESPN athlete id — no placeholder needed.
 *
 * NCAAF: NOT invoked here (D-06 — off-season; logic exists in roster-fetch.ts but is
 *        excluded from this seeder by design).
 * =============================================================================
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Env loading (copied from scripts/seed-teams.mjs)
// ---------------------------------------------------------------------------
function readEnvFile() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    for (const name of ['.env', '.env.local']) {
      const p = join(dir, name)
      if (existsSync(p)) return readFileSync(p, 'utf8')
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error('No .env/.env.local found')
}

const env = readEnvFile()
const SUPABASE_URL =
  env.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim() ??
  env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim()
const KEY = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim()
if (!SUPABASE_URL || !KEY) throw new Error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')

// ---------------------------------------------------------------------------
// MLB — ESPN abbreviation → MLB StatsAPI team ID (static map, 30 teams)
// Pitfall 4: MLB team ids ≠ ESPN team ids — never use ESPN ids here.
// ---------------------------------------------------------------------------
const MLB_TEAM_IDS = {
  AZ: 109, ATH: 133, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CHW: 145,
  CIN: 113, CLE: 114, COL: 115, DET: 116, HOU: 117, KC: 118, LAA: 108,
  LAD: 119, MIA: 146, MIL: 158, MIN: 142, NYM: 121, NYY: 147, PHI: 143,
  PIT: 134, SD: 135, SF: 137, SEA: 136, STL: 138, TB: 139, TEX: 140,
  TOR: 141, WSH: 120,
}

// ---------------------------------------------------------------------------
// Helper: delay (DoS mitigation — T-17-09)
// ---------------------------------------------------------------------------
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Helper: upsert rows into the players table via Supabase REST
// Conflict key: espn_id (UNIQUE NOT NULL on players table)
// ---------------------------------------------------------------------------
async function upsertPlayers(rows) {
  if (rows.length === 0) return { ok: true, count: 0 }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/players?on_conflict=espn_id`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`upsert failed ${res.status}: ${text}`)
  }
  return { ok: true, count: rows.length }
}

// ---------------------------------------------------------------------------
// Helper: fetch the teams table to build espnAbbrev → espn_id lookup
// ---------------------------------------------------------------------------
async function fetchTeamLookup() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/teams?select=espn_id,sport,abbreviation&sport=eq.MLB`,
    {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
      },
    },
  )
  if (!res.ok) throw new Error(`teams fetch failed ${res.status}`)
  const rows = await res.json()
  const lookup = {}
  for (const row of rows) {
    if (row.abbreviation && row.espn_id) {
      lookup[row.abbreviation] = row.espn_id
    }
  }
  return lookup
}

// Generic per-sport team list: returns [{ espn_id, abbreviation }] for one sport.
async function fetchTeamsForSport(sport) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/teams?select=espn_id,sport,abbreviation,full_name&sport=eq.${encodeURIComponent(sport)}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  )
  if (!res.ok) throw new Error(`teams fetch for ${sport} failed ${res.status}`)
  return (await res.json()).filter((r) => r.espn_id)
}

// ---------------------------------------------------------------------------
// MLB active roster fetch
// source_id = person.id (MLB-internal; Pitfall 7 — needed by Phase 18)
// espn_id  = "mlb:{person.id}" placeholder (see header comment for why)
// ---------------------------------------------------------------------------
async function fetchMlbRoster(espnAbbrev, mlbTeamId) {
  const url = `https://statsapi.mlb.com/api/v1/teams/${mlbTeamId}/roster?rosterType=active`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'quant-edge-tracker/1.0 (contact: estack318@gmail.com)' },
  })
  if (!res.ok) throw new Error(`MLB roster ${url} → ${res.status}`)
  const { roster } = await res.json()
  return roster.map((p) => ({
    // espn_id placeholder: "mlb:{person.id}" — enriched to real ESPN id at cut-over (Plan 07)
    // See header comment. This satisfies UNIQUE NOT NULL without violating it.
    espn_id: `mlb:${p.person.id}`,
    sport: 'MLB',              // uppercase — matches teams.sport constraint
    full_name: p.person.fullName,
    short_name: null,
    team_espn_id: null,        // set per-team below after lookup
    position: p.position.abbreviation,
    jersey: p.jerseyNumber,
    active: true,
    source: 'mlb_statsapi',
    source_id: String(p.person.id),  // Pitfall 7: MLB person id for Phase 18 grading
    agent_derived: false,
    updated_at: new Date().toISOString(),
  }))
}

// ---------------------------------------------------------------------------
// ESPN team-roster fetch for NBA / NHL / NFL / WNBA.
// Endpoint: https://site.api.espn.com/apis/site/v2/sports/{path}/teams/{teamId}/roster
// Response can either be:
//   { athletes: [{ position: "guards", items: [{ id, displayName, ... }] }] }   ← nested
// or
//   { athletes: [{ id, displayName, ... }] }                                    ← flat
// We handle both shapes.
// ---------------------------------------------------------------------------
const ESPN_SPORT_PATH = {
  NBA: 'basketball/nba',
  WNBA: 'basketball/wnba',
  NHL: 'hockey/nhl',
  NFL: 'football/nfl',
}

function flattenAthletes(athletes) {
  if (!Array.isArray(athletes)) return []
  const out = []
  for (const a of athletes) {
    if (a && Array.isArray(a.items)) {
      for (const it of a.items) out.push(it)
    } else if (a && a.id && (a.displayName || a.fullName)) {
      out.push(a)
    }
  }
  return out
}

async function fetchEspnRoster(sport, teamEspnId) {
  const path = ESPN_SPORT_PATH[sport]
  if (!path) throw new Error(`unsupported sport ${sport}`)
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamEspnId}/roster`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'quant-edge-tracker/1.0 (contact: estack318@gmail.com)' },
  })
  if (!res.ok) throw new Error(`${sport} roster ${teamEspnId} → ${res.status}`)
  const data = await res.json()
  const rows = []
  for (const ath of flattenAthletes(data.athletes)) {
    const id = ath.id != null ? String(ath.id) : null
    const fullName = ath.fullName ?? ath.displayName ?? null
    if (!id || !fullName) continue
    rows.push({
      espn_id: id,
      sport,
      full_name: fullName,
      short_name: ath.shortName ?? null,
      team_espn_id: teamEspnId,
      position:
        typeof ath.position === 'string'
          ? ath.position
          : ath.position?.abbreviation ?? ath.position?.displayName ?? null,
      jersey: ath.jersey != null ? String(ath.jersey) : null,
      active: ath.active !== false,
      source: 'espn',
      source_id: id,
      agent_derived: false,
      updated_at: new Date().toISOString(),
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Tennis active field fetch (ATP + WTA)
// competitor.id IS the ESPN athlete id — no placeholder needed (D-08)
// ---------------------------------------------------------------------------
async function fetchTennisActiveField(league) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'quant-edge-tracker/1.0' },
  })
  if (!res.ok) throw new Error(`Tennis ${league} scoreboard ${url} → ${res.status}`)
  const data = await res.json()

  const seen = new Set()
  const players = []
  for (const event of data.events ?? []) {
    for (const grouping of event.groupings ?? []) {
      for (const competition of grouping.competitions ?? []) {
        for (const competitor of competition.competitors ?? []) {
          if (!competitor.id || seen.has(competitor.id)) continue
          seen.add(competitor.id)
          players.push({
            espn_id: competitor.id,                         // real ESPN id — no placeholder
            sport: 'Tennis',
            full_name: competitor.athlete?.fullName ?? competitor.athlete?.displayName ?? '',
            short_name: competitor.athlete?.shortName ?? null,
            team_espn_id: null,    // individual sport — composite FK skipped (MATCH SIMPLE)
            position: null,
            jersey: null,
            active: true,
            source: 'espn',
            source_id: competitor.id,   // ESPN id doubles as source_id for Tennis
            agent_derived: false,
            updated_at: new Date().toISOString(),
          })
        }
      }
    }
  }
  return players
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== seed-rosters.mjs ===')
  console.log('Fetching MLB team lookup from Supabase...')

  // Build ESPN abbrev → espn_id lookup for MLB teams
  const teamLookup = await fetchTeamLookup()
  console.log(`  Found ${Object.keys(teamLookup).length} MLB teams in Supabase`)

  // ------------------------------------------------------------------
  // MLB — all 30 teams (~1 req/s — T-17-09 DoS mitigation)
  // ------------------------------------------------------------------
  console.log('\nSeeding MLB active rosters (30 teams, ~1 req/s)...')
  let mlbTotal = 0
  let mlbErrors = 0

  for (const [espnAbbrev, mlbTeamId] of Object.entries(MLB_TEAM_IDS)) {
    try {
      const players = await fetchMlbRoster(espnAbbrev, mlbTeamId)

      // Resolve team_espn_id from the lookup (null if team not in DB yet — safe, FK is MATCH SIMPLE)
      const teamEspnId = teamLookup[espnAbbrev] ?? null
      for (const p of players) {
        p.team_espn_id = teamEspnId
      }

      const { count } = await upsertPlayers(players)
      mlbTotal += count
      process.stdout.write(`  ${espnAbbrev}(${count}) `)
    } catch (e) {
      mlbErrors++
      console.error(`\n  ERROR ${espnAbbrev}: ${e.message}`)
    }

    // ~1 req/s delay between teams (DoS mitigation — T-17-09)
    await delay(1100)
  }
  console.log(`\n  MLB done: ${mlbTotal} players upserted, ${mlbErrors} team errors`)

  // ------------------------------------------------------------------
  // NBA / NHL / NFL / WNBA — ESPN team roster API (~1 req/s per team)
  // ------------------------------------------------------------------
  const espnSports = (process.env.SPORTS
    ? process.env.SPORTS.split(',').map((s) => s.trim().toUpperCase())
    : ['NBA', 'NHL', 'NFL', 'WNBA']
  ).filter((s) => s in ESPN_SPORT_PATH)

  const sportTotals = {}
  for (const sport of espnSports) {
    console.log(`\nSeeding ${sport} active rosters (ESPN team roster API, ~1 req/s)...`)
    const teams = await fetchTeamsForSport(sport)
    if (teams.length === 0) {
      console.log(`  No ${sport} teams in Supabase — run seed-teams.mjs first.`)
      sportTotals[sport] = 0
      continue
    }
    console.log(`  Found ${teams.length} ${sport} teams in Supabase`)
    let total = 0
    let errs = 0
    for (const t of teams) {
      try {
        const rows = await fetchEspnRoster(sport, t.espn_id)
        const { count } = await upsertPlayers(rows)
        total += count
        process.stdout.write(`  ${t.abbreviation || t.espn_id}(${count}) `)
      } catch (e) {
        errs++
        console.error(`\n  ERROR ${sport} ${t.abbreviation || t.espn_id}: ${e.message}`)
      }
      await delay(1100)
    }
    sportTotals[sport] = total
    console.log(`\n  ${sport} done: ${total} players upserted, ${errs} team errors`)
  }

  // ------------------------------------------------------------------
  // Tennis — ATP + WTA active field (D-08)
  // NCAAF is NOT called here (D-06 — off-season; logic exists in roster-fetch.ts).
  // ------------------------------------------------------------------
  console.log('\nSeeding Tennis active field (ATP + WTA)...')
  let tennisTotal = 0

  for (const league of ['atp', 'wta']) {
    try {
      const players = await fetchTennisActiveField(league)
      const { count } = await upsertPlayers(players)
      tennisTotal += count
      console.log(`  Tennis ${league.toUpperCase()}: ${count} players upserted`)
    } catch (e) {
      console.error(`  ERROR Tennis ${league}: ${e.message}`)
    }
    await delay(500)
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n=== Seed complete ===')
  console.log(`  MLB:    ${mlbTotal} players`)
  for (const sport of espnSports) {
    console.log(`  ${sport.padEnd(6)}: ${sportTotals[sport] ?? 0} players`)
  }
  console.log(`  Tennis: ${tennisTotal} players`)
  console.log('\nNote: MLB espn_id values are "mlb:{person.id}" placeholders.')
  console.log('      Run the enrichment pass at cut-over (Plan 07) to resolve to real ESPN ids.')
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
