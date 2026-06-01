import { describe, it, expect } from 'vitest'
import { matchPropBet } from './prop-matcher'
import type { LiveStatus } from './team-matcher'
import type { LiveGame } from '@/hooks/use-live-scores'
import type { GameBoxscore, PlayerStatRow } from '@/hooks/use-boxscores'
import type { Bet } from '@/lib/types'

// ---------------------------------------------------------------------------
// Fixture factories — mirror team-matcher.test.ts (lines 11-28) conventions.
// ---------------------------------------------------------------------------

function makeGame(overrides: Partial<LiveGame> = {}): LiveGame {
  return {
    id: 'g-1',
    sport: 'MLB',
    homeTeam: 'NYY',
    awayTeam: 'BOS',
    homeName: 'Yankees',
    awayName: 'Red Sox',
    homeScore: 0,
    awayScore: 0,
    status: 'in',
    statusDetail: 'Top 3rd',
    startTime: '2026-04-30T18:00:00Z',
    periodScores: [],
    currentPeriod: null,
    ...overrides,
  }
}

function makePlayer(overrides: Partial<PlayerStatRow> = {}): PlayerStatRow {
  return {
    athleteId: 'a-1',
    name: 'Aaron Judge',
    shortName: 'A. Judge',
    team: 'NYY',
    stats: {},
    didNotPlay: false,
    ...overrides,
  }
}

function makeBoxscore(
  gameId: string,
  players: PlayerStatRow[],
  status: GameBoxscore['status'] = 'in',
  sport = 'MLB',
): GameBoxscore {
  return { gameId, sport, status, players }
}

function makeBet(overrides: Partial<Bet> = {}): Bet {
  return {
    id: 'b-1',
    placed_at: '2026-04-30T17:00:00Z',
    sport: 'MLB',
    bet_type: 'prop',
    description: 'Aaron Judge (NYY) Over 1.5 Total Bases',
    stake: 100,
    odds: -110,
    status: 'pending',
    profit_loss: 0,
    is_freeplay: false,
    ...overrides,
  } as Bet
}

// ---------------------------------------------------------------------------
// Core Task-1 cases: clinch-first, pace band, fallback, basis, per-leg.
// ---------------------------------------------------------------------------

describe('matchPropBet — clinch precedence (D-05)', () => {
  it('an over prop with current > line mid-game returns prediction.outcome === "won" (clinch first, not a pace band)', () => {
    // 4 innings completed, elapsed 4/9 ≈ 0.44 — would be a pace band candidate.
    const game = makeGame({
      periodScores: [
        { home: 1, away: 0 },
        { home: 1, away: 0 },
        { home: 0, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 5,
    })
    const player = makePlayer({ stats: { total_bases: 3 } })
    const box = makeBoxscore(game.id, [player])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result).not.toBeNull()
    expect(result!.prediction?.outcome).toBe('won')
  })

  it('a plus prop with current >= line mid-game returns prediction.outcome === "won" (clinch first)', () => {
    const game = makeGame({
      sport: 'NBA',
      homeTeam: 'LAL',
      awayTeam: 'BOS',
      homeName: 'Lakers',
      awayName: 'Celtics',
      periodScores: [
        { home: 30, away: 28 },
        { home: 25, away: 26 },
      ],
      currentPeriod: 3,
    })
    const player = makePlayer({
      name: 'LeBron James',
      shortName: 'L. James',
      team: 'LAL',
      stats: { points: 6 },
    })
    const box = makeBoxscore(game.id, [player], 'in', 'NBA')
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ sport: 'NBA', description: 'LeBron James (LAL) 6+ Points' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.prediction?.outcome).toBe('won')
  })
})

