import { useState, useEffect, useCallback, useRef } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Score for a single period/quarter/half/inning. */
export interface PeriodScore {
  home: number
  away: number
}

/**
 * Tennis-specific live state. Only present for Tennis competitions when
 * status === 'in'. Mirrors the optional-field pattern used by `LiveGame.situation`.
 *
 * Sourced from the verified ESPN ATP/WTA scoreboard shape (19-RESEARCH Unknown 1):
 *   - serverId/serverName from the `competitor.possession === true` competitor (D-08)
 *   - formatPeriods from `competition.format.regulation.periods` (3 = Bo3, 5 = Bo5) (D-10)
 *   - tiebreaks indexed per set (0-based); null entry for sets without a tiebreak
 *
 * Graceful degradation: every field coalesced with `?? default` — missing ESPN
 * fields never throw (T-19-02, ASVS V5).
 */
export interface TennisLive {
  /** ESPN athlete ID of the current server (the competitor whose `possession` is true) */
  serverId: string
  /** shortName of the current server, e.g. "L. Sonego". Empty when unknown. */
  serverName: string
  /** Bo3 = 3, Bo5 = 5 — from `format.regulation.periods`. Defaults to 3. */
  formatPeriods: number
  /** Tiebreak scores for each set in the home competitor's perspective; null when no tiebreak. */
  tiebreaks: (number | null)[]
}

export interface LiveGame {
  id: string
  sport: string
  homeTeam: string
  awayTeam: string
  homeName: string
  awayName: string
  homeScore: number
  awayScore: number
  status: 'pre' | 'in' | 'post'
  statusDetail: string
  startTime: string
  /**
   * Per-period scores in chronological order. Length depends on sport:
   *   NHL: 3 entries (+OT/SO if applicable)
   *   NBA / NFL / NCAAF: 4 entries (+OT)
   *   NCAAB / Soccer: 2 entries (halves)
   *   MLB: ≥9 entries (innings)
   *   Tennis: 1 entry per set, value = games won in that set (RESEARCH Unknown 1)
   * Empty if ESPN didn't include linescores for the game (pre-game, or
   * leagues where scoreboard omits them).
   */
  periodScores: readonly PeriodScore[]
  /** 1-based period the game is currently in (or finished in). null pre-game. */
  currentPeriod: number | null
  /**
   * In-game situation. Only present for MLB when status === 'in'.
   * Optional because ESPN omits it between innings and for all non-live games (D-08, Pitfall 6).
   */
  situation?: {
    balls: number
    strikes: number
    outs: number
    onFirst: boolean
    onSecond: boolean
    onThird: boolean
    /** From comp.status?.type?.shortDetail — e.g. "Top 5th", "Bot 3rd" */
    inningDetail: string
  }
  /**
   * Tennis-specific live state. Only present for Tennis when status === 'in'.
   * Optional because the field is sport-gated and ESPN omits it for non-live matches.
   * See `parseTennisLive` for the parse + graceful-degradation contract.
   */
  tennisLive?: TennisLive
}

interface UseLiveScoresResult {
  games: readonly LiveGame[]
  loading: boolean
  lastUpdated: Date | null
  refresh: () => void
}

// ---------------------------------------------------------------------------
// League mapping from bet sport field to ESPN scoreboard path segments.
//
// A sport can map to multiple leagues — e.g. "Soccer" hits all the
// competitions we care about because there's no single global scoreboard.
// Each path is appended to https://site.api.espn.com/apis/site/v2/sports/
// ---------------------------------------------------------------------------

