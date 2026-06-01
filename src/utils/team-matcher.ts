import type { Bet } from '@/lib/types'
import type { LiveGame } from '@/hooks/use-live-scores'

// ---------------------------------------------------------------------------
// Sport-scoped ESPN abbreviation lookup
// ---------------------------------------------------------------------------
// Keys are lowercase team names, city abbreviations, and common variants.
// Values are the ESPN abbreviation used in LiveGame.homeTeam / awayTeam.
//
// Per-sport so that collisions like "Cardinals" (MLB STL vs NFL ARI) and
// "Panthers" (NHL FLA vs NFL CAR) resolve correctly. The bet's sport is
// passed in by the caller and we only consult that sport's table.
// ---------------------------------------------------------------------------

type AbbrevMap = Readonly<Record<string, string>>

const MLB_ABBREVS: AbbrevMap = {
  astros: 'HOU', yankees: 'NYY', dodgers: 'LAD', orioles: 'BAL',
  braves: 'ATL', 'red sox': 'BOS', 'white sox': 'CHW', cubs: 'CHC',
  reds: 'CIN', guardians: 'CLE', rockies: 'COL', tigers: 'DET',
  marlins: 'MIA', twins: 'MIN', mets: 'NYM', athletics: 'OAK',
  phillies: 'PHI', pirates: 'PIT', padres: 'SD', giants: 'SF',
  mariners: 'SEA', cardinals: 'STL', rays: 'TB',
  'blue jays': 'TOR', nationals: 'WSH', brewers: 'MIL', royals: 'KC',
  angels: 'LAA', diamondbacks: 'ARI', rangers: 'TEX',
  // City abbreviations from bet descriptions
  hou: 'HOU', nyy: 'NYY', lad: 'LAD', bal: 'BAL', atl: 'ATL',
  bos: 'BOS', chw: 'CHW', chc: 'CHC', cin: 'CIN', cle: 'CLE',
  col: 'COL', det: 'DET', mia: 'MIA', min: 'MIN', nym: 'NYM',
  oak: 'OAK', phi: 'PHI', pit: 'PIT', sdp: 'SD', sfg: 'SF',
  sea: 'SEA', stl: 'STL', tbr: 'TB', tex: 'TEX', tor: 'TOR',
  wsn: 'WSH', mil: 'MIL', kcr: 'KC', kc: 'KC', laa: 'LAA',
  ari: 'ARI', sd: 'SD', sf: 'SF', tb: 'TB', wsh: 'WSH',
}

const NBA_ABBREVS: AbbrevMap = {
  hawks: 'ATL', celtics: 'BOS', nets: 'BKN', hornets: 'CHA',
  bulls: 'CHI', cavaliers: 'CLE', mavericks: 'DAL', nuggets: 'DEN',
  pistons: 'DET', warriors: 'GS', rockets: 'HOU', pacers: 'IND',
  clippers: 'LAC', lakers: 'LAL', grizzlies: 'MEM', heat: 'MIA',
  bucks: 'MIL', timberwolves: 'MIN', pelicans: 'NOP', knicks: 'NY',
  thunder: 'OKC', magic: 'ORL', sixers: 'PHI', '76ers': 'PHI',
  suns: 'PHX', blazers: 'POR', 'trail blazers': 'POR',
  spurs: 'SA', raptors: 'TOR', jazz: 'UTAH', wizards: 'WSH',
  kings: 'SAC',
  // City abbreviations
  atl: 'ATL', bos: 'BOS', bkn: 'BKN', cha: 'CHA', chi: 'CHI',
  cle: 'CLE', dal: 'DAL', den: 'DEN', det: 'DET', gsw: 'GS', gs: 'GS',
  hou: 'HOU', ind: 'IND', lac: 'LAC', lal: 'LAL', mem: 'MEM',
  mia: 'MIA', mil: 'MIL', min: 'MIN', nop: 'NOP', nyk: 'NY', ny: 'NY',
  okc: 'OKC', orl: 'ORL', phi: 'PHI', phx: 'PHX', por: 'POR',
  sac: 'SAC', sas: 'SA', sa: 'SA', tor: 'TOR', uta: 'UTAH', was: 'WSH',
}

