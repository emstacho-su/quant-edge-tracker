/**
 * Pure ESPN teams-response parser + league registry. Used by the dev seed
 * script and the weekly refresh cron. ESPN quirk: `name` is the nickname
 * ("Diamondbacks"), `location` is the city, `displayName` is the full name.
 */
export interface TeamRow {
  sport: string
  league: string
  full_name: string
  location: string | null
  nickname: string | null
  abbreviation: string
  aliases: string[]
  espn_id: string | null
}

export const LEAGUES: { sport: string; league: string; path: string }[] = [
  { sport: 'MLB', league: 'mlb', path: 'baseball/mlb' },
  { sport: 'NBA', league: 'nba', path: 'basketball/nba' },
  { sport: 'WNBA', league: 'wnba', path: 'basketball/wnba' },
  { sport: 'NHL', league: 'nhl', path: 'hockey/nhl' },
  { sport: 'NFL', league: 'nfl', path: 'football/nfl' },
]

interface EspnTeam {
  id?: string | number
  location?: string
  name?: string
  abbreviation?: string
  displayName?: string
  shortDisplayName?: string
  slug?: string
}

export function parseEspnTeams(json: unknown, sport: string, league: string): TeamRow[] {
  const root = json as {
    sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: EspnTeam }> }> }>
  }
  const teams = root?.sports?.[0]?.leagues?.[0]?.teams ?? []
  return teams
    .map((t) => t?.team)
    .filter((t): t is EspnTeam => !!t)
    .map((t): TeamRow => ({
      sport,
      league,
      full_name: t.displayName ?? '',
      location: t.location ?? null,
      nickname: t.name ?? null,
      abbreviation: t.abbreviation ?? '',
      aliases: Array.from(
        new Set(
          [t.shortDisplayName, t.slug, t.name, t.location].filter(
            (s): s is string => !!s,
          ),
        ),
      ),
      espn_id: t.id != null ? String(t.id) : null,
    }))
    .filter((r) => r.abbreviation && r.full_name)
}

export async function fetchLeagueTeams(path: string): Promise<unknown> {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${path}/teams`,
  )
  if (!res.ok) throw new Error(`ESPN teams ${path} -> ${res.status}`)
  return res.json()
}
