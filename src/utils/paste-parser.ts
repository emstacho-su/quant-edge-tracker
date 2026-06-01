import type { ParsedBet, ParsedLeg } from '@/lib/types'
import { detectSport } from './sport-detector'

// ---------------------------------------------------------------------------
// Paste parser — converts raw pasted text into structured ParsedBet[]
//
// Expected format (consecutive 2-line pairs, NO blank-line separation):
//
//   GameRisk / Win          ← optional header line (skipped)
//   21.00 / 19.74           ← stake / to_win
//   Some Bet Description -106          ← description line
//   35.00 / 31.82
//   PHX Suns -13 -110 (FP)             ← (FP) = freeplay
//   20.00 / 42.54
//   Parlay - 2 Teams                   ← parlay header
//   MIL Brewers ML -119                ← leg 1
//   LA Dodgers ML -143                 ← leg 2
// ---------------------------------------------------------------------------

/** Regex matching a stake/to_win line like `21.00 / 19.74` */
const STAKE_LINE_RE = /^([\d.]+)\s*\/\s*([\d.]+)$/

/** Regex matching the header line `GameRisk / Win` (various spacings) */
const HEADER_LINE_RE = /^game\s*risk\s*\/\s*win$/i

/** Regex matching a parlay header like `Parlay - 2 Teams` */
const PARLAY_RE = /^Parlay\s*-\s*(\d+)\s*Teams?/i

/** Regex detecting `(FP)` marker at the end of a description */
const FREEPLAY_RE = /\s*\(FP\)\s*$/

/**
 * Extract the American odds from a description line.
 *
 * American odds are signed integers with 3+ digits (e.g. `+150`, `-167`).
 * Finds the LAST such pattern in the line so trailing period/half/live
 * markers (`(1P)`, `(1H)`, `(1st5)`, `Live`, `(Sell 1)`, etc.) don't break
 * extraction. A 1- or 2-digit signed number like `-7` is treated as a spread,
 * not odds.
 *
 * Returns `[cleanDescription, oddsOrNull]`. Any text after the odds is
 * preserved in the description.
 */
export function extractOdds(line: string): [string, number | null] {
  const matches = [...line.matchAll(/(?:^|\s|(?<=\)))([+-]\d{3,})\b/g)]
  if (matches.length === 0) return [line.trim(), null]
  const last = matches[matches.length - 1]
  const odds = Number(last[1])
  const start = last.index ?? 0
  const oddsStart = line.indexOf(last[1], start)
  const before = line.slice(0, oddsStart).trimEnd()
  const after = line.slice(oddsStart + last[1].length).trim()
  const desc = after ? `${before} ${after}`.trim() : before.trim()
  return [desc, odds]
}

/**
 * Detect and strip `(FP)` freeplay marker from a description.
 * Returns `[cleanDescription, isFreeplay]`.
 */
function extractFreeplay(description: string): [string, boolean] {
  if (FREEPLAY_RE.test(description)) {
    return [description.replace(FREEPLAY_RE, '').trim(), true]
  }
  return [description, false]
}

/**
 * Parse pasted text into an array of structured bets.
 *
 * The format uses consecutive lines (no blank-line separation):
 * - When a line matches `number / number`, it starts a new bet (stake / to_win).
 * - The next line(s) are the description. If the description starts with
 *   `Parlay - N Teams`, the following N lines are parlay legs.
 * - `(FP)` at the end of a description marks it as a freeplay bet.
 */
export function parsePaste(raw: string): ParsedBet[] {
  if (!raw.trim()) return []

  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  // Skip the header line if present (e.g. "GameRisk / Win")
  const startIndex = HEADER_LINE_RE.test(lines[0] ?? '') ? 1 : 0

  const results: ParsedBet[] = []
  let i = startIndex

  while (i < lines.length) {
    // Expect a stake line
    const stakeMatch = lines[i].match(STAKE_LINE_RE)
    if (!stakeMatch) {
      // Not a stake line — skip it
      i += 1
      continue
    }

    const stake = Number(stakeMatch[1])
    const toWin = Number(stakeMatch[2])
    i += 1

    // Next line should be the description or parlay header
    if (i >= lines.length) break

    const descLine = lines[i]
    const parlayMatch = descLine.match(PARLAY_RE)

    if (parlayMatch) {
      // --- Parlay bet ---
      const legCount = Number(parlayMatch[1])
      i += 1 // move past the "Parlay - N Teams" line

      // Check if the parlay header itself has a freeplay marker
      const [, parlayFreeplay] = extractFreeplay(descLine)

      const legs: ParsedLeg[] = []
      for (let legIdx = 0; legIdx < legCount && i < lines.length; legIdx += 1) {
        // Make sure the leg line isn't actually the next bet's stake line
        if (STAKE_LINE_RE.test(lines[i])) break

        const [legDesc, legOdds] = extractOdds(lines[i])
        legs.push({
          description: legDesc,
          odds_american: legOdds,
          // D-16: detectSport provides initial sport hint; resolveEntity in insertBets
          // (use-bets.ts) owns the final entity assignment through the library.
          sport: detectSport(legDesc),
        })
        i += 1
      }

      const overallDescription = legs.map((l) => l.description).join(' / ')
      const [, parlayOdds] = extractOdds(descLine)
      const primarySport = legs[0]?.sport ?? 'unknown'

      results.push({
        stake,
        to_win: toWin,
        bet_type: 'parlay',
        description: overallDescription,
        odds_american: parlayOdds,
        sport: primarySport,
        legs,
        is_freeplay: parlayFreeplay,
      })
    } else {
      // --- Single bet ---
      // Collect description lines until we hit the next stake line or end
      const descriptionParts: string[] = [descLine]
      i += 1

      while (i < lines.length && !STAKE_LINE_RE.test(lines[i])) {
        // Also stop if we hit another header line
        if (HEADER_LINE_RE.test(lines[i])) break
        descriptionParts.push(lines[i])
        i += 1
      }

      const fullDescription = descriptionParts.join(' ')
      const [strippedFP, isFreeplay] = extractFreeplay(fullDescription)
      const [desc, odds] = extractOdds(strippedFP)

      results.push({
        stake,
        to_win: toWin,
        bet_type: 'single',
        description: desc,
        odds_american: odds,
        // D-16: detectSport provides initial sport hint; resolveEntity in insertBets
        // (use-bets.ts) owns the final entity assignment through the library.
        sport: detectSport(desc),
        legs: [],
        is_freeplay: isFreeplay,
      })
    }
  }

  return results
}
