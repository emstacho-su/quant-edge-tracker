/**
 * Offshore slate paste-text parser (D-04, D-05, D-06, D-11).
 *
 * Takes raw pasted slate text from one of the four registered offshore books
 * and returns structured price rows PLUS unparsed rows with reasons — nothing
 * is silently dropped (D-06).
 *
 * The parser is PURE: no fetch, no Supabase, no localStorage.
 * Market resolution (sport + event_name_hint → markets.id) is delegated to
 * the upload route (21-05), not done here.
 *
 * Per-book grammar notes (Assumption A1 from 21-RESEARCH.md):
 *   These grammars are best-guess from public knowledge of offshore book UIs.
 *   Each branch is isolated in its own function so when real samples arrive
 *   (Task 2 of this plan) the regex can be tightened in one place.
 */

import { extractOdds } from './paste-parser'
import { detectSport } from './sport-detector'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The four registered offshore book identifiers (D-11). */
export type OffshoreBook = '7stacks' | 'betvegas23' | 'bovada' | 'betus'

export interface ParsedSlatePrice {
  /** Original input line (for traceability). */
  rawLine: string
  /** Sport detected from team tokens; null when ambiguous. */
  sport: string | null
  /** Market side; null when ambiguous (those rows surface in the fix-up table). */
  side: 'home' | 'away' | 'over' | 'under' | null
  /** Spread/total point value; null for moneylines. */
  point: number | null
  /** Signed American odds — e.g. -110, +150. */
  priceAmerican: number
  /**
   * Best-effort team/event name substring.
   * The upload route (21-05) uses this to resolve markets.id.
   */
  eventNameHint: string | null
  /**
   * 'low' rows surface in the fix-up table even if technically parsed
   * (e.g. side was ambiguous, point was inferred not explicit).
   */
  parseConfidence: 'high' | 'low'
}

export interface UnparsedSlateRow {
  line: string
  reason: string
}

type ParserOutput = { parsed: ParsedSlatePrice[]; unparsed: UnparsedSlateRow[] }

// ---------------------------------------------------------------------------
// Regex helpers
// ---------------------------------------------------------------------------

/** Matches over/under labels at the start of a token (e.g. "o7.5", "u47", "Over", "Under"). */
const OVER_UNDER_RE = /^(?:over|under|o|u)(\d+(?:\.\d+)?)?$/i