const NHL_ABBREVS: AbbrevMap = {
  ducks: 'ANA', coyotes: 'ARI', bruins: 'BOS', sabres: 'BUF',
  flames: 'CGY', hurricanes: 'CAR', blackhawks: 'CHI', avalanche: 'COL',
  'blue jackets': 'CBJ', stars: 'DAL', 'red wings': 'DET', oilers: 'EDM',
  panthers: 'FLA', wild: 'MIN', canadiens: 'MTL',
  predators: 'NSH', devils: 'NJ', islanders: 'NYI', rangers: 'NYR',
  senators: 'OTT', flyers: 'PHI', penguins: 'PIT', sharks: 'SJ',
  kraken: 'SEA', blues: 'STL', lightning: 'TB', 'maple leafs': 'TOR',
  canucks: 'VAN', 'golden knights': 'VGK', capitals: 'WSH', jets: 'WPG',
  kings: 'LA',
  // City abbreviations
  ana: 'ANA', bos: 'BOS', buf: 'BUF', cgy: 'CGY', car: 'CAR',
  chi: 'CHI', col: 'COL', cbj: 'CBJ', dal: 'DAL', det: 'DET',
  edm: 'EDM', fla: 'FLA', la: 'LA', lak: 'LA', min: 'MIN', mtl: 'MTL',
  mon: 'MTL', nsh: 'NSH', njd: 'NJ', nj: 'NJ', nyi: 'NYI', nyr: 'NYR',
  ott: 'OTT', phi: 'PHI', pit: 'PIT', sjs: 'SJ', sj: 'SJ',
  sea: 'SEA', stl: 'STL', tbl: 'TB', tb: 'TB', tor: 'TOR',
  van: 'VAN', vgk: 'VGK', wsh: 'WSH', wpg: 'WPG', win: 'WPG',
}

const NFL_ABBREVS: AbbrevMap = {
  cardinals: 'ARI', falcons: 'ATL', ravens: 'BAL', bills: 'BUF',
  panthers: 'CAR', bears: 'CHI', bengals: 'CIN', browns: 'CLE',
  cowboys: 'DAL', broncos: 'DEN', lions: 'DET', packers: 'GB',
  texans: 'HOU', colts: 'IND', jaguars: 'JAX', chiefs: 'KC',
  raiders: 'LV', chargers: 'LAC', rams: 'LAR', dolphins: 'MIA',
  vikings: 'MIN', patriots: 'NE', saints: 'NO', giants: 'NYG',
  jets: 'NYJ', eagles: 'PHI', steelers: 'PIT', '49ers': 'SF',
  niners: 'SF', seahawks: 'SEA', buccaneers: 'TB', titans: 'TEN',
  commanders: 'WSH',
  // City / common abbreviations
  ari: 'ARI', atl: 'ATL', bal: 'BAL', buf: 'BUF', car: 'CAR',
  chi: 'CHI', cin: 'CIN', cle: 'CLE', dal: 'DAL', den: 'DEN',
  det: 'DET', gb: 'GB', gbp: 'GB', hou: 'HOU', ind: 'IND',
  jax: 'JAX', kc: 'KC', kcc: 'KC', lv: 'LV', lvr: 'LV',
  lac: 'LAC', lar: 'LAR', mia: 'MIA', min: 'MIN', ne: 'NE',
  nep: 'NE', no: 'NO', nos: 'NO', nyg: 'NYG', nyj: 'NYJ',
  phi: 'PHI', pit: 'PIT', sf: 'SF', sfo: 'SF', sea: 'SEA',
  tb: 'TB', tbb: 'TB', ten: 'TEN', wsh: 'WSH', was: 'WSH',
}

const WNBA_ABBREVS: AbbrevMap = {
  // Team names (lowercase) -> ESPN scoreboard abbreviation
  aces: 'LV',          // Las Vegas Aces
  liberty: 'NY',       // New York Liberty
  sky: 'CHI',          // Chicago Sky  <- 3 letters, MUST be here (fuzzy fallback drops it)
  fever: 'IND',        // Indiana Fever
  storm: 'SEA',        // Seattle Storm
  lynx: 'MIN',         // Minnesota Lynx
  mercury: 'PHX',      // Phoenix Mercury
  sun: 'CON',          // Connecticut Sun  <- 3 letters, MUST be here (verified vs ESPN teams + scoreboard)
  wings: 'DAL',        // Dallas Wings
  dream: 'ATL',        // Atlanta Dream
  mystics: 'WSH',      // Washington Mystics
  sparks: 'LA',        // Los Angeles Sparks
  valkyries: 'GS',     // Golden State Valkyries
  // City abbreviations (lowercase)
  lv: 'LV', ny: 'NY', chi: 'CHI', ind: 'IND', sea: 'SEA',
  min: 'MIN', phx: 'PHX', conn: 'CON', dal: 'DAL',
  atl: 'ATL', wsh: 'WSH', la: 'LA', gs: 'GS',
  // City full names
  'las vegas': 'LV', 'new york': 'NY', chicago: 'CHI',
  indiana: 'IND', seattle: 'SEA', minnesota: 'MIN',
  phoenix: 'PHX', connecticut: 'CON', dallas: 'DAL',
  atlanta: 'ATL', washington: 'WSH', 'los angeles': 'LA',
  'golden state': 'GS',
}

const ABBREV_BY_SPORT: Readonly<Record<string, AbbrevMap>> = {
  MLB: MLB_ABBREVS,
  NBA: NBA_ABBREVS,
  WNBA: WNBA_ABBREVS,
  NHL: NHL_ABBREVS,
  NFL: NFL_ABBREVS,
}

// ---------------------------------------------------------------------------
// Bet description parsing
// ---------------------------------------------------------------------------

