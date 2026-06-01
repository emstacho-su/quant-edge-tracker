// ---------------------------------------------------------------------------
// Player prop description parser
// ---------------------------------------------------------------------------
//
// Recognized shapes (case-insensitive, except player names):
//   "Paul George (PHI) Over 16.5 Points"
//   "Robert Williams III (POR) Over 7.5 Points"
//   "Collin Murray-Boyles (TOR) Over 12.5 Points"
//   "Jordan Clarkson (NY) 6+ Points"            -> alternate "N+" form
//   "Matt Boldy (MIN) Over 3.5 Shots on goal"
//   "Patrick Mahomes (KC) Over 275.5 Passing Yards"
//
// Output is sport-agnostic at parse time — the caller (prop-matcher) uses the
// team abbreviation to pick the right league boxscore.
// ---------------------------------------------------------------------------

/**
 * Normalized player-prop stat keys. Combos like PRA / Pts+Ast are first-class
 * because their interpretation differs from a sum of two single-stat bets
 * (alternate lines, push semantics, etc.).
 */
export type PropStat =
  | 'points' | 'rebounds' | 'assists' | 'threes' | 'steals' | 'blocks'
  | 'pra' | 'pts_reb' | 'pts_ast' | 'reb_ast'
  | 'goals' | 'sog' | 'nhl_points' | 'saves' | 'shots_blocked' | 'hits_skater'
  | 'hits_batter' | 'home_runs' | 'rbis' | 'strikeouts_pitcher' | 'strikeouts_batter'
  | 'total_bases' | 'runs_scored' | 'walks'
  | 'passing_yards' | 'rushing_yards' | 'receiving_yards'
  | 'passing_tds' | 'rushing_tds' | 'receiving_tds' | 'anytime_td'
  | 'receptions' | 'completions' | 'attempts' | 'interceptions'
  | 'unknown'

export type Comparator = 'over' | 'under' | 'plus'

export interface ParsedProp {
  playerName: string              // "Paul George"
  teamAbbrev: string | null       // "PHI" — null when the description omits the parenthetical and we'll resolve player → team via the players table
  comparator: Comparator
  value: number
  stat: PropStat
  /** Original stat phrase from the description, for display purposes. */
  statLabel: string
}

// ---------------------------------------------------------------------------
// Stat phrase → canonical PropStat
// ---------------------------------------------------------------------------

interface StatPattern {
  re: RegExp
  stat: PropStat
}

// Order matters — multi-token / combo patterns first so "Pts+Reb+Ast" beats
// the bare "points" pattern.
const STAT_PATTERNS: readonly StatPattern[] = [
  { re: /^pts\s*\+\s*reb\s*\+\s*ast$/i, stat: 'pra' },
  { re: /^pra$/i, stat: 'pra' },
  { re: /^points\s*\+\s*rebounds\s*\+\s*assists$/i, stat: 'pra' },
  { re: /^pts\s*\+\s*reb$/i, stat: 'pts_reb' },
  { re: /^points\s*\+\s*rebounds$/i, stat: 'pts_reb' },
  { re: /^pts\s*\+\s*ast$/i, stat: 'pts_ast' },
  { re: /^points\s*\+\s*assists$/i, stat: 'pts_ast' },
  { re: /^reb\s*\+\s*ast$/i, stat: 'reb_ast' },
  { re: /^rebounds\s*\+\s*assists$/i, stat: 'reb_ast' },

  // NBA singles
  { re: /^points$/i, stat: 'points' },
  { re: /^rebounds$/i, stat: 'rebounds' },
  { re: /^assists$/i, stat: 'assists' },
  { re: /^(three\s+pointers?\s+made|threes?|3\s*pt|3\s*pm|3pt\s*made|3pts?|three\s*pointers?)$/i, stat: 'threes' },
  { re: /^steals$/i, stat: 'steals' },
  { re: /^blocks$/i, stat: 'blocks' },

  // NHL
  { re: /^shots?\s+on\s+goal$/i, stat: 'sog' },
  { re: /^sog$/i, stat: 'sog' },
  { re: /^goals$/i, stat: 'goals' },
  { re: /^saves$/i, stat: 'saves' },
  { re: /^shots?\s+blocked$/i, stat: 'shots_blocked' },
  { re: /^hits$/i, stat: 'hits_skater' }, // disambiguated by sport in matcher

  // MLB
  { re: /^home\s+runs?$/i, stat: 'home_runs' },
  { re: /^hrs?$/i, stat: 'home_runs' },
  { re: /^rbis?$/i, stat: 'rbis' },
  { re: /^total\s+bases$/i, stat: 'total_bases' },
  { re: /^runs?(\s+scored)?$/i, stat: 'runs_scored' },
  { re: /^walks?$/i, stat: 'walks' },
  { re: /^strikeouts?$/i, stat: 'strikeouts_pitcher' }, // pitcher default; matcher overrides

  // NFL
  { re: /^passing\s+yards?$/i, stat: 'passing_yards' },
  { re: /^rushing\s+yards?$/i, stat: 'rushing_yards' },
  { re: /^receiving\s+yards?$/i, stat: 'receiving_yards' },
  { re: /^passing\s+tds?$/i, stat: 'passing_tds' },
  { re: /^rushing\s+tds?$/i, stat: 'rushing_tds' },
  { re: /^receiving\s+tds?$/i, stat: 'receiving_tds' },
  { re: /^anytime\s+td$/i, stat: 'anytime_td' },
  { re: /^receptions?$/i, stat: 'receptions' },
  { re: /^completions?$/i, stat: 'completions' },
  { re: /^attempts?$/i, stat: 'attempts' },
  { re: /^interceptions?$/i, stat: 'interceptions' },
]

