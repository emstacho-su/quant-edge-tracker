import { matchScore } from './match.js'

/**
 * MLB StatsAPI named-field stat extractor.
 *
 * Reads player stats from the MLB StatsAPI boxscore endpoint
 * (GET /api/v1/game/{gamePk}/boxscore) which returns named JSON fields —
 * NOT the ESPN label-indexed array format used by fetchBoxScorePlayers.
 *
 * Field names verified against live API (gamePk 823380, 2026-05-25):
 *   pitching: strikeOuts, inningsPitched, hits, earnedRuns, baseOnBalls, homeRuns, runs
 *   batting:  hits, runs, rbi, homeRuns, stolenBases, baseOnBalls, strikeOuts, atBats
 *
 * Safety rail: null on ANY doubt — missing field, absent player, unknown statKey.
 * NEVER returns 0 as a default. Caller maps null → pending / needs-agent.
 */

// --- Minimal local types for MLB StatsAPI boxscore shape ---

interface MlbBattingStats {
  hits?: number | null
  runs?: number | null
  rbi?: number | null
  homeRuns?: number | null
  stolenBases?: number | null
  baseOnBalls?: number | null
  strikeOuts?: number | null
  atBats?: number | null
  [key: string]: unknown
}

interface MlbPitchingStats {
  strikeOuts?: number | null
  inningsPitched?: string | null
  hits?: number | null
  earnedRuns?: number | null
  baseOnBalls?: number | null
  homeRuns?: number | null
  runs?: number | null
  [key: string]: unknown
}

interface MlbPlayerStats {
  batting?: MlbBattingStats
  pitching?: MlbPitchingStats
}

interface MlbPlayer {
  person?: { fullName?: string }
  stats?: MlbPlayerStats
}

interface MlbTeamPlayers {
  players?: Record<string, MlbPlayer>
}

export interface MlbBoxscorePlayers {
  teams?: {
    away?: MlbTeamPlayers
    home?: MlbTeamPlayers
  }
}

/**
 * Extract a player's stat value from an MLB StatsAPI boxscore.
 *
 * @param players  The `teams` object from /api/v1/game/{gamePk}/boxscore
 * @param playerName  Player name to match (fuzzy, via matchScore)
 * @param statKey  Canonical taxonomy key (e.g. 'strikeouts_pitcher', 'hits_batter', 'rbi')
 * @returns The numeric stat value, or null if the player is absent, the stat key is
 *          unrecognized, or the named field is missing/empty in the API response.
 */
export function extractMlbStat(
  players: MlbBoxscorePlayers,
  playerName: string,
  statKey: string,
): number | null {
  const sides: (MlbTeamPlayers | undefined)[] = [
    players?.teams?.away,
    players?.teams?.home,
  ]
  for (const side of sides) {
    if (!side?.players) continue
    for (const entry of Object.values(side.players)) {
      const fullName = entry?.person?.fullName ?? ''
      if (matchScore(playerName, fullName) < 1) continue

      // Player found — read the named field for the requested stat key
      const batting = entry?.stats?.batting
      const pitching = entry?.stats?.pitching

      switch (statKey) {
        // --- Pitching stats ---
        case 'strikeouts_pitcher':
          return pitching?.strikeOuts ?? null
        case 'hits_allowed':
          return pitching?.hits ?? null
        case 'walks_pitcher':
          return pitching?.baseOnBalls ?? null
        case 'earned_runs':
          return pitching?.earnedRuns ?? null
        case 'hr_allowed':
          return pitching?.homeRuns ?? null

        // --- Batting stats ---
        case 'hits_batter':
          return batting?.hits ?? null
        case 'rbi':
          return batting?.rbi ?? null
        case 'hr':
          return batting?.homeRuns ?? null
        case 'runs':
          return batting?.runs ?? null
        case 'stolen_bases':
          return batting?.stolenBases ?? null
        case 'walks_batter':
          return batting?.baseOnBalls ?? null
        case 'strikeouts_batter':
          return batting?.strikeOuts ?? null

        // --- Unknown statKey → null (never 0, never guess) ---
        default:
          return null
      }
    }
  }
  return null // player not found (DNP or not in box score)
}

/**
 * Fetch the MLB StatsAPI boxscore for a given gamePk.
 * Returns null if the fetch fails — caller falls back to ESPN or marks needs-agent.
 */
export async function fetchMlbBoxscore(gamePk: string | number): Promise<MlbBoxscorePlayers | null> {
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`)
    if (!res.ok) return null
    return (await res.json()) as MlbBoxscorePlayers
  } catch {
    return null
  }
}