export type LineType = 'moneyline' | 'spread' | 'over' | 'under' | 'unknown'

/**
 * Period scope for the bet. Determines which linescore segments to sum
 * when computing cover status / auto-settling.
 *
 *   fullgame   — entire game (default)
 *   1h / 2h    — first / second half (NBA, NCAAB, NFL, NCAAF, Soccer)
 *   1q-4q      — first through fourth quarter (NBA, NFL, NCAAF)
 *   1p / 2p / 3p — first / second / third period (NHL)
 *   f5 / f3    — first 5 / 3 innings (MLB)
 */
export type BetPeriod =
  | 'fullgame'
  | '1h' | '2h'
  | '1q' | '2q' | '3q' | '4q'
  | '1p' | '2p' | '3p'
  | 'f5' | 'f3'

export interface ParsedLine {
  team: string | null
  lineType: LineType
  lineValue: number | null
  period: BetPeriod
}

/**
 * Detect a period marker in the description. Looks for patterns like
 * `(1H)`, `(1P)`, `(F5)`, plus the spelled-out variants.
 *
 * Returns 'fullgame' if no period marker is present.
 */
export function detectBetPeriod(description: string): BetPeriod {
  const d = description

  // Parenthesized short codes — most common in user's data: "(1H)", "(1P)".
  const paren = d.match(/\(([1-4])\s*([HhPpQq])\)/)
  if (paren) {
    const n = paren[1]
    const letter = paren[2].toLowerCase()
    return `${n}${letter}` as BetPeriod
  }

  // (F5) / (F3) — first N innings (MLB).
  if (/\(F5\)/i.test(d)) return 'f5'
  if (/\(F3\)/i.test(d)) return 'f3'
  if (/\bFirst\s+5\b/i.test(d)) return 'f5'

  // Long form: "1st Half", "First Half", "2nd Period", etc.
  const longMatch = d.match(
    /\b(1st|2nd|3rd|4th|First|Second|Third|Fourth)\s+(Half|Period|Quarter|Q|H|P)\b/i,
  )
  if (longMatch) {
    const ordWord = longMatch[1].toLowerCase()
    const unitWord = longMatch[2].toLowerCase()
    const ordMap: Record<string, string> = {
      '1st': '1', first: '1',
      '2nd': '2', second: '2',
      '3rd': '3', third: '3',
      '4th': '4', fourth: '4',
    }
    const unitMap: Record<string, 'h' | 'p' | 'q'> = {
      half: 'h', h: 'h',
      period: 'p', p: 'p',
      quarter: 'q', q: 'q',
    }
    const n = ordMap[ordWord]
    const unit = unitMap[unitWord]
    if (n && unit) return `${n}${unit}` as BetPeriod
  }

  return 'fullgame'
}

/**
 * Parse a bet description to extract team, line type, line value, and
 * optional period marker.
 *
 * Examples:
 *  "PHX Suns -13"          -> { team: "PHX", lineType: "spread",   period: "fullgame" }
 *  "KC Royals ML"          -> { team: "KC",  lineType: "moneyline" }
 *  "TOR - MEM o233.5"      -> { lineType: "over", lineValue: 233.5 }
 *  "ORL Magic +5 (1H)"     -> { team: "ORL", lineType: "spread", period: "1h" }
 *  "ANA - EDM u1½ (1P)"    -> { lineType: "under", lineValue: 1.5, period: "1p" }
 */
export function parseBetLine(description: string): ParsedLine {
  // Strip the period marker before pattern-matching the line; halves like
  // "u1½" need normalization too.
  const desc = description.trim().replace(/½/g, '.5')
  const period = detectBetPeriod(desc)

  // Over/under: look for o/O or u/U followed by a number
  const ouMatch = desc.match(/\b([oOuU])(\d+(?:\.\d+)?)\b/)
  if (ouMatch) {
    const type = ouMatch[1].toLowerCase() === 'o' ? 'over' : 'under'
    return { team: null, lineType: type, lineValue: parseFloat(ouMatch[2]), period }
  }

  // Moneyline: description ends with "ML" (optionally followed by period marker)
  const mlMatch = desc.match(/^(.+?)\s+ML\b/i)
  if (mlMatch) {
    const teamPart = mlMatch[1].trim()
    const firstWord = teamPart.split(/\s+/)[0]
    return { team: firstWord, lineType: 'moneyline', lineValue: null, period }
  }

  // Spread: team name followed by a positive or negative number
  const spreadMatch = desc.match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?)\s*(?:\(|$)/)
  if (spreadMatch) {
    const teamPart = spreadMatch[1].trim()
    const firstWord = teamPart.split(/\s+/)[0]
    return {
      team: firstWord,
      lineType: 'spread',
      lineValue: parseFloat(spreadMatch[2]),
      period,
    }
  }

  return { team: null, lineType: 'unknown', lineValue: null, period }
}

// ---------------------------------------------------------------------------
// Team matching: find ESPN abbreviations mentioned in a description
// ---------------------------------------------------------------------------

