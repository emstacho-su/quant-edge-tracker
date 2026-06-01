import { describe, it, expect } from 'vitest'
import {
  parseBetLine,
  detectBetPeriod,
  getSegmentScore,
  predictBetOutcome,
  findEspnAbbrevs,
  matchBetToGame,
  matchParlayLegs,
  borderlineMargin,
  getOnPaceStatus,
  getElapsedFraction,
  getLiveStatus,
} from './team-matcher'
import type { LibraryAliasMap, LiveStatus, PaceStatus } from './team-matcher'
import type { Bet } from '@/lib/types'
import type { LiveGame } from '@/hooks/use-live-scores'

function makeGame(overrides: Partial<LiveGame> = {}): LiveGame {
  return {
    id: 'g-1',
    sport: 'NBA',
    homeTeam: 'LAL',
    awayTeam: 'BOS',
    homeName: 'Lakers',
    awayName: 'Celtics',
    homeScore: 0,
    awayScore: 0,
    status: 'in',
    statusDetail: '',
    startTime: '2026-04-30T00:00:00Z',
    periodScores: [],
    currentPeriod: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// detectBetPeriod
// ---------------------------------------------------------------------------

describe('detectBetPeriod', () => {
  it('returns fullgame when no marker present', () => {
    expect(detectBetPeriod('PHX Suns -13')).toBe('fullgame')
    expect(detectBetPeriod('KC Royals ML')).toBe('fullgame')
  })

  it('parses NBA half markers', () => {
    expect(detectBetPeriod('ORL Magic +5 (1H)')).toBe('1h')
    expect(detectBetPeriod('PHI 76ers +6.5 (1H)')).toBe('1h')
    expect(detectBetPeriod('LAL Lakers ML (2H)')).toBe('2h')
  })

  it('parses NCAAB half markers', () => {
    expect(detectBetPeriod('Connecticut - Illinois u64.5 (1H)')).toBe('1h')
  })

  it('parses NHL period markers', () => {
    expect(detectBetPeriod('ANA Ducks - EDM Oilers u1.5 (1P)')).toBe('1p')
    expect(detectBetPeriod('NY Rangers - TB Lightning o1.5 -130 (1P)')).toBe('1p')
    expect(detectBetPeriod('Some bet (2P)')).toBe('2p')
    expect(detectBetPeriod('Some bet (3P)')).toBe('3p')
  })

  it('parses MLB first 5 innings', () => {
    expect(detectBetPeriod('NYY o4.5 (F5)')).toBe('f5')
    expect(detectBetPeriod('First 5 BOS ML')).toBe('f5')
  })

  it('parses spelled-out forms', () => {
    expect(detectBetPeriod('NBA Lakers 1st Half -3')).toBe('1h')
    expect(detectBetPeriod('First Quarter Suns ML')).toBe('1q')
    expect(detectBetPeriod('NHL 2nd Period o2.5')).toBe('2p')
  })

  it('parses NBA quarter markers', () => {
    expect(detectBetPeriod('Lakers ML (1Q)')).toBe('1q')
    expect(detectBetPeriod('Some bet (4Q)')).toBe('4q')
  })
})

// ---------------------------------------------------------------------------
// parseBetLine — period-aware
// ---------------------------------------------------------------------------

describe('parseBetLine', () => {
  it('parses full-game spread', () => {
    expect(parseBetLine('PHX Suns -13')).toEqual({
      team: 'PHX',
      lineType: 'spread',
      lineValue: -13,
      period: 'fullgame',
    })
  })

  it('parses full-game moneyline', () => {
    expect(parseBetLine('KC Royals ML')).toEqual({
      team: 'KC',
      lineType: 'moneyline',
      lineValue: null,
      period: 'fullgame',
    })
  })

  it('parses over/under', () => {
    expect(parseBetLine('TOR - MEM o233.5')).toEqual({
      team: null,
      lineType: 'over',
      lineValue: 233.5,
      period: 'fullgame',
    })
  })

  it('parses 1H spread (NBA)', () => {
    expect(parseBetLine('ORL Magic +5 (1H)')).toEqual({
      team: 'ORL',
      lineType: 'spread',
      lineValue: 5,
      period: '1h',
    })
  })

  it('parses 1H ML (NBA)', () => {
    expect(parseBetLine('ORL Magic ML (1H)')).toEqual({
      team: 'ORL',
      lineType: 'moneyline',
      lineValue: null,
      period: '1h',
    })
  })

  it('parses 1P under with ½ unicode (NHL)', () => {
    expect(parseBetLine('ANA Ducks - EDM Oilers u1½ (1P)')).toEqual({
      team: null,
      lineType: 'under',
      lineValue: 1.5,
      period: '1p',
    })
  })

  it('parses 1P over with odds (NHL)', () => {
    expect(parseBetLine('NY Rangers - TB Lightning o1½ -130 (1P)')).toEqual({
      team: null,
      lineType: 'over',
      lineValue: 1.5,
      period: '1p',
    })
  })

  it('parses 1H total (NCAAB)', () => {
    expect(parseBetLine('Connecticut - Illinois u64.5 (1H)')).toEqual({
      team: null,
      lineType: 'under',
      lineValue: 64.5,
      period: '1h',
    })
  })
})

// ---------------------------------------------------------------------------
// getSegmentScore
// ---------------------------------------------------------------------------

describe('getSegmentScore', () => {
  it('returns full game score for fullgame period', () => {
    const game = makeGame({ homeScore: 110, awayScore: 105, status: 'post' })
    const seg = getSegmentScore('fullgame', game)
    expect(seg).toEqual({ home: 110, away: 105, complete: true, hasData: true })
  })

  it('sums Q1+Q2 for NBA 1H', () => {
    const game = makeGame({
      sport: 'NBA',
      periodScores: [
        { home: 28, away: 24 },  // Q1
        { home: 30, away: 32 },  // Q2 -> halftime 58-56
        { home: 25, away: 28 },  // Q3 -> after Q3
      ],
      currentPeriod: 3,
    })
    const seg = getSegmentScore('1h', game)
    expect(seg.home).toBe(58)
    expect(seg.away).toBe(56)
    expect(seg.complete).toBe(true) // Q3 in progress, so 1H is final
    expect(seg.hasData).toBe(true)
  })

  it('uses single linescore for NCAAB 1H', () => {
    const game = makeGame({
      sport: 'NCAAB',
      periodScores: [
        { home: 38, away: 35 },  // 1H final
      ],
      currentPeriod: 2,
    })
    const seg = getSegmentScore('1h', game)
    expect(seg.home).toBe(38)
    expect(seg.away).toBe(35)
    expect(seg.complete).toBe(true) // 2H started -> 1H is final
  })

  it('marks NHL 1P incomplete while still in P1', () => {
    const game = makeGame({
      sport: 'NHL',
      periodScores: [
        { home: 1, away: 0 },  // P1 in progress
      ],
      currentPeriod: 1,
    })
    const seg = getSegmentScore('1p', game)
    expect(seg.home).toBe(1)
    expect(seg.away).toBe(0)
    expect(seg.complete).toBe(false)
  })

  it('marks NHL 1P complete once P2 starts', () => {
    const game = makeGame({
      sport: 'NHL',
      periodScores: [
        { home: 1, away: 0 },
        { home: 0, away: 1 },
      ],
      currentPeriod: 2,
    })
    const seg = getSegmentScore('1p', game)
    expect(seg.complete).toBe(true)
  })

  it('sums first 5 innings for MLB F5', () => {
    const game = makeGame({
      sport: 'MLB',
      periodScores: [
        { home: 1, away: 0 },
        { home: 0, away: 0 },
        { home: 2, away: 1 },
        { home: 0, away: 0 },
        { home: 0, away: 1 },  // 6 innings would be needed for F5 to be "complete"
        { home: 1, away: 0 },
      ],
      currentPeriod: 6,
    })
    const seg = getSegmentScore('f5', game)
    expect(seg.home).toBe(3)
    expect(seg.away).toBe(2)
    expect(seg.complete).toBe(true) // Currently in inning 6 -> F5 is final
  })

  it('returns hasData=false when linescores empty', () => {
    const game = makeGame({ status: 'in', periodScores: [] })
    const seg = getSegmentScore('1h', game)
    expect(seg.hasData).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// predictBetOutcome
// ---------------------------------------------------------------------------

describe('predictBetOutcome', () => {
  it('predicts won for NHL 1P over total when over', () => {
    const game = makeGame({
      sport: 'NHL',
      periodScores: [{ home: 2, away: 1 }, { home: 0, away: 0 }],
      currentPeriod: 2,
      status: 'in',
    })
    const parsed = parseBetLine('NY Rangers - TB Lightning o1½ (1P)')
    const result = predictBetOutcome(parsed, game, 'NY Rangers - TB Lightning o1½ (1P)')
    expect(result?.outcome).toBe('won')
  })

  it('predicts lost for NHL 1P under when total exceeds', () => {
    const game = makeGame({
      sport: 'NHL',
      periodScores: [{ home: 2, away: 1 }, { home: 0, away: 0 }],
      currentPeriod: 2,
      status: 'in',
    })
    const parsed = parseBetLine('ANA - EDM u1½ (1P)')
    const result = predictBetOutcome(parsed, game, 'ANA - EDM u1½ (1P)')
    expect(result?.outcome).toBe('lost')
  })

  it('returns null when bet period is not yet final', () => {
    const game = makeGame({
      sport: 'NHL',
      periodScores: [{ home: 1, away: 0 }],
      currentPeriod: 1,
      status: 'in',
    })
    const parsed = parseBetLine('NY Rangers - TB Lightning o1½ (1P)')
    expect(predictBetOutcome(parsed, game, '')).toBeNull()
  })

  it('predicts push when total exactly equals line', () => {
    const game = makeGame({
      sport: 'NCAAB',
      periodScores: [{ home: 32, away: 32 }],
      currentPeriod: 2,
      status: 'in',
    })
    const parsed = parseBetLine('Connecticut - Illinois u64 (1H)')
    const result = predictBetOutcome(parsed, game, 'Connecticut - Illinois u64 (1H)')
    expect(result?.outcome).toBe('push')
  })

  it('predicts won for full-game spread cover', () => {
    const game = makeGame({
      sport: 'NBA',
      homeScore: 115,
      awayScore: 100,
      status: 'post',
      periodScores: [],
      currentPeriod: 4,
    })
    const parsed = parseBetLine('LAL Lakers -10')
    const result = predictBetOutcome(parsed, game, 'LAL Lakers -10')
    expect(result?.outcome).toBe('won')
  })
})

// ---------------------------------------------------------------------------
// matchBetToGame — D-16 library-alias routing
// ---------------------------------------------------------------------------

function makeBet(overrides: Partial<Bet> = {}): Bet {
  return {
    id: 'bet-1',
    sport: 'MLB',
    bet_type: 'single',
    stake: 100,
    to_win: 91,
    odds_american: -110,
    description: 'Brewers ML',
    status: 'pending',
    is_freeplay: false,
    placed_at: '2026-05-01T18:00:00Z',
    settled_at: null,
    profit_loss: null,
    notes: null,
    live_game_id: null,
    live_game_sport: null,
    live_game_locked_at: null,
    ...overrides,
  }
}

function makeGameForMatcher(overrides: Partial<LiveGame> = {}): LiveGame {
  return {
    id: 'g-mlb-1',
    sport: 'MLB',
    homeTeam: 'MIL',
    awayTeam: 'STL',
    homeName: 'Brewers',
    awayName: 'Cardinals',
    homeScore: 0,
    awayScore: 0,
    status: 'pre',
    statusDetail: '',
    startTime: '2026-05-01T20:00:00Z',
    periodScores: [],
    currentPeriod: null,
    ...overrides,
  }
}

describe('matchBetToGame — D-16 library alias routing', () => {
  it('matches "Brewers ML" to the MIL game via library alias map', () => {
    const bet = makeBet({ description: 'Brewers ML', sport: 'MLB' })
    const game = makeGameForMatcher()
    // Library alias map: brewers → MIL (simulating what team_aliases table provides)
    const libraryAliases: LibraryAliasMap = { brewers: 'MIL', mil: 'MIL', milwaukee: 'MIL' }
    const result = matchBetToGame(bet, [game], libraryAliases)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('g-mlb-1')
  })

  it('matches "MIL" abbreviation via library aliases', () => {
    const bet = makeBet({ description: 'MIL -1.5', sport: 'MLB' })
    const game = makeGameForMatcher()
    const libraryAliases: LibraryAliasMap = { mil: 'MIL', brewers: 'MIL' }
    const result = matchBetToGame(bet, [game], libraryAliases)
    expect(result).not.toBeNull()
    expect(result?.homeTeam).toBe('MIL')
  })

  it('matches "Cardinals -3" MLB via library alias → STL game (not ARI)', () => {
    const mlbGame = makeGameForMatcher({ id: 'g-mlb-2', sport: 'MLB', homeTeam: 'STL', awayTeam: 'CHC' })
    const nflGame: LiveGame = {
      id: 'g-nfl-1', sport: 'NFL',
      homeTeam: 'ARI', awayTeam: 'SF',
      homeName: 'Cardinals', awayName: '49ers',
      homeScore: 0, awayScore: 0, status: 'pre',
      statusDetail: '', startTime: '2026-05-01T20:00:00Z',
      periodScores: [], currentPeriod: null,
    }
    const bet = makeBet({ description: 'Cardinals -3', sport: 'MLB' })
    // MLB library aliases: cardinals → STL
    const libraryAliases: LibraryAliasMap = { cardinals: 'STL', stl: 'STL' }
    // Pass only MLB game → should match STL Cardinals
    const result = matchBetToGame(bet, [mlbGame, nflGame], libraryAliases)
    expect(result?.id).toBe('g-mlb-2')
  })

  it('returns null when library aliases do not match any live game', () => {
    const bet = makeBet({ description: 'Xyzzy Unknown', sport: 'MLB' })
    const game = makeGameForMatcher()
    const libraryAliases: LibraryAliasMap = { brewers: 'MIL' }
    const result = matchBetToGame(bet, [game], libraryAliases)
    // No alias match → falls to fuzzy name → tokens too short/generic → null
    expect(result).toBeNull()
  })

  it('falls back to fuzzy name match when library aliases provided but no alias hit', () => {
    const bet = makeBet({ description: 'Milwaukee Brewers ML', sport: 'MLB' })
    const game = makeGameForMatcher({ homeName: 'Milwaukee Brewers' })
    // Library aliases don't cover "milwaukee brewers" as a key
    const libraryAliases: LibraryAliasMap = { mil: 'MIL' }
    // Should fall through to pass 2 (matchByNames) and find "Milwaukee" token
    const result = matchBetToGame(bet, [game], libraryAliases)
    expect(result).not.toBeNull()
  })

  it('stale-guard drops game that started >1 hour before bet placement', () => {
    const bet = makeBet({
      description: 'Brewers ML',
      sport: 'MLB',
      placed_at: '2026-05-01T22:00:00Z',
    })
    const staleGame = makeGameForMatcher({
      id: 'g-stale',
      startTime: '2026-05-01T18:00:00Z',  // 4 hours before bet → stale
    })
    const freshGame = makeGameForMatcher({
      id: 'g-fresh',
      startTime: '2026-05-01T21:30:00Z',  // 30 min before bet → fresh
    })
    const libraryAliases: LibraryAliasMap = { brewers: 'MIL', mil: 'MIL' }
    const result = matchBetToGame(bet, [staleGame, freshGame], libraryAliases)
    expect(result?.id).toBe('g-fresh')
  })

  it('matchParlayLegs routes each leg through library aliases', () => {
    const brewersGame = makeGameForMatcher({
      id: 'g-brew', homeTeam: 'MIL', awayTeam: 'STL',
    })
    const yanksGame = makeGameForMatcher({
      id: 'g-yanks', homeTeam: 'NYY', awayTeam: 'BOS',
    })
    const bet = makeBet({
      description: 'Brewers ML / Yankees ML',
      sport: 'MLB',
      bet_type: 'parlay',
      parlay_legs: [
        { id: 'l1', bet_id: 'bet-1', description: 'Brewers ML', odds_american: -119, sport: 'MLB', leg_status: 'pending' },
        { id: 'l2', bet_id: 'bet-1', description: 'Yankees ML', odds_american: -130, sport: 'MLB', leg_status: 'pending' },
      ],
    })
    const libraryAliases: LibraryAliasMap = { brewers: 'MIL', mil: 'MIL', yankees: 'NYY', nyy: 'NYY' }
    const results = matchParlayLegs(bet, [brewersGame, yanksGame], libraryAliases)
    expect(results[0]?.id).toBe('g-brew')
    expect(results[1]?.id).toBe('g-yanks')
  })
})

// ---------------------------------------------------------------------------
// findEspnAbbrevs — WNBA
// ---------------------------------------------------------------------------

describe('findEspnAbbrevs — WNBA', () => {
  it('returns CHI for Chicago Sky (3-letter name requires explicit map entry)', () => {
    // 'sky' is 3 chars — dropped by extractNameTokens; MUST be in WNBA_ABBREVS
    expect(findEspnAbbrevs('WNBA Chicago Sky ML', 'WNBA')).toContain('CHI')
  })

  it('returns CON for Connecticut Sun (3-letter name requires explicit map entry)', () => {
    // 'sun' is 3 chars — dropped by extractNameTokens; MUST be in WNBA_ABBREVS
    expect(findEspnAbbrevs('WNBA Connecticut Sun -3.5', 'WNBA')).toContain('CON')
  })

  it('returns LV and NY for Las Vegas Aces vs New York Liberty', () => {
    const abbrevs = findEspnAbbrevs('Las Vegas Aces vs New York Liberty', 'WNBA')
    expect(abbrevs).toContain('LV')
    expect(abbrevs).toContain('NY')
  })

  it('returns DAL for Dallas Wings', () => {
    expect(findEspnAbbrevs('Dallas Wings +4.5', 'WNBA')).toContain('DAL')
  })

  it('returns GS for Golden State Valkyries — WNBA-only key proves real map is used', () => {
    // 'valkyries' -> 'GS' only exists in WNBA_ABBREVS, not NBA_ABBREVS
    expect(findEspnAbbrevs('Golden State Valkyries ML', 'WNBA')).toContain('GS')
  })
})

// ---------------------------------------------------------------------------
// borderlineMargin (D-02 — 10% of line, 0.5 floor)
// ---------------------------------------------------------------------------

describe('borderlineMargin', () => {
  it('returns 10% of the line value for typical totals', () => {
    expect(borderlineMargin(8.5)).toBeCloseTo(0.85, 10)
  })

  it('enforces the 0.5 floor for small line values', () => {
    expect(borderlineMargin(1.5)).toBe(0.5)
  })

  it('scales up for high-variance totals (NBA O220)', () => {
    expect(borderlineMargin(220)).toBe(22)
  })

  it('uses absolute value so negative lines (spread placeholders) still scale', () => {
    expect(borderlineMargin(-10)).toBe(1)
  })

  it('returns floor 0.5 for zero/edge inputs', () => {
    expect(borderlineMargin(0)).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// getOnPaceStatus (D-01 linear projection, D-02 three bands, D-03 15% gate)
// ---------------------------------------------------------------------------

describe('getOnPaceStatus', () => {
  it('returns too_early for elapsedFraction === 0 (pre-game / no elapsed)', () => {
    // D-03 / division-by-zero guard (Pitfall 4)
    expect(getOnPaceStatus(0, 8.5, true, 0, 0.85)).toBe('too_early')
    expect(getOnPaceStatus(3, 8.5, true, 0, 0.85)).toBe('too_early')
  })

  it('returns too_early for elapsedFraction below 0.15 (D-03 suppression)', () => {
    expect(getOnPaceStatus(3, 8.5, true, 0.10, 0.85)).toBe('too_early')
    expect(getOnPaceStatus(3, 8.5, true, 0.14, 0.85)).toBe('too_early')
  })

  it('starts returning a pace band at elapsedFraction = 0.15 (D-03 boundary)', () => {
    // 3 runs / 0.15 = 20 projected, way above O8.5 → on_pace
    const result = getOnPaceStatus(3, 8.5, true, 0.15, 0.85)
    expect(result).not.toBe('too_early')
    expect(result).toBe('on_pace')
  })

  it('reads the motivating example (O8.5 @ 3 runs / elapsed 0.22) as on_pace (D-01)', () => {
    // RESEARCH motivating example: 3 runs in 2nd inning (2/9 ≈ 0.22) for O8.5
    // projected = 3 / 0.22 ≈ 13.6 → projected - line = 5.1 > margin 0.85 → on_pace
    expect(getOnPaceStatus(3, 8.5, true, 0.22, borderlineMargin(8.5))).toBe('on_pace')
  })

  it('returns off_pace when projected total is far below an over line', () => {
    // 0 runs at half-game → projected 0 → diff = -8.5 < -0.85 → off_pace
    expect(getOnPaceStatus(0, 8.5, true, 0.5, 0.85)).toBe('off_pace')
  })

  it('returns borderline when projection lands within the margin of the line', () => {
    // projected = 8.5 (right on the line); margin 0.85; diff = 0 → borderline
    // currentTotal = 4.25, elapsed = 0.5 → projected 8.5
    expect(getOnPaceStatus(4.25, 8.5, true, 0.5, 0.85)).toBe('borderline')
  })

  it('returns on_pace just beyond +margin for an over', () => {
    // projected just over line + margin
    // line 8.5, margin 0.85; project to 9.4 → currentTotal 4.7, elapsed 0.5
    expect(getOnPaceStatus(4.7, 8.5, true, 0.5, 0.85)).toBe('on_pace')
  })

  it('returns off_pace just beyond -margin for an over', () => {
    // project to 7.6 → currentTotal 3.8, elapsed 0.5 → diff = -0.9 < -0.85
    expect(getOnPaceStatus(3.8, 8.5, true, 0.5, 0.85)).toBe('off_pace')
  })

  it('flips diff polarity correctly for under bets (D-01)', () => {
    // Same currentTotal/elapsed (3 @ 0.22 → projected 13.6) but for u8.5:
    // diff = line - projected = 8.5 - 13.6 = -5.1 → off_pace
    expect(getOnPaceStatus(3, 8.5, false, 0.22, 0.85)).toBe('off_pace')
  })

  it('returns on_pace for an under that projects below the line', () => {
    // currentTotal 1 at elapsed 0.5 → projected 2; u8.5 → diff = 6.5 → on_pace
    expect(getOnPaceStatus(1, 8.5, false, 0.5, 0.85)).toBe('on_pace')
  })

  it('never returns Infinity or NaN — the <0.15 guard prevents the divide', () => {
    // Tiny elapsedFraction would otherwise produce ~Infinity
    const result = getOnPaceStatus(3, 8.5, true, 0.001, 0.85)
    expect(result).toBe('too_early')
    // Also negative elapsedFraction guarded
    expect(getOnPaceStatus(3, 8.5, true, -0.5, 0.85)).toBe('too_early')
  })

  it('handles NBA-scale totals (O220) without crashing', () => {
    // current 50 at elapsed 0.25 → projected 200; line 220, margin 22
    // diff = -20 → within margin → borderline
    expect(getOnPaceStatus(50, 220, true, 0.25, borderlineMargin(220))).toBe('borderline')
  })

  it('PaceStatus type is a subset of LiveStatus (witness)', () => {
    // type-shape compile-time witness: a PaceStatus literal must assign to LiveStatus
    const p: PaceStatus = getOnPaceStatus(3, 8.5, true, 0.22, 0.85)
    const ls: LiveStatus = p
    expect(ls).toBe('on_pace')
  })
})

// ---------------------------------------------------------------------------
// getElapsedFraction (D-13 per-sport elapsed, D-10 tennis denominator,
// D-12 -1 sentinel fallback)
// ---------------------------------------------------------------------------

describe('getElapsedFraction', () => {
  it('returns 0 for status=pre regardless of sport (D-03)', () => {
    expect(getElapsedFraction(makeGame({ sport: 'MLB', status: 'pre' }), 'fullgame')).toBe(0)
    expect(getElapsedFraction(makeGame({ sport: 'NBA', status: 'pre' }), 'fullgame')).toBe(0)
    expect(
      getElapsedFraction(
        makeGame({ sport: 'Tennis', status: 'pre' }),
        'fullgame',
      ),
    ).toBe(0)
  })

  it('returns 1 for status=post (game over)', () => {
    expect(getElapsedFraction(makeGame({ sport: 'MLB', status: 'post' }), 'fullgame')).toBe(1)
    expect(getElapsedFraction(makeGame({ sport: 'NBA', status: 'post' }), 'fullgame')).toBe(1)
  })

  it('MLB: 4 completed innings, fullgame bet → 4/9 ≈ 0.44', () => {
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      periodScores: [
        { home: 1, away: 0 },
        { home: 0, away: 0 },
        { home: 2, away: 1 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 5,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBeCloseTo(4 / 9, 6)
  })

  it('MLB: 4 completed innings, F5 bet → 4/5 = 0.8 (Pitfall 7 — sub-period denom)', () => {
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      periodScores: [
        { home: 1, away: 0 },
        { home: 0, away: 0 },
        { home: 2, away: 1 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 5,
    })
    expect(getElapsedFraction(game, 'f5')).toBeCloseTo(0.8, 6)
  })

  it('MLB: 2 completed innings, F3 bet → 2/3 ≈ 0.67', () => {
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      periodScores: [
        { home: 1, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 3,
    })
    expect(getElapsedFraction(game, 'f3')).toBeCloseTo(2 / 3, 6)
  })

  it('MLB: extra innings (10 completed periods) cap at 1.0', () => {
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      periodScores: Array.from({ length: 10 }, () => ({ home: 0, away: 0 })),
      currentPeriod: 11,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(1)
  })

  it('NBA: 2 completed periods → 2/4 = 0.5', () => {
    const game = makeGame({
      sport: 'NBA',
      status: 'in',
      periodScores: [
        { home: 28, away: 24 },
        { home: 30, away: 32 },
      ],
      currentPeriod: 3,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBeCloseTo(0.5, 6)
  })

  it('NHL: 2 completed periods → 2/3 ≈ 0.67', () => {
    const game = makeGame({
      sport: 'NHL',
      status: 'in',
      periodScores: [
        { home: 1, away: 0 },
        { home: 0, away: 1 },
      ],
      currentPeriod: 3,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBeCloseTo(2 / 3, 6)
  })

  it('NFL: 3 completed quarters → 3/4 = 0.75', () => {
    const game = makeGame({
      sport: 'NFL',
      status: 'in',
      periodScores: [
        { home: 7, away: 3 },
        { home: 10, away: 0 },
        { home: 0, away: 14 },
      ],
      currentPeriod: 4,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(0.75)
  })

  it('Soccer: 1 completed half → 1/2 = 0.5', () => {
    const game = makeGame({
      sport: 'Soccer',
      status: 'in',
      periodScores: [{ home: 1, away: 0 }],
      currentPeriod: 2,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(0.5)
  })

  it('NCAAB: bucketed with NBA at /4 denominator per plan (D-13)', () => {
    // Plan action explicitly groups NBA/NCAAB/NFL/NCAAF at /4; the period-bucket
    // approximation is conservative (1 completed half reads as 25% elapsed,
    // below the 15% gate is impossible at this granularity but it stays inside
    // the band logic). RESEARCH Unknown 3 table shows the trade-off.
    const game = makeGame({
      sport: 'NCAAB',
      status: 'in',
      periodScores: [{ home: 32, away: 30 }],
      currentPeriod: 2,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(0.25)
  })

  it('NCAAF: 2 completed quarters → 2/4 = 0.5', () => {
    const game = makeGame({
      sport: 'NCAAF',
      status: 'in',
      periodScores: [
        { home: 7, away: 14 },
        { home: 10, away: 0 },
      ],
      currentPeriod: 3,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(0.5)
  })

  it('Tennis Bo5: 20 total games completed → 20/40 = 0.5 (D-10 Bo5=40)', () => {
    // Sum of all home+away values across periodScores
    // [6+4, 4+6, 0+0, ...] = (6+4)+(4+6) = 20
    const game = makeGame({
      sport: 'Tennis',
      status: 'in',
      periodScores: [
        { home: 6, away: 4 },
        { home: 4, away: 6 },
      ],
      currentPeriod: 3,
      tennisLive: {
        serverId: 'abc',
        serverName: 'L. Sonego',
        formatPeriods: 5,
        tiebreaks: [null, null],
      },
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(0.5)
  })

  it('Tennis Bo3: 11 total games → 11/23 ≈ 0.478 (D-10 Bo3=23)', () => {
    // 6+5 = 11 games across set 1
    const game = makeGame({
      sport: 'Tennis',
      status: 'in',
      periodScores: [{ home: 6, away: 5 }],
      currentPeriod: 1,
      tennisLive: {
        serverId: 'abc',
        serverName: 'L. Sonego',
        formatPeriods: 3,
        tiebreaks: [null],
      },
    })
    expect(getElapsedFraction(game, 'fullgame')).toBeCloseTo(11 / 23, 6)
  })

  it('Tennis: returns -1 sentinel when tennisLive is absent (D-12 fallback)', () => {
    const game = makeGame({
      sport: 'Tennis',
      status: 'in',
      periodScores: [],
      // no tennisLive
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(-1)
  })

  it('Tennis: caps elapsed at 1.0 when game count exceeds expected', () => {
    // 50 total games on Bo3 (max 23) → cap to 1.0
    const game = makeGame({
      sport: 'Tennis',
      status: 'in',
      periodScores: [
        { home: 7, away: 6 },
        { home: 6, away: 7 },
        { home: 13, away: 11 },
      ],
      currentPeriod: 3,
      tennisLive: {
        serverId: 'abc',
        serverName: 'L. Sonego',
        formatPeriods: 3,
        tiebreaks: [null, null, null],
      },
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(1)
  })

  it('unknown sport → -1 sentinel (D-12)', () => {
    const game = makeGame({
      sport: 'Cricket',
      status: 'in',
      periodScores: [{ home: 100, away: 90 }],
      currentPeriod: 1,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(-1)
  })

  it('Golf → -1 sentinel (D-12, leaderboard not clock-based)', () => {
    const game = makeGame({
      sport: 'Golf',
      status: 'in',
      periodScores: [],
      currentPeriod: null,
    })
    expect(getElapsedFraction(game, 'fullgame')).toBe(-1)
  })

  it('never returns NaN or Infinity for any branch', () => {
    const cases: Array<{ game: LiveGame; period: 'fullgame' | 'f5' | 'f3' }> = [
      { game: makeGame({ sport: 'MLB', status: 'in', periodScores: [] }), period: 'fullgame' },
      { game: makeGame({ sport: 'NBA', status: 'in', periodScores: [] }), period: 'fullgame' },
      {
        game: makeGame({
          sport: 'Tennis',
          status: 'in',
          tennisLive: {
            serverId: '',
            serverName: '',
            formatPeriods: 5,
            tiebreaks: [],
          },
          periodScores: [],
        }),
        period: 'fullgame',
      },
    ]
    for (const c of cases) {
      const r = getElapsedFraction(c.game, c.period)
      expect(Number.isFinite(r)).toBe(true)
      expect(Number.isNaN(r)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// getLiveStatus — router (D-05/D-09/D-11/D-12 routing rules + D-07 per-leg)
// ---------------------------------------------------------------------------

describe('getLiveStatus', () => {
  it('returns pregame for status=pre', () => {
    const game = makeGame({ sport: 'MLB', status: 'pre' })
    const parsed = parseBetLine('NYY - BOS o8.5')
    expect(getLiveStatus(parsed, game, 'NYY - BOS o8.5')).toBe('pregame')
  })

  // -- Totals → on-pace path (D-11) ---------------------------------------

  it('routes an over bet with elapsed ≥ 0.15 through getOnPaceStatus → on_pace (D-01)', () => {
    // Motivating example: MLB O8.5 with 3 total runs across 2 completed innings
    // periodScores.length = 2 → elapsed 2/9 ≈ 0.222 ≥ 0.15
    // projected = 3 / 0.222 ≈ 13.5 → on_pace
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      homeScore: 2,
      awayScore: 1,
      periodScores: [
        { home: 1, away: 1 },
        { home: 1, away: 0 },
      ],
      currentPeriod: 3,
    })
    const parsed = parseBetLine('NYY - BOS o8.5')
    expect(getLiveStatus(parsed, game, 'NYY - BOS o8.5')).toBe('on_pace')
  })

  it('routes an under bet with elapsed ≥ 0.15 through getOnPaceStatus → on_pace', () => {
    // 1 run total at elapsed 0.44 (4 innings) → projected ≈ 2.25 → for u8.5 → diff = 6.25 → on_pace
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      homeScore: 1,
      awayScore: 0,
      periodScores: [
        { home: 0, away: 0 },
        { home: 1, away: 0 },
        { home: 0, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 5,
    })
    const parsed = parseBetLine('NYY - BOS u8.5')
    expect(getLiveStatus(parsed, game, 'NYY - BOS u8.5')).toBe('on_pace')
  })

  it('returns off_pace for an over bet with no scoring after the gate threshold', () => {
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      homeScore: 0,
      awayScore: 0,
      periodScores: [
        { home: 0, away: 0 },
        { home: 0, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 4,
    })
    const parsed = parseBetLine('NYY - BOS o8.5')
    expect(getLiveStatus(parsed, game, 'NYY - BOS o8.5')).toBe('off_pace')
  })

  // -- Spreads/ML → getCoverStatus (D-11) ---------------------------------

  it('routes a spread bet through getCoverStatus → covering/behind, not a pace band (D-11)', () => {
    const game = makeGame({
      sport: 'NBA',
      status: 'in',
      homeScore: 60,
      awayScore: 50,
      periodScores: [
        { home: 30, away: 24 },
        { home: 30, away: 26 },
      ],
      currentPeriod: 3,
    })
    const parsed = parseBetLine('LAL Lakers -5')
    const result = getLiveStatus(parsed, game, 'LAL Lakers -5')
    expect(['covering', 'behind', 'push']).toContain(result)
    // Strictly: home (LAL) up by 10, spread -5 → adjustedDiff +5 → covering
    expect(result).toBe('covering')
  })

  it('routes a moneyline bet through getCoverStatus → covering/behind (D-11)', () => {
    const game = makeGame({
      sport: 'NBA',
      status: 'in',
      homeScore: 60,
      awayScore: 50,
      periodScores: [
        { home: 30, away: 24 },
        { home: 30, away: 26 },
      ],
      currentPeriod: 3,
    })
    const parsed = parseBetLine('LAL Lakers ML')
    const result = getLiveStatus(parsed, game, 'LAL Lakers ML')
    expect(result).toBe('covering')
  })

  // -- Clinch (D-05) ------------------------------------------------------

  it('returns final_won when status=post and segment complete with covering over (D-05)', () => {
    const game = makeGame({
      sport: 'NBA',
      status: 'post',
      homeScore: 120,
      awayScore: 115,
      periodScores: [],
      currentPeriod: 4,
    })
    const parsed = parseBetLine('LAL - BOS o220.5')
    expect(getLiveStatus(parsed, game, 'LAL - BOS o220.5')).toBe('final_won')
  })

  it('returns final_lost when status=post and total under an over line', () => {
    const game = makeGame({
      sport: 'NBA',
      status: 'post',
      homeScore: 100,
      awayScore: 105,
      periodScores: [],
      currentPeriod: 4,
    })
    const parsed = parseBetLine('LAL - BOS o220.5')
    expect(getLiveStatus(parsed, game, 'LAL - BOS o220.5')).toBe('final_lost')
  })

  it('returns final_push when total exactly equals the line', () => {
    const game = makeGame({
      sport: 'NBA',
      status: 'post',
      homeScore: 110,
      awayScore: 110,
      periodScores: [],
      currentPeriod: 4,
    })
    const parsed = parseBetLine('LAL - BOS o220')
    expect(getLiveStatus(parsed, game, 'LAL - BOS o220')).toBe('final_push')
  })

  // -- D-12 fallback (-1 elapsed sentinel) --------------------------------

  it('falls back to getCoverStatus for totals when getElapsedFraction returns -1 (D-12)', () => {
    // Tennis total with no tennisLive → getElapsedFraction returns -1
    // → must delegate to getCoverStatus (not a pace band)
    const game = makeGame({
      sport: 'Tennis',
      status: 'in',
      homeName: 'Sinner',
      awayName: 'Alcaraz',
      homeScore: 0,
      awayScore: 0,
      periodScores: [
        { home: 6, away: 4 },
        { home: 4, away: 6 },
      ],
      currentPeriod: 3,
      // tennisLive intentionally absent
    })
    const parsed = parseBetLine('Sinner - Alcaraz o22.5')
    const result = getLiveStatus(parsed, game, 'Sinner - Alcaraz o22.5')
    // getCoverStatus reads total = 6+4+4+6 = 20 < 22.5 → behind
    expect(['covering', 'behind', 'push']).toContain(result)
    expect(result).toBe('behind')
  })

  it('falls back to getCoverStatus for totals on unknown sport (D-12)', () => {
    // Unknown sport → elapsed = -1 → fallback to cover status
    const game = makeGame({
      sport: 'Cricket',
      status: 'in',
      homeScore: 100,
      awayScore: 90,
      periodScores: [{ home: 100, away: 90 }],
      currentPeriod: 1,
    })
    const parsed = parseBetLine('TeamA - TeamB o200.5')
    const result = getLiveStatus(parsed, game, 'TeamA - TeamB o200.5')
    // getCoverStatus reads fullgame total = 100+90 = 190 < 200.5 → behind
    expect(['covering', 'behind', 'push']).toContain(result)
  })

  // -- Sub-period elapsed denominator (D-13 Pitfall 7) ---------------------

  it('F5 bet passes parsedLine.period to getElapsedFraction (Pitfall 7 — denominator wiring)', () => {
    // The F5 path uses getSegmentScore('f5', game) which requires all 5 innings
    // of linescore data to flip hasData=true. Until then, getLiveStatus returns
    // 'pregame'. Once F5 is complete, predictBetOutcome triggers clinched_*/final_*.
    // So an F5 bet never lands in the pace bands directly — but the wiring is
    // still verified by getElapsedFraction's own test ('f5' → /5 denominator),
    // and we assert here that an in-progress F5 (4 innings done) is pregame,
    // NOT a fullgame-elapsed pace band.
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      homeScore: 0,
      awayScore: 0,
      periodScores: [
        { home: 0, away: 0 },
        { home: 0, away: 0 },
        { home: 0, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 5,
    })
    const parsed = parseBetLine('NYY o4.5 (F5)')
    expect(parsed.period).toBe('f5')
    // F5 incomplete (need 5 innings; have 4) → seg.hasData = false → 'pregame'.
    // If we'd (incorrectly) routed via 'fullgame', this would read off_pace
    // (4 innings of 0 runs → elapsed 0.44 → projected 0 → off_pace), so the
    // pregame outcome proves period is being honored, not silently treated as
    // fullgame.
    expect(getLiveStatus(parsed, game, 'NYY o4.5 (F5)')).toBe('pregame')
  })

  it('F5 complete (5 innings done) routes to clinched/final via predictBetOutcome (D-05)', () => {
    // Once F5 has all 5 innings, seg.complete = true → predictBetOutcome
    // returns a settlement → maps to clinched_won/lost (game still in
    // progress) or final_* (game over).
    const game = makeGame({
      sport: 'MLB',
      status: 'in',
      homeScore: 5,
      awayScore: 1,
      periodScores: [
        { home: 1, away: 1 },
        { home: 2, away: 0 },
        { home: 1, away: 0 },
        { home: 1, away: 0 },
        { home: 0, away: 0 },
      ],
      currentPeriod: 6,
    })
    const parsed = parseBetLine('NYY o4.5 (F5)')
    // F5 total = 6 runs > 4.5 → clinched_won
    expect(getLiveStatus(parsed, game, 'NYY o4.5 (F5)')).toBe('clinched_won')
  })

  // -- Tennis market scope (D-09) -----------------------------------------

  it('tennis total games over → on-pace projection path (D-09)', () => {
    // Bo3 with 18 total games → elapsed 18/23 ≈ 0.78
    // projected = 18/0.78 ≈ 23.1; vs o22.5 → diff ≈ 0.6; margin = 2.25 → borderline
    const game = makeGame({
      sport: 'Tennis',
      status: 'in',
      homeName: 'Sinner',
      awayName: 'Alcaraz',
      homeScore: 0,
      awayScore: 0,
      periodScores: [
        { home: 6, away: 4 },
        { home: 4, away: 4 },
      ],
      currentPeriod: 2,
      tennisLive: {
        serverId: 'a1',
        serverName: 'Sinner',
        formatPeriods: 3,
        tiebreaks: [null, null],
      },
    })
    const parsed = parseBetLine('Sinner - Alcaraz o22.5')
    const result = getLiveStatus(parsed, game, 'Sinner - Alcaraz o22.5')
    // result must be in the pace-band family, not covering/behind
    expect(['on_pace', 'borderline', 'off_pace', 'too_early']).toContain(result)
  })

  it('tennis spread (set/game handicap) routes to getCoverStatus → covering/behind (D-09)', () => {
    // tennis spread → never goes through the pace engine; spread→getCoverStatus
    // ESPN tennis homeScore/awayScore are 0 (no aggregate score field for tennis),
    // so the cover read reflects that baseline (D-09: tennis on-pace not given for spread).
    const game = makeGame({
      sport: 'Tennis',
      status: 'in',
      homeName: 'Sinner',
      awayName: 'Alcaraz',
      homeScore: 0,
      awayScore: 0,
      periodScores: [
        { home: 6, away: 4 },
        { home: 4, away: 6 },
      ],
      currentPeriod: 3,
      tennisLive: {
        serverId: 'a1',
        serverName: 'Sinner',
        formatPeriods: 3,
        tiebreaks: [null, null],
      },
    })
    const parsed = parseBetLine('Sinner -3')
    expect(parsed.lineType).toBe('spread')
    const result = getLiveStatus(parsed, game, 'Sinner -3')
    expect(['covering', 'behind', 'push']).toContain(result)
  })

  // -- D-07 per-leg parlay --------------------------------------------------

  it('per-leg: two legs of the same parlay return INDEPENDENT LiveStatus values (D-07)', () => {
    // Leg 1: MLB O8.5 at 3 runs / 2 innings → on_pace
    const mlbGame = makeGame({
      sport: 'MLB',
      status: 'in',
      homeScore: 2,
      awayScore: 1,
      periodScores: [
        { home: 1, away: 1 },
        { home: 1, away: 0 },
      ],
      currentPeriod: 3,
    })
    const mlbParsed = parseBetLine('NYY - BOS o8.5')
    const leg1 = getLiveStatus(mlbParsed, mlbGame, 'NYY - BOS o8.5')

    // Leg 2: NBA -5 spread, home up by 10 → covering
    const nbaGame = makeGame({
      sport: 'NBA',
      status: 'in',
      homeScore: 60,
      awayScore: 50,
      periodScores: [
        { home: 30, away: 24 },
        { home: 30, away: 26 },
      ],
      currentPeriod: 3,
    })
    const nbaParsed = parseBetLine('LAL Lakers -5')
    const leg2 = getLiveStatus(nbaParsed, nbaGame, 'LAL Lakers -5')

    // Two legs → two distinct LiveStatus values; no aggregate function exists.
    expect(leg1).toBe('on_pace')
    expect(leg2).toBe('covering')
    expect(leg1).not.toBe(leg2)
  })

  // -- LiveStatus return type witness --------------------------------------

  it('returns a value assignable to LiveStatus (compile-time witness)', () => {
    const game = makeGame({ sport: 'MLB', status: 'pre' })
    const parsed = parseBetLine('NYY - BOS o8.5')
    const result: LiveStatus = getLiveStatus(parsed, game, 'NYY - BOS o8.5')
    expect(result).toBe('pregame')
  })
})
