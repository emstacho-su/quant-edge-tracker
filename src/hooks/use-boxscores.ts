import { useState, useEffect, useCallback, useRef } from 'react'
import type { PropStat } from '@/utils/prop-parser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlayerStatRow {
  athleteId: string
  name: string
  shortName: string
  team: string                 // ESPN abbrev: "LAL"
  /** Canonical stat values readable by prop-matcher. */
  stats: Partial<Record<PropStat, number>>
  didNotPlay: boolean
}

export interface GameBoxscore {
  gameId: string
  sport: string
  status: 'pre' | 'in' | 'post'
  players: readonly PlayerStatRow[]
}

interface UseBoxscoresResult {
  boxscores: ReadonlyMap<string, GameBoxscore>
  loading: boolean
  refresh: () => void
}

// ---------------------------------------------------------------------------
// Sport → ESPN league path. Only sports where prop bets are realistic.
// ---------------------------------------------------------------------------

const SPORT_LEAGUE_PATH: Readonly<Record<string, string>> = {
  MLB: 'baseball/mlb',
  NBA: 'basketball/nba',
  WNBA: 'basketball/wnba',
  NHL: 'hockey/nhl',
  NFL: 'football/nfl',
  NCAAB: 'basketball/mens-college-basketball',
  NCAAF: 'football/college-football',
}

const POLL_INTERVAL_MS = 60_000

// ---------------------------------------------------------------------------
// ESPN response types — only what we read.
// ---------------------------------------------------------------------------

interface EspnAthlete {
  id?: string
  displayName?: string
  shortName?: string
}

interface EspnAthleteStats {
  athlete?: EspnAthlete
  stats?: string[]
  didNotPlay?: boolean
  active?: boolean
}

interface EspnStatGroup {
  name?: string                // 'starters' | 'bench' | 'skaters' | 'goalies' | 'batters' | 'pitchers' | 'passing' | 'rushing' | etc.
  keys?: string[]              // older shape: lowercase keys
  labels?: string[]            // shorter labels
  names?: string[]             // newer shape: uppercase short names ['MIN','FG','3PT',...]
  athletes?: EspnAthleteStats[]
}

interface EspnTeamPlayers {
  team?: { abbreviation?: string }
  statistics?: EspnStatGroup[]
}

interface EspnSummary {
  boxscore?: { players?: EspnTeamPlayers[] }
  header?: {
    competitions?: Array<{
      status?: { type?: { name?: string } }
    }>
  }
}

// ---------------------------------------------------------------------------
// Stat parsing helpers
// ---------------------------------------------------------------------------