export function findEspnAbbrevs(description: string, sport: string): string[] {
  const map = ABBREV_BY_SPORT[sport]
  if (!map) return []

  const lower = description.toLowerCase()
  const found: string[] = []

  // Multi-word keys first so e.g. "blue jays" beats "blue".
  const sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length)

  for (const key of sortedKeys) {
    const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (pattern.test(lower)) {
      const abbrev = map[key]
      if (!found.includes(abbrev)) {
        found.push(abbrev)
      }
    }
  }

  return found
}

// ---------------------------------------------------------------------------
// Fuzzy name fallback
// ---------------------------------------------------------------------------
// For sports without an abbrev map (Soccer, NCAAB, NCAAF, Tennis, etc.) we
// extract proper-noun-ish tokens from the description and check substring
// matches against each game's home/away shortDisplayName.
// ---------------------------------------------------------------------------

const NAME_STOPWORDS = new Set([
  'vs', 'at', 'over', 'under', 'ml', 'and', 'the', 'fc', 'cf',
  'first', 'second', 'half', 'period', 'quarter', 'game',
  'cover', 'win', 'lose', 'live', 'risk', 'free', 'play',
])

function extractNameTokens(description: string): string[] {
  return description
    .split(/[\s\-/(),]+/)
    .filter((t) => /^[A-Z][A-Za-z]{2,}$/.test(t))
    .filter((t) => !NAME_STOPWORDS.has(t.toLowerCase()))
    .map((t) => t.toUpperCase())
}

function matchByNames(
  description: string,
  sportGames: readonly LiveGame[],
): LiveGame[] {
  const tokens = extractNameTokens(description)
  if (tokens.length === 0) return []

  const matches: LiveGame[] = []
  for (const game of sportGames) {
    const home = game.homeName.toUpperCase()
    const away = game.awayName.toUpperCase()
    const hit = tokens.some((t) => {
      // Require >=4 chars so generic tokens like "FC" or short city abbrevs
      // don't accidentally substring-match into longer team names.
      if (t.length < 4) return false
      return home.includes(t) || away.includes(t)
    })
    if (hit) matches.push(game)
  }
  return matches
}

// ---------------------------------------------------------------------------
// Library alias map type (D-16)
// ---------------------------------------------------------------------------

/**
 * Optional library-sourced alias map for a single sport.
 * Keys are lowercased aliases (nicknames, abbreviations, full names);
 * values are the ESPN abbreviation (e.g. "brewers" → "MIL").
 *
 * When provided to matchDescriptionToGame, this replaces the hardcoded
 * ABBREV_BY_SPORT lookup — fulfilling D-16 "route assignment through the library".
 */
export type LibraryAliasMap = Readonly<Record<string, string>>

// ---------------------------------------------------------------------------
// Match a bet to a live game
// ---------------------------------------------------------------------------

/**
 * Core description → game matcher.
 *
 * Pass 1 (high-precision): If `libraryAliases` is provided, resolve description
 * tokens to ESPN abbreviations via the library (D-16 routing). Otherwise falls
 * back to the local ABBREV_BY_SPORT hardcoded maps (backward compatibility for
 * callers that haven't yet pre-fetched library data).
 *
 * Pass 2 (fuzzy name fallback): token-based substring match against game names.
 */
function matchDescriptionToGame(
  description: string,
  sport: string,
  games: readonly LiveGame[],
  placedAt?: string,
  libraryAliases?: LibraryAliasMap,
): LiveGame | null {
  const sportGames = games.filter((g) => g.sport === sport)
  if (sportGames.length === 0) return null

  // Pass 1: sport-specific abbrev match (high precision).
  // D-16: use library aliases when provided; fall back to hardcoded maps otherwise.
  const betAbbrevs = libraryAliases
    ? findEspnAbbreviasFromLibrary(description, libraryAliases)
    : findEspnAbbrevs(description, sport)

  let matches: LiveGame[] = []
  if (betAbbrevs.length > 0) {
    for (const game of sportGames) {
      const gameIds = [
        game.homeTeam.toUpperCase(),
        game.awayTeam.toUpperCase(),
        game.homeName.toUpperCase(),
        game.awayName.toUpperCase(),
      ]
      const matched = betAbbrevs.some((ba) =>
        gameIds.some((ga) => ga === ba.toUpperCase()),
      )
      if (matched) matches.push(game)
    }
  }

  // Pass 2: fuzzy name fallback for sports without a map (or when the map
  // doesn't recognize the description's tokens — e.g. NCAA teams).
  if (matches.length === 0) {
    matches = matchByNames(description, sportGames)
  }

  if (matches.length === 0) return null

  // Stale guard: drop games that started more than an hour before the bet
  // was placed. This keeps back-to-back same-team games (yesterday's final
  // vs tonight's upcoming) from accidentally showing yesterday's score.
  let pool = matches
  if (placedAt) {
    const placedMs = new Date(placedAt).getTime()
    const fresh = matches.filter(
      (g) => new Date(g.startTime).getTime() >= placedMs - 60 * 60 * 1000,
    )
    if (fresh.length > 0) pool = fresh
  }

  if (pool.length === 1) return pool[0]

  // Prefer a not-yet-final game so pending bets show the upcoming/live game.
  const upcomingOrLive = pool.find((g) => g.status !== 'post')
  return upcomingOrLive ?? pool[0]
}