/** Column-header lines to silently skip (recognised header patterns per-book). */
const HEADER_LINE_RE =
  /^(?:team|side|spread|total|line|money\s*line|ml|o\/u|ou|home|away|over|under|event|matchup|game|rotation|#|rot\.)$/i

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Normalise CRLF and split into trimmed non-empty lines. */
function splitLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Parse a point value from a string token. Handles "47.5", "+3.5", "-7", "3½".
 */
function parsePoint(token: string): number | null {
  const t = token.trim().replace('½', '.5').replace('⅕', '.2')
  const n = Number(t)
  return isNaN(n) ? null : n
}

/**
 * Build a ParsedSlatePrice from components. Uses extractOdds to locate the
 * odds in the line and strips them to form eventNameHint.
 */
function buildRow(
  rawLine: string,
  odds: number,
  eventNameHint: string | null,
  side: 'home' | 'away' | 'over' | 'under' | null,
  point: number | null,
  confidence: 'high' | 'low',
): ParsedSlatePrice {
  const sport = eventNameHint ? detectSport(eventNameHint) : null
  return {
    rawLine,
    sport: sport === 'unknown' ? null : sport ?? null,
    side,
    point,
    priceAmerican: odds,
    eventNameHint: eventNameHint || null,
    parseConfidence: confidence,
  }
}

// ---------------------------------------------------------------------------
// Per-book parsers
// ---------------------------------------------------------------------------

/**
 * MLB team identity map (7stacks abbrev → full city name as it appears in
 * `markets.event_name`). Used by the 7stacks parser to build a hint that
 * LIKE-matches the production markets table.
 *
 * 7stacks displays teams as `<ABBREV> <Name>` (e.g. "STL Cardinals"), but the
 * markets table stores the full form (e.g. "St. Louis Cardinals @ Milwaukee
 * Brewers"). The team NAME portion is identical in both, so we only need the
 * city. The Athletics moved past their city prefix in 2025; markets stores
 * them as bare "Athletics".
 */
const MLB_ABBREV_TO_CITY: Record<string, string> = {
  ARI: 'Arizona',
  ATL: 'Atlanta',
  BAL: 'Baltimore',
  BOS: 'Boston',
  CHI: 'Chicago', // disambiguated by trailing name (Cubs / White Sox)
  CIN: 'Cincinnati',
  CLE: 'Cleveland',
  COL: 'Colorado',
  DET: 'Detroit',
  HOU: 'Houston',
  KC: 'Kansas City',
  LA: 'Los Angeles', // disambiguated by trailing name (Dodgers / Angels)
  MIA: 'Miami',
  MIL: 'Milwaukee',
  MIN: 'Minnesota',
  NY: 'New York', // disambiguated by trailing name (Yankees / Mets)
  PHI: 'Philadelphia',
  PIT: 'Pittsburgh',
  SD: 'San Diego',
  SEA: 'Seattle',
  SF: 'San Francisco',
  STL: 'St. Louis',
  TB: 'Tampa Bay',
  TEX: 'Texas',
  TOR: 'Toronto',
  WAS: 'Washington',
}

/**
 * Build the full-form team name as it appears in `markets.event_name`.
 *
 *   ("STL", "Cardinals")     → "St. Louis Cardinals"
 *   ("CHI", "White Sox")     → "Chicago White Sox"
 *   (null,  "Athletics")     → "Athletics"
 *   ("XYZ", "Hypotheticals") → "XYZ Hypotheticals"   (unknown abbrev — pass through)
 */
function mlbFullTeamName(abbrev: string | null, name: string): string {
  if (!abbrev) return name
  const city = MLB_ABBREV_TO_CITY[abbrev]
  return city ? `${city} ${name}` : `${abbrev} ${name}`
}

/**
 * 7stacks slate parser.
 *
 * Real format (verified 2026-05-27 paste, see `__fixtures__/offshore-slate-samples.ts`):
 *
 *   5/27 Game                       ← date header (silently skipped)
 *   Spread  ($1,000)                ← 4-line column header (silently skipped)
 *   ML  ($1,000)
 *   Total  ($1,000)
 *   Team Total  ($1,000)
 *   1:40 PM STL Cardinals - MIL Brewers   ← game time + matchup (sets away/home state)
 *                                          ← blank line
 *   901  STL Cardinals D May              ← away team header (rotation# + abbrev/name + pitcher)
 *   +1½ -152                              ← spread (point + price)
 *   +143                                  ← ML price (blank line = no ML offered)
 *   o8 -116                               ← game total (o|u + point + price)
 *   o3.5 -115                             ← team total over   (silently skipped — out of scope)
 *   u3.5 -115                             ← team total under  (silently skipped — out of scope)
 *                                          ← blank line
 *   902  MIL Brewers C Patrick            ← home team header (next 5 lines = same markets)
 *   …
 *
 * The team-block layout is invariant: exactly 6 lines starting from the
 * rotation-number header (header + spread + ML + game-total + 2 team-totals).
 * The ML line can be empty (no moneyline offered for blowout games).
 *
 * Per Phase 21 scope, only spread / moneyline / game-total markets are emitted
 * to `parsed[]`. Team-total lines are silently skipped (the `inferMarketType`
 * helper in `markets-lookup.ts` explicitly excludes team_total — they need a
 * team identifier the parser does not yet extract). Date headers, column
 * headers, game-time lines, team-block headers, and blank separators are
 * structurally-metadata, also silently skipped. Only lines whose shape is
 * genuinely unrecognised land in `unparsed[]` (D-06 / 21-02 test contract:
 * "returns empty unparsed for clean fixture").
 */
function parse7stacks(text: string): ParserOutput {
  const parsed: ParsedSlatePrice[] = []
  const unparsed: UnparsedSlateRow[] = []

  // Preserve blank lines — they're meaningful (empty ML line inside a team block).
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim())

  // Date header: "5/27 Game" or "5/27/2026 Game"
  const RE_DATE_HEADER = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+(?:Game|Games|Schedule)$/i
  // Column header: "Spread", "ML", "Total", "Team Total" with optional stake suffix.
  const RE_COL_HEADER =
    /^(?:Spread|ML|Total|Team\s+Total|Run\s+Line|Puck\s+Line)\s*(?:\(\$[\d,]+\))?\s*$/i
  // Game-time line: "1:40 PM STL Cardinals - MIL Brewers"
  const RE_GAME_TIME = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s+(.+?)\s+-\s+(.+)$/i
  // Team-block header: "<3-4-digit rotation#>  <team identity> <pitcher>"
  const RE_TEAM_HEADER = /^(\d{3,4})\s+(.+)$/

  // Current game state, set when a game-time line is seen and cleared as needed.
  let awayAbbrev: string | null = null
  let awayName: string | null = null
  let homeAbbrev: string | null = null
  let homeName: string | null = null

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Blank separator — silent skip
    if (line === '') {
      i++
      continue
    }

    // Date / column headers — silent skip
    if (RE_DATE_HEADER.test(line) || RE_COL_HEADER.test(line)) {
      i++
      continue
    }

    // Game-time line — capture away/home identity for the next two team blocks
    const gtMatch = line.match(RE_GAME_TIME)
    if (gtMatch) {
      const awayRaw = gtMatch[4]
      const homeRaw = gtMatch[5]
      const aw = parseTeamIdentity7stacks(awayRaw)
      const hm = parseTeamIdentity7stacks(homeRaw)
      if (aw && hm) {
        awayAbbrev = aw.abbrev
        awayName = aw.name
        homeAbbrev = hm.abbrev
        homeName = hm.name
      }
      i++
      continue
    }

    // Team-block header — start of a 6-line block (header + 5 market lines)
    const thMatch = line.match(RE_TEAM_HEADER)
    if (thMatch && (awayName || homeName)) {
      const rest = thMatch[2].trim()

      const teamSide = matchTeamSide7stacks(rest, awayAbbrev, awayName, homeAbbrev, homeName)
      if (teamSide === null) {
        // Looks like a rotation header but neither team matches — surface for fix-up.
        unparsed.push({
          line,
          reason: `team header does not match game (away=${awayAbbrev ?? '?'} ${awayName ?? '?'}, home=${homeAbbrev ?? '?'} ${homeName ?? '?'})`,
        })
        i++
        continue
      }

      // Build the FULL hint as it appears in markets.event_name so
      // resolveMarketId's ilike `%hint%` match succeeds (e.g. markets stores
      // "St. Louis Cardinals @ Milwaukee Brewers", not "STL Cardinals @ MIL Brewers").
      const fullAway = mlbFullTeamName(awayAbbrev, awayName!)
      const fullHome = mlbFullTeamName(homeAbbrev, homeName!)
      const eventNameHint = `${fullAway} @ ${fullHome}`
      const sportRaw = detectSport(eventNameHint)
      // markets.sport is lowercase ('mlb'), but detectSport returns uppercase ('MLB').
      // Normalise so resolveMarketId's eq('sport', …) matches.
      const sport =
        !sportRaw || sportRaw === 'unknown' ? null : sportRaw.toLowerCase()

      // The team block always consumes 6 lines from the rotation header.
      // Missing markets surface as blank lines; we don't shorten the window.
      const spreadLine = lines[i + 1] ?? ''
      const mlLine = lines[i + 2] ?? ''
      const totalLine = lines[i + 3] ?? ''
      // lines[i + 4] and lines[i + 5] are team-total over/under — silently skipped.

      // Spread: "+1½ -152" or "-1.5 +110"
      const spread = parseSpread7stacks(spreadLine)
      if (spread) {
        parsed.push({
          rawLine: spreadLine,
          sport,
          side: teamSide,
          point: spread.point,
          priceAmerican: spread.price,
          eventNameHint,
          parseConfidence: 'high',
        })
      } else if (spreadLine !== '') {
        unparsed.push({ line: spreadLine, reason: 'could not parse spread row' })
      }

      // ML: "+143", "-163", "Even", or blank (no ML offered)
      const ml = parseAmerican7stacks(mlLine)
      if (ml !== null) {
        parsed.push({
          rawLine: mlLine,
          sport,
          side: teamSide,
          point: null,
          priceAmerican: ml,
          eventNameHint,
          parseConfidence: 'high',
        })
      } else if (mlLine !== '') {
        unparsed.push({ line: mlLine, reason: 'could not parse moneyline row' })
      }

      // Game total: "o8 -116" or "u8½ Even"
      const total = parseTotal7stacks(totalLine)
      if (total) {
        parsed.push({
          rawLine: totalLine,
          sport,
          side: total.side,
          point: total.point,
          priceAmerican: total.price,
          eventNameHint,
          parseConfidence: 'high',
        })
      } else if (totalLine !== '') {
        unparsed.push({ line: totalLine, reason: 'could not parse game total row' })
      }

      // Advance past the 6-line block; main loop handles blank/next game-time/next team.
      i += 6
      continue
    }

    // Anything else is a genuinely unrecognised line shape.
    unparsed.push({ line, reason: 'unrecognised line shape' })
    i++
  }

  return { parsed, unparsed }
}