function canonicalStat(label: string): PropStat {
  const trimmed = label.trim()
  // Exact match first.
  for (const { re, stat } of STAT_PATTERNS) {
    if (re.test(trimmed)) return stat
  }
  // Greedy prefix fallback — sportsbook descriptions often append a bet-type
  // token like "Single" / "Parlay" after the stat (e.g. "Rebounds Single").
  // Walk the prefix from longest to shortest and accept the first hit.
  const words = trimmed.split(/\s+/)
  for (let n = words.length - 1; n >= 1; n--) {
    const prefix = words.slice(0, n).join(' ')
    for (const { re, stat } of STAT_PATTERNS) {
      if (re.test(prefix)) return stat
    }
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Description regex
// ---------------------------------------------------------------------------
//
// Match shape:
//   <player name>  <whitespace>  '(' <team> ')'  <whitespace>
//   ( 'Over' | 'Under' )  <whitespace>  <number>   |   <number> '+'
//   <whitespace>  <stat phrase>
//
// Player name can include letters, periods, apostrophes, hyphens, accented
// chars, suffixes (Jr., III). Team is 2-4 uppercase letters.
// ---------------------------------------------------------------------------

// Teamed shape — high confidence; the parenthetical pins the team explicitly.
//   "Paul George (PHI) Over 16.5 Points"
const PROP_RE_TEAMED =
  /^([\p{L}.\p{M} '’\-]+?)\s+\(([A-Z]{2,4})\)\s+(?:(Over|Under|O|U)\s*([\d.]+)|(\d+)\s*\+)\s+(.+?)\s*$/iu

// No-team shape — relies on a downstream player→team resolver to find the
// game. Lower confidence; require a multi-word player name to avoid swallowing
// team-line bets like "Yankees Over 5.5 Runs".
//   "Jason Alexander o3.5 Strikeouts"
//   "De'Aaron Fox 4+ Rebounds Single"
const PROP_RE_NO_TEAM =
  /^([\p{L}.\p{M} '’\-]+?)\s+(?:(Over|Under|O|U)\s*([\d.]+)|(\d+)\s*\+)\s+(.+?)\s*$/iu

export function parseProp(description: string): ParsedProp | null {
  const trimmed = description.trim()

  let teamAbbrev: string | null = null
  let playerName: string
  let overUnder: string | undefined
  let ouValueStr: string | undefined
  let plusValueStr: string | undefined
  let statLabel: string

  const teamed = trimmed.match(PROP_RE_TEAMED)
  if (teamed) {
    playerName = teamed[1].trim()
    teamAbbrev = teamed[2].toUpperCase()
    overUnder = teamed[3]?.toLowerCase()
    ouValueStr = teamed[4]
    plusValueStr = teamed[5]
    statLabel = teamed[6].trim()
  } else {
    const noTeam = trimmed.match(PROP_RE_NO_TEAM)
    if (!noTeam) return null
    playerName = noTeam[1].trim()
    overUnder = noTeam[2]?.toLowerCase()
    ouValueStr = noTeam[3]
    plusValueStr = noTeam[4]
    statLabel = noTeam[5].trim()
    // No-team variant must look like a person's name (2+ words). Catches false
    // positives like "Yankees Over 5.5 Runs" where the team itself is the only
    // word before the comparator.
    if (playerName.split(/\s+/).length < 2) return null
  }

  const ouValue = ouValueStr ? parseFloat(ouValueStr) : null
  const plusValue = plusValueStr ? parseInt(plusValueStr, 10) : null

  let comparator: Comparator
  let value: number
  if (overUnder === 'over' || overUnder === 'o') {
    comparator = 'over'
    value = ouValue ?? 0
  } else if (overUnder === 'under' || overUnder === 'u') {
    comparator = 'under'
    value = ouValue ?? 0
  } else if (plusValue !== null) {
    comparator = 'plus'
    value = plusValue
  } else {
    return null
  }

  if (!Number.isFinite(value)) return null

  const stat = canonicalStat(statLabel)
  if (stat === 'unknown') return null

  // Reject if the captured "player name" looks like a team-line bet that
  // happens to have a parenthetical (e.g. "ORL Magic +5 (1H)").
  if (/^[A-Z]{2,4}\s/.test(playerName) && playerName.split(/\s+/).length <= 2) {
    return null
  }

  return { playerName, teamAbbrev, comparator, value, stat, statLabel }
}

/** True if the description looks like a player prop (vs a team line bet). */
export function isPropDescription(description: string): boolean {
  return parseProp(description) !== null
}