/**
 * Resolve ESPN abbreviations from a bet description using library-sourced aliases.
 * D-16: This replaces the ABBREV_BY_SPORT lookup inside matchDescriptionToGame
 * when the caller provides pre-fetched library aliases.
 */
function findEspnAbbreviasFromLibrary(
  description: string,
  libraryAliases: LibraryAliasMap,
): string[] {
  const lower = description.toLowerCase()
  const found: string[] = []

  // Multi-word keys first so e.g. "golden knights" beats "golden"
  const sortedKeys = Object.keys(libraryAliases).sort((a, b) => b.length - a.length)

  for (const key of sortedKeys) {
    const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (pattern.test(lower)) {
      const abbrev = libraryAliases[key]
      if (!found.includes(abbrev)) {
        found.push(abbrev)
      }
    }
  }

  return found
}

export function matchBetToGame(
  bet: Bet,
  games: readonly LiveGame[],
  libraryAliases?: LibraryAliasMap,
): LiveGame | null {
  return matchDescriptionToGame(bet.description, bet.sport, games, bet.placed_at, libraryAliases)
}

/** Match each parlay leg to its own game. Returns array parallel to legs. */
export function matchParlayLegs(
  bet: Bet,
  games: readonly LiveGame[],
  libraryAliases?: LibraryAliasMap,
): (LiveGame | null)[] {
  if (!bet.parlay_legs || bet.parlay_legs.length === 0) {
    // Fallback: split combined description by " / "
    const parts = bet.description.split(' / ')
    return parts.map((part) =>
      matchDescriptionToGame(part.trim(), bet.sport, games, bet.placed_at, libraryAliases)
    )
  }

  return bet.parlay_legs.map((leg) =>
    matchDescriptionToGame(leg.description, leg.sport ?? bet.sport, games, bet.placed_at, libraryAliases)
  )
}

// ---------------------------------------------------------------------------
// Period score helper
// ---------------------------------------------------------------------------
//
// Given a bet's period scope and a game's linescore array, return the
// running home/away scores at the end of the bet's relevant segment, plus
// whether that segment is complete (so we can offer auto-settle).
// ---------------------------------------------------------------------------

export interface SegmentScore {
  home: number
  away: number
  /** True when the bet's period scope is over and the score is final. */
  complete: boolean
  /** True when we have enough data to compute the segment (vs pregame). */
  hasData: boolean
}

/**
 * Indexes into linescore[] to sum, and the period number (1-based) at which
 * the segment is complete. Sport disambiguates 1H semantics — quarters in NBA
 * vs halves in NCAAB.
 */
function segmentSpec(
  period: BetPeriod,
  sport: string,
): { indexes: number[]; finishedAfterPeriod: number } | null {
  // Sports where 1H = halves directly (linescores[0] is the half, not Q1).
  const halfSports = new Set(['NCAAB', 'Soccer'])

  switch (period) {
    case 'fullgame':
      return null // caller uses total score
    case '1h':
      return halfSports.has(sport)
        ? { indexes: [0], finishedAfterPeriod: 1 }
        : { indexes: [0, 1], finishedAfterPeriod: 2 }
    case '2h':
      return halfSports.has(sport)
        ? { indexes: [1], finishedAfterPeriod: 2 }
        : { indexes: [2, 3], finishedAfterPeriod: 4 }
    case '1q':
      return { indexes: [0], finishedAfterPeriod: 1 }
    case '2q':
      return { indexes: [1], finishedAfterPeriod: 2 }
    case '3q':
      return { indexes: [2], finishedAfterPeriod: 3 }
    case '4q':
      return { indexes: [3], finishedAfterPeriod: 4 }
    case '1p':
      return { indexes: [0], finishedAfterPeriod: 1 }
    case '2p':
      return { indexes: [1], finishedAfterPeriod: 2 }
    case '3p':
      return { indexes: [2], finishedAfterPeriod: 3 }
    case 'f5':
      return { indexes: [0, 1, 2, 3, 4], finishedAfterPeriod: 5 }
    case 'f3':
      return { indexes: [0, 1, 2], finishedAfterPeriod: 3 }
  }
}