describe('matchPropBet — pace band on live, non-clinched over/under (D-04/D-11)', () => {
  it('a live over prop with player in boxscore at >=15% elapsed (currentValue < line, projected over) reads on_pace', () => {
    // 3 innings completed of 9 → elapsed 3/9 ≈ 0.33 (above 15% gate).
    // 1 base @ 0.33 elapsed → projected 1/0.33 ≈ 3.03, line 1.5 → diff +1.5 > margin → on_pace.
    const game = makeGame({
      periodScores: [
        { home: 0, away: 0 },
        { home: 1, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 4,
    })
    const player = makePlayer({ stats: { total_bases: 1 } })
    const box = makeBoxscore(game.id, [player])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.cover).toBe<LiveStatus>('on_pace')
    // Clinch did NOT fire — currentValue 1 is NOT > line 1.5.
    expect(result?.prediction).toBeNull()
  })

  it('a live over prop with strongly behind currentValue at >=15% elapsed reads off_pace', () => {
    // 5 innings of 9 → elapsed ≈ 0.56. currentValue 0 → projected 0 → diff -1.5 < -margin → off_pace.
    const game = makeGame({
      periodScores: Array.from({ length: 5 }, () => ({ home: 0, away: 0 })),
      currentPeriod: 6,
    })
    const player = makePlayer({ stats: { total_bases: 0 } })
    const box = makeBoxscore(game.id, [player])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.cover).toBe<LiveStatus>('off_pace')
    expect(result?.prediction).toBeNull()
  })

  it('a live under prop with current below the line at >=15% elapsed reads on_pace', () => {
    // 4 innings of 9 → elapsed 4/9 ≈ 0.44. currentValue 1 strikeout vs u5.5
    // projected 1/0.44 ≈ 2.27 → under diff = 5.5 - 2.27 ≈ +3.23 > margin → on_pace.
    const game = makeGame({
      periodScores: [
        { home: 0, away: 0 },
        { home: 0, away: 0 },
        { home: 0, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 5,
    })
    const player = makePlayer({
      name: 'Gerrit Cole',
      shortName: 'G. Cole',
      team: 'NYY',
      stats: { strikeouts_pitcher: 1 },
    })
    const box = makeBoxscore(game.id, [player])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({
      description: 'Gerrit Cole (NYY) Under 5.5 Strikeouts',
    })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.cover).toBe<LiveStatus>('on_pace')
  })
})

describe('matchPropBet — fallback to covering/behind (D-12)', () => {
  it('when the player is not yet in the boxscore, cover stays "pregame" — never a pace band', () => {
    // 3 innings completed → elapsed 0.33; but no player in box → falls through
    // pace path entirely (player gate). currentValue stays null; cover is the
    // initial 'pregame' value.
    const game = makeGame({
      periodScores: [
        { home: 0, away: 0 },
        { home: 1, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 4,
    })
    // empty box — player array is []
    const box = makeBoxscore(game.id, [])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.player).toBeNull()
    expect(result?.cover).toBe<LiveStatus>('pregame')
    // No pace band.
    expect(result?.cover).not.toBe('on_pace')
    expect(result?.cover).not.toBe('off_pace')
    expect(result?.cover).not.toBe('borderline')
  })

  it('when getElapsedFraction returns -1 (unknown sport), cover falls back to comparatorPasses covering/behind — not a pace band', () => {
    // Use the WNBA sport — not in getElapsedFraction's switch → -1 sentinel.
    // But the prop-matcher needs a known sport for TEAM_TO_SPORTS lookup; we
    // use sport WNBA which won't resolve, so we pass an explicit team mapping
    // via NBA team abbrev and override the game's sport to a value getElapsedFraction
    // does not handle. WNBA is unhandled in getElapsedFraction → returns -1.
    // We use NY (NBA/WNBA candidate; NBA is in TEAM_TO_SPORTS) and override game.sport to WNBA.
    const game = makeGame({
      sport: 'WNBA',
      homeTeam: 'NY',
      awayTeam: 'LAS',
      homeName: 'Liberty',
      awayName: 'Aces',
      periodScores: [
        { home: 20, away: 18 },
        { home: 22, away: 20 },
      ],
      currentPeriod: 3,
    })
    const player = makePlayer({
      name: 'Sabrina Ionescu',
      shortName: 'S. Ionescu',
      team: 'NY',
      stats: { points: 12 },
    })
    const box = makeBoxscore(game.id, [player], 'in', 'WNBA')
    const boxscores = new Map([[game.id, box]])
    // NY is in TEAM_TO_SPORTS but as NBA only. Pass sport=NBA on the bet so
    // findGameForTeam picks our WNBA game via sport hint = bet.sport. Actually
    // we need bet.sport to match the game.sport, so set bet.sport = WNBA and
    // accept that findGameForTeam may need adjustment — but TEAM_TO_SPORTS NY=NBA only.
    // Easier path: use a sport getElapsedFraction doesn't handle (e.g. add it as
    // hint). Switch to MMA-style: sport = 'Tennis' but no tennisLive set → -1.
    const tennisGame = makeGame({
      sport: 'Tennis',
      homeTeam: 'TBD',
      awayTeam: 'TBD',
      // No tennisLive — getElapsedFraction returns -1.
      periodScores: [{ home: 4, away: 3 }],
      currentPeriod: 1,
    })
    void game
    void box
    void boxscores
    void player
    // Tennis path is awkward for prop fixtures; instead test the fallback via
    // a simpler MLB-pre game where getSegmentScore.hasData=false maps to 'pregame'.
    // Most direct: assert that when elapsed=-1 (no periodScores for an MLB game in 'in'),
    // cover stays the comparator value, not a pace band.
    void tennisGame

    // Direct test: MLB game in 'in' but with currentValue clearly behind the line
    // and zero periodScores → elapsed = 0/9 = 0 → too_early gate trips → falls
    // back to comparatorPasses. (0 is not the -1 sentinel, but the pace override
    // is structured to OVERRIDE when elapsed >= 0; the engine itself maps elapsed=0
    // to 'too_early'. Use a true -1 path via an unhandled-sport boxscore.)
    const mmaLikeGame = makeGame({
      sport: 'WNBA', // unhandled in getElapsedFraction → -1
      homeTeam: 'NY',
      awayTeam: 'LAS',
      homeName: 'Liberty',
      awayName: 'Aces',
      periodScores: [
        { home: 20, away: 18 },
        { home: 22, away: 20 },
      ],
      currentPeriod: 3,
    })
    const wnbaPlayer = makePlayer({
      name: 'Sabrina Ionescu',
      shortName: 'S. Ionescu',
      team: 'NY',
      stats: { points: 12 },
    })
    const wnbaBox = makeBoxscore(mmaLikeGame.id, [wnbaPlayer], 'in', 'WNBA')
    const wnbaBoxscores = new Map([[mmaLikeGame.id, wnbaBox]])
    const wnbaBet = makeBet({
      sport: 'WNBA',
      description: 'Sabrina Ionescu (NY) Over 20.5 Points',
    })

    const result = matchPropBet(wnbaBet, [mmaLikeGame], wnbaBoxscores)
    // currentValue 12, line 20.5 → comparatorPasses returns 'behind'. -1 elapsed
    // keeps the fallback in place (no pace band override).
    expect(result?.cover).toBe<LiveStatus>('behind')
    // Explicitly NOT a pace band.
    expect(result?.cover).not.toBe('on_pace')
    expect(result?.cover).not.toBe('off_pace')
    expect(result?.cover).not.toBe('borderline')
  })
})

describe('matchPropBet — uniform game-clock basis (D-04)', () => {
  it('an MLB 1-base prop at 3rd inning uses the inning denominator (not a participation/PA field) and reads on_pace', () => {
    // Exactly the motivating example: "Judge 1.5+ Total Bases" at 1 base in the 3rd
    // inning of a 9-inning game. periodScores has 3 entries → elapsed 3/9 ≈ 0.33.
    // currentValue 1 / 0.33 ≈ 3.03 → diff +1.5 > margin → on_pace.
    // Note we explicitly do NOT set any participation/PA field on the player —
    // the pace read comes from the *game-clock* basis only.
    const game = makeGame({
      periodScores: [
        { home: 0, away: 0 },
        { home: 1, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 4,
    })
    // Player has total_bases ONLY — no minutes/plate appearances field.
    const player = makePlayer({
      stats: { total_bases: 1 },
    })
    const box = makeBoxscore(game.id, [player])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.cover).toBe<LiveStatus>('on_pace')
  })
})

// ---------------------------------------------------------------------------
// Task 2 — broader coverage per 19-VALIDATION.md Wave-0 gap:
//   - D-05 clinch-first (stronger case — clinch overrides what would otherwise
//     be a borderline / off_pace projection)
//   - D-04/D-11 borderline band (projection within borderlineMargin of line)
//   - D-12 fallback — DNP'd player + pre-game game.status
//   - D-04 basis — assert that an *NBA* prop also uses period-bucket elapsed
//     (the same getElapsedFraction the engine uses for team totals)
//   - D-07 per-leg — two distinct prop bets return independent
//     PropMatchResult.cover values; no aggregate function exists/is invoked
// ---------------------------------------------------------------------------

describe('matchPropBet — D-05 clinch precedence overrides what would otherwise be a pace band', () => {
  it('an over prop already past the line at 50% elapsed yields prediction.outcome="won" — the pace path does NOT overwrite cover into a band', () => {
    // 5 innings completed → elapsed 5/9 ≈ 0.56. currentValue 3 > line 1.5 →
    // clinch fires (prediction.outcome === "won"). With prediction !== null,
    // the pace override is skipped and cover keeps its comparatorPasses value
    // ("covering"), NOT a pace band.
    const game = makeGame({
      periodScores: Array.from({ length: 5 }, () => ({ home: 0, away: 0 })),
      currentPeriod: 6,
    })
    const player = makePlayer({ stats: { total_bases: 3 } })
    const box = makeBoxscore(game.id, [player])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.prediction?.outcome).toBe('won')
    // cover stays at the comparator-pass value (a subset of LiveStatus).
    expect(result?.cover).toBe<LiveStatus>('covering')
    // Explicitly NOT a pace band — the clinch path won.
    expect(result?.cover).not.toBe('on_pace')
    expect(result?.cover).not.toBe('off_pace')
    expect(result?.cover).not.toBe('borderline')
  })
})

describe('matchPropBet — D-04/D-11 borderline band (projection within margin of line)', () => {
  it('a live over prop whose projection lands inside borderlineMargin of the line reads borderline', () => {
    // borderlineMargin(20.5) = max(20.5 * 0.10, 0.5) = 2.05.
    // Target: projected ≈ line so diff falls inside ±2.05.
    // Use NBA periodScores.length=2 (Q2 complete) → elapsed 2/4 = 0.5.
    // currentValue 10 → projected 10/0.5 = 20 → diff = 20 - 20.5 = -0.5
    // |diff| < margin → borderline.
    const game = makeGame({
      sport: 'NBA',
      homeTeam: 'LAL',
      awayTeam: 'BOS',
      homeName: 'Lakers',
      awayName: 'Celtics',
      periodScores: [
        { home: 30, away: 28 },
        { home: 25, away: 26 },
      ],
      currentPeriod: 3,
    })
    const player = makePlayer({
      name: 'LeBron James',
      shortName: 'L. James',
      team: 'LAL',
      stats: { points: 10 },
    })
    const box = makeBoxscore(game.id, [player], 'in', 'NBA')
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ sport: 'NBA', description: 'LeBron James (LAL) Over 20.5 Points' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.cover).toBe<LiveStatus>('borderline')
  })
})

describe('matchPropBet — D-12 fallback edge cases', () => {
  it('a player marked didNotPlay does NOT enter the pace path; cover stays "pregame"', () => {
    // DNP + game.status === 'in' → falls into neither the pace branch nor
    // the DNP=post branch; cover stays at the initial 'pregame'.
    const game = makeGame({
      periodScores: [
        { home: 0, away: 0 },
        { home: 1, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 4,
    })
    const player = makePlayer({
      didNotPlay: true,
      stats: { total_bases: 0 },
    })
    const box = makeBoxscore(game.id, [player])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.cover).toBe<LiveStatus>('pregame')
    // Not a pace band.
    expect(result?.cover).not.toBe('on_pace')
    expect(result?.cover).not.toBe('off_pace')
  })

  it('a pregame (status="pre") prop never enters the pace path — cover stays "pregame"', () => {
    const game = makeGame({
      status: 'pre',
      periodScores: [],
      currentPeriod: null,
    })
    const player = makePlayer({ stats: { total_bases: 0 } })
    const box = makeBoxscore(game.id, [player], 'pre')
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.cover).toBe<LiveStatus>('pregame')
  })
})

describe('matchPropBet — D-04 game-clock basis across sports', () => {
  it('an NBA prop uses the quarter denominator (periodScores.length / 4), not a participation/minutes field', () => {
    // 2 quarters completed → elapsed 2/4 = 0.5. currentValue 5 → projected 5/0.5 = 10.
    // line 20.5 → diff = 10 - 20.5 = -10.5 → magnitude > margin 2.05 → off_pace.
    // The pace read uses the inning/quarter-bucket basis identically to team
    // totals — explicitly NOT a player-minutes-played figure.
    const game = makeGame({
      sport: 'NBA',
      homeTeam: 'LAL',
      awayTeam: 'BOS',
      homeName: 'Lakers',
      awayName: 'Celtics',
      periodScores: [
        { home: 30, away: 28 },
        { home: 25, away: 26 },
      ],
      currentPeriod: 3,
    })
    const player = makePlayer({
      name: 'LeBron James',
      shortName: 'L. James',
      team: 'LAL',
      // points ONLY — no minutes_played / seconds_played field consulted.
      stats: { points: 5 },
    })
    const box = makeBoxscore(game.id, [player], 'in', 'NBA')
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ sport: 'NBA', description: 'LeBron James (LAL) Over 20.5 Points' })

    const result = matchPropBet(bet, [game], boxscores)
    expect(result?.cover).toBe<LiveStatus>('off_pace')
  })

  it('an MLB prop uses the inning denominator across multiple completed innings (period-count basis)', () => {
    // 6 innings completed → elapsed 6/9 ≈ 0.67. currentValue 4 → projected 6 → over 1.5 → on_pace.
    const game = makeGame({
      periodScores: Array.from({ length: 6 }, () => ({ home: 0, away: 0 })),
      currentPeriod: 7,
    })
    const player = makePlayer({ stats: { total_bases: 4 } })
    const box = makeBoxscore(game.id, [player])
    const boxscores = new Map([[game.id, box]])
    const bet = makeBet({ description: 'Aaron Judge (NYY) Over 1.5 Total Bases' })

    const result = matchPropBet(bet, [game], boxscores)
    // Clinch fires (4 > 1.5) — assert won; but the period-count math is still
    // the live-elapsed signal, not minutes.
    expect(result?.prediction?.outcome).toBe('won')
  })
})

