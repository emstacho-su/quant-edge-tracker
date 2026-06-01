import { matchScore } from './match.js'

/**
 * Player-prop settlement core. Parses a prop description, maps the stat to an
 * ESPN box-score field per sport, extracts the player's actual value, and
 * grades over/under. Every step returns null on any doubt (stat-match guard) so
 * an unrecognized stat or an unfound player is NEVER auto-settled.
 */
export type PropOutcome = 'won' | 'lost' | 'push'

export interface PropParse {
  player: string
  /** Null when the description has no (TEAM) parenthetical — caller must resolve
   *  player → team via the players table before doing event lookup. */
  team: string | null
  statKey: string
  line: number
  direction: 'over' | 'under'
}

/** Many sportsbook stat phrasings → a canonical taxonomy key. */
const STAT_ALIASES: Record<string, string> = {
  // NBA / WNBA
  points: 'points', pts: 'points',
  rebounds: 'rebounds', reb: 'rebounds', 'total rebounds': 'rebounds',
  assists: 'assists', ast: 'assists',
  'pts + reb + ast': 'pra', 'points + rebounds + assists': 'pra', pra: 'pra', 'p+r+a': 'pra',
  'pts + reb': 'pts_reb', 'points + rebounds': 'pts_reb',
  'pts + ast': 'pts_ast', 'points + assists': 'pts_ast',
  'reb + ast': 'reb_ast', 'rebounds + assists': 'reb_ast',
  turnovers: 'turnovers', to: 'turnovers',
  'three point field goals made': 'threes', '3 point field goals made': 'threes',
  'three pointers made': 'threes', threes: 'threes', '3pm': 'threes',
  steals: 'steals', blocks: 'blocks',
  // NHL
  goals: 'goals', g: 'goals',
  'goals + assists': 'goals_assists', 'g+a': 'goals_assists', 'goals_assists': 'goals_assists',
  'shots on goal': 'shots', sog: 'shots', shots: 'shots',
  // NHL 'assists' maps to same key as NBA but the taxonomy separates by sport; alias is shared safely
  // NHL 'points' (G+A) — separate from NBA 'points' (PTS) — same alias key, different TAXONOMY entry
  // NFL
  'passing yards': 'pass_yards', 'pass yds': 'pass_yards', 'pass yards': 'pass_yards',
  'rushing yards': 'rush_yards', 'rush yds': 'rush_yards', 'rush yards': 'rush_yards',
  'receiving yards': 'rec_yards', 'rec yds': 'rec_yards', 'recv yards': 'rec_yards',
  receptions: 'receptions', rec: 'receptions',
  'passing tds': 'pass_tds', 'passing touchdowns': 'pass_tds',
  'rushing tds': 'rush_tds', 'rushing touchdowns': 'rush_tds',
  'receiving tds': 'rec_tds', 'receiving touchdowns': 'rec_tds',
  completions: 'completions',
  interceptions: 'interceptions',
  // MLB (ESPN box-score fallback phrasings)
  strikeouts: 'strikeouts', 'pitcher strikeouts': 'strikeouts_pitcher', ks: 'strikeouts',
  'strikeouts pitcher': 'strikeouts_pitcher', 'ks (pitcher)': 'strikeouts_pitcher',
  'hits allowed': 'hits_allowed',
  hits: 'hits',
  rbi: 'rbi', rbis: 'rbi',
  'home runs': 'hr', hr: 'hr',
  runs: 'runs',
  'stolen bases': 'stolen_bases', sb: 'stolen_bases',
}

interface StatSpec { label?: string; combine?: string[]; group?: 'batting' | 'pitching' | 'passing' | 'rushing' | 'receiving' | 'skating' }

const NBA_STATS: Record<string, StatSpec> = {
  points: { label: 'PTS' }, rebounds: { label: 'REB' }, assists: { label: 'AST' },
  threes: { label: '3PT' }, pra: { combine: ['PTS', 'REB', 'AST'] },
  steals: { label: 'STL' }, blocks: { label: 'BLK' },
  pts_reb: { combine: ['PTS', 'REB'] },
  pts_ast: { combine: ['PTS', 'AST'] },
  reb_ast: { combine: ['REB', 'AST'] },
  turnovers: { label: 'TO' },
}

