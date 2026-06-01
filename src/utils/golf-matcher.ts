import type { Bet } from '@/lib/types'
import type { GolfPlayer, GolfTournament } from '@/hooks/use-live-golf'
import type { CoverStatus } from '@/utils/team-matcher'

// ---------------------------------------------------------------------------
// Golf bet pattern detection
// ---------------------------------------------------------------------------
//
// Supported description shapes (case-insensitive):
//   "To Win Outright Cameron Young"            -> outright
//   "Outright Winner Scottie Scheffler"        -> outright
//   "Top 5 Finishing Scheffler"                -> top5
//   "Top 10 Finishing Harris English"          -> top10
//   "Top 20 Finishing Si Woo Kim"              -> top20
//   "Justin Thomas ML"                         -> outright (treated as ML/win)
//   "To Win Outright Chad Ramey/Justin Lower"  -> outright with multiple players
// ---------------------------------------------------------------------------

export type GolfBetKind = 'outright' | 'topN' | 'unknown'

export interface ParsedGolfBet {
  kind: GolfBetKind
  topN: number | null
  playerNames: string[]
}

const STOP_TOKENS = new Set([
  'to', 'win', 'outright', 'winner', 'top', 'finishing', 'finish',
  'ml', 'cover', 'over', 'under', 'matchup', 'vs', 'and', 'or',
])

/** Strip diacritics so "Højgaard" matches against ESPN's display name. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function parseGolfBet(description: string): ParsedGolfBet {
  const desc = description.trim()

  // Top N detection
  const topMatch = desc.match(/\bTop\s+(\d+)\b/i)
  let kind: GolfBetKind = 'unknown'
  let topN: number | null = null
  if (topMatch) {
    kind = 'topN'
    topN = parseInt(topMatch[1], 10)
  } else if (
    /\b(?:to\s+win\s+)?outright\b/i.test(desc) ||
    /\bML\b/.test(desc)
  ) {
    kind = 'outright'
  }

  // Strip stop tokens, ML, "Top N", "Finishing", etc., to leave player names.
  // Players can be separated by "/" for combined outright bets.
  const cleaned = desc
    .replace(/\bTop\s+\d+\b/gi, ' ')
    .replace(/\bFinishing\b/gi, ' ')
    .replace(/\bTo\s+Win\b/gi, ' ')
    .replace(/\bOutright\s+Winner\b/gi, ' ')
    .replace(/\bOutright\b/gi, ' ')
    .replace(/\bWinner\b/gi, ' ')
    .replace(/\bML\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Multiple-player formats use slash, comma, or "and" as separators.
  const playerNames = cleaned
    .split(/[/,]| and |&/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !STOP_TOKENS.has(p.toLowerCase()))

  return { kind, topN, playerNames }
}

// ---------------------------------------------------------------------------
// Match a player name to a leaderboard entry
// ---------------------------------------------------------------------------

interface MatchedGolfPlayer {
  player: GolfPlayer
  tournament: GolfTournament
}

function nameMatches(target: string, player: GolfPlayer): boolean {
  const t = normalize(target)
  const full = normalize(player.name)
  const short = normalize(player.shortName)

  if (full === t || short === t) return true
  if (full.includes(t) && t.length >= 3) return true

  // Last name only (e.g. "Scheffler" → "Scottie Scheffler")
  const targetParts = t.split(/\s+/).filter((p) => p.length >= 3)
  if (targetParts.length === 1) {
    const lastName = full.split(/\s+/).pop() ?? ''
    if (lastName === targetParts[0]) return true
  }

  // First-last format match across both directions
  const fullParts = full.split(/\s+/)
  const allTargetTokensPresent = targetParts.every((tp) =>
    fullParts.some((fp) => fp === tp || fp.startsWith(tp)),
  )
  if (targetParts.length >= 2 && allTargetTokensPresent) return true

  return false
}

export function matchPlayer(
  playerName: string,
  tournaments: readonly GolfTournament[],
): MatchedGolfPlayer | null {
  for (const tournament of tournaments) {
    for (const player of tournament.players) {
      if (nameMatches(playerName, player)) {
        return { player, tournament }
      }
    }
  }
  return null
}

export interface GolfMatchResult {
  parsed: ParsedGolfBet
  primaryPlayer: GolfPlayer | null
  tournament: GolfTournament | null
  allPlayers: MatchedGolfPlayer[]   // for "X / Y" combined bets
  cover: CoverStatus
}

/** Match a golf bet to one or more players on a current leaderboard. */
export function matchGolfBet(
  bet: Bet,
  tournaments: readonly GolfTournament[],
): GolfMatchResult | null {
  const parsed = parseGolfBet(bet.description)
  if (parsed.playerNames.length === 0) return null

  const matched: MatchedGolfPlayer[] = []
  for (const name of parsed.playerNames) {
    const m = matchPlayer(name, tournaments)
    if (m) matched.push(m)
  }
  if (matched.length === 0) return null

  // Pick the "primary" matched player as the one with the best position
  // (lowest number; nulls sort last). For combined outright bets the best
  // player carries the cover status.
  const sorted = [...matched].sort((a, b) => {
    const aPos = a.player.position ?? 9999
    const bPos = b.player.position ?? 9999
    return aPos - bPos
  })
  const primary = sorted[0]
  const cover = computeCover(parsed, sorted.map((m) => m.player))

  return {
    parsed,
    primaryPlayer: primary.player,
    tournament: primary.tournament,
    allPlayers: matched,
    cover,
  }
}

function computeCover(
  parsed: ParsedGolfBet,
  players: readonly GolfPlayer[],
): CoverStatus {
  if (players.length === 0) return 'pregame'

  const anyInProgress = players.some((p) => p.status === 'in')
  const anyFinal = players.some((p) => p.status === 'post')
  const allFinal = players.every((p) => p.status === 'post')

  if (!anyInProgress && !anyFinal) return 'pregame'

  // Cut players are immediate "behind" for outright/Top X (unless it's an
  // explicit Cut Made bet, which we don't parse yet).
  const allCut = players.every((p) => p.isCut)
  if (allCut) return 'behind'

  if (parsed.kind === 'outright') {
    // Covering iff any matched player is currently in 1st alone (position == 1
    // and no other player tied for 1st in the broader field). We don't have
    // the full field here, so we approximate: covering iff a matched player's
    // position == 1.
    const inFirst = players.some((p) => !p.isCut && p.position === 1)
    if (inFirst && allFinal) return 'covering'
    if (inFirst) return 'covering'
    return 'behind'
  }

  if (parsed.kind === 'topN' && parsed.topN !== null) {
    const inTopN = players.some(
      (p) => !p.isCut && p.position !== null && p.position <= (parsed.topN ?? 0),
    )
    if (inTopN) return 'covering'
    return 'behind'
  }

  return 'pregame'
}
