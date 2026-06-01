import { describe, it, expect } from 'vitest'
import { parseGolfBet, matchPlayer } from './golf-matcher'
import type { GolfPlayer, GolfTournament } from '@/hooks/use-live-golf'

// ---------------------------------------------------------------------------
// parseGolfBet
// ---------------------------------------------------------------------------

describe('parseGolfBet', () => {
  it('parses outright winner bets', () => {
    expect(parseGolfBet('To Win Outright Cameron Young')).toEqual({
      kind: 'outright',
      topN: null,
      playerNames: ['Cameron Young'],
    })
  })

  it('parses Top 5 finish bets', () => {
    expect(parseGolfBet('Top 5 Finishing Scottie Scheffler')).toEqual({
      kind: 'topN',
      topN: 5,
      playerNames: ['Scottie Scheffler'],
    })
  })

  it('parses Top 20 finish bets', () => {
    expect(parseGolfBet('Top 20 Finishing Si Woo Kim')).toEqual({
      kind: 'topN',
      topN: 20,
      playerNames: ['Si Woo Kim'],
    })
  })

  it('treats player + ML as outright', () => {
    expect(parseGolfBet('Justin Thomas ML')).toEqual({
      kind: 'outright',
      topN: null,
      playerNames: ['Justin Thomas'],
    })
  })

  it('parses combined player outright with slash', () => {
    expect(parseGolfBet('To Win Outright Chad Ramey/Justin Lower')).toEqual({
      kind: 'outright',
      topN: null,
      playerNames: ['Chad Ramey', 'Justin Lower'],
    })
  })

  it('handles unicode names like Højgaard', () => {
    expect(parseGolfBet('To Win Outright Nicolai Højgaard')).toEqual({
      kind: 'outright',
      topN: null,
      playerNames: ['Nicolai Højgaard'],
    })
  })
})

// ---------------------------------------------------------------------------
// matchPlayer
// ---------------------------------------------------------------------------

function makePlayer(name: string, shortName = ''): GolfPlayer {
  return {
    athleteId: name,
    name,
    shortName: shortName || name,
    position: 1,
    positionLabel: '1',
    scoreToPar: '-5',
    thru: 'F',
    round: 4,
    status: 'in',
    isCut: false,
  }
}

function makeTournament(players: GolfPlayer[]): GolfTournament {
  return {
    id: 'tournament-1',
    name: 'Test Tournament',
    shortName: 'Test',
    startDate: '2026-04-30T00:00:00Z',
    status: 'in',
    statusDetail: 'Round 4',
    players,
  }
}

describe('matchPlayer', () => {
  it('matches full name', () => {
    const t = makeTournament([
      makePlayer('Scottie Scheffler', 'S. Scheffler'),
      makePlayer('Rory McIlroy', 'R. McIlroy'),
    ])
    const result = matchPlayer('Scottie Scheffler', [t])
    expect(result?.player.name).toBe('Scottie Scheffler')
  })

  it('matches last name only', () => {
    const t = makeTournament([
      makePlayer('Scottie Scheffler', 'S. Scheffler'),
    ])
    const result = matchPlayer('Scheffler', [t])
    expect(result?.player.name).toBe('Scottie Scheffler')
  })

  it('matches diacritics-stripped name', () => {
    const t = makeTournament([
      makePlayer('Nicolai Højgaard'),
    ])
    const result = matchPlayer('Nicolai Højgaard', [t])
    expect(result?.player.name).toBe('Nicolai Højgaard')
  })

  it('returns null when player not in field', () => {
    const t = makeTournament([
      makePlayer('Scottie Scheffler'),
    ])
    expect(matchPlayer('Tiger Woods', [t])).toBeNull()
  })
})
