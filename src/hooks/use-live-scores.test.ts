import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseSituation,
  parseTennisLive,
  pollDelayForGames,
  fetchLeagueScoreboard,
} from './use-live-scores'
import type { LiveGame, TennisLive } from './use-live-scores'

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeComp(overrides: Partial<{
  situation: Record<string, unknown>
  status: { period?: number; type?: { name?: string; shortDetail?: string } }
}> = {}) {
  return {
    status: { type: { name: 'STATUS_IN_PROGRESS', shortDetail: 'Top 5th' } },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// parseSituation — Wave 0 coverage for MLB-01 (outs), MLB-02 (count), MLB-03 (runners)
// ---------------------------------------------------------------------------

describe('parseSituation', () => {
  it('returns situation object for MLB in-progress with all fields', () => {
    const comp = makeComp({
      situation: { balls: 3, strikes: 1, outs: 2, onFirst: true, onSecond: false, onThird: true },
    })
    expect(parseSituation(comp, 'MLB', 'in')).toEqual({
      balls: 3,
      strikes: 1,
      outs: 2,
      onFirst: true,
      onSecond: false,
      onThird: true,
      inningDetail: 'Top 5th',
    })
  })

  it('returns undefined for MLB pre-game', () => {
    const comp = makeComp({
      situation: { balls: 0, strikes: 0, outs: 0 },
    })
    expect(parseSituation(comp, 'MLB', 'pre')).toBeUndefined()
  })

  it('returns undefined for non-MLB sport even if in-progress', () => {
    const comp = makeComp({
      situation: { balls: 0, strikes: 0, outs: 0 },
    })
    expect(parseSituation(comp, 'NBA', 'in')).toBeUndefined()
  })

  it('defaults missing situation fields to 0/false', () => {
    const comp = makeComp({ situation: {} })
    const result = parseSituation(comp, 'MLB', 'in')
    expect(result?.balls).toBe(0)
    expect(result?.strikes).toBe(0)
    expect(result?.outs).toBe(0)
    expect(result?.onFirst).toBe(false)
    expect(result?.onSecond).toBe(false)
    expect(result?.onThird).toBe(false)
  })

  it('returns undefined when situation object is absent (between innings)', () => {
    const comp = makeComp() // no situation key
    expect(parseSituation(comp, 'MLB', 'in')).toBeUndefined()
  })

  it('uses inningDetail from comp.status.type.shortDetail', () => {
    const comp = makeComp({
      situation: { balls: 1, strikes: 2, outs: 1 },
      status: { type: { name: 'STATUS_IN_PROGRESS', shortDetail: 'Bot 3rd' } },
    })
    const result = parseSituation(comp, 'MLB', 'in')
    expect(result?.inningDetail).toBe('Bot 3rd')
  })

  it('defaults inningDetail to empty string when shortDetail is absent', () => {
    const comp = {
      situation: { balls: 0, strikes: 0, outs: 0 },
      status: { type: { name: 'STATUS_IN_PROGRESS' } },
    }
    const result = parseSituation(comp, 'MLB', 'in')
    expect(result?.inningDetail).toBe('')
  })
})

// ---------------------------------------------------------------------------
// pollDelayForGames — delay-selector unit tests (MLB-04 automated portion)
// ---------------------------------------------------------------------------

/** Minimal LiveGame fixture — only sport + status are used by pollDelayForGames */
function makeGame(sport: string, status: LiveGame['status']): LiveGame {
  return {
    id: `${sport}-${status}`,
    sport,
    status,
    homeTeam: '',
    awayTeam: '',
    homeName: '',
    awayName: '',
    homeScore: 0,
    awayScore: 0,
    statusDetail: '',
    startTime: '',
    periodScores: [],
    currentPeriod: null,
  }
}

describe('pollDelayForGames', () => {
  it('returns 15_000 when a live MLB game is present', () => {
    expect(pollDelayForGames([makeGame('MLB', 'in')])).toBe(15_000)
  })

  it('returns 60_000 for a WNBA-only live array (WNBA stays at 60s)', () => {
    expect(pollDelayForGames([makeGame('WNBA', 'in')])).toBe(60_000)
  })

  it('returns 60_000 for an empty array', () => {
    expect(pollDelayForGames([])).toBe(60_000)
  })

  it('returns 60_000 when an MLB game is present but status is post (final stops fast cadence)', () => {
    expect(pollDelayForGames([makeGame('MLB', 'post')])).toBe(60_000)
  })

  it('returns 60_000 when an MLB game is pre (before first pitch)', () => {
    expect(pollDelayForGames([makeGame('MLB', 'pre')])).toBe(60_000)
  })

  it('returns 15_000 when a live MLB game is present alongside other non-MLB live games', () => {
    expect(
      pollDelayForGames([makeGame('WNBA', 'in'), makeGame('MLB', 'in'), makeGame('NBA', 'in')])
    ).toBe(15_000)
  })
})

// ---------------------------------------------------------------------------
// parseTennisLive — Wave 0 coverage for D-08 (server) + D-10 (formatPeriods)
// ---------------------------------------------------------------------------

/**
 * Tennis competition fixture builder. Mirrors the verified ESPN ATP/WTA
 * scoreboard shape (RESEARCH Unknown 1).
 */
function makeTennisComp(opts: {
  homePossession?: boolean
  awayPossession?: boolean
  homeAthleteId?: string
  homeAthleteShortName?: string
  awayAthleteId?: string
  awayAthleteShortName?: string
  formatPeriods?: number | null
  homeLinescores?: Array<{ value?: number; winner?: boolean; tiebreak?: number }>
  awayLinescores?: Array<{ value?: number; winner?: boolean; tiebreak?: number }>
  noFormat?: boolean
}) {
  const home = {
    homeAway: 'home' as const,
    athlete: opts.homeAthleteId !== undefined || opts.homeAthleteShortName !== undefined
      ? {
          id: opts.homeAthleteId,
          shortName: opts.homeAthleteShortName,
        }
      : undefined,
    ...(opts.homePossession !== undefined ? { possession: opts.homePossession } : {}),
    linescores: opts.homeLinescores,
  }
  const away = {
    homeAway: 'away' as const,
    athlete: opts.awayAthleteId !== undefined || opts.awayAthleteShortName !== undefined
      ? {
          id: opts.awayAthleteId,
          shortName: opts.awayAthleteShortName,
        }
      : undefined,
    ...(opts.awayPossession !== undefined ? { possession: opts.awayPossession } : {}),
    linescores: opts.awayLinescores,
  }
  const comp: {
    competitors: Array<typeof home | typeof away>
    format?: { regulation?: { periods?: number } }
  } = {
    competitors: [home, away],
  }
  if (!opts.noFormat) {
    comp.format = { regulation: { periods: opts.formatPeriods ?? 3 } }
  }
  return { comp, home, away }
}

describe('parseTennisLive', () => {
  it('returns serverId/serverName/formatPeriods/tiebreaks for tennis-in with possession=true', () => {
    // Home is serving. Bo5 fixture, two completed sets, tiebreak in set 1.
    const { comp, home, away } = makeTennisComp({
      homePossession: true,
      homeAthleteId: 'a-1001',
      homeAthleteShortName: 'L. Sonego',
      awayAthleteId: 'a-2002',
      awayAthleteShortName: 'P. Herbert',
      formatPeriods: 5,
      homeLinescores: [
        { value: 7, winner: true, tiebreak: 7 },
        { value: 5, winner: false },
      ],
      awayLinescores: [
        { value: 6, winner: false, tiebreak: 3 },
        { value: 7, winner: true },
      ],
    })
    const result = parseTennisLive(comp, home, away, 'Tennis', 'in')
    expect(result).toBeDefined()
    expect(result?.serverId).toBe('a-1001')
    expect(result?.serverName).toBe('L. Sonego')
    expect(result?.formatPeriods).toBe(5)
    // Tiebreaks indexed per set, home's perspective; set 0 had a tiebreak, set 1 did not.
    expect(result?.tiebreaks[0]).toBe(7)
    expect(result?.tiebreaks[1]).toBeNull()
  })

  it('returns undefined for non-Tennis sport', () => {
    const { comp, home, away } = makeTennisComp({ homePossession: true })
    expect(parseTennisLive(comp, home, away, 'MLB', 'in')).toBeUndefined()
  })

  it('returns undefined for tennis pre-game (status !== in)', () => {
    const { comp, home, away } = makeTennisComp({ homePossession: true })
    expect(parseTennisLive(comp, home, away, 'Tennis', 'pre')).toBeUndefined()
  })

  it('returns undefined for tennis post-game (status === post)', () => {
    const { comp, home, away } = makeTennisComp({ homePossession: true })
    expect(parseTennisLive(comp, home, away, 'Tennis', 'post')).toBeUndefined()
  })

  it('degrades gracefully when no competitor has possession (serverId/serverName empty)', () => {
    // Neither home nor away has possession — must not throw, must return empty strings.
    const { comp, home, away } = makeTennisComp({
      homeAthleteId: 'a-1',
      homeAthleteShortName: 'X',
      awayAthleteId: 'a-2',
      awayAthleteShortName: 'Y',
      formatPeriods: 3,
    })
    const result = parseTennisLive(comp, home, away, 'Tennis', 'in')
    expect(result).toBeDefined()
    expect(result?.serverId).toBe('')
    expect(result?.serverName).toBe('')
    expect(result?.formatPeriods).toBe(3)
  })

  it('falls back to formatPeriods=3 when format is absent', () => {
    const { comp, home, away } = makeTennisComp({
      homePossession: true,
      homeAthleteId: 'a-1',
      homeAthleteShortName: 'X',
      noFormat: true,
    })
    const result = parseTennisLive(comp, home, away, 'Tennis', 'in')
    expect(result?.formatPeriods).toBe(3)
  })

  it('uses awayAthlete identity when away has possession=true', () => {
    const { comp, home, away } = makeTennisComp({
      awayPossession: true,
      homeAthleteId: 'h-id',
      homeAthleteShortName: 'Home',
      awayAthleteId: 'aw-id',
      awayAthleteShortName: 'Away',
      formatPeriods: 3,
    })
    const result = parseTennisLive(comp, home, away, 'Tennis', 'in')
    expect(result?.serverId).toBe('aw-id')
    expect(result?.serverName).toBe('Away')
  })

  it('does not throw when athlete object is missing on the server competitor', () => {
    // possession=true competitor has no athlete field at all.
    const home = { homeAway: 'home' as const, possession: true }
    const away = { homeAway: 'away' as const }
    const comp = {
      competitors: [home, away],
      format: { regulation: { periods: 3 } },
    }
    const result = parseTennisLive(comp, home, away, 'Tennis', 'in')
    expect(result).toBeDefined()
    expect(result?.serverId).toBe('')
    expect(result?.serverName).toBe('')
  })

  it('TennisLive type shape is exported', () => {
    // Compile-time witness: the type is importable. Runtime asserts the right shape.
    const tl: TennisLive = {
      serverId: '',
      serverName: '',
      formatPeriods: 3,
      tiebreaks: [],
    }
    expect(tl.formatPeriods).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// fetchLeagueScoreboard — tennis groupings flattener (Pitfall 1 root-cause fix)
// ---------------------------------------------------------------------------

/**
 * Mocks `globalThis.fetch` for a single test, returns a Response whose JSON
 * body is the provided payload. Cleans up automatically (per-test scoping).
 */
function mockFetchOnce(payload: unknown, ok = true) {
  const fakeRes = {
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  }
  vi.stubGlobal('fetch', vi.fn(async () => fakeRes as unknown as Response))
}

describe('fetchLeagueScoreboard tennis flattener', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flattens events->groupings->competitions for Tennis into a non-empty LiveGame[]', async () => {
    // The verified ESPN tennis shape (RESEARCH Unknown 1):
    // events[0].groupings[N].competitions[M] (tournament wraps matches under groupings).
    // The OLD code path (which read event.competitions[0]) returned [] for this shape.
    const tennisPayload = {
      events: [
        {
          id: 'tournament-roland-garros',
          date: '2026-05-24T12:00:00Z',
          groupings: [
            {
              competitions: [
                {
                  id: 'match-1',
                  date: '2026-05-24T12:30:00Z',
                  format: { regulation: { periods: 3 } },
                  status: { period: 1, type: { name: 'STATUS_IN_PROGRESS', shortDetail: '1st' } },
                  competitors: [
                    {
                      homeAway: 'home',
                      possession: true,
                      athlete: { id: 'a-1', displayName: 'Player One', shortName: 'P. One' },
                      linescores: [{ value: 4 }],
                    },
                    {
                      homeAway: 'away',
                      athlete: { id: 'a-2', displayName: 'Player Two', shortName: 'P. Two' },
                      linescores: [{ value: 3 }],
                    },
                  ],
                },
                {
                  id: 'match-2',
                  date: '2026-05-24T13:00:00Z',
                  format: { regulation: { periods: 5 } },
                  status: { period: 2, type: { name: 'STATUS_IN_PROGRESS', shortDetail: '2nd' } },
                  competitors: [
                    {
                      homeAway: 'home',
                      athlete: { id: 'a-3', displayName: 'Player Three', shortName: 'P. Three' },
                      linescores: [{ value: 6, winner: true }, { value: 2 }],
                    },
                    {
                      homeAway: 'away',
                      possession: true,
                      athlete: { id: 'a-4', displayName: 'Player Four', shortName: 'P. Four' },
                      linescores: [{ value: 4 }, { value: 5 }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    mockFetchOnce(tennisPayload)

    const games = await fetchLeagueScoreboard('Tennis', 'tennis/atp', '20260524')

    expect(games).toHaveLength(2)
    expect(games[0].id).toBe('match-1')
    expect(games[1].id).toBe('match-2')
  })

  it('flattened tennis LiveGame carries periodScores + tennisLive.serverId from possession', async () => {
    const tennisPayload = {
      events: [
        {
          id: 'tournament-1',
          date: '2026-05-24T12:00:00Z',
          groupings: [
            {
              competitions: [
                {
                  id: 'match-x',
                  date: '2026-05-24T12:30:00Z',
                  format: { regulation: { periods: 5 } },
                  status: { period: 3, type: { name: 'STATUS_IN_PROGRESS', shortDetail: '3rd' } },
                  competitors: [
                    {
                      homeAway: 'home',
                      possession: true,
                      athlete: { id: 'srv-1', displayName: 'Server', shortName: 'S. erver' },
                      linescores: [
                        { value: 6, winner: true },
                        { value: 7, winner: true, tiebreak: 7 },
                        { value: 3 },
                      ],
                    },
                    {
                      homeAway: 'away',
                      athlete: { id: 'opp-1', displayName: 'Opponent', shortName: 'O. pponent' },
                      linescores: [
                        { value: 3 },
                        { value: 6, tiebreak: 5 },
                        { value: 4 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    mockFetchOnce(tennisPayload)

    const games = await fetchLeagueScoreboard('Tennis', 'tennis/atp', '20260524')

    expect(games).toHaveLength(1)
    const g = games[0]
    expect(g.sport).toBe('Tennis')
    expect(g.status).toBe('in')
    // periodScores maps linescores[i].value directly (no change to buildPeriodScores).
    expect(g.periodScores).toEqual([
      { home: 6, away: 3 },
      { home: 7, away: 6 },
      { home: 3, away: 4 },
    ])
    expect(g.tennisLive).toBeDefined()
    expect(g.tennisLive?.serverId).toBe('srv-1')
    expect(g.tennisLive?.serverName).toBe('S. erver')
    expect(g.tennisLive?.formatPeriods).toBe(5)
    // Tiebreaks from home perspective: set 0 no tb, set 1 tb=7, set 2 no tb.
    expect(g.tennisLive?.tiebreaks).toEqual([null, 7, null])
  })

  it('current-set games derivable from periodScores last entry; periodScores length matches set count', async () => {
    // D-08: sets-won + current-set games derivable from per-set linescores.
    // periodScores carries value-per-set (games won this set, both sides). The
    // current-set games are periodScores[periodScores.length - 1].
    const tennisPayload = {
      events: [
        {
          id: 't-1',
          date: '2026-05-24T12:00:00Z',
          groupings: [
            {
              competitions: [
                {
                  id: 'match-sw',
                  format: { regulation: { periods: 5 } },
                  status: { period: 4, type: { name: 'STATUS_IN_PROGRESS', shortDetail: '4th' } },
                  competitors: [
                    {
                      homeAway: 'home',
                      athlete: { id: 'h', shortName: 'H' },
                      linescores: [
                        { value: 6, winner: true },
                        { value: 4 },
                        { value: 7, winner: true },
                        { value: 5 },
                      ],
                    },
                    {
                      homeAway: 'away',
                      athlete: { id: 'a', shortName: 'A' },
                      linescores: [
                        { value: 3 },
                        { value: 6, winner: true },
                        { value: 6 },
                        { value: 5 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    mockFetchOnce(tennisPayload)
    const games = await fetchLeagueScoreboard('Tennis', 'tennis/wta', '20260524')
    const g = games[0]
    expect(g).toBeDefined()
    // periodScores has 4 entries — one per set the match has reached.
    expect(g.periodScores).toHaveLength(4)
    // Current-set games (last entry) — set index 3, home=5 away=5.
    expect(g.periodScores[g.periodScores.length - 1]).toEqual({ home: 5, away: 5 })
    // Verify the per-set linescore values mapped through buildPeriodScores untouched.
    expect(g.periodScores[0]).toEqual({ home: 6, away: 3 })
    expect(g.periodScores[1]).toEqual({ home: 4, away: 6 })
    expect(g.periodScores[2]).toEqual({ home: 7, away: 6 })
  })

  it('does NOT flatten for non-Tennis sport (regression guard: standard shape still parses)', async () => {
    const mlbPayload = {
      events: [
        {
          id: 'mlb-1',
          date: '2026-05-24T19:00:00Z',
          competitions: [
            {
              status: { period: 1, type: { name: 'STATUS_IN_PROGRESS', shortDetail: 'Top 1st' } },
              competitors: [
                {
                  homeAway: 'home',
                  score: '0',
                  team: { abbreviation: 'NYY', shortDisplayName: 'Yankees' },
                  linescores: [{ value: 0 }],
                },
                {
                  homeAway: 'away',
                  score: '0',
                  team: { abbreviation: 'BOS', shortDisplayName: 'Red Sox' },
                  linescores: [{ value: 0 }],
                },
              ],
            },
          ],
        },
      ],
    }
    mockFetchOnce(mlbPayload)
    const games = await fetchLeagueScoreboard('MLB', 'baseball/mlb', '20260524')
    expect(games).toHaveLength(1)
    expect(games[0].id).toBe('mlb-1')
    expect(games[0].sport).toBe('MLB')
    expect(games[0].homeTeam).toBe('NYY')
    // tennisLive must be undefined for non-tennis.
    expect(games[0].tennisLive).toBeUndefined()
  })

  it('tennis payload with no groupings (malformed/empty) returns [] without throwing (T-19-01)', async () => {
    const malformedPayload = {
      events: [
        {
          id: 'broken-event',
          date: '2026-05-24T12:00:00Z',
          // No groupings field at all (missing/malformed).
        },
      ],
    }
    mockFetchOnce(malformedPayload)
    const games = await fetchLeagueScoreboard('Tennis', 'tennis/atp', '20260524')
    expect(games).toEqual([])
  })

  it('tennis payload with empty events array returns []', async () => {
    mockFetchOnce({ events: [] })
    const games = await fetchLeagueScoreboard('Tennis', 'tennis/atp', '20260524')
    expect(games).toEqual([])
  })

  it('a non-tennis fixture in groupings-only shape returns [] (flattener gated on sport)', async () => {
    // If the user passes sport='MLB' but the payload accidentally has groupings,
    // the old non-flatten path is taken and yields [] (no competitions at event level).
    const oddPayload = {
      events: [
        {
          id: 'odd',
          date: '2026-05-24T00:00:00Z',
          groupings: [{ competitions: [{ id: 'x' }] }],
        },
      ],
    }
    mockFetchOnce(oddPayload)
    const games = await fetchLeagueScoreboard('MLB', 'baseball/mlb', '20260524')
    expect(games).toEqual([])
  })
})
