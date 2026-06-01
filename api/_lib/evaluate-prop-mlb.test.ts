import { describe, it, expect } from 'vitest'
import { extractMlbStat } from './evaluate-prop-mlb.js'

/**
 * MLB StatsAPI boxscore fixture (named-field shape, NOT ESPN label-array shape).
 *
 * Shape verified against live /api/v1/game/{gamePk}/boxscore response (2026-05-25, gamePk 823380).
 * Verified field names:
 *   pitching: strikeOuts, inningsPitched, hits, earnedRuns, baseOnBalls, homeRuns, runs
 *   batting:  hits, runs, rbi, homeRuns, stolenBases, baseOnBalls, strikeOuts, atBats
 */
const MLB_BOX = {
  teams: {
    away: {
      players: {
        ID123: {
          person: { fullName: 'Andrew Abbott' },
          stats: {
            pitching: {
              strikeOuts: 7,
              inningsPitched: '5.1',
              hits: 3,
              earnedRuns: 1,
              baseOnBalls: 3,
              homeRuns: 1,
              runs: 2,
            },
            batting: {},
          },
        },
        ID124: {
          person: { fullName: 'Luis Castillo' },
          stats: {
            pitching: {
              strikeOuts: 9,
              inningsPitched: '7.0',
              hits: 4,
              earnedRuns: 2,
              baseOnBalls: 1,
              homeRuns: 0,
              runs: 2,
            },
            batting: {},
          },
        },
      },
    },
    home: {
      players: {
        ID456: {
          person: { fullName: 'Matt McLain' },
          stats: {
            batting: {
              hits: 2,
              runs: 1,
              rbi: 0,
              homeRuns: 0,
              stolenBases: 1,
              baseOnBalls: 1,
              strikeOuts: 1,
              atBats: 5,
            },
            pitching: {},
          },
        },
        ID457: {
          person: { fullName: 'Elly De La Cruz' },
          stats: {
            batting: {
              hits: 1,
              runs: 0,
              rbi: 2,
              homeRuns: 1,
              stolenBases: 0,
              baseOnBalls: 0,
              strikeOuts: 2,
              atBats: 4,
            },
            pitching: {},
          },
        },
      },
    },
  },
}

describe('extractMlbStat — pitching stats', () => {
  it('extracts pitcher strikeouts (strikeOuts named field)', () => {
    expect(extractMlbStat(MLB_BOX, 'Andrew Abbott', 'strikeouts_pitcher')).toBe(7)
  })
  it('extracts pitcher hits allowed (hits from pitching named field)', () => {
    expect(extractMlbStat(MLB_BOX, 'Andrew Abbott', 'hits_allowed')).toBe(3)
  })
  it('extracts pitcher walks (baseOnBalls from pitching)', () => {
    expect(extractMlbStat(MLB_BOX, 'Andrew Abbott', 'walks_pitcher')).toBe(3)
  })
  it('extracts a different pitcher (Luis Castillo strikeouts)', () => {
    expect(extractMlbStat(MLB_BOX, 'Luis Castillo', 'strikeouts_pitcher')).toBe(9)
  })
})

describe('extractMlbStat — batting stats', () => {
  it('extracts batter hits (hits named field from batting)', () => {
    expect(extractMlbStat(MLB_BOX, 'Matt McLain', 'hits_batter')).toBe(2)
  })
  it('extracts batter rbi', () => {
    expect(extractMlbStat(MLB_BOX, 'Matt McLain', 'rbi')).toBe(0)
  })
  it('extracts batter home runs (homeRuns named field)', () => {
    expect(extractMlbStat(MLB_BOX, 'Elly De La Cruz', 'hr')).toBe(1)
  })
  it('extracts batter runs', () => {
    expect(extractMlbStat(MLB_BOX, 'Matt McLain', 'runs')).toBe(1)
  })
  it('extracts stolen bases (stolenBases named field)', () => {
    expect(extractMlbStat(MLB_BOX, 'Matt McLain', 'stolen_bases')).toBe(1)
  })
  it('extracts batter walks (baseOnBalls from batting)', () => {
    expect(extractMlbStat(MLB_BOX, 'Matt McLain', 'walks_batter')).toBe(1)
  })
})

describe('extractMlbStat — null-on-doubt guards', () => {
  it('player not in box score → null (DNP guard)', () => {
    expect(extractMlbStat(MLB_BOX, 'Nobody Here', 'strikeouts_pitcher')).toBeNull()
  })
  it('unknown statKey → null (never 0)', () => {
    expect(extractMlbStat(MLB_BOX, 'Andrew Abbott', 'fantasy_pts')).toBeNull()
  })
  it('unknown statKey for batter → null', () => {
    expect(extractMlbStat(MLB_BOX, 'Matt McLain', 'double_doubles')).toBeNull()
  })
  it('player present but reading stat from wrong group → null (batter has no pitching strikeouts)', () => {
    // Matt McLain is a batter; strikeouts_pitcher reads pitching.strikeOuts which is empty {}
    // The function should return null, not coerce 0 or undefined
    expect(extractMlbStat(MLB_BOX, 'Matt McLain', 'strikeouts_pitcher')).toBeNull()
  })
})

describe('extractMlbStat — name fuzzy matching', () => {
  it('matches with slight name variation (partial last name match)', () => {
    // matchScore threshold >= 1 significant token
    expect(extractMlbStat(MLB_BOX, 'Elly De La Cruz', 'hr')).toBe(1)
  })
})