export function getSegmentScore(
  period: BetPeriod,
  game: LiveGameLite,
): SegmentScore {
  if (period === 'fullgame') {
    return {
      home: game.homeScore,
      away: game.awayScore,
      complete: game.status === 'post',
      hasData: game.status !== 'pre',
    }
  }

  const spec = segmentSpec(period, game.sport)
  if (!spec) {
    return { home: 0, away: 0, complete: false, hasData: false }
  }

  const ls = game.periodScores ?? []
  if (ls.length === 0) {
    // No linescore data available — can't compute period score.
    return { home: 0, away: 0, complete: false, hasData: false }
  }

  const maxIdx = Math.max(...spec.indexes)
  // We only have data through ls.length periods. If the segment requires
  // an index past that, we can't yet compute it.
  if (maxIdx >= ls.length) {
    return { home: 0, away: 0, complete: false, hasData: false }
  }

  let home = 0
  let away = 0
  for (const i of spec.indexes) {
    home += ls[i].home
    away += ls[i].away
  }

  const complete =
    game.status === 'post' ||
    (game.currentPeriod != null && game.currentPeriod > spec.finishedAfterPeriod)

  return { home, away, complete, hasData: true }
}

// LiveGame import is kept structural to avoid a circular import via use-live-scores.
type LiveGameLite = Pick<
  LiveGame,
  'sport' | 'homeScore' | 'awayScore' | 'status' | 'periodScores' | 'currentPeriod'
>

// ---------------------------------------------------------------------------
// Cover status calculation
// ---------------------------------------------------------------------------

export type CoverStatus = 'covering' | 'behind' | 'push' | 'pregame'

/**
 * Full live state for a bet — the contract Phase 16's card tint consumes.
 *
 * State machine:
 *   pre  → 'pregame'
 *   live → 'too_early'  (elapsedFraction < 0.15, D-03 suppression)
 *        → 'on_pace' | 'borderline' | 'off_pace'   (D-02 — totals/props)
 *        → 'covering' | 'behind' | 'push'          (D-11 — spreads/ML retained,
 *                                                    and D-12 fallback)
 *        → 'clinched_won' | 'clinched_lost'        (D-05 — mid-game clinch)
 *   post → 'final_won' | 'final_lost' | 'final_push'  (D-05)
 *
 * 'covering'/'behind'/'push' are RETAINED and structurally a subset of
 * LiveStatus, so getCoverStatus's return value still assigns cleanly. The
 * pace bands and clinch/final states are net new and surface in the
 * card tint mapping that Phase 16 owns.
 */
export type LiveStatus =
  | 'pregame'
  | 'too_early'
  | 'on_pace'
  | 'borderline'
  | 'off_pace'
  | 'covering'
  | 'behind'
  | 'push'
  | 'clinched_won'
  | 'clinched_lost'
  | 'final_won'
  | 'final_lost'
  | 'final_push'

/**
 * The pure pace-band subset returned by `getOnPaceStatus`. A strict
 * subset of `LiveStatus`, so any `PaceStatus` assigns to `LiveStatus`.
 */
export type PaceStatus = 'too_early' | 'on_pace' | 'borderline' | 'off_pace'

/**
 * Borderline-band half-width for the on-pace projection (D-02).
 *
 * RESEARCH Unknown 5: 10% of the line, with an absolute floor of 0.5 units so
 * small-value totals (e.g. NHL u1.5) still get a usable band. Uses `Math.abs`
 * so negative inputs (defensive — spreads should never reach this path) still
 * scale positively.
 */
export function borderlineMargin(lineValue: number): number {
  return Math.max(Math.abs(lineValue) * 0.10, 0.5)
}

/**
 * Linear-projection pace status (D-01/D-02/D-03).
 *
 *   projected = currentTotal / elapsedFraction         (D-01)
 *   diff = isOver ? projected - line : line - projected
 *
 *     diff >  margin → on_pace
 *     diff < -margin → off_pace
 *     else           → borderline                       (D-02)
 *
 * Two early returns implement D-03 + Pitfall 4: an `elapsedFraction <= 0`
 * guard (defensive — would also pre-empt the divide) and the explicit
 * `< 0.15` suppression. The divide is therefore never reached with a zero or
 * negative denominator, so no NaN/Infinity can propagate into the band logic
 * or the card tint.
 */
export function getOnPaceStatus(
  currentTotal: number,
  lineValue: number,
  isOver: boolean,
  elapsedFraction: number,
  margin: number,
): PaceStatus {
  if (elapsedFraction <= 0) return 'too_early'
  if (elapsedFraction < 0.15) return 'too_early'

  const projected = currentTotal / elapsedFraction
  const diff = isOver ? projected - lineValue : lineValue - projected

  if (diff > margin) return 'on_pace'
  if (diff < -margin) return 'off_pace'
  return 'borderline'
}