const TAXONOMY: Record<string, Record<string, StatSpec>> = {
  NBA: NBA_STATS,
  WNBA: NBA_STATS,
  MLB: {
    strikeouts: { label: 'K', group: 'pitching' },
    hits: { label: 'H', group: 'batting' },
    // ESPN box-score fallback keys (D-08) — primary path is extractMlbStat (StatsAPI)
    strikeouts_pitcher: { label: 'K', group: 'pitching' },
    hits_allowed: { label: 'H', group: 'pitching' },
    rbi: { label: 'RBI', group: 'batting' },
    hr: { label: 'HR', group: 'batting' },
    runs: { label: 'R', group: 'batting' },
    stolen_bases: { label: 'SB', group: 'batting' },
  },
  NHL: {
    goals: { label: 'G' },
    assists: { label: 'A' },
    points: { combine: ['G', 'A'] },
    shots: { label: 'SOG' },
    goals_assists: { combine: ['G', 'A'] },
  },
  NFL: {
    pass_yards: { label: 'YDS', group: 'passing' },
    pass_tds: { label: 'TD', group: 'passing' },
    completions: { label: 'CMP', group: 'passing' },
    interceptions: { label: 'INT', group: 'passing' },
    rush_yards: { label: 'YDS', group: 'rushing' },
    rush_tds: { label: 'TD', group: 'rushing' },
    rec_yards: { label: 'YDS', group: 'receiving' },
    receptions: { label: 'REC', group: 'receiving' },
    rec_tds: { label: 'TD', group: 'receiving' },
  },
}

// Teamed shape — high-confidence; the parenthetical pins the team explicitly.
const PROP_RE_TEAMED =
  /^(.+?)\s*\(([A-Z]{2,4})\)\s+(?:(over|under|o|u)\s*(\d+(?:\.\d+)?)|(\d+)\s*\+)\s+(.+)$/i

// No-team shape — relies on a downstream player→team resolver (players table).
// Lower confidence; require a multi-word player name so team-line bets like
// "Yankees Over 5.5 Runs" don't get swallowed.
const PROP_RE_NO_TEAM =
  /^(.+?)\s+(?:(over|under|o|u)\s*(\d+(?:\.\d+)?)|(\d+)\s*\+)\s+(.+)$/i

/** Greedy stat-phrase normalisation — handles trailing sportsbook tokens like
 *  "Rebounds Single" / "Strikeouts Parlay" by walking the prefix word-by-word. */
function normalizeStatKey(statRaw: string): string | null {
  const s = statRaw.trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ')
  if (STAT_ALIASES[s]) return STAT_ALIASES[s]
  const words = s.split(' ')
  for (let n = words.length - 1; n >= 1; n--) {
    const prefix = words.slice(0, n).join(' ')
    if (STAT_ALIASES[prefix]) return STAT_ALIASES[prefix]
  }
  return null
}

/** Parse a prop description into structured fields, or null. Accepts:
 *   "Jalen Williams (OKC) Over 27.5 Pts + Reb + Ast"   ← teamed, full Over/Under
 *   "Jason Alexander (KC) o3.5 Strikeouts"             ← teamed, o/u shorthand
 *   "De'Aaron Fox (SAC) 4+ Rebounds"                   ← teamed, N+ alt format
 *   "Jason Alexander o3.5 Strikeouts"                  ← no team (resolver fills)
 *   "De'Aaron Fox 4+ Rebounds Single"                  ← no team, trailing token
 *
 * The "N+" alt format ("4+ Rebounds" = "scoring 4 or more") is rendered as
 * direction='over' with line=N-0.5 — the per-event prop endpoint emits OU lines
 * at .5 intervals, so an "over 3.5" book line is the natural CLV anchor.
 */
