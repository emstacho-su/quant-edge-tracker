/**
 * roster-fetch.ts
 * Per-sport roster + active-field fetchers.
 *
 * Sources (all verified live probe 2026-05-24):
 *   MLB  — statsapi.mlb.com/api/v1/teams/{mlbTeamId}/roster?rosterType=active
 *   NHL  — api-web.nhle.com/v1/roster/{teamAbbrev}/current
 *   NBA  — stats.nba.com/stats/commonteamroster (requires 4 browser-like headers)
 *   NFL/NCAAF — site.api.espn.com ESPN roster (NCAAF logic present per D-06; NOT populated)
 *   Tennis/Golf/MMA — site.api.espn.com scoreboard → active field (D-08)
 *
 * MLB espn_id caveat (Pitfall 4 + 7):
 *   MLB StatsAPI person.id is the MLB-internal player id, NOT the ESPN athlete id.
 *   We store it as `source_id` (for Phase 18 grading). The seeder (seed-rosters.mjs)
 *   must resolve ESPN athlete ids separately — either by fetching the ESPN core athlete
 *   endpoint (sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/seasons/2025/athletes/{id})
 *   or by using the MLB player's fullName + team to match against ESPN. The seeder documents
 *   its chosen approach in a header comment.
 *
 * NCAAF is wired in SPORT_PATHS so the logic exists (D-06), but the seeder NEVER calls it
 * because NCAAF is off-season. See scripts/seed-rosters.mjs for the commented-out note.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RosterPlayer {
  source_id: string        // league-official player id (for Phase 18 grading)
  full_name: string
  jersey: string
  position: string
}

export interface EspnRosterPlayer {
  id: string               // ESPN athlete id (canonical D-04)
  displayName: string
  fullName: string
  jersey: string | null
  position: { abbreviation: string } | null
}

export interface ActiveFieldPlayer {
  espn_id: string          // ESPN athlete id (canonical D-04)
  full_name: string
  short_name: string | null
  sport: string            // 'Tennis' | 'Golf' | 'MMA'
  team_espn_id: null       // always null for individual sports (D-08)
  source: 'espn'
}

// ---------------------------------------------------------------------------
// SPORT_PATHS — ESPN site API sport routing
// NCAAF included so the logic exists (D-06); seeder never calls it.
// ---------------------------------------------------------------------------

export const SPORT_PATHS: Record<string, string> = {
  MLB: 'baseball/mlb',
  NBA: 'basketball/nba',
  WNBA: 'basketball/wnba',
  NHL: 'hockey/nhl',
  NFL: 'football/nfl',
  NCAAF: 'football/college-football',  // D-06: logic present, NOT populated
}

// ---------------------------------------------------------------------------
// MLB — statsapi.mlb.com
// ESPN abbreviation → MLB StatsAPI team ID (static map, verified 2026-05-24)
// Pitfall 4: MLB team ids ≠ ESPN team ids — never substitute ESPN ids here.
// ---------------------------------------------------------------------------

export const MLB_TEAM_IDS: Record<string, number> = {
  // ESPN abbreviation → MLB StatsAPI team ID
  AZ: 109, ATH: 133, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CHW: 145,
  CIN: 113, CLE: 114, COL: 115, DET: 116, HOU: 117, KC: 118, LAA: 108,
  LAD: 119, MIA: 146, MIL: 158, MIN: 142, NYM: 121, NYY: 147, PHI: 143,
  PIT: 134, SD: 135, SF: 137, SEA: 136, STL: 138, TB: 139, TEX: 140,
  TOR: 141, WSH: 120,
}

/**
 * Fetch the active roster for an MLB team.
 * source_id = MLB person.id (NOT the ESPN athlete id — see file header for espn_id caveat).
 * Pitfall 7: always populate source_id so Phase 18 can call statsapi.mlb.com/api/v1/people/{id}/stats.
 */
