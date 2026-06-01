// ---------------------------------------------------------------------------
// Sport auto-detection from bet description text
// ---------------------------------------------------------------------------

const MLB_TEAMS = [
  'Astros', 'Yankees', 'Dodgers', 'Orioles', 'Braves', 'Red Sox', 'White Sox',
  'Cubs', 'Reds', 'Guardians', 'Rockies', 'Tigers', 'Marlins', 'Twins', 'Mets',
  'Athletics', 'Phillies', 'Pirates', 'Padres', 'Giants', 'Mariners', 'Cardinals',
  'Rays', 'Rangers', 'Blue Jays', 'Nationals', 'Brewers', 'Royals', 'Angels',
  'Diamondbacks',
]

const MLB_ABBREVS = [
  'HOU', 'NYY', 'LAD', 'BAL', 'ATL', 'BOS', 'CHW', 'CHC', 'CIN', 'CLE',
  'COL', 'DET', 'MIA', 'MIN', 'NYM', 'OAK', 'PHI', 'PIT', 'SDP', 'SFG',
  'SEA', 'STL', 'TBR', 'TEX', 'TOR', 'WSN', 'MIL', 'KCR', 'LAA', 'ARI',
]

const NBA_TEAMS = [
  'Hawks', 'Celtics', 'Nets', 'Hornets', 'Bulls', 'Cavaliers', 'Mavericks',
  'Nuggets', 'Pistons', 'Warriors', 'Rockets', 'Pacers', 'Clippers', 'Lakers',
  'Grizzlies', 'Heat', 'Bucks', 'Timberwolves', 'Pelicans', 'Knicks', 'Thunder',
  'Magic', 'Sixers', '76ers', 'Suns', 'Blazers', 'Trail Blazers',
  'Sacramento Kings', 'SAC Kings', 'Kings',
  'Spurs', 'Raptors', 'Jazz', 'Wizards',
]

const NBA_ABBREVS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
]

const NFL_TEAMS = [
  'Cardinals', 'Falcons', 'Ravens', 'Bills',
  'Carolina Panthers', 'CAR Panthers', 'Panthers',
  'Bears', 'Bengals',
  'Browns', 'Cowboys', 'Broncos', 'Lions', 'Packers', 'Texans', 'Colts',
  'Jaguars', 'Chiefs', 'Chargers', 'Rams', 'Dolphins', 'Vikings', 'Patriots',
  'Saints', 'Jets', 'Raiders', 'Eagles', 'Steelers', 'Seahawks', 'Buccaneers',
  'Titans', 'Commanders', '49ers', 'Niners',
]

const NFL_ABBREVS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
  'DET', 'GBP', 'HOU', 'IND', 'JAX', 'KCC', 'LAC', 'LAR', 'MIA', 'MIN',
  'NEP', 'NOS', 'NYJ', 'NYG', 'LVR', 'PHI', 'PIT', 'SEA', 'TBB', 'TEN',
  'WAS', 'SFO',
]

const NHL_TEAMS = [
  'Ducks', 'Coyotes', 'Bruins', 'Sabres', 'Flames', 'Hurricanes', 'Blackhawks',
  'Avalanche', 'Blue Jackets', 'Stars', 'Red Wings', 'Oilers',
  'Florida Panthers', 'FLA Panthers', 'FLO Panthers', 'Panthers',
  'LA Kings', 'Los Angeles Kings', 'L.A. Kings', 'Kings',
  'Wild', 'Canadiens', 'Predators', 'Devils', 'Islanders', 'Senators',
  'Flyers', 'Penguins', 'Sharks', 'Kraken', 'Blues', 'Lightning', 'Maple Leafs',
  'Canucks', 'Golden Knights', 'Capitals', 'Jets',
]

const NHL_ABBREVS = [
  'ANA', 'ARI', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL',
  'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NSH', 'NJD', 'NYI', 'NYR',
  'OTT', 'PHI', 'PIT', 'SJS', 'SEA', 'STL', 'TBL', 'TOR', 'VAN', 'VGK',
  'WSH', 'WPG',
]

// ---------------------------------------------------------------------------
// Keyword patterns per sport
// ---------------------------------------------------------------------------

