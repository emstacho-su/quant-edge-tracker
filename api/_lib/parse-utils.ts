/**
 * api/_lib/parse-utils.ts
 *
 * Server-side thin copy of the deterministic parse logic from
 * src/utils/team-matcher.ts (parseBetLine) and src/utils/sport-detector.ts
 * (detectSport). Lives here so the api/ bundle resolves without importing
 * from src/ (Vercel bundles each api/ function independently — RESEARCH Pitfall 2).
 *
 * Exports:
 *   precheckParse(text) -> { parsed: Record<string, unknown> | null; confidence: number }
 *
 * Confidence >= 0.75 means the text is structured enough that the LLM is not
 * needed. Confidence < 0.75 triggers the Haiku tool_use fallback in parse.ts.
 */

// ---------------------------------------------------------------------------
// Sport detection — minimal inline copy (no src/ imports)
// ---------------------------------------------------------------------------

// Team lists used for sport detection. Keep in sync with sport-detector.ts
// for the sports the line-shopper cares about (SHOP-02 supported sports).

const MLB_TEAMS = [
  'Astros', 'Yankees', 'Dodgers', 'Orioles', 'Braves', 'Red Sox', 'White Sox',
  'Cubs', 'Reds', 'Guardians', 'Rockies', 'Tigers', 'Marlins', 'Twins', 'Mets',
  'Athletics', 'Phillies', 'Pirates', 'Padres', 'Giants', 'Mariners', 'Cardinals',
  'Rays', 'Rangers', 'Blue Jays', 'Nationals', 'Brewers', 'Royals', 'Angels',
  'Diamondbacks',
]
const NBA_TEAMS = [
  'Hawks', 'Celtics', 'Nets', 'Hornets', 'Bulls', 'Cavaliers', 'Mavericks',
  'Nuggets', 'Pistons', 'Warriors', 'Rockets', 'Pacers', 'Clippers', 'Lakers',
  'Grizzlies', 'Heat', 'Bucks', 'Timberwolves', 'Pelicans', 'Knicks', 'Thunder',
  'Magic', 'Sixers', '76ers', 'Suns', 'Blazers', 'Trail Blazers', 'Kings',
  'Spurs', 'Raptors', 'Jazz', 'Wizards',
]
const NFL_TEAMS = [
  'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals',
  'Browns', 'Cowboys', 'Broncos', 'Lions', 'Packers', 'Texans', 'Colts',
  'Jaguars', 'Chiefs', 'Chargers', 'Rams', 'Dolphins', 'Vikings', 'Patriots',
  'Saints', 'Jets', 'Raiders', 'Eagles', 'Steelers', 'Seahawks', 'Buccaneers',
  'Titans', 'Commanders', '49ers', 'Niners',
]
const NHL_TEAMS = [
  'Ducks', 'Coyotes', 'Bruins', 'Sabres', 'Flames', 'Hurricanes', 'Blackhawks',
  'Avalanche', 'Blue Jackets', 'Stars', 'Red Wings', 'Oilers', 'Panthers',
  'Wild', 'Canadiens', 'Predators', 'Devils', 'Islanders', 'Rangers', 'Senators',
  'Flyers', 'Penguins', 'Sharks', 'Kraken', 'Blues', 'Lightning', 'Maple Leafs',
  'Canucks', 'Golden Knights', 'Capitals', 'Jets',
]

type SportRule = { sport: string; keywords: RegExp; teams?: RegExp }

const SPORT_RULES: readonly SportRule[] = [
  {
    sport: 'MLB',
    teams: buildTeamRegex(MLB_TEAMS),
    keywords: /\b(?:MLB|Baseball|Run Line|NRFI|First 5|F5|Pitcher|Batter)\b/i,
  },
  {
    sport: 'NBA',
    teams: buildTeamRegex(NBA_TEAMS),
    keywords: /\b(?:NBA|Basketball|Points|Rebounds|Assists|PRA)\b/i,
  },
  {
    sport: 'NFL',
    teams: buildTeamRegex(NFL_TEAMS),
    keywords: /\b(?:NFL|Football|Passing Yards|Rushing Yards|Touchdowns)\b/i,
  },
  {
    sport: 'NHL',
    teams: buildTeamRegex(NHL_TEAMS),
    keywords: /\b(?:NHL|Hockey|Puck Line|Shots on Goal|SOG)\b/i,
  },
  { sport: 'Golf', teams: undefined, keywords: /\b(?:Golf|PGA|Masters|Top 5|Top 10)\b/i },
  { sport: 'Tennis', teams: undefined, keywords: /\b(?:Tennis|ATP|WTA)\b/i },
  { sport: 'Soccer', teams: undefined, keywords: /\b(?:Soccer|EPL|Premier League|MLS|UEFA)\b/i },
  { sport: 'MMA', teams: undefined, keywords: /\b(?:MMA|UFC|Bellator)\b/i },
]

function buildTeamRegex(teams: readonly string[]): RegExp {
  const escaped = teams.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i')
}