export async function fetchMlbActiveRoster(espnAbbrev: string): Promise<RosterPlayer[]> {
  const mlbId = MLB_TEAM_IDS[espnAbbrev]
  if (!mlbId) throw new Error(`Unknown MLB abbreviation: ${espnAbbrev}`)
  const url = `https://statsapi.mlb.com/api/v1/teams/${mlbId}/roster?rosterType=active`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'quant-edge-tracker/1.0 (contact: estack318@gmail.com)' },
  })
  if (!res.ok) throw new Error(`MLB roster ${url} → ${res.status}`)
  const { roster } = await res.json() as {
    roster: Array<{
      person: { id: number; fullName: string }
      jerseyNumber: string
      position: { abbreviation: string }
    }>
  }
  return roster.map((p) => ({
    source_id: String(p.person.id),    // MLB person id — Pitfall 7
    full_name: p.person.fullName,
    jersey: p.jerseyNumber,
    position: p.position.abbreviation,
  }))
}

// ---------------------------------------------------------------------------
// NHL — api-web.nhle.com
// Pitfall 3: firstName / lastName are locale objects { default: string },
// NOT plain strings. Always access player.firstName.default.
// ---------------------------------------------------------------------------

export async function fetchNhlRoster(teamAbbrev: string): Promise<RosterPlayer[]> {
  const url = `https://api-web.nhle.com/v1/roster/${teamAbbrev}/current`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 quant-edge-tracker/1.0' },
  })
  if (!res.ok) throw new Error(`NHL roster ${url} → ${res.status}`)
  const data = await res.json() as {
    forwards?: Array<NhlPlayer>
    defensemen?: Array<NhlPlayer>
    goalies?: Array<NhlPlayer>
  }
  const all = [
    ...(data.forwards ?? []),
    ...(data.defensemen ?? []),
    ...(data.goalies ?? []),
  ]
  return all.map((p) => ({
    source_id: String(p.id),
    // Pitfall 3: firstName.default — NOT String(p.firstName) which gives "[object Object]"
    full_name: `${p.firstName.default} ${p.lastName.default}`,
    jersey: String(p.sweaterNumber),
    position: p.positionCode,
  }))
}

interface NhlPlayer {
  id: number
  firstName: { default: string }
  lastName: { default: string }
  sweaterNumber: number
  positionCode: string
}

// ---------------------------------------------------------------------------
// NBA — stats.nba.com
// Pitfall 2: MUST send all 4 browser-like headers or receive 403 / timeout.
// On !res.ok the caller (seed-rosters.mjs) can fall back to fetchEspnRoster.
// ---------------------------------------------------------------------------

const NBA_TEAM_IDS: Record<string, number> = {
  // ESPN abbreviation → NBA stats.nba.com team ID
  ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766,
  CHI: 1610612741, CLE: 1610612739, DAL: 1610612742, DEN: 1610612743,
  DET: 1610612765, GS: 1610612744, HOU: 1610612745, IND: 1610612754,
  LAC: 1610612746, LAL: 1610612747, MEM: 1610612763, MIA: 1610612748,
  MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NY: 1610612752,
  OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756,
  POR: 1610612757, SAC: 1610612758, SA: 1610612759, TOR: 1610612761,
  UTAH: 1610612762, WSH: 1610612764,
}

const NBA_SEASON = '2024-25'

/**
 * Fetch the current roster for an NBA team.
 * Sends the 4 required headers (Pitfall 2). Throws on non-ok so the seeder
 * can catch and fall back to fetchEspnRoster.
 */