const MLB_KEYWORDS = [
  'MLB', 'Baseball', 'Strikeouts', 'Hits Allowed', 'Total Bases', 'Home Runs',
  'RBIs', 'Earned Runs', 'Innings', 'ERA', 'Run Line', 'NRFI', 'First 5',
  'F5', 'Pitcher', 'Batter',
]

const NBA_KEYWORDS = [
  'NBA', 'Basketball', 'Points', 'Rebounds', 'Assists', 'Steals', 'Blocks',
  'Three Pointers', '3-Pointers', '3PT', 'PRA', 'Pts\\+Reb', 'Pts\\+Ast',
  'Double Double', 'Triple Double',
]

const NFL_KEYWORDS = [
  'NFL', 'Football', 'Passing Yards', 'Rushing Yards', 'Receiving Yards',
  'Touchdowns', 'Completions', 'Interceptions', 'Sacks', 'Field Goals',
  'Anytime TD', 'First TD', 'Pass Attempts', 'Carries',
]

const NHL_KEYWORDS = [
  'NHL', 'Hockey', 'Goals', 'Shots on Goal', 'Power Play', 'Puck Line',
  'Saves', 'Goaltender', 'SOG',
]

const NCAAF_KEYWORDS = [
  'NCAAF', 'College Football', 'CFB', 'Bowl Game', 'College FB',
]

const NCAAB_KEYWORDS = [
  'NCAAB', 'College Basketball', 'CBB', 'March Madness', 'NCAA Basketball',
  'College Hoops',
]

const SOCCER_KEYWORDS = [
  'Soccer', 'Football', 'EPL', 'Premier League', 'La Liga', 'Serie A',
  'Bundesliga', 'Ligue 1', 'Champions League', 'MLS', 'UEFA', 'FIFA',
  'Clean Sheet', 'Anytime Goalscorer', 'Both Teams to Score', 'BTTS',
  'Draw No Bet', 'Corner',
]

const TENNIS_KEYWORDS = [
  'Tennis', 'ATP', 'WTA', 'Grand Slam', 'Wimbledon', 'US Open Tennis',
  'French Open', 'Australian Open', 'Sets', 'Aces', 'Match Winner',
  'Set Betting',
]

const MMA_KEYWORDS = [
  'MMA', 'UFC', 'Bellator', 'PFL', 'Fight Night', 'Method of Victory',
  'Round Betting', 'KO/TKO', 'Submission', 'Decision',
]

const GOLF_KEYWORDS = [
  'Golf', 'PGA', 'Masters', 'The Open', 'US Open Golf', 'Ryder Cup',
  'Top 5', 'Top 10', 'Top 20', 'Cut Made', 'Outright Winner', 'Matchup',
  'First Round Leader',
]

const CRICKET_KEYWORDS = [
  'Cricket', 'IPL', 'T20', 'ODI', 'Test Match', 'Big Bash', 'BBL',
  'CPL', 'PSL', 'SA20', 'The Hundred', 'Wickets', 'Overs', 'Innings',
  'Run Rate', 'Boundary', 'Six', 'LBW', 'Maiden', 'Century',
  'ICC', 'World Cup Cricket',
]

// WNBA teams — 'Sky' omitted (3 chars, below buildTeamRegex word-boundary usefulness).
// 'Dallas Wings' used (not bare 'Wings') to avoid NHL Red Wings collision (D-03a).
// 'Las Vegas Aces' used (not bare 'Aces') to avoid Tennis 'Aces' keyword collision (D-03a).
const WNBA_TEAMS = [
  'Las Vegas Aces', 'Liberty', 'Dallas Wings', 'Fever', 'Storm', 'Lynx',
  'Mercury', 'Sun', 'Dream', 'Mystics', 'Sparks', 'Valkyries',
]

const WNBA_KEYWORDS = ['WNBA', "Women's Basketball", "Women's National Basketball"]

// PLL (Premier Lacrosse League) team names — chosen to avoid collisions with
// other leagues. NLL team names largely collide with NFL/NHL (Bandits, Wings,
// Panthers) and are intentionally excluded here; keyword match covers NLL.
const LACROSSE_TEAMS = [
  'Archers', 'Atlas', 'Cannons', 'Chaos', 'Chrome',
  'Outlaws', 'Redwoods', 'Waterdogs', 'Whipsnakes',
]

