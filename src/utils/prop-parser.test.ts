import { describe, it, expect } from 'vitest'
import { parseProp, isPropDescription } from './prop-parser'

describe('parseProp', () => {
  it('parses NBA Over points', () => {
    expect(parseProp('Paul George (PHI) Over 16.5 Points')).toEqual({
      playerName: 'Paul George',
      teamAbbrev: 'PHI',
      comparator: 'over',
      value: 16.5,
      stat: 'points',
      statLabel: 'Points',
    })
  })

  it('parses NBA Under points', () => {
    expect(parseProp('Brandon Ingram (TOR) Over 21.5 Points')).toEqual({
      playerName: 'Brandon Ingram',
      teamAbbrev: 'TOR',
      comparator: 'over',
      value: 21.5,
      stat: 'points',
      statLabel: 'Points',
    })
  })

  it('parses player names with suffixes', () => {
    expect(parseProp('Robert Williams III (POR) Over 7.5 Points')).toMatchObject({
      playerName: 'Robert Williams III',
      teamAbbrev: 'POR',
    })
    expect(parseProp('Jabari Smith Jr. (HOU) Over 15.5 Points')).toMatchObject({
      playerName: 'Jabari Smith Jr.',
      teamAbbrev: 'HOU',
    })
  })

  it('parses hyphenated names', () => {
    expect(parseProp('Collin Murray-Boyles (TOR) Over 12.5 Points')).toMatchObject({
      playerName: 'Collin Murray-Boyles',
    })
  })

  it('parses NHL shots on goal', () => {
    expect(parseProp('Matt Boldy (MIN) Over 3.5 Shots on goal')).toEqual({
      playerName: 'Matt Boldy',
      teamAbbrev: 'MIN',
      comparator: 'over',
      value: 3.5,
      stat: 'sog',
      statLabel: 'Shots on goal',
    })
  })

  it('parses NHL Under SOG', () => {
    expect(parseProp('Clayton Keller (UTA) Under 2.5 Shots on goal')).toMatchObject({
      comparator: 'under',
      value: 2.5,
      stat: 'sog',
    })
  })

  it('parses NHL points (G+A)', () => {
    expect(parseProp('Jackson LaCombe (ANA) Over 0.5 Points')).toEqual({
      playerName: 'Jackson LaCombe',
      teamAbbrev: 'ANA',
      comparator: 'over',
      value: 0.5,
      stat: 'points',
      statLabel: 'Points',
    })
  })

  it('parses N+ alternate format', () => {
    expect(parseProp('Jordan Clarkson (NY) 6+ Points')).toEqual({
      playerName: 'Jordan Clarkson',
      teamAbbrev: 'NY',
      comparator: 'plus',
      value: 6,
      stat: 'points',
      statLabel: 'Points',
    })
  })

  it('parses combo stats', () => {
    expect(parseProp('LeBron James (LAL) Over 35.5 PRA')?.stat).toBe('pra')
    expect(parseProp('LeBron James (LAL) Over 25.5 Pts+Ast')?.stat).toBe('pts_ast')
    expect(parseProp('LeBron James (LAL) Over 18.5 Pts+Reb')?.stat).toBe('pts_reb')
  })

  it('parses 3-letter team abbrevs and 4-letter for soccer-ish', () => {
    expect(parseProp('Paul George (PHX) Over 16.5 Points')?.teamAbbrev).toBe('PHX')
    expect(parseProp('Paul George (UTAH) Over 16.5 Points')?.teamAbbrev).toBe('UTAH')
  })

  it('returns null for non-prop descriptions', () => {
    expect(parseProp('PHX Suns -13')).toBeNull()
    expect(parseProp('KC Royals ML')).toBeNull()
    expect(parseProp('TOR - MEM o233.5')).toBeNull()
    expect(parseProp('ORL Magic +5 (1H)')).toBeNull()
  })

  it('returns null for unknown stat', () => {
    expect(parseProp('Paul George (PHI) Over 5.5 Bananas')).toBeNull()
  })

  it('parses o/u shorthand comparator', () => {
    expect(parseProp('Jason Alexander (LAD) o3.5 Strikeouts')).toMatchObject({
      playerName: 'Jason Alexander',
      teamAbbrev: 'LAD',
      comparator: 'over',
      value: 3.5,
      stat: 'strikeouts_pitcher',
    })
    expect(parseProp('Jason Alexander (LAD) u3.5 Strikeouts')).toMatchObject({
      comparator: 'under',
      value: 3.5,
    })
  })

  it('parses without (TEAM) annotation when player name has 2+ words', () => {
    expect(parseProp('Jason Alexander o3.5 Strikeouts')).toMatchObject({
      playerName: 'Jason Alexander',
      teamAbbrev: null,
      comparator: 'over',
      value: 3.5,
      stat: 'strikeouts_pitcher',
    })
    expect(parseProp("De'Aaron Fox 4+ Rebounds")).toMatchObject({
      playerName: "De'Aaron Fox",
      teamAbbrev: null,
      comparator: 'plus',
      value: 4,
      stat: 'rebounds',
    })
  })

  it('accepts trailing bet-type tokens (greedy stat prefix)', () => {
    expect(parseProp("De'Aaron Fox 4+ Rebounds Single")).toMatchObject({
      playerName: "De'Aaron Fox",
      stat: 'rebounds',
    })
    expect(parseProp('Paul George (PHI) Over 16.5 Points Parlay')).toMatchObject({
      stat: 'points',
    })
  })

  it('rejects team-name only props (single-word player) in no-team variant', () => {
    expect(parseProp('Yankees Over 5.5 Runs')).toBeNull()
    expect(parseProp('Lakers 4+ Points')).toBeNull()
  })
})

describe('isPropDescription', () => {
  it('detects prop bets', () => {
    expect(isPropDescription('Paul George (PHI) Over 16.5 Points')).toBe(true)
    expect(isPropDescription('Matt Boldy (MIN) Over 3.5 Shots on goal')).toBe(true)
    expect(isPropDescription('Jordan Clarkson (NY) 6+ Points')).toBe(true)
  })

  it('rejects team-line bets', () => {
    expect(isPropDescription('PHX Suns -13')).toBe(false)
    expect(isPropDescription('NY Rangers - TB Lightning o1.5 (1P)')).toBe(false)
    expect(isPropDescription('ORL Magic +5 (1H)')).toBe(false)
  })
})
