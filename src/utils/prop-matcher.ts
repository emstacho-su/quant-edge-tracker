import type { Bet } from '@/lib/types'
import type { LiveGame } from '@/hooks/use-live-scores'
import type { GameBoxscore, PlayerStatRow } from '@/hooks/use-boxscores'
import type { PlayerResolver } from '@/hooks/use-player-resolver'
import {
  parseProp,
  type ParsedProp,
  type PropStat,
} from '@/utils/prop-parser'
import type { LiveStatus, PredictedOutcome, BetPeriod } from '@/utils/team-matcher'
import {
  borderlineMargin,
  getElapsedFraction,
  getOnPaceStatus,
} from '@/utils/team-matcher'

// ---------------------------------------------------------------------------
// Team abbrev → sport resolver
// ---------------------------------------------------------------------------
//
// Bet description has "(ANA)" / "(NY)" — we use this to figure out which
// scoreboard / boxscore to consult, since the bet's `sport` field is
// occasionally wrong (sport-detector mis-classifies NHL props as NBA when
// the keyword "Points" wins over a non-keyword team match).
// ---------------------------------------------------------------------------

const TEAM_TO_SPORTS: Readonly<Record<string, readonly string[]>> = {
  // NBA
  ATL: ['NBA', 'NHL', 'MLB', 'NFL'],
  BOS: ['NBA', 'NHL', 'MLB'],
  BKN: ['NBA'],
  CHA: ['NBA'],
  CHI: ['NBA', 'NHL', 'NFL', 'MLB'],
  CLE: ['NBA', 'MLB', 'NFL'],
  DAL: ['NBA', 'NHL', 'NFL', 'MLB'],
  DEN: ['NBA', 'NFL'],
  DET: ['NBA', 'NHL', 'NFL', 'MLB'],
  GS: ['NBA'], GSW: ['NBA'],
  HOU: ['NBA', 'MLB', 'NFL'],
  IND: ['NBA', 'NFL'],
  LAC: ['NBA', 'NFL'],
  LAL: ['NBA'],
  MEM: ['NBA'],
  MIA: ['NBA', 'NHL', 'NFL', 'MLB'],
  MIL: ['NBA', 'MLB'],
  MIN: ['NBA', 'NHL', 'NFL', 'MLB'],
  NOP: ['NBA', 'NFL'],
  NY: ['NBA'], NYK: ['NBA'],
  OKC: ['NBA'],
  ORL: ['NBA'],
  PHI: ['NBA', 'NHL', 'NFL', 'MLB'],
  PHX: ['NBA'],
  POR: ['NBA'],
  SAC: ['NBA'],
  SAS: ['NBA'], SA: ['NBA'],
  TOR: ['NBA', 'MLB'],
  UTA: ['NBA', 'NHL'], UTAH: ['NBA'],
  WAS: ['NBA', 'NHL', 'NFL', 'MLB'], WSH: ['NHL', 'NFL', 'MLB'],

  // NHL-only (or NHL primary)
  ANA: ['NHL'],
  ARI: ['NHL', 'MLB', 'NFL'],
  BUF: ['NHL', 'NFL'],
  CGY: ['NHL'],
  CAR: ['NHL', 'NFL'],
  CBJ: ['NHL'],
  COL: ['NHL', 'MLB'],
  EDM: ['NHL'],
  FLA: ['NHL'],
  LA: ['NHL'], LAK: ['NHL'],
  MTL: ['NHL'],
  NSH: ['NHL'],
  NJ: ['NHL'], NJD: ['NHL'],
  NYI: ['NHL'],
  NYR: ['NHL'],
  OTT: ['NHL'],
  PIT: ['NHL', 'MLB', 'NFL'],
  SJ: ['NHL'], SJS: ['NHL'],
  SEA: ['NHL', 'NFL', 'MLB'],
  STL: ['NHL', 'MLB'],
  TB: ['NHL', 'MLB', 'NFL'], TBL: ['NHL'], TBR: ['MLB'], TBB: ['NFL'],
  VAN: ['NHL'],
  VGK: ['NHL'],
  WPG: ['NHL'], WIN: ['NHL'],

  // MLB-only
  NYY: ['MLB'], NYM: ['MLB'],
  LAD: ['MLB'], LAA: ['MLB'],
  BAL: ['MLB', 'NFL'],
  CHW: ['MLB'], CHC: ['MLB'],
  CIN: ['MLB', 'NFL'],
  KC: ['MLB', 'NFL'], KCR: ['MLB'], KCC: ['NFL'],
  OAK: ['MLB'],
  SD: ['MLB'], SDP: ['MLB'],
  SF: ['MLB', 'NFL'], SFG: ['MLB'], SFO: ['NFL'],
  TEX: ['MLB'],

  // NFL-only
  GB: ['NFL'], GBP: ['NFL'],
  JAX: ['NFL'],
  LV: ['NFL'], LVR: ['NFL'],
  LAR: ['NFL'],
  NE: ['NFL'], NEP: ['NFL'],
  NO: ['NFL'], NOS: ['NFL'],
  NYG: ['NFL'], NYJ: ['NFL'],
  TEN: ['NFL'],
}

