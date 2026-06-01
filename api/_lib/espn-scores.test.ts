import { describe, it, expect } from 'vitest'
import { parseScoreboard, finalTypeFor } from './espn-scores.js'

const final = (name: string) => ({ type: { name: 'STATUS_FINAL', state: 'post', completed: true, shortDetail: name } })

const SAMPLE = {
  events: [
    {
      id: '401', date: '2026-05-20T23:00Z',
      competitions: [{
        status: final('Final/10'),
        competitors: [
          { homeAway: 'home', score: '5', team: { abbreviation: 'KC', shortDisplayName: 'Royals' } },
          { homeAway: 'away', score: '3', team: { abbreviation: 'BOS', shortDisplayName: 'Red Sox' } },
        ],
      }],
    },
    {
      id: '402', date: '2026-05-20T23:30Z',
      competitions: [{
        // in progress (incl. games still in OT) — completed:false → must be excluded
        status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, shortDetail: 'Bot 7th' } },
        competitors: [
          { homeAway: 'home', score: '2', team: { abbreviation: 'NYM', shortDisplayName: 'Mets' } },
          { homeAway: 'away', score: '1', team: { abbreviation: 'WSH', shortDisplayName: 'Nationals' } },
        ],
      }],
    },
  ],
}

describe('parseScoreboard', () => {
  it('returns only completed games (OT-aware) with extracted fields', () => {
    const games = parseScoreboard(SAMPLE, 'MLB')
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({
      espnId: '401', homeAbbrev: 'KC', homeName: 'Royals',
      awayAbbrev: 'BOS', awayName: 'Red Sox', homeScore: 5, awayScore: 3,
      finalType: 'extra_innings',
    })
  })

  it('excludes in-progress games even if scores are present', () => {
    const ids = parseScoreboard(SAMPLE, 'MLB').map((g) => g.espnId)
    expect(ids).not.toContain('402')
  })

  it('returns [] for empty/malformed payloads', () => {
    expect(parseScoreboard({})).toEqual([])
    expect(parseScoreboard({ events: [] })).toEqual([])
  })
})

describe('finalTypeFor', () => {
  it('classifies sport-specific final variants', () => {
    expect(finalTypeFor('MLB', 'Final/10')).toBe('extra_innings')
    expect(finalTypeFor('MLB', 'Final')).toBe('regulation')
    expect(finalTypeFor('NHL', 'Final/OT')).toBe('overtime')
    expect(finalTypeFor('NHL', 'Final/SO')).toBe('shootout')
    expect(finalTypeFor('NBA', 'Final/OT')).toBe('overtime')
    expect(finalTypeFor('NFL', 'Final')).toBe('regulation')
  })
})