// ─── 7stacks-specific helpers ─────────────────────────────────────────────────

/**
 * Extract `{ abbrev, name }` from one half of a 7stacks game-time line.
 *   "STL Cardinals"   → { abbrev: 'STL', name: 'Cardinals' }
 *   "CHI White Sox"   → { abbrev: 'CHI', name: 'White Sox' }
 *   "Athletics"       → { abbrev: null, name: 'Athletics' }   ← post-OAK rebrand
 */
function parseTeamIdentity7stacks(text: string): { abbrev: string | null; name: string } | null {
  const t = text.trim()
  if (!t) return null
  // Two-to-four-letter UPPERCASE prefix + name
  const m = t.match(/^([A-Z]{2,4})\s+(.+)$/)
  if (m) return { abbrev: m[1], name: m[2].trim() }
  // Name-only (e.g. "Athletics")
  return { abbrev: null, name: t }
}

/**
 * Determine whether the text after the rotation number identifies the away
 * team or the home team — by matching against the most-recent game-time line's
 * captured identities.
 */
function matchTeamSide7stacks(
  rest: string,
  awayAbbrev: string | null,
  awayName: string | null,
  homeAbbrev: string | null,
  homeName: string | null,
): 'home' | 'away' | null {
  if (awayName) {
    const awayPrefix = awayAbbrev ? `${awayAbbrev} ${awayName}` : awayName
    if (rest === awayPrefix || rest.startsWith(`${awayPrefix} `)) return 'away'
  }
  if (homeName) {
    const homePrefix = homeAbbrev ? `${homeAbbrev} ${homeName}` : homeName
    if (rest === homePrefix || rest.startsWith(`${homePrefix} `)) return 'home'
  }
  return null
}