/**
 * Detect sport from text. Returns one of the SPORT_RULES sport strings, or 'unknown'.
 */
function detectSportLocal(text: string): string {
  for (const rule of SPORT_RULES) {
    if (rule.keywords.test(text)) return rule.sport
  }
  for (const rule of SPORT_RULES) {
    if (rule.teams?.test(text)) return rule.sport
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Line / market / side extraction — thin copy of parseBetLine logic
// ---------------------------------------------------------------------------

type Market = 'moneyline' | 'spread' | 'total' | 'unknown'
type Side = 'home' | 'away' | 'over' | 'under' | null

interface ExtractedLine {
  market: Market
  side: Side
  line: number | null
  price: number | null
  team: string | null
}

/**
 * Extract the structured betting line from description text.
 * Handles:
 *   - Moneyline: "Brewers ML -110", "Yankees ML +130"
 *   - Total over/under: "o233.5 (-110)", "u7.5", "Over 8.5 (-115)"
 *   - Spread: "Dodgers -1.5 (-120)", "Chiefs +3 (-110)"
 */
function extractLine(text: string): ExtractedLine {
  // Normalize half-point notation
  const desc = text.trim().replace(/½/g, '.5')

  // Extract price (american odds) — look for parenthesized or trailing odds
  const priceMatch = desc.match(/\(([+-]?\d{3,4})\)/) ?? desc.match(/\s([+-]\d{3,4})(?:\s|$)/)
  const price = priceMatch ? parseInt(priceMatch[1], 10) : null

  // Total over/under: o/O or u/U followed by a number, OR "Over"/"Under" + number
  const ouMatch = desc.match(/\b([oOuU])(\d+(?:\.\d+)?)\b/) ??
    desc.match(/\b(Over|Under)\s+(\d+(?:\.\d+)?)\b/i)
  if (ouMatch) {
    const letter = ouMatch[1].toLowerCase()
    const side: Side = (letter === 'o' || letter === 'over') ? 'over' : 'under'
    return {
      market: 'total',
      side,
      line: parseFloat(ouMatch[2]),
      price,
      team: null,
    }
  }

  // Moneyline: description contains "ML" keyword
  const mlMatch = desc.match(/^(.+?)\s+ML\b/i)
  if (mlMatch) {
    const teamPart = mlMatch[1].trim()
    const firstWord = teamPart.split(/\s+/)[0]
    return { market: 'moneyline', side: null, line: null, price, team: firstWord }
  }

  // Spread: team followed by a signed or unsigned decimal number (not price-like odds)
  // A "price-like" number is 3+ digits absolute value (e.g. -110, +130).
  // A spread is typically 1–2 digits absolute value (e.g. -1.5, +3, -7).
  const spreadMatch = desc.match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?)\s*(?:\(|$)/)
  if (spreadMatch) {
    const val = parseFloat(spreadMatch[2])
    // If the value is clearly odds-range (|val| >= 100), it's probably just odds with
    // no team — skip the spread interpretation.
    if (Math.abs(val) < 100) {
      const teamPart = spreadMatch[1].trim()
      const firstWord = teamPart.split(/\s+/)[0]
      return { market: 'spread', side: null, line: val, price, team: firstWord }
    }
  }

  return { market: 'unknown', side: null, line: null, price, team: null }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PrecheckResult {
  parsed: Record<string, unknown> | null
  confidence: number
}

/**
 * precheckParse — deterministic precheck that runs before any LLM call.
 *
 * Returns high confidence (>= 0.8) when the text is clearly structured:
 *   - Has a recognized market (ML / spread / total)
 *   - Optionally has a price
 *
 * Returns low confidence (< 0.75) when ambiguous:
 *   - No recognizable market
 *   - Text is too short / unrecognized
 *
 * @param text - Free-text sports pick description
 */
export function precheckParse(text: string): PrecheckResult {
  if (!text || !text.trim()) {
    return { parsed: null, confidence: 0 }
  }

  const trimmed = text.trim()
  const sport = detectSportLocal(trimmed)
  const extracted = extractLine(trimmed)

  // Build a confidence score based on what we were able to extract.
  // Each recognized structural element adds to confidence.
  let confidence = 0.0

  if (extracted.market !== 'unknown') {
    confidence += 0.5
  }
  if (extracted.price !== null) {
    confidence += 0.2
  }
  if (sport !== 'unknown') {
    confidence += 0.15
  }
  if (extracted.line !== null) {
    confidence += 0.1
  }
  if (extracted.team !== null) {
    confidence += 0.05
  }

  // Cap at 0.95 — leave some room for LLM to improve on structured picks
  confidence = Math.min(confidence, 0.95)

  if (extracted.market === 'unknown') {
    // Could not determine the market type — needs LLM
    return { parsed: null, confidence }
  }

  const parsed: Record<string, unknown> = {
    sport: sport !== 'unknown' ? sport : null,
    market: extracted.market,
    side: extracted.side,
    line: extracted.line,
    price: extracted.price,
    team: extracted.team,
  }

  return { parsed, confidence }
}