const LEAGUES_BY_SPORT: Record<string, readonly string[]> = {
  MLB: ['baseball/mlb'],
  NBA: ['basketball/nba'],
  WNBA: ['basketball/wnba'],
  NHL: ['hockey/nhl'],
  NCAAB: ['basketball/mens-college-basketball'],
  NFL: ['football/nfl'],
  NCAAF: ['football/college-football'],
  Soccer: [
    'soccer/eng.1',           // Premier League
    'soccer/usa.1',           // MLS
    'soccer/uefa.champions',  // UCL
    'soccer/uefa.europa',     // Europa League
    'soccer/esp.1',           // La Liga
    'soccer/ita.1',           // Serie A
    'soccer/ger.1',           // Bundesliga
    'soccer/fra.1',           // Ligue 1
  ],
  Tennis: [
    'tennis/atp',
    'tennis/wta',
  ],
  MMA: [
    'mma/ufc',
    'mma/pfl',
    'mma/bellator',
  ],
  Lacrosse: [
    'lacrosse/pll',
  ],
}

const FAST_POLL_MS = 15_000  // while at least one live MLB game is present
const SLOW_POLL_MS = 60_000  // all other states (no live MLB, WNBA-only, pre, post)

/**
 * Pure helper — exported for unit-testing without mocking fetch (MLB-04).
 * Returns FAST_POLL_MS (15s) when at least one fetched game is a live MLB game
 * (sport === 'MLB' && status === 'in'), otherwise SLOW_POLL_MS (60s).
 * WNBA-only live windows stay at 60s — the accelerate trigger is specifically live MLB.
 */
export function pollDelayForGames(games: readonly LiveGame[]): number {
  return games.some((g) => g.sport === 'MLB' && g.status === 'in')
    ? FAST_POLL_MS
    : SLOW_POLL_MS
}

// ---------------------------------------------------------------------------
// ESPN response parsing helpers
// ---------------------------------------------------------------------------

function mapEspnStatus(statusName: string): LiveGame['status'] {
  if (statusName === 'STATUS_IN_PROGRESS') return 'in'
  if (statusName === 'STATUS_FINAL') return 'post'
  return 'pre'
}

interface EspnLinescore {
  value?: number | string
  /** Tennis: true when this competitor won the set (RESEARCH Unknown 1). */
  winner?: boolean
  /** Tennis: tiebreak score for this player in this set, if a tiebreak was played. */
  tiebreak?: number
}

interface EspnAthleteRef {
  id?: string
  displayName?: string
  shortName?: string
}

interface EspnCompetitor {
  homeAway?: 'home' | 'away'
  score?: string
  // Team-sport shape
  team?: {
    abbreviation?: string
    shortDisplayName?: string
  }
  // Individual-sport shape (Tennis, MMA, Boxing)
  athlete?: EspnAthleteRef
  // Some individual-sport responses use roster[]
  roster?: Array<{ athlete?: EspnAthleteRef }>
  linescores?: EspnLinescore[]
  /** Tennis: true on the competitor currently serving (D-08, RESEARCH Unknown 1). */
  possession?: boolean
}

interface EspnSituation {
  balls?: number
  strikes?: number
  outs?: number
  onFirst?: boolean
  onSecond?: boolean
  onThird?: boolean
}

interface EspnCompetition {
  id?: string
  date?: string
  competitors?: EspnCompetitor[]
  situation?: EspnSituation
  status?: {
    period?: number
    type?: {
      name?: string
      shortDetail?: string
    }
  }
  /** Tennis: best-of format spec (RESEARCH Unknown 1, D-10). */
  format?: { regulation?: { periods?: number } }
}

interface EspnEvent {
  id: string
  date: string
  competitions?: EspnCompetition[]
  /**
   * Tennis-only nesting (Roland Garros etc.): tournament events wrap matches under
   * `groupings[N].competitions[M]` instead of `competitions[0]`. The tennis flattener
   * in `fetchLeagueScoreboard` unwraps this back into the standard shape so
   * `parseEvents` stays sport-agnostic (RESEARCH Unknown 1, Pitfall 1).
   */
  groupings?: Array<{ competitions?: EspnCompetition[] }>
}

