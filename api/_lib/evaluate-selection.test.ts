import { describe, it, expect } from 'vitest'
import { evaluateSelection, selectionGameScore, type FinalGame } from './evaluate-selection.js'

const G: FinalGame = {
  homeAbbrev: 'KC', homeName: 'Royals',
  awayAbbrev: 'BOS', awayName: 'Red Sox',
  homeScore: 5, awayScore: 3,
}

describe('evaluateSelection', () => {
  it('ML win', () => expect(evaluateSelection({ market: 'moneyline', selection: 'KC Royals', line: null }, G)).toBe('won'))
  it('ML loss', () => expect(evaluateSelection({ market: 'moneyline', selection: 'Red Sox', line: null }, G)).toBe('lost'))
  it('ML push on tie', () => expect(evaluateSelection({ market: 'moneyline', selection: 'KC', line: null }, { ...G, awayScore: 5 })).toBe('push'))
  it('spread cover', () => expect(evaluateSelection({ market: 'spread', selection: 'KC', line: -1.5 }, G)).toBe('won'))
  it('spread loss', () => expect(evaluateSelection({ market: 'spread', selection: 'KC', line: -2.5 }, G)).toBe('lost'))
  it('spread push', () => expect(evaluateSelection({ market: 'spread', selection: 'BOS', line: 2 }, G)).toBe('push'))
  it('total over', () => expect(evaluateSelection({ market: 'total', selection: 'over', line: 7.5 }, G)).toBe('won'))
  it('total under', () => expect(evaluateSelection({ market: 'total', selection: 'under', line: 7.5 }, G)).toBe('lost'))
  it('total push', () => expect(evaluateSelection({ market: 'total', selection: 'over', line: 8 }, G)).toBe('push'))
  it('unresolvable side → null', () => expect(evaluateSelection({ market: 'moneyline', selection: 'Lakers', line: null }, G)).toBeNull())
  it('team_total deferred → null', () => expect(evaluateSelection({ market: 'team_total', selection: 'KC', line: 4.5 }, G)).toBeNull())
})

describe('selectionGameScore', () => {
  it('scores an exact-abbrev or name match high, a non-match zero', () => {
    expect(selectionGameScore('KC Royals', G)).toBeGreaterThan(0)
    expect(selectionGameScore('Red Sox', G)).toBeGreaterThan(0)
    expect(selectionGameScore('Lakers', G)).toBe(0)
  })
})