export async function fetchNbaRoster(espnAbbrev: string): Promise<RosterPlayer[]> {
  const nbaId = NBA_TEAM_IDS[espnAbbrev]
  if (!nbaId) throw new Error(`Unknown NBA abbreviation: ${espnAbbrev}`)
  const url = `https://stats.nba.com/stats/commonteamroster?LeagueID=00&Season=${NBA_SEASON}&TeamID=${nbaId}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://www.nba.com/',
      'x-nba-stats-origin': 'stats',
      'x-nba-stats-token': 'true',
    },
  })
  if (!res.ok) throw new Error(`NBA roster ${url} → ${res.status}`)
  const data = await res.json() as {
    resultSets: Array<{
      headers: string[]
      rowSet: unknown[][]
    }>
  }
  const rs = data.resultSets[0]
  const headers = rs.headers
  return rs.rowSet.map((row) => {
    const get = (key: string) => row[headers.indexOf(key)]
    return {
      source_id: String(get('PLAYER_ID')),
      full_name: get('PLAYER') as string,
      jersey: get('NUM') as string,
      position: get('POSITION') as string,
    }
  })
}

// ---------------------------------------------------------------------------
// ESPN roster (uniform fallback + NFL primary + NCAAF logic)
// Handles BOTH response shapes:
//   flat:    { athletes: [{ id, fullName, ... }] }          — MLB, NBA
//   grouped: { athletes: [{ position, items: [...] }] }     — NFL, NHL
// ---------------------------------------------------------------------------

/**
 * Fetch a team roster from the ESPN site API.
 * Returns ESPN athlete ids directly (the canonical D-04 id).
 * NCAAF is accessible via SPORT_PATHS['NCAAF'] but NOT invoked by the seeder (D-06).
 */
export async function fetchEspnRoster(
  sport: string,
  espnTeamId: string,
): Promise<EspnRosterPlayer[]> {
  const path = SPORT_PATHS[sport]
  if (!path) throw new Error(`No ESPN path for sport: ${sport}`)
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${espnTeamId}/roster`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'quant-edge-tracker/1.0' },
  })
  if (!res.ok) throw new Error(`ESPN roster ${url} → ${res.status}`)
  const data = await res.json() as { athletes?: unknown[] }
  const raw = data.athletes ?? []
  if (raw.length > 0 && Array.isArray((raw[0] as { items?: unknown[] })?.items)) {
    // Grouped shape (NFL, NHL): [{ position: string, items: EspnRosterPlayer[] }]
    return (raw as Array<{ items?: EspnRosterPlayer[] }>).flatMap((g) => g.items ?? [])
  }
  // Flat shape (MLB, NBA)
  return raw as EspnRosterPlayer[]
}

// ---------------------------------------------------------------------------
// Active field — Tennis (atp/wta), Golf (pga), MMA (ufc)
// ESPN scoreboard → competitor list (D-08)
// team_espn_id is always null for individual sports (composite FK skipped via MATCH SIMPLE)
// ---------------------------------------------------------------------------

const SCOREBOARD_PATHS: Record<string, string> = {
  atp: 'tennis/atp/scoreboard',
  wta: 'tennis/wta/scoreboard',
  pga: 'golf/pga/scoreboard',
  ufc: 'mma/ufc/scoreboard',
}

const SCOREBOARD_SPORT: Record<string, string> = {
  atp: 'Tennis',
  wta: 'Tennis',
  pga: 'Golf',
  ufc: 'MMA',
}

/**
 * Fetch the current active field for an individual sport from the ESPN scoreboard.
 * Returns competitors de-duplicated by espn_id.
 * team_espn_id is null — required by the composite FK (MATCH SIMPLE skips null FK columns).
 *
 * @param league One of: 'atp' | 'wta' | 'pga' | 'ufc'
 */
export async function fetchActiveField(league: string): Promise<ActiveFieldPlayer[]> {
  const sbPath = SCOREBOARD_PATHS[league]
  if (!sbPath) throw new Error(`No scoreboard path for league: ${league}`)
  const sport = SCOREBOARD_SPORT[league]
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sbPath}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'quant-edge-tracker/1.0' },
  })
  if (!res.ok) throw new Error(`Active field ${url} → ${res.status}`)
  const data = await res.json() as {
    events?: Array<{
      groupings?: Array<{
        competitions?: Array<{
          competitors?: Array<{
            id: string
            type: string
            athlete?: {
              fullName?: string
              displayName?: string
              shortName?: string
            }
          }>
        }>
      }>
    }>
  }

  const seen = new Set<string>()
  const players: ActiveFieldPlayer[] = []

  for (const event of data.events ?? []) {
    for (const grouping of event.groupings ?? []) {
      for (const competition of grouping.competitions ?? []) {
        for (const competitor of competition.competitors ?? []) {
          if (!competitor.id || seen.has(competitor.id)) continue
          seen.add(competitor.id)
          players.push({
            espn_id: competitor.id,
            full_name: competitor.athlete?.fullName ?? competitor.athlete?.displayName ?? '',
            short_name: competitor.athlete?.shortName ?? null,
            sport,
            team_espn_id: null,   // individual sport — no team FK (D-08)
            source: 'espn',
          })
        }
      }
    }
  }

  return players
}
