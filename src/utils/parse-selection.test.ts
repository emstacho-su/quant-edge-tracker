import { describe, it, expect } from 'vitest'
import { parseSelection } from './parse-selection'

describe('parseSelection', () => {
  it('parses moneyline', () => {
    expect(parseSelection('KC Royals ML')).toMatchObject({
      market: 'moneyline', selection: 'KC Royals', line: null,
    })
  })
  it('parses spread with ½', () => {
    expect(parseSelection('COL Avalanche -1½')).toMatchObject({
      market: 'spread', selection: 'COL Avalanche', line: -1.5,
    })
  })
  it('parses total over, dropping a trailing matchup hint', () => {
    expect(parseSelection('NY Mets - WAS Nationals o9½')).toMatchObject({
      market: 'total', selection: 'over', line: 9.5,
    })
  })
  it('returns null market for unrecognized text', () => {
    expect(parseSelection('some weird text').market).toBeNull()
  })
})