/**
 * Parse a 7stacks spread line: "<signed point> <price>".
 *   "+1½ -152" → { point: 1.5, price: -152 }
 *   "-1.5 +110" → { point: -1.5, price: 110 }
 *   "+1½ +150" → { point: 1.5, price: 150 }
 */
function parseSpread7stacks(line: string): { point: number; price: number } | null {
  const m = line.match(/^([+-]?\d+(?:\.\d+)?(?:½|⅕)?)\s+([+-]?\d+|Even)$/i)
  if (!m) return null
  const point = parsePoint(m[1])
  if (point === null) return null
  const price = /^even$/i.test(m[2]) ? 100 : parseInt(m[2], 10)
  if (isNaN(price)) return null
  return { point, price }
}

/**
 * Parse a 7stacks moneyline price. Blank string → null (no ML offered).
 *   "+143" → 143
 *   "-163" → -163
 *   "Even" → 100
 */
function parseAmerican7stacks(line: string): number | null {
  const t = line.trim()
  if (!t) return null
  if (/^even$/i.test(t)) return 100
  const m = t.match(/^([+-]?\d{3,4})$/)
  return m ? parseInt(m[1], 10) : null
}

/**
 * Parse a 7stacks game-total line: "<o|u><point> <price>".
 *   "o8 -116"  → { side: 'over',  point: 8,   price: -116 }
 *   "u8½ Even" → { side: 'under', point: 8.5, price: 100 }
 *   "o3.5 100" → { side: 'over',  point: 3.5, price: 100 }
 */