const LACROSSE_KEYWORDS = [
  'Lacrosse', 'PLL', 'NLL', 'Premier Lacrosse', 'World Lacrosse',
  'Faceoff', 'Face-off', 'Face Off',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a regex that matches any word from the list as a whole word (case-insensitive). */
function buildTeamRegex(teams: readonly string[]): RegExp {
  const escaped = teams.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i')
}

/** Build a regex that matches any 2-3 letter abbreviation in parens like (LAC) or standalone. */
function buildAbbrevRegex(abbrevs: readonly string[]): RegExp {
  return new RegExp(`(?:\\(|\\b)(?:${abbrevs.join('|')})(?:\\)|\\b)`, 'i')
}

function buildKeywordRegex(keywords: readonly string[]): RegExp {
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i')
}

// ---------------------------------------------------------------------------
// Sport detection rules — ordered by specificity (most specific first)
// ---------------------------------------------------------------------------

interface SportRule {
  sport: string
  teamRegex?: RegExp
  abbrevRegex?: RegExp
  keywordRegex: RegExp
}

// We split NBA/NFL/NHL abbreviations that collide with MLB (e.g. HOU, ATL, PHI)
// by checking keywords first and falling back to abbreviations last.
const SPORT_RULES: readonly SportRule[] = [
  // College sports checked before pro to avoid false positives
  {
    sport: 'NCAAF',
    keywordRegex: buildKeywordRegex(NCAAF_KEYWORDS),
  },
  {
    sport: 'NCAAB',
    keywordRegex: buildKeywordRegex(NCAAB_KEYWORDS),
  },
  // Pro sports — keyword match
  {
    sport: 'MLB',
    teamRegex: buildTeamRegex(MLB_TEAMS),
    abbrevRegex: buildAbbrevRegex(MLB_ABBREVS),
    keywordRegex: buildKeywordRegex(MLB_KEYWORDS),
  },
  // WNBA must be evaluated before NBA so WNBA prop bets carrying 'Points'/'Basketball'
  // keywords resolve to WNBA, not NBA (D-03a).
  {
    sport: 'WNBA',
    teamRegex: buildTeamRegex(WNBA_TEAMS),
    keywordRegex: buildKeywordRegex(WNBA_KEYWORDS),
  },
  {
    sport: 'NBA',
    teamRegex: buildTeamRegex(NBA_TEAMS),
    abbrevRegex: buildAbbrevRegex(NBA_ABBREVS),
    keywordRegex: buildKeywordRegex(NBA_KEYWORDS),
  },
  {
    sport: 'NFL',
    teamRegex: buildTeamRegex(NFL_TEAMS),
    abbrevRegex: buildAbbrevRegex(NFL_ABBREVS),
    keywordRegex: buildKeywordRegex(NFL_KEYWORDS),
  },
  {
    sport: 'NHL',
    teamRegex: buildTeamRegex(NHL_TEAMS),
    abbrevRegex: buildAbbrevRegex(NHL_ABBREVS),
    keywordRegex: buildKeywordRegex(NHL_KEYWORDS),
  },
  // Non-team sports
  {
    sport: 'Soccer',
    keywordRegex: buildKeywordRegex(SOCCER_KEYWORDS),
  },
  {
    sport: 'Tennis',
    keywordRegex: buildKeywordRegex(TENNIS_KEYWORDS),
  },
  {
    sport: 'MMA',
    keywordRegex: buildKeywordRegex(MMA_KEYWORDS),
  },
  {
    sport: 'Golf',
    keywordRegex: buildKeywordRegex(GOLF_KEYWORDS),
  },
  {
    sport: 'Cricket',
    keywordRegex: buildKeywordRegex(CRICKET_KEYWORDS),
  },
  {
    sport: 'Lacrosse',
    teamRegex: buildTeamRegex(LACROSSE_TEAMS),
    keywordRegex: buildKeywordRegex(LACROSSE_KEYWORDS),
  },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Prop-shape disambiguator
// ---------------------------------------------------------------------------
//
// Player props have the shape "Player Name (TEAM) Over|Under|N+ Stat". Without
// this special-case pass, descriptions like "Jackson LaCombe (ANA) Over 0.5
// Points" get tagged as NBA because the keyword "Points" wins over the team
// abbrev. ANA is unambiguously NHL, so the parens take priority for props.
// ---------------------------------------------------------------------------

const PROP_SHAPE_RE =
  /^[\p{L}.\p{M} '’\-]+?\s+\(([A-Z]{2,4})\)\s+(?:Over|Under|\d+\+)\b/iu

/** NHL-only stat hints — when present, NHL wins over NBA for ambiguous teams. */
const NHL_STAT_RE =
  /\b(?:shots?\s+on\s+goal|sog|saves?|goalie|power\s+play|hat\s+trick)\b/i

/** NBA-only stat hints. */
const NBA_STAT_RE =
  /\b(?:rebounds?|assists?|three\s+pointers?|threes?|3pt|3pm|pra|pts\s*\+|reb\s*\+|double\s+double|triple\s+double)\b/i

/** NFL-only stat hints. */
const NFL_STAT_RE =
  /\b(?:passing|rushing|receiving|completions?|sacks?|interceptions?|receptions?|anytime\s+td)\b/i

/** MLB-only stat hints. */
const MLB_STAT_RE =
  /\b(?:home\s+runs?|hrs?|rbis?|total\s+bases|strikeouts?|walks?|innings?\s+pitched)\b/i

function detectByPropShape(description: string): string | null {
  const m = description.match(PROP_SHAPE_RE)
  if (!m) return null

  const abbrev = m[1].toUpperCase()
  const candidates: string[] = []
  if (NHL_ABBREVS.includes(abbrev)) candidates.push('NHL')
  if (NBA_ABBREVS.includes(abbrev)) candidates.push('NBA')
  if (MLB_ABBREVS.includes(abbrev)) candidates.push('MLB')
  if (NFL_ABBREVS.includes(abbrev)) candidates.push('NFL')

  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // Multiple candidates — disambiguate via stat keyword.
  if (NHL_STAT_RE.test(description) && candidates.includes('NHL')) return 'NHL'
  if (NBA_STAT_RE.test(description) && candidates.includes('NBA')) return 'NBA'
  if (NFL_STAT_RE.test(description) && candidates.includes('NFL')) return 'NFL'
  if (MLB_STAT_RE.test(description) && candidates.includes('MLB')) return 'MLB'

  // Generic "Points" stat with multiple candidates: NHL > NBA > NFL > MLB
  // (Points is most common in NHL/NBA; NFL "Points" props don't exist; MLB
  // doesn't either.) This kicks in for cases like "(CAR) Points" → NHL.
  if (/\bpoints?\b/i.test(description)) {
    if (candidates.includes('NHL')) return 'NHL'
    if (candidates.includes('NBA')) return 'NBA'
  }

  return null
}

/**
 * Detect the sport from a bet description string.
 *
 * Returns one of: 'MLB' | 'NBA' | 'NFL' | 'NHL' | 'NCAAF' | 'NCAAB' |
 *                 'Soccer' | 'Tennis' | 'MMA' | 'Golf' | 'Cricket' |
 *                 'Lacrosse' | 'unknown'
 */
export function detectSport(description: string): string {
  if (!description) return 'unknown'

  // Pass 0 — prop-shape short-circuit. Highly diagnostic for player props,
  // where the parenthesized team abbrev should override keyword matches.
  const propSport = detectByPropShape(description)
  if (propSport) return propSport

  // Pass 1 — keyword match (most reliable for non-prop bets)
  for (const rule of SPORT_RULES) {
    if (rule.keywordRegex.test(description)) {
      return rule.sport
    }
  }

  // Pass 2 — team full name match (prefer longest match to disambiguate
  // shared names like "Kings" → NBA vs "LA Kings" → NHL)
  let bestTeamMatch: { sport: string; length: number } | null = null
  for (const rule of SPORT_RULES) {
    if (rule.teamRegex) {
      const m = description.match(rule.teamRegex)
      if (m && (!bestTeamMatch || m[0].length > bestTeamMatch.length)) {
        bestTeamMatch = { sport: rule.sport, length: m[0].length }
      }
    }
  }
  if (bestTeamMatch) return bestTeamMatch.sport

  // Pass 3 — abbreviation match (least specific, can collide across leagues)
  for (const rule of SPORT_RULES) {
    if (rule.abbrevRegex?.test(description)) {
      return rule.sport
    }
  }

  return 'unknown'
}
