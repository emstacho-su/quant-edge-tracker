import { fetchActiveSportKeysByGroup } from './odds-api.js'

/** Bounded set of Odds API soccer league keys to search for an unresolved
 *  soccer bet (cost guard — iterating all ~40 leagues per tick is wasteful).
 *  Seeded with the leagues this user actually bets; edit as needed. */
export const SOCCER_LEAGUES = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_usa_mls',
  'soccer_mexico_ligamx',
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_conference_league',
  'soccer_conmebol_copa_libertadores',
]

/** Odds API keys to search for a bet, given its sport. `resolvedKey` (the cached
 *  `odds_sport_key`) short-circuits to a single key. `tennisKeys` are discovered
 *  live (tournament-specific, rotate weekly). Team sports are handled by the
 *  cron's own SPORT_KEYS map, not here. */
export function candidateOddsKeys(
  sport: string | null,
  resolvedKey: string | null,
  tennisKeys: string[],
): string[] {
  if (resolvedKey) return [resolvedKey]
  const s = (sport ?? '').toLowerCase().trim()
  if (s === 'soccer') return SOCCER_LEAGUES
  if (s === 'tennis') return tennisKeys
  return []
}

/** Live tennis tour/tournament keys (free `/sports` call). */
export async function activeTennisKeys(): Promise<string[]> {
  return fetchActiveSportKeysByGroup('Tennis')
}

/** Live golf tournament keys (free `/sports` call). Tournament-specific, rotate. */
export async function activeGolfKeys(): Promise<string[]> {
  return fetchActiveSportKeysByGroup('Golf')
}