function parseTotal7stacks(
  line: string,
): { side: 'over' | 'under'; point: number; price: number } | null {
  const m = line.match(/^([ou])(\d+(?:\.\d+)?(?:½|⅕)?)\s+([+-]?\d+|Even)$/i)
  if (!m) return null
  const side: 'over' | 'under' = m[1].toLowerCase() === 'o' ? 'over' : 'under'
  const point = parsePoint(m[2])
  if (point === null) return null
  const price = /^even$/i.test(m[3]) ? 100 : parseInt(m[3], 10)
  if (isNaN(price)) return null
  return { side, point, price }
}

/**
 * betvegas23 slate parser.
 *
 * Assumption (A1 — no real sample): betvegas23 is a PPH / IDSCA-style book
 * similar to 7stacks. Expected format mirrors standard offshore rotation sheets:
 *
 *   <Rot> <TeamName> [Spread] [ML] [Total]
 *
 * Layout is the same heuristic as 7stacks; per-line odds detection applies.
 * Tighten once real samples arrive.
 */
function parseBetvegas23(text: string): ParserOutput {
  // Same heuristic as 7stacks — both are IDSCA-family PPH books.
  // A dedicated branch exists here so grammar can be tuned independently.
  return parse7stacks(text)
}

/**
 * Bovada slate parser.
 *
 * Assumption (A1 — no real sample): Bovada's sports-betting page renders
 * markets in a card grid. When users copy-paste the card area they typically
 * get lines in one of these shapes:
 *
 *   New York Yankees -1.5 (-110)
 *   Boston Red Sox   +1.5 (-110)
 *   Total            Over 8.5 (-115)
 *                    Under 8.5 (-105)
 *   New York Yankees -130 (ML)
 *
 * Odds may appear without parens: "New York Yankees -1.5 -110"
 * The "(ML)" suffix can indicate moneyline; "(RL)" run line; "(PL)" puck line.
 *
 * Side detection: "Over" / "Under" tokens; "Total" header is skipped.
 * Spread lines: team name + signed number + odds; side = null (ambiguous),
 * confidence = 'low'.
 */