/**
 * Elapsed-fraction in [0, 1], or -1 sentinel when the sport/feed can't
 * supply a clean elapsed signal (D-12 fallback).
 *
 * Per-sport denominators (D-13, RESEARCH Unknown 3):
 *   MLB        — periodScores.length / (betPeriod === 'f5' ? 5 : 'f3' ? 3 : 9)
 *   NBA/NCAAB  — periodScores.length / 4 (NCAAB uses 2-bucket halves; period
 *                                         bucket is the only available signal)
 *   NHL        — periodScores.length / 3
 *   NFL/NCAAF  — periodScores.length / 4
 *   Soccer     — periodScores.length / 2
 *   Tennis     — sum(home+away across periodScores) / (formatPeriods===5?40:23)
 *                (D-10 — Bo5=40, Bo3=23). Returns -1 when tennisLive is absent.
 *   anything else → -1 sentinel
 *
 * `status === 'pre'` returns 0; `status === 'post'` returns 1. Capped at 1.0
 * for extra innings / OT / over-budget tennis matches. Defensive
 * `periodScores ?? []` ensures the reducer never throws.
 */
export function getElapsedFraction(game: LiveGame, betPeriod: BetPeriod): number {
  if (game.status === 'pre') return 0
  if (game.status === 'post') return 1

  const periodScores = game.periodScores ?? []
  const completedPeriods = periodScores.length

  switch (game.sport) {
    case 'MLB': {
      const totalInnings =
        betPeriod === 'f5' ? 5 : betPeriod === 'f3' ? 3 : 9
      return Math.min(completedPeriods / totalInnings, 1)
    }
    case 'NBA':
    case 'NCAAB':
      // NBA: 4 quarters; NCAAB: 2 halves but period-bucket approximation is
      // the only signal — RESEARCH Unknown 3 documents the trade-off.
      return Math.min(completedPeriods / 4, 1)
    case 'NHL':
      return Math.min(completedPeriods / 3, 1)
    case 'NFL':
    case 'NCAAF':
      return Math.min(completedPeriods / 4, 1)
    case 'Soccer':
      return Math.min(completedPeriods / 2, 1)
    case 'Tennis': {
      // D-10: need tennisLive.formatPeriods to pick Bo3=23 / Bo5=40 denominator.
      const formatPeriods = game.tennisLive?.formatPeriods
      if (!formatPeriods) return -1
      const expected = formatPeriods === 5 ? 40 : 23
      const totalGames = periodScores.reduce(
        (sum, ps) => sum + ps.home + ps.away,
        0,
      )
      return Math.min(totalGames / expected, 1)
    }
    default:
      // D-12 sentinel: caller delegates to getCoverStatus
      return -1
  }
}

export function getCoverStatus(
  parsedLine: ParsedLine,
  game: LiveGame,
  betDescription: string,
  sport?: string,
): CoverStatus {
  if (game.status === 'pre') return 'pregame'

  const { lineType, lineValue, period } = parsedLine

  // Compute home/away scores at the bet's period scope.
  const seg = getSegmentScore(period, game)
  if (!seg.hasData) return 'pregame'

  const totalScore = seg.home + seg.away

  if (lineType === 'over' && lineValue !== null) {
    if (totalScore > lineValue) return 'covering'
    if (totalScore === lineValue) return 'push'
    return 'behind'
  }

  if (lineType === 'under' && lineValue !== null) {
    if (totalScore < lineValue) return 'covering'
    if (totalScore === lineValue) return 'push'
    return 'behind'
  }

  // For ML and spread, determine which team the bet is on. Use the game's
  // own sport (set by the scoreboard fetcher) so the abbrev map is correct
  // even if the caller didn't pass it in.
  const lookupSport = sport ?? game.sport
  const betAbbrevs = findEspnAbbrevs(betDescription, lookupSport)
  const isHome = betAbbrevs.some(
    (ba) =>
      ba.toUpperCase() === game.homeTeam.toUpperCase() ||
      game.homeName.toUpperCase().includes(ba.toUpperCase())
  ) || (() => {
    // Fallback to name token check for sports without abbrevs.
    const tokens = extractNameTokens(betDescription)
    return tokens.some((t) => t.length >= 4 && game.homeName.toUpperCase().includes(t))
  })()

  const betTeamScore = isHome ? seg.home : seg.away
  const oppTeamScore = isHome ? seg.away : seg.home
  const diff = betTeamScore - oppTeamScore

  if (lineType === 'moneyline') {
    if (diff > 0) return 'covering'
    if (diff === 0) return 'push'
    return 'behind'
  }

  if (lineType === 'spread' && lineValue !== null) {
    // Spread: team must win by more than abs(spread) or lose by less
    const adjustedDiff = diff + lineValue
    if (adjustedDiff > 0) return 'covering'
    if (adjustedDiff === 0) return 'push'
    return 'behind'
  }

  return 'pregame'
}

// ---------------------------------------------------------------------------
// Predicted bet outcome — used for auto-settle UX
// ---------------------------------------------------------------------------

export type PredictedOutcome = 'won' | 'lost' | 'push'

export interface PredictedSettlement {
  outcome: PredictedOutcome
  reason: string
  /** Score at the relevant segment, for display next to the prediction. */
  segment: SegmentScore
}

/**
 * If the bet's relevant segment is complete, return the predicted outcome
 * and supporting info. Otherwise return null (caller keeps showing live
 * cover status).
 */