/** Parse a "made-attempted" string like "8-15" → 8. Returns null if not that shape. */
function parseMadeAttempted(s: string | undefined): number | null {
  if (!s) return null
  const m = s.match(/^(\d+)-(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

function parseInteger(s: string | undefined): number | null {
  if (s == null || s === '') return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

function statByName(
  names: readonly string[],
  stats: readonly string[],
  ...candidates: readonly string[]
): string | undefined {
  for (const c of candidates) {
    const i = names.findIndex((n) => n.toUpperCase() === c.toUpperCase())
    if (i >= 0) return stats[i]
  }
  return undefined
}

function mapEspnStatus(name: string | undefined): 'pre' | 'in' | 'post' {
  if (name === 'STATUS_IN_PROGRESS') return 'in'
  if (name === 'STATUS_FINAL') return 'post'
  return 'pre'
}

// ---------------------------------------------------------------------------
// Per-sport parsers
// ---------------------------------------------------------------------------

function parseNbaPlayer(
  athleteRow: EspnAthleteStats,
  team: string,
  names: readonly string[],
): PlayerStatRow {
  const stats = athleteRow.stats ?? []
  const dnp = athleteRow.didNotPlay === true || stats.length === 0

  const points = parseInteger(statByName(names, stats, 'PTS'))
  const rebounds = parseInteger(statByName(names, stats, 'REB'))
  const assists = parseInteger(statByName(names, stats, 'AST'))
  const steals = parseInteger(statByName(names, stats, 'STL'))
  const blocks = parseInteger(statByName(names, stats, 'BLK'))
  const threes = parseMadeAttempted(statByName(names, stats, '3PT'))

  const out: Partial<Record<PropStat, number>> = {}
  if (points != null) out.points = points
  if (rebounds != null) out.rebounds = rebounds
  if (assists != null) out.assists = assists
  if (steals != null) out.steals = steals
  if (blocks != null) out.blocks = blocks
  if (threes != null) out.threes = threes

  // Combos derived from singles
  if (points != null && rebounds != null && assists != null) {
    out.pra = points + rebounds + assists
  }
  if (points != null && rebounds != null) out.pts_reb = points + rebounds
  if (points != null && assists != null) out.pts_ast = points + assists
  if (rebounds != null && assists != null) out.reb_ast = rebounds + assists

  return {
    athleteId: athleteRow.athlete?.id ?? '',
    name: athleteRow.athlete?.displayName ?? '',
    shortName: athleteRow.athlete?.shortName ?? '',
    team,
    stats: out,
    didNotPlay: dnp,
  }
}

function parseNhlSkater(
  athleteRow: EspnAthleteStats,
  team: string,
  names: readonly string[],
): PlayerStatRow {
  const stats = athleteRow.stats ?? []
  const dnp = athleteRow.didNotPlay === true

  const goals = parseInteger(statByName(names, stats, 'G', 'goals'))
  const assists = parseInteger(statByName(names, stats, 'A', 'assists'))
  const sog = parseInteger(statByName(names, stats, 'SOG', 'S', 'shots'))
  const blocked = parseInteger(statByName(names, stats, 'BS', 'blocked'))
  const hits = parseInteger(statByName(names, stats, 'HITS', 'HT'))

  const out: Partial<Record<PropStat, number>> = {}
  if (goals != null) out.goals = goals
  if (sog != null) out.sog = sog
  if (blocked != null) out.shots_blocked = blocked
  if (hits != null) out.hits_skater = hits
  if (goals != null && assists != null) {
    out.nhl_points = goals + assists
    // Bet descriptions like "Over 0.5 Points" for NHL refer to G+A. Keep
    // 'points' aliased to nhl_points so the matcher doesn't need sport
    // disambiguation in the lookup table.
    out.points = goals + assists
  }

  return {
    athleteId: athleteRow.athlete?.id ?? '',
    name: athleteRow.athlete?.displayName ?? '',
    shortName: athleteRow.athlete?.shortName ?? '',
    team,
    stats: out,
    didNotPlay: dnp,
  }
}

function parseNhlGoalie(
  athleteRow: EspnAthleteStats,
  team: string,
  names: readonly string[],
): PlayerStatRow {
  const stats = athleteRow.stats ?? []
  const dnp = athleteRow.didNotPlay === true

  const saves = parseInteger(statByName(names, stats, 'SV', 'saves'))
  const out: Partial<Record<PropStat, number>> = {}
  if (saves != null) out.saves = saves

  return {
    athleteId: athleteRow.athlete?.id ?? '',
    name: athleteRow.athlete?.displayName ?? '',
    shortName: athleteRow.athlete?.shortName ?? '',
    team,
    stats: out,
    didNotPlay: dnp,
  }
}

// ---------------------------------------------------------------------------
// MLB
// ---------------------------------------------------------------------------

function parseMlbBatter(
  athleteRow: EspnAthleteStats,
  team: string,
  names: readonly string[],
): PlayerStatRow {
  const stats = athleteRow.stats ?? []
  const dnp = athleteRow.didNotPlay === true

  const hits = parseInteger(statByName(names, stats, 'H'))
  const hr = parseInteger(statByName(names, stats, 'HR'))
  const rbi = parseInteger(statByName(names, stats, 'RBI'))
  const runs = parseInteger(statByName(names, stats, 'R'))
  const walks = parseInteger(statByName(names, stats, 'BB'))
  const ks = parseInteger(statByName(names, stats, 'K', 'SO'))
  // Total bases: ESPN may include TB directly, otherwise approximate from H +
  // HR (a proper computation needs 2B/3B). We surface H+HR*3 as a lower bound
  // when TB is missing — better than nothing, but mark via stat key TB.
  const tb = parseInteger(statByName(names, stats, 'TB'))

  const out: Partial<Record<PropStat, number>> = {}
  if (hits != null) out.hits_batter = hits
  if (hr != null) out.home_runs = hr
  if (rbi != null) out.rbis = rbi
  if (runs != null) out.runs_scored = runs
  if (walks != null) out.walks = walks
  if (ks != null) out.strikeouts_batter = ks
  if (tb != null) out.total_bases = tb

  return {
    athleteId: athleteRow.athlete?.id ?? '',
    name: athleteRow.athlete?.displayName ?? '',
    shortName: athleteRow.athlete?.shortName ?? '',
    team,
    stats: out,
    didNotPlay: dnp,
  }
}

function parseMlbPitcher(
  athleteRow: EspnAthleteStats,
  team: string,
  names: readonly string[],
): PlayerStatRow {
  const stats = athleteRow.stats ?? []
  const dnp = athleteRow.didNotPlay === true

  const ks = parseInteger(statByName(names, stats, 'K', 'SO'))
  const out: Partial<Record<PropStat, number>> = {}
  if (ks != null) out.strikeouts_pitcher = ks

  return {
    athleteId: athleteRow.athlete?.id ?? '',
    name: athleteRow.athlete?.displayName ?? '',
    shortName: athleteRow.athlete?.shortName ?? '',
    team,
    stats: out,
    didNotPlay: dnp,
  }
}

// ---------------------------------------------------------------------------
// NFL — stats split across passing / rushing / receiving groups; same player
// can appear in multiple. We return one row per group and merge after.
// ---------------------------------------------------------------------------

function parseNflPlayer(
  athleteRow: EspnAthleteStats,
  team: string,
  names: readonly string[],
  groupName: string,
): PlayerStatRow {
  const stats = athleteRow.stats ?? []
  const dnp = athleteRow.didNotPlay === true
  const out: Partial<Record<PropStat, number>> = {}

  if (groupName === 'passing') {
    const yds = parseInteger(statByName(names, stats, 'YDS'))
    const td = parseInteger(statByName(names, stats, 'TD'))
    const int = parseInteger(statByName(names, stats, 'INT'))
    // C/ATT format: "23/35"
    const cAtt = statByName(names, stats, 'C/ATT', 'CMP/ATT')
    if (cAtt) {
      const m = cAtt.match(/^(\d+)\/(\d+)$/)
      if (m) {
        out.completions = parseInt(m[1], 10)
        out.attempts = parseInt(m[2], 10)
      }
    }
    if (yds != null) out.passing_yards = yds
    if (td != null) out.passing_tds = td
    if (int != null) out.interceptions = int
  } else if (groupName === 'rushing') {
    const yds = parseInteger(statByName(names, stats, 'YDS'))
    const td = parseInteger(statByName(names, stats, 'TD'))
    if (yds != null) out.rushing_yards = yds
    if (td != null) out.rushing_tds = td
  } else if (groupName === 'receiving') {
    const yds = parseInteger(statByName(names, stats, 'YDS'))
    const td = parseInteger(statByName(names, stats, 'TD'))
    const rec = parseInteger(statByName(names, stats, 'REC'))
    if (yds != null) out.receiving_yards = yds
    if (td != null) out.receiving_tds = td
    if (rec != null) out.receptions = rec
  }

  return {
    athleteId: athleteRow.athlete?.id ?? '',
    name: athleteRow.athlete?.displayName ?? '',
    shortName: athleteRow.athlete?.shortName ?? '',
    team,
    stats: out,
    didNotPlay: dnp,
  }
}

/** Merge stat rows for the same athlete across multiple stat groups. */
function mergeRowsByAthlete(rows: readonly PlayerStatRow[]): PlayerStatRow[] {
  const map = new Map<string, PlayerStatRow>()
  for (const row of rows) {
    const key = row.athleteId || row.name
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { ...row, stats: { ...row.stats } })
      continue
    }
    map.set(key, {
      ...existing,
      stats: { ...existing.stats, ...row.stats },
      didNotPlay: existing.didNotPlay && row.didNotPlay,
    })
  }
  // Compute derived NFL stats after merge.
  for (const row of map.values()) {
    const rushTd = row.stats.rushing_tds ?? 0
    const recTd = row.stats.receiving_tds ?? 0
    const passTd = row.stats.passing_tds ?? 0
    if (
      row.stats.rushing_tds != null ||
      row.stats.receiving_tds != null ||
      row.stats.passing_tds != null
    ) {
      // Anytime TD: any rushing or receiving TD counts (passing TDs by QBs
      // don't count for "anytime TD scorer" prop in standard markets).
      row.stats.anytime_td = rushTd + recTd > 0 ? 1 : 0
      // Suppress unused-var warning for passTd.
      void passTd
    }
  }
  return Array.from(map.values())
}

function parseTeamPlayers(
  teamPlayers: EspnTeamPlayers,
  sport: string,
): PlayerStatRow[] {
  const team = teamPlayers.team?.abbreviation ?? ''
  const groups = teamPlayers.statistics ?? []
  const out: PlayerStatRow[] = []

  for (const group of groups) {
    const names = group.names ?? group.labels ?? group.keys ?? []
    const athletes = group.athletes ?? []
    const groupName = (group.name ?? '').toLowerCase()

    for (const a of athletes) {
      let row: PlayerStatRow | null = null
      if (sport === 'NBA' || sport === 'WNBA' || sport === 'NCAAB') {
        row = parseNbaPlayer(a, team, names)
      } else if (sport === 'NHL') {
        row = groupName.includes('goalie')
          ? parseNhlGoalie(a, team, names)
          : parseNhlSkater(a, team, names)
      } else if (sport === 'MLB') {
        if (groupName.includes('pitcher')) {
          row = parseMlbPitcher(a, team, names)
        } else if (groupName.includes('batter')) {
          row = parseMlbBatter(a, team, names)
        }
      } else if (sport === 'NFL' || sport === 'NCAAF') {
        if (
          groupName === 'passing' ||
          groupName === 'rushing' ||
          groupName === 'receiving'
        ) {
          row = parseNflPlayer(a, team, names, groupName)
        }
      }
      // Skip blank or unsupported groups
      if (!row || !row.name) continue
      out.push(row)
    }
  }

  // NFL/MLB players appear across multiple stat groups; merge into one row
  // per athlete so the prop-matcher can read all stats from a single entry.
  if (sport === 'NFL' || sport === 'NCAAF' || sport === 'MLB') {
    return mergeRowsByAthlete(out)
  }
  return out
}

// ---------------------------------------------------------------------------
// Fetch a single game's boxscore
// ---------------------------------------------------------------------------

async function fetchBoxscore(
  gameId: string,
  sport: string,
): Promise<GameBoxscore | null> {
  const leaguePath = SPORT_LEAGUE_PATH[sport]
  if (!leaguePath) return null

  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${gameId}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as EspnSummary

    const teamPlayers = data.boxscore?.players ?? []
    const players = teamPlayers.flatMap((tp) => parseTeamPlayers(tp, sport))
    const status = mapEspnStatus(
      data.header?.competitions?.[0]?.status?.type?.name,
    )

    return { gameId, sport, status, players }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Hook — fetch boxscores for the given (gameId, sport) pairs
// ---------------------------------------------------------------------------

export interface BoxscoreRequest {
  gameId: string
  sport: string
}

export function useBoxscores(
  requests: readonly BoxscoreRequest[],
): UseBoxscoresResult {
  const [boxscores, setBoxscores] = useState<ReadonlyMap<string, GameBoxscore>>(
    new Map(),
  )
  const [loading, setLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Stringify requests for stable dependency tracking.
  const requestKey = requests
    .map((r) => `${r.sport}:${r.gameId}`)
    .sort()
    .join('|')

  const fetchAll = useCallback(async () => {
    if (requests.length === 0) {
      setBoxscores(new Map())
      setLoading(false)
      return
    }

    setLoading(true)
    const results = await Promise.all(
      requests.map((r) => fetchBoxscore(r.gameId, r.sport)),
    )

    const map = new Map<string, GameBoxscore>()
    for (const b of results) {
      if (b) map.set(b.gameId, b)
    }
    setBoxscores(map)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  useEffect(() => {
    fetchAll()
    intervalRef.current = setInterval(fetchAll, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
    }
  }, [fetchAll])

  return { boxscores, loading, refresh: fetchAll }
}