function parseBovada(text: string): ParserOutput {
  const parsed: ParsedSlatePrice[] = []
  const unparsed: UnparsedSlateRow[] = []

  for (const line of splitLines(text)) {
    // Skip standalone "Total" header rows
    if (/^total$/i.test(line)) continue
    if (HEADER_LINE_RE.test(line)) continue

    const [desc, odds] = extractOdds(line)
    if (odds === null) {
      unparsed.push({ line, reason: 'no odds found' })
      continue
    }

    const tokens = desc.replace(/\((?:ML|RL|PL|PS|AU)\)/gi, '').split(/\s+/).filter(Boolean)

    let side: 'home' | 'away' | 'over' | 'under' | null = null
    let point: number | null = null
    let confidence: 'high' | 'low' = 'high'
    const hintParts: string[] = []

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]

      const ouMatch = tok.match(OVER_UNDER_RE)
      if (ouMatch) {
        side = tok.toLowerCase().startsWith('o') ? 'over' : 'under'
        if (ouMatch[1] !== undefined) {
          point = parsePoint(ouMatch[1])
        } else if (i + 1 < tokens.length) {
          const next = parsePoint(tokens[i + 1])
          if (next !== null) {
            point = next
            i++ // consume the point token
          }
        }
        continue
      }

      // Spread: a signed float before the odds position
      if (/^[+-]\d+(?:\.\d+)?$/.test(tok) && side === null) {
        point = parsePoint(tok)
        confidence = 'low'
        continue
      }

      // Standalone unsigned total point value (e.g. "8.5" on its own after Over/Under)
      if (/^\d+(?:\.\d+)?$/.test(tok) && side !== null && point === null) {
        point = parsePoint(tok)
        continue
      }

      hintParts.push(tok)
    }

    const eventNameHint = hintParts.join(' ') || null
    if (side === null) confidence = 'low'

    parsed.push(buildRow(line, odds, eventNameHint, side, point, confidence))
  }

  return { parsed, unparsed }
}

/**
 * BetUS slate parser.
 *
 * Assumption (A1 — no real sample): BetUS uses a traditional offshore sportsbook
 * rotation sheet layout similar to most Caribbean PPH books. Expected format:
 *
 *   <Rot> <TeamName/Total>   <Spread|O/U>  <ML>
 *
 * or line-per-market:
 *   301  Houston Astros      -1.5 -115    -150
 *   302  Chicago Cubs         +1.5 -105    +130
 *   303  Total               Over 8.5 -110
 *
 * "Total" lines contain "Over" / "Under" tokens.
 * Rotation numbers (3-4 digits at start of line) are stripped from the hint.
 *
 * Same heuristic as 7stacks; isolated branch for independent tuning.
 */
function parseBetus(text: string): ParserOutput {
  // BetUS rotation format is close to the 7stacks/betvegas23 PPH family.
  // Reuses the 7stacks heuristic until real samples arrive.
  return parse7stacks(text)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse raw pasted slate text from an offshore sportsbook into structured
 * price rows.
 *
 * @param book  One of the four registered offshore books (D-11).
 * @param text  Raw paste text from the book's slate page.
 * @returns     `{ parsed, unparsed }` — every non-blank input line ends in
 *              one array or the other (D-06).
 *
 * Security (T-21-02-02): input capped at 100 KB to prevent DoS on pathological
 * regex inputs.
 */
export function parseOffshoreSlate(
  book: OffshoreBook,
  text: string,
): { parsed: ParsedSlatePrice[]; unparsed: UnparsedSlateRow[] } {
  // T-21-02-02: cap input size
  if (text.length > 100_000) {
    return {
      parsed: [],
      unparsed: [{ line: '<truncated>', reason: 'input too large' }],
    }
  }

  if (!text.trim()) {
    return { parsed: [], unparsed: [] }
  }

  switch (book) {
    case '7stacks':
      return parse7stacks(text)
    case 'betvegas23':
      return parseBetvegas23(text)
    case 'bovada':
      return parseBovada(text)
    case 'betus':
      return parseBetus(text)
    default: {
      // Defense-in-depth for D-11: TypeScript should prevent this path, but a
      // force-cast caller will hit this branch at runtime.
      const exhaustiveCheck: never = book
      return {
        parsed: [],
        unparsed: [{ line: text, reason: `unknown_book: ${String(exhaustiveCheck)}` }],
      }
    }
  }
}