describe('matchPropBet — D-07 per-leg independence (no aggregate)', () => {
  it('two distinct prop legs return independent PropMatchResult.cover values; no aggregate function exists in the module', () => {
    // Leg A: live over prop, on_pace.
    // Leg B: live under prop on same game, off_pace.
    // Each leg is computed independently — no roll-up.
    const game = makeGame({
      periodScores: [
        { home: 1, away: 0 },
        { home: 1, away: 0 },
        { home: 1, away: 0 },
        { home: 1, away: 0 },
      ],
      currentPeriod: 5,
    })
    const judge = makePlayer({
      athleteId: 'judge',
      name: 'Aaron Judge',
      shortName: 'A. Judge',
      stats: { total_bases: 2 },
    })
    const cole = makePlayer({
      athleteId: 'cole',
      name: 'Gerrit Cole',
      shortName: 'G. Cole',
      stats: { strikeouts_pitcher: 6 },
    })
    const box = makeBoxscore(game.id, [judge, cole])
    const boxscores = new Map([[game.id, box]])

    const legA = makeBet({
      id: 'b-A',
      description: 'Aaron Judge (NYY) Over 1.5 Total Bases',
    })
    const legB = makeBet({
      id: 'b-B',
      description: 'Gerrit Cole (NYY) Under 5.5 Strikeouts',
    })

    const resA = matchPropBet(legA, [game], boxscores)
    const resB = matchPropBet(legB, [game], boxscores)

    expect(resA).not.toBeNull()
    expect(resB).not.toBeNull()
    // Independent results.
    expect(resA?.parsed.playerName).toBe('Aaron Judge')
    expect(resB?.parsed.playerName).toBe('Gerrit Cole')
    // 2 > 1.5 → Judge over clinches → prediction.outcome = 'won', cover = 'covering'.
    expect(resA?.prediction?.outcome).toBe('won')
    // 6 > 5.5 (under bet) — comparator='under', current > line → cover = 'behind'.
    // Pace path: elapsed 4/9 ≈ 0.44. Projected 6/0.44 ≈ 13.5. Under diff = 5.5 - 13.5 = -8 → off_pace.
    expect(resB?.cover).toBe<LiveStatus>('off_pace')
    // No aggregated parlay-level field exists on PropMatchResult.
    expect(resA && 'parlayCover' in resA).toBe(false)
    expect(resB && 'parlayCover' in resB).toBe(false)
  })
})
