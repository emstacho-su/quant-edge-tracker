import { describe, it, expect } from 'vitest'
import { parseBet } from './parse-bet.js'

describe('parseBet totals', () => {
  it('full-game total is now supported', () => {
    const r = parseBet('NY Mets - WAS Nationals o9.5', false)
    expect(r).toMatchObject({ market: 'total', selection: 'over', line: 9.5, supported: true })
  })
})

describe('parseBet team totals', () => {
  it('"<TEAM> Team Total o<line>" → team_total + team, supported', () => {
    expect(parseBet('DET Pistons Team Total o105', false)).toMatchObject(
      { market: 'team_total', selection: 'over', team: 'DET Pistons', line: 105, supported: true })
  })
  it('half-point + under', () => {
    expect(parseBet('SEA Mariners Team Total u4.5', false)).toMatchObject(
      { market: 'team_total', selection: 'under', team: 'SEA Mariners', line: 4.5, supported: true })
  })
  it('TT shorthand still works', () => {
    expect(parseBet('LAL TT u220.5', false)).toMatchObject(
      { market: 'team_total', selection: 'under', team: 'LAL', line: 220.5, supported: true })
  })
  it('period team total (1st5) is unsupported', () => {
    expect(parseBet('BOS Red Sox Team Total u1.5 (1st5)', false)).toMatchObject(
      { market: 'team_total', selection: 'under', supported: false })
  })
  it('does NOT mis-parse as a game total', () => {
    expect(parseBet('OKC Thunder Team Total o113', false).market).toBe('team_total')
  })
})

describe('parseBet soccer draw', () => {
  it('Draw (TeamA vs TeamB) ML → moneyline/Draw, supported', () => {
    const r = parseBet('Draw (Lens vs Lyon) ML', false)
    expect(r).toMatchObject({ market: 'moneyline', selection: 'Draw', supported: true })
  })
  it('plain team ML still parses', () => {
    expect(parseBet('Real Betis ML', false)).toMatchObject({ market: 'moneyline', selection: 'Real Betis', supported: true })
  })
  it('tennis player ML still parses', () => {
    expect(parseBet('Leylah Annie Fernandez ML', false)).toMatchObject({ market: 'moneyline', selection: 'Leylah Annie Fernandez', supported: true })
  })
  it('Draw No Bet is NOT treated as a 3-way Draw', () => {
    expect(parseBet('Draw No Bet Lyon ML', false).selection).not.toBe('Draw')
  })
})

describe('parseBet golf outright', () => {
  it('"To Win Outright <golfer>" → outright/golfer, supported', () => {
    expect(parseBet('To Win Outright Xander Schauffele', false)).toMatchObject(
      { market: 'outright', selection: 'Xander Schauffele', supported: true })
  })
  it('handles a period-less plain outright', () => {
    expect(parseBet('To Win Outright Cameron Young', false)).toMatchObject(
      { market: 'outright', selection: 'Cameron Young', supported: true })
  })
  it('Top-N finishing is NOT an outright', () => {
    expect(parseBet('Top 5 Finishing Scottie Scheffler', false).market).not.toBe('outright')
  })
  it('plain team ML still parses (regression)', () => {
    expect(parseBet('Real Betis ML', false)).toMatchObject({ market: 'moneyline', selection: 'Real Betis' })
  })
})