function toNumber(value: number | string | undefined): number {
  if (value == null) return 0
  if (typeof value === 'number') return value
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildPeriodScores(
  homeLs: readonly EspnLinescore[] | undefined,
  awayLs: readonly EspnLinescore[] | undefined,
): PeriodScore[] {
  const len = Math.max(homeLs?.length ?? 0, awayLs?.length ?? 0)
  if (len === 0) return []
  const out: PeriodScore[] = []
  for (let i = 0; i < len; i++) {
    out.push({
      home: toNumber(homeLs?.[i]?.value),
      away: toNumber(awayLs?.[i]?.value),
    })
  }
  return out
}

function competitorIdentity(c: EspnCompetitor | undefined): {
  abbrev: string
  name: string
} {
  if (!c) return { abbrev: '', name: '' }

  // Team sports: prefer team data
  const teamAbbrev = c.team?.abbreviation ?? ''
  const teamName = c.team?.shortDisplayName ?? ''
  if (teamAbbrev || teamName) return { abbrev: teamAbbrev, name: teamName }

  // Individual sports: fall back to athlete
  const athlete = c.athlete ?? c.roster?.[0]?.athlete
  const fullName = athlete?.displayName ?? ''
  const shortName = athlete?.shortName ?? ''
  return { abbrev: shortName, name: fullName || shortName }
}

/**
 * Pure helper — exported for unit-testing without mocking fetch (Wave 0 gap).
 * Returns the parsed situation for an in-progress MLB game, or undefined when:
 * - sport is not 'MLB'
 * - status is not 'in'
 * - comp.situation is absent (between innings; Pitfall 6)
 * All fields are coalesced to safe defaults so missing ESPN fields never throw.
 */
export function parseSituation(
  comp: { situation?: EspnSituation; status?: { type?: { name?: string; shortDetail?: string } } },
  sport: string,
  status: LiveGame['status'],
): LiveGame['situation'] {
  if (sport !== 'MLB' || status !== 'in' || !comp.situation) return undefined
  return {
    balls:    comp.situation.balls    ?? 0,
    strikes:  comp.situation.strikes  ?? 0,
    outs:     comp.situation.outs     ?? 0,
    onFirst:  comp.situation.onFirst  ?? false,
    onSecond: comp.situation.onSecond ?? false,
    onThird:  comp.situation.onThird  ?? false,
    inningDetail: comp.status?.type?.shortDetail ?? '',
  }
}

/**
 * Pure helper — exported for unit-testing without mocking fetch.
 *
 * Returns a TennisLive block for an in-progress tennis match, or undefined when:
 *   - sport is not 'Tennis'
 *   - status is not 'in' (pre-game / post-game / non-live)
 *
 * Mirrors `parseSituation`'s guard-then-coalesce shape (PATTERNS lines 222-238):
 * every ESPN field is coalesced with `?? default` so a malformed competitor
 * (missing `athlete`, no `possession` on either side, no `format`, missing
 * `linescores`) degrades gracefully and never throws (T-19-02, ASVS V5, D-08).
 *
 * Server resolution (D-08): finds `competitor.possession === true` among the
 * competition's competitors. When no competitor has possession (between points,
 * feed lag, or an old/partial response), serverId/serverName fall back to ''.
 *
 * Format resolution (D-10): reads `competition.format.regulation.periods` —
 * 3 for Bo3 (ATP/WTA early rounds), 5 for Bo5 (Grand Slam men's). Defaults to 3
 * when format is absent so the on-pace engine (plan 02) still has a denominator.
 *
 * Tiebreaks (graceful): each set's tiebreak score from the home competitor's
 * linescore; sets with no tiebreak emit `null` so the array remains indexed by set.
 */
export function parseTennisLive(
  comp: {
    competitors?: EspnCompetitor[]
    format?: { regulation?: { periods?: number } }
  },
  home: EspnCompetitor | undefined,
  away: EspnCompetitor | undefined,
  sport: string,
  status: LiveGame['status'],
): TennisLive | undefined {
  if (sport !== 'Tennis' || status !== 'in') return undefined

  // Find the serving competitor. Use the explicit home/away first (passed in so
  // call-site doesn't re-derive), then fall back to scanning comp.competitors.
  const serverComp =
    (home?.possession === true ? home : undefined) ??
    (away?.possession === true ? away : undefined) ??
    comp.competitors?.find((c) => c?.possession === true)

  const serverAthlete = serverComp?.athlete ?? serverComp?.roster?.[0]?.athlete
  const serverId = serverAthlete?.id ?? ''
  const serverName = serverAthlete?.shortName ?? ''

  const formatPeriods = comp.format?.regulation?.periods ?? 3

  // Tiebreaks indexed by set — read from home competitor's linescores (the
  // tiebreak field, when present, mirrors across competitors). null when absent.
  const homeLs = home?.linescores ?? []
  const tiebreaks: (number | null)[] = homeLs.map((ls) =>
    typeof ls?.tiebreak === 'number' ? ls.tiebreak : null
  )

  return {
    serverId,
    serverName,
    formatPeriods,
    tiebreaks,
  }
}

function parseEvents(events: EspnEvent[], sport: string): LiveGame[] {
  return events
    .map((event): LiveGame | null => {
      const comp = event.competitions?.[0]
      if (!comp) return null
      const competitors = comp.competitors ?? []
      // Prefer explicit homeAway, otherwise treat first as home, second as away
      // (which is how individual-sport responses are usually ordered).
      const home =
        competitors.find((c) => c.homeAway === 'home') ?? competitors[0]
      const away =
        competitors.find((c) => c.homeAway === 'away') ?? competitors[1]

      const periodScores = buildPeriodScores(home?.linescores, away?.linescores)
      const status = mapEspnStatus(comp.status?.type?.name ?? '')
      const currentPeriod =
        comp.status?.period && comp.status.period > 0
          ? comp.status.period
          : status === 'pre'
            ? null
            : periodScores.length > 0
              ? periodScores.length
              : null

      const homeId = competitorIdentity(home)
      const awayId = competitorIdentity(away)

      return {
        id: event.id,
        sport,
        homeTeam: homeId.abbrev,
        awayTeam: awayId.abbrev,
        homeName: homeId.name,
        awayName: awayId.name,
        homeScore: parseInt(home?.score ?? '0', 10) || 0,
        awayScore: parseInt(away?.score ?? '0', 10) || 0,
        status,
        statusDetail: comp.status?.type?.shortDetail ?? '',
        startTime: event.date,
        periodScores,
        currentPeriod,
        situation: parseSituation(comp, sport, status),
        tennisLive: parseTennisLive(comp, home, away, sport, status),
      }
    })
    .filter((g): g is LiveGame => g !== null)
}

// ---------------------------------------------------------------------------
// Fetch a single league scoreboard
// ---------------------------------------------------------------------------

/**
 * Pure helper — exported for unit-testing (Wave 0 gap, RESEARCH Unknown 1).
 *
 * Fetches one league's ESPN scoreboard and parses it into LiveGames.
 *
 * Tennis-only flattener (RESEARCH Unknown 1, Pitfall 1): the ESPN tennis
 * scoreboard nests matches under `events[0].groupings[N].competitions[M]`
 * instead of `events[N].competitions[0]`. Without flattening, `parseEvents`
 * reads `event.competitions?.[0]` (undefined) and every tennis match returns
 * null — the root cause of "tennis wired but never rendered". The flattener
 * builds pseudo `EspnEvent[]` wrapping each competition in `competitions:[comp]`
 * so `parseEvents` stays sport-agnostic.
 *
 * Defensive parse (T-19-01): every nested access uses `?? []` + optional
 * chaining; a missing/malformed groupings payload yields [], never a throw.
 */
export async function fetchLeagueScoreboard(
  sport: string,
  leaguePath: string,
  dateStr: string
): Promise<LiveGame[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${dateStr}`

  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = (await res.json()) as { events?: EspnEvent[] }

    if (sport === 'Tennis') {
      // Flatten groupings.competitions into pseudo EspnEvent objects so
      // parseEvents remains sport-agnostic. Each comp becomes an event whose
      // id/date carry from the comp itself (falling back to the tournament event).
      const pseudoEvents: EspnEvent[] = (data.events ?? []).flatMap((ev) =>
        (ev.groupings ?? []).flatMap((g) =>
          (g.competitions ?? []).map((comp) => ({
            id: comp.id ?? ev.id,
            date: comp.date ?? ev.date,
            competitions: [comp],
          }))
        )
      )
      return parseEvents(pseudoEvents, sport)
    }

    return parseEvents(data.events ?? [], sport)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** Get unique local date strings (YYYYMMDD) to query, based on bet placed_at dates + today + tomorrow */
function getDateStrings(betDates: readonly string[]): string[] {
  const dates = new Set<string>()

  const today = new Date()
  dates.add(formatDateStr(today))

  // Also tomorrow — late-evening bets for next-day games (NHL finishing past
  // midnight UTC, playoff games one day out, etc.) need the next calendar day.
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  dates.add(formatDateStr(tomorrow))

  // Include each unique bet date (local timezone)
  for (const iso of betDates) {
    const d = new Date(iso)
    dates.add(formatDateStr(d))
  }

  return Array.from(dates)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLiveScores(
  sports: readonly string[],
  betDates?: readonly string[]
): UseLiveScoresResult {
  const [games, setGames] = useState<readonly LiveGame[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep a ref to the latest games so the schedule closure can read fresh state
  // without a stale reference (RESEARCH Pitfall 3, PATTERNS lines 100-135).
  const gamesRef = useRef<readonly LiveGame[]>([])

  const supportedSports = Array.from(new Set(sports)).filter(
    (s) => s in LEAGUES_BY_SPORT
  )

  const dateStrs = getDateStrings(betDates ?? [])

  const fetchAll = useCallback(async () => {
    if (supportedSports.length === 0) {
      setGames([])
      setLoading(false)
      return
    }

    setLoading(true)

    // Fetch all sport+league+date combinations
    const fetches: Promise<LiveGame[]>[] = []
    for (const sport of supportedSports) {
      const leagues = LEAGUES_BY_SPORT[sport] ?? []
      for (const leaguePath of leagues) {
        for (const dateStr of dateStrs) {
          fetches.push(fetchLeagueScoreboard(sport, leaguePath, dateStr))
        }
      }
    }

    const results = await Promise.all(fetches)

    // Deduplicate by game ID
    const seen = new Set<string>()
    const deduped: LiveGame[] = []
    for (const game of results.flat()) {
      if (!seen.has(game.id)) {
        seen.add(game.id)
        deduped.push(game)
      }
    }

    setGames(deduped)
    setLastUpdated(new Date())
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportedSports.join(','), dateStrs.join(',')])

  // Keep gamesRef in sync so the schedule closure always reads fresh game state
  // without capturing a stale closure value (RESEARCH Pitfall 3).
  useEffect(() => {
    gamesRef.current = games
  }, [games])

  useEffect(() => {
    function scheduleNext(delayMs: number) {
      timeoutRef.current = setTimeout(async () => {
        await fetchAll()
        // Compute the next delay from the just-returned games (gamesRef is updated
        // by the games useEffect above). Only reschedule when the tab is visible —
        // if hidden, the visibilitychange handler will resume on return.
        if (!document.hidden) {
          scheduleNext(pollDelayForGames(gamesRef.current))
        }
      }, delayMs)
    }

    function handleVisibility() {
      if (document.hidden) {
        // Tab hidden — cancel pending tick so no network calls fire while hidden
        // (RESEARCH Pitfall 5; T-06-06 self-imposed load mitigation).
        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current)
        }
      } else {
        // Tab visible again — fetch immediately then resume the chain at SLOW_POLL_MS.
        // The next tick will recompute to FAST_POLL_MS if there are live MLB games.
        void fetchAll()
        scheduleNext(SLOW_POLL_MS)
      }
    }

    // Initial fetch then start the chain at SLOW_POLL_MS; the chain will
    // accelerate to FAST_POLL_MS on subsequent ticks if live MLB is present.
    void fetchAll()
    scheduleNext(SLOW_POLL_MS)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
      }
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchAll])

  return { games, loading, lastUpdated, refresh: fetchAll }
}