export function predictBetOutcome(
  parsedLine: ParsedLine,
  game: LiveGame,
  betDescription: string,
  sport?: string,
): PredictedSettlement | null {
  if (game.status === 'pre') return null

  const seg = getSegmentScore(parsedLine.period, game)
  if (!seg.hasData || !seg.complete) return null

  const cover = getCoverStatus(parsedLine, game, betDescription, sport)
  if (cover === 'pregame') return null

  const total = seg.home + seg.away
  let reason = ''
  if (parsedLine.lineType === 'over' || parsedLine.lineType === 'under') {
    reason = `${parsedLine.lineType.toUpperCase()} ${parsedLine.lineValue} (final ${total})`
  } else {
    reason = `${seg.away}-${seg.home}`
  }

  if (cover === 'covering') return { outcome: 'won', reason, segment: seg }
  if (cover === 'push') return { outcome: 'push', reason, segment: seg }
  return { outcome: 'lost', reason, segment: seg }
}

// ---------------------------------------------------------------------------
// LiveStatus router (D-05/D-09/D-11/D-12)
// ---------------------------------------------------------------------------

/**
 * Cross-sport live-status router — the contract Phase 16's card tint consumes.
 *
 * Routing rules:
 *   - status === 'pre' → 'pregame'
 *   - lineType 'spread' | 'moneyline' | 'unknown' → getCoverStatus (D-11)
 *   - lineType 'over' | 'under' with lineValue:
 *       1) predictBetOutcome non-null:
 *            status === 'post' → final_won/final_push/final_lost (D-05)
 *            otherwise         → clinched_won/clinched_lost (D-05)
 *       2) seg.hasData === false → 'pregame'
 *       3) getElapsedFraction returns -1 sentinel → getCoverStatus (D-12)
 *       4) otherwise → getOnPaceStatus(currentTotal, lineValue, isOver,
 *                                       elapsed, borderlineMargin(lineValue))
 *
 * Sub-period denominator (Pitfall 7): always passes `parsedLine.period` to
 * getElapsedFraction so an F5/F3 MLB bet uses the 5- or 3-inning denominator,
 * not the fullgame 9-inning one.
 *
 * No parlay roll-up (D-07): this is called once per leg; the consumer
 * (Phase 16's card render) iterates legs and tints each independently.
 *
 * `as LiveStatus` casts are safe because `CoverStatus`'s 4 string values
 * ('covering', 'behind', 'push', 'pregame') are members of the LiveStatus
 * union, and `PaceStatus`'s 4 values are also members.
 */
export function getLiveStatus(
  parsedLine: ParsedLine,
  game: LiveGame,
  betDescription: string,
  sport?: string,
): LiveStatus {
  if (game.status === 'pre') return 'pregame'

  const { lineType, lineValue, period } = parsedLine

  // Spreads, moneylines, and unparseable lines all keep margin-based
  // covering/behind. Tennis spreads (D-09) flow through this branch too.
  if (lineType === 'spread' || lineType === 'moneyline' || lineType === 'unknown') {
    return getCoverStatus(parsedLine, game, betDescription, sport) as LiveStatus
  }

  // Totals (over/under) path
  if ((lineType === 'over' || lineType === 'under') && lineValue !== null) {
    // Clinch / final check first (D-05). predictBetOutcome returns non-null
    // only when seg.complete === true. We additionally key off game.status
    // to distinguish a mid-game clinch from a final segment.
    const prediction = predictBetOutcome(parsedLine, game, betDescription, sport)
    if (prediction) {
      if (game.status === 'post') {
        if (prediction.outcome === 'won') return 'final_won'
        if (prediction.outcome === 'push') return 'final_push'
        return 'final_lost'
      }
      // Mid-game clinch (segment complete but game still in-progress —
      // e.g. F5 already settled with full game still going)
      if (prediction.outcome === 'won') return 'clinched_won'
      if (prediction.outcome === 'push') return 'final_push'
      return 'clinched_lost'
    }

    // Compute currentTotal at the bet's period scope. hasData=false means
    // we have no linescore data yet (e.g. just-flipped status to 'in' but
    // no innings logged) — surface as pregame.
    const seg = getSegmentScore(period, game)
    if (!seg.hasData) return 'pregame'

    const currentTotal = seg.home + seg.away
    // Pitfall 7: pass parsedLine.period so F5/F3 sub-period bets get the
    // right denominator (5 / 3 innings, not 9).
    const elapsed = getElapsedFraction(game, period)
    if (elapsed < 0) {
      // D-12 sentinel fallback: tennis-no-tennisLive, unknown sport, etc.
      return getCoverStatus(parsedLine, game, betDescription, sport) as LiveStatus
    }

    return getOnPaceStatus(
      currentTotal,
      lineValue,
      lineType === 'over',
      elapsed,
      borderlineMargin(lineValue),
    ) as LiveStatus
  }

  // Defensive default — should be unreachable given LineType's closed union.
  return getCoverStatus(parsedLine, game, betDescription, sport) as LiveStatus
}