/**
 * Sports a team abbreviation can belong to. The first entry is the most
 * common interpretation; caller should check matching scoreboard data.
 */
export function sportsForTeamAbbrev(abbrev: string): readonly string[] {
  return TEAM_TO_SPORTS[abbrev.toUpperCase()] ?? []
}

// ---------------------------------------------------------------------------
// Player name matching — diacritics-aware substring match.
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function nameMatches(target: string, row: PlayerStatRow): boolean {
  const t = normalize(target).replace(/[.]/g, '')
  const full = normalize(row.name).replace(/[.]/g, '')
  const short = normalize(row.shortName).replace(/[.]/g, '')

  if (full === t || short === t) return true
  if (full.includes(t)) return true

  // Last name match
  const tParts = t.split(/\s+/).filter(Boolean)
  if (tParts.length === 1 && tParts[0].length >= 4) {
    const lastName = full.split(/\s+/).pop() ?? ''
    if (lastName === tParts[0]) return true
  }

  // All target tokens appear in full name
  const fParts = full.split(/\s+/)
  if (
    tParts.length >= 2 &&
    tParts.every((tp) => fParts.some((fp) => fp === tp || fp.startsWith(tp)))
  ) {
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Public match result
// ---------------------------------------------------------------------------

export interface PropMatchResult {
  parsed: ParsedProp
  game: LiveGame
  player: PlayerStatRow | null   // null when game found but player not yet in boxscore
  currentValue: number | null
  /**
   * Live state for the prop. Widened from CoverStatus → LiveStatus so that
   * live, non-clinched over/under props can carry the on-pace band
   * (`on_pace`/`borderline`/`off_pace`) from the same engine team totals use
   * (D-04/D-11). The existing `covering`/`behind`/`push`/`pregame` returns
   * remain valid — they are a subset of LiveStatus (D-12 fallback).
   */
  cover: LiveStatus
  prediction: { outcome: PredictedOutcome; reason: string } | null
}

// ---------------------------------------------------------------------------
// Match a prop bet → game + player + outcome
// ---------------------------------------------------------------------------

/**
 * Find the live game involving the bet's team. Looks at all sports the team
 * could belong to (TEAM_TO_SPORTS) and returns the first scoreboard match
 * with a non-stale start time.
 */
export function findGameForTeam(
  teamAbbrev: string,
  betPlacedAt: string,
  games: readonly LiveGame[],
  hint?: { sport?: string },
): LiveGame | null {
  // Trust the bet's declared sport when present — otherwise fall back to the
  // static TEAM_TO_SPORTS table (which is necessarily lossy for cross-sport
  // abbrev collisions like ATL or NY).
  const sports = hint?.sport ? [hint.sport] : sportsForTeamAbbrev(teamAbbrev)
  if (sports.length === 0) return null

  const betMs = new Date(betPlacedAt).getTime()
  const candidates = games.filter((g) => {
    if (!sports.includes(g.sport)) return false
    const matchesAbbrev =
      g.homeTeam.toUpperCase() === teamAbbrev ||
      g.awayTeam.toUpperCase() === teamAbbrev
    if (!matchesAbbrev) return false
    // Stale guard: ignore games more than 1h before the bet.
    return new Date(g.startTime).getTime() >= betMs - 60 * 60 * 1000
  })
  if (candidates.length === 0) return null

  // Prefer not-yet-final game so a pending prop on tomorrow's slate doesn't
  // settle against yesterday's final.
  const upcomingOrLive = candidates.find((g) => g.status !== 'post')
  return upcomingOrLive ?? candidates[0]
}

function comparatorPasses(
  comparator: ParsedProp['comparator'],
  current: number,
  line: number,
): LiveStatus {
  if (comparator === 'over') {
    if (current > line) return 'covering'
    if (current === line) return 'push'
    return 'behind'
  }
  if (comparator === 'under') {
    if (current < line) return 'covering'
    if (current === line) return 'push'
    return 'behind'
  }
  // 'plus' (e.g. "6+ Points") — pushes don't exist; integer thresholds.
  if (current >= line) return 'covering'
  return 'behind'
}

export function matchPropBet(
  bet: Bet,
  games: readonly LiveGame[],
  boxscores: ReadonlyMap<string, GameBoxscore>,
  playerResolver?: PlayerResolver | null,
): PropMatchResult | null {
  const parsed = parseProp(bet.description)
  if (!parsed) return null

  // Resolve team abbreviation: prefer the explicit (TEAM) annotation, else
  // ask the players-table resolver to map player name → team. Sport hint comes
  // from the bet itself (set by sport-detector at insert time).
  let teamAbbrev = parsed.teamAbbrev
  let resolvedSport: string | null = null
  if (!teamAbbrev && playerResolver) {
    const hit = playerResolver.resolve(parsed.playerName, { sport: bet.sport })
    if (hit?.teamAbbrev) {
      teamAbbrev = hit.teamAbbrev
      resolvedSport = hit.sport
    }
  }
  if (!teamAbbrev) return null

  const game = findGameForTeam(teamAbbrev, bet.placed_at, games, {
    sport: resolvedSport ?? bet.sport,
  })
  if (!game) return null

  const box = boxscores.get(game.id)
  let player: PlayerStatRow | null = null
  if (box) {
    player = box.players.find((p) => nameMatches(parsed.playerName, p)) ?? null
  }

  // Compute current value + cover.
  let currentValue: number | null = null
  let cover: LiveStatus = 'pregame'
  let prediction: { outcome: PredictedOutcome; reason: string } | null = null

  if (player && !player.didNotPlay) {
    const v = pickStat(player, parsed.stat)
    if (v != null) {
      currentValue = v
      if (game.status !== 'pre') {
        cover = comparatorPasses(parsed.comparator, v, parsed.value)

        // Auto-settle prediction:
        //  - "over": locked if current > line (already past it; can't lose)
        //  - "under": locked only at game end (could still go over)
        //  - "push": locked at game end
        //  - "plus": locked if current >= line
        if (parsed.comparator === 'over' && v > parsed.value) {
          prediction = {
            outcome: 'won',
            reason: `${v} ${labelForStat(parsed.stat)} over ${parsed.value}`,
          }
        } else if (parsed.comparator === 'plus' && v >= parsed.value) {
          prediction = {
            outcome: 'won',
            reason: `${v} ${labelForStat(parsed.stat)} ≥ ${parsed.value}`,
          }
        } else if (game.status === 'post') {
          if (cover === 'covering') {
            prediction = {
              outcome: 'won',
              reason: `${v} ${labelForStat(parsed.stat)} (final)`,
            }
          } else if (cover === 'push') {
            prediction = {
              outcome: 'push',
              reason: `${v} ${labelForStat(parsed.stat)} = ${parsed.value}`,
            }
          } else {
            prediction = {
              outcome: 'lost',
              reason: `${v} ${labelForStat(parsed.stat)} (final)`,
            }
          }
        }

        // ---------------------------------------------------------------
        // D-04 / D-11: on-pace projection for live over/under props.
        //
        // Runs AFTER the clinch checks above (D-05): the pace band only
        // overrides `cover` when the bet is live, not yet clinched
        // (prediction === null), and the elapsed fraction is computable
        // (>= 0 — the -1 sentinel keeps the comparatorPasses fallback,
        // D-12). Uses the same game-clock elapsed basis as team totals
        // — explicitly NOT a player-participation (minutes / PA) field.
        //
        // ParsedProp has no period field today, so we route prop bets
        // through the 'fullgame' denominator (sub-period prop markets
        // would need a prop-parser extension before reaching here).
        // ---------------------------------------------------------------
        if (
          game.status === 'in' &&
          prediction === null &&
          (parsed.comparator === 'over' || parsed.comparator === 'under')
        ) {
          const propPeriod: BetPeriod = 'fullgame'
          const elapsed = getElapsedFraction(game, propPeriod)
          if (elapsed >= 0) {
            cover = getOnPaceStatus(
              v,
              parsed.value,
              parsed.comparator === 'over',
              elapsed,
              borderlineMargin(parsed.value),
            )
          }
          // elapsed < 0 → -1 sentinel; leave `cover` as the
          // comparatorPasses fallback (D-12).
        }
      }
    }
  } else if (player?.didNotPlay && game.status === 'post') {
    // DNP at final → bet typically voids/refunds; surface as push for now.
    cover = 'push'
    prediction = { outcome: 'push', reason: 'Did not play' }
  }

  return { parsed, game, player, currentValue, cover, prediction }
}

function pickStat(row: PlayerStatRow, stat: PropStat): number | null {
  const v = row.stats[stat]
  return typeof v === 'number' ? v : null
}

const STAT_LABELS: Record<PropStat, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PM',
  steals: 'STL', blocks: 'BLK',
  pra: 'PRA', pts_reb: 'PTS+REB', pts_ast: 'PTS+AST', reb_ast: 'REB+AST',
  goals: 'G', sog: 'SOG', nhl_points: 'PTS', saves: 'SV',
  shots_blocked: 'BS', hits_skater: 'HITS',
  hits_batter: 'H', home_runs: 'HR', rbis: 'RBI',
  strikeouts_pitcher: 'K', strikeouts_batter: 'K',
  total_bases: 'TB', runs_scored: 'R', walks: 'BB',
  passing_yards: 'PASS YDS', rushing_yards: 'RUSH YDS', receiving_yards: 'REC YDS',
  passing_tds: 'PASS TD', rushing_tds: 'RUSH TD', receiving_tds: 'REC TD',
  anytime_td: 'TD', receptions: 'REC', completions: 'CMP', attempts: 'ATT',
  interceptions: 'INT',
  unknown: '',
}

export function labelForStat(stat: PropStat): string {
  return STAT_LABELS[stat] ?? stat
}
