import { matchScore } from './match.js'

/**
 * Pure outcome evaluator: decides won/lost/push for a parsed straight-market
 * selection against a final game score. Returns null when it can't be
 * confidently evaluated (caller MUST skip — never force-settle on null).
 * team_total and anything unrecognized return null (deferred).
 */
export type Outcome = 'won' | 'lost' | 'push'

export interface FinalGame {
  homeAbbrev: string
  homeName: string
  awayAbbrev: string
  awayName: string
  homeScore: number
  awayScore: number
}

export interface Selection {
  market: string | null // 'moneyline' | 'spread' | 'total' | 'team_total'
  selection: string | null // team for ml/spread; 'over' | 'under' for totals
  line: number | null
}

/**
 * How strongly a selection matches one team. Exact-abbreviation word match
 * (score 100) handles short abbrevs (e.g. "KC", "LA") that matchScore's
 * >2-char token filter drops; otherwise token overlap against abbrev + name.
 */
function sideScore(selection: string, abbrev: string, name: string): number {
  const a = abbrev.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (a.length > 0 && new RegExp(`\\b${a}\\b`).test(selection.toLowerCase())) return 100
  return Math.max(matchScore(selection, abbrev), matchScore(selection, name))
}

/** Best match of the selection to EITHER team — used to pick which game a bet is about. */
export function selectionGameScore(selection: string, g: FinalGame): number {
  return Math.max(
    sideScore(selection, g.homeAbbrev, g.homeName),
    sideScore(selection, g.awayAbbrev, g.awayName),
  )
}

/** Which side the selection refers to, or null when no/ambiguous match. */
function resolveSide(selection: string, g: FinalGame): 'home' | 'away' | null {
  const home = sideScore(selection, g.homeAbbrev, g.homeName)
  const away = sideScore(selection, g.awayAbbrev, g.awayName)
  if (home === away) return null // 0/0 = no match; equal = ambiguous → skip
  return home > away ? 'home' : 'away'
}

export function evaluateSelection(sel: Selection, g: FinalGame): Outcome | null {
  if (sel.market === 'total') {
    if (sel.line == null || (sel.selection !== 'over' && sel.selection !== 'under')) return null
    const total = g.homeScore + g.awayScore
    if (total === sel.line) return 'push'
    const wentOver = total > sel.line
    return (sel.selection === 'over') === wentOver ? 'won' : 'lost'
  }

  if (!sel.selection) return null
  const side = resolveSide(sel.selection, g)
  if (!side) return null
  const my = side === 'home' ? g.homeScore : g.awayScore
  const opp = side === 'home' ? g.awayScore : g.homeScore

  if (sel.market === 'moneyline') {
    return my === opp ? 'push' : my > opp ? 'won' : 'lost'
  }

  if (sel.market === 'spread') {
    if (sel.line == null) return null
    const margin = my + sel.line - opp
    return margin === 0 ? 'push' : margin > 0 ? 'won' : 'lost'
  }

  return null // team_total + unrecognized markets: deferred (caller skips)
}