export function parsePropDescription(desc: string): PropParse | null {
  const trimmed = desc.trim()

  let player: string
  let team: string | null = null
  let dir: string | undefined
  let ouValStr: string | undefined
  let plusValStr: string | undefined
  let statRaw: string

  const teamed = trimmed.match(PROP_RE_TEAMED)
  if (teamed) {
    player = teamed[1].trim()
    team = teamed[2].toUpperCase()
    dir = teamed[3]?.toLowerCase()
    ouValStr = teamed[4]
    plusValStr = teamed[5]
    statRaw = teamed[6]
  } else {
    const noTeam = trimmed.match(PROP_RE_NO_TEAM)
    if (!noTeam) return null
    player = noTeam[1].trim()
    dir = noTeam[2]?.toLowerCase()
    ouValStr = noTeam[3]
    plusValStr = noTeam[4]
    statRaw = noTeam[5]
    // Multi-word player name guard — keeps "Yankees Over 5.5 Runs" from parsing
    // as a player prop.
    if (player.split(/\s+/).length < 2) return null
  }

  let direction: 'over' | 'under'
  let line: number
  if (dir === 'over' || dir === 'o') {
    direction = 'over'
    line = parseFloat(ouValStr ?? '')
  } else if (dir === 'under' || dir === 'u') {
    direction = 'under'
    line = parseFloat(ouValStr ?? '')
  } else if (plusValStr != null) {
    const n = parseInt(plusValStr, 10)
    if (!Number.isFinite(n)) return null
    // "4+ Rebounds" → win iff rebounds >= 4 → over 3.5 in OU terms.
    direction = 'over'
    line = n - 0.5
  } else {
    return null
  }
  if (!Number.isFinite(line)) return null

  const statKey = normalizeStatKey(statRaw)
  if (!statKey) return null

  return { player, team, statKey, line, direction }
}

// --- box-score extraction ---

interface BoxAthlete { athlete?: { displayName?: string }; stats?: string[] }
interface BoxGroup { labels?: string[]; athletes?: BoxAthlete[] }
interface BoxTeam { statistics?: BoxGroup[] }

/** ESPN counting stats are sometimes "made-attempted" (e.g. 3PT "1-7"); take the made part. */
function statValue(group: BoxGroup, ath: BoxAthlete, label: string): number | null {
  const i = group.labels?.indexOf(label) ?? -1
  if (i < 0) return null
  const raw = ath.stats?.[i]
  if (raw == null) return null
  const v = parseInt(String(raw).split('-')[0], 10)
  return Number.isFinite(v) ? v : null
}

function groupMatches(group: BoxGroup, kind: 'batting' | 'pitching'): boolean {
  const labels = group.labels ?? []
  if (kind === 'pitching') return labels.includes('IP') || labels.includes('ERA')
  return labels.includes('AB') && !labels.includes('IP')
}

/** NFL group discriminator — the ESPN box score has separate passing / rushing / receiving stat groups. */
function groupMatchesNfl(group: BoxGroup, kind: 'passing' | 'rushing' | 'receiving'): boolean {
  const labels = group.labels ?? []
  if (kind === 'passing') return labels.includes('CMP') && labels.includes('INT')
  if (kind === 'rushing') return labels.includes('CAR') && !labels.includes('CMP')
  if (kind === 'receiving') return labels.includes('REC') && labels.includes('TGT')
  return false
}

/**
 * Extract a player's actual stat from boxscore.players. Returns null when the
 * stat isn't in the taxonomy, the player isn't found, or a value is missing.
 */
export function extractStat(players: BoxTeam[], sport: string, playerName: string, statKey: string): number | null {
  const spec = TAXONOMY[sport]?.[statKey]
  if (!spec) return null // stat-match guard
  for (const team of players) {
    for (const group of team.statistics ?? []) {
      // Group discriminator: route NFL groups through groupMatchesNfl; MLB batting/pitching through groupMatches
      if (spec.group === 'passing' || spec.group === 'rushing' || spec.group === 'receiving') {
        if (!groupMatchesNfl(group, spec.group)) continue
      } else if (spec.group === 'batting' || spec.group === 'pitching') {
        if (!groupMatches(group, spec.group)) continue
      }
      // NHL / NBA / WNBA specs have no group — match by label presence only
      for (const ath of group.athletes ?? []) {
        if (matchScore(playerName, ath.athlete?.displayName ?? '') >= 1) {
          if (spec.combine) {
            let sum = 0
            for (const lbl of spec.combine) {
              const v = statValue(group, ath, lbl)
              if (v == null) return null
              sum += v
            }
            return sum
          }
          return statValue(group, ath, spec.label as string)
        }
      }
    }
  }
  return null // player not found (DNP or not in box score)
}

export function evaluateProp(actual: number, line: number, direction: 'over' | 'under'): PropOutcome {
  if (actual === line) return 'push'
  const wentOver = actual > line
  return (direction === 'over') === wentOver ? 'won' : 'lost'
}

/** Fetch a game's box-score players array from the ESPN summary endpoint. */
export async function fetchBoxScorePlayers(leaguePath: string, eventId: string): Promise<BoxTeam[]> {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${eventId}`)
  if (!res.ok) return []
  const json = (await res.json()) as { boxscore?: { players?: BoxTeam[] } }
  return json?.boxscore?.players ?? []
}
