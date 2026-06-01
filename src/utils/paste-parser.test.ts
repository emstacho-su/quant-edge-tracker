import { describe, it, expect } from 'vitest'
import { parsePaste } from './paste-parser'

describe('parsePaste', () => {
  it('returns empty array for empty input', () => {
    expect(parsePaste('')).toEqual([])
    expect(parsePaste('   ')).toEqual([])
  })

  it('skips the GameRisk / Win header line', () => {
    const input = [
      'GameRisk / Win',
      '21.00 / 19.74',
      'Will there be a score in 1st Inning - NO (MIN @ KC) -106',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(1)
    expect(result[0].stake).toBe(21)
    expect(result[0].to_win).toBe(19.74)
  })

  it('skips header with varied spacing (Game Risk / Win)', () => {
    const input = [
      'Game Risk / Win',
      '10.00 / 8.50',
      'Some bet -110',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(1)
  })

  it('parses a single straight bet', () => {
    const input = [
      '21.00 / 19.74',
      'Will there be a score in 1st Inning - NO (MIN @ KC) -106',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      stake: 21,
      to_win: 19.74,
      bet_type: 'single',
      odds_american: -106,
      is_freeplay: false,
    })
    expect(result[0].description).toBe(
      'Will there be a score in 1st Inning - NO (MIN @ KC)'
    )
  })

  it('parses multiple consecutive bets without blank lines', () => {
    const input = [
      '21.00 / 19.74',
      'Will there be a score in 1st Inning - NO (MIN @ KC) -106',
      '35.00 / 31.82',
      'PHX Suns -13 -110',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(2)
    expect(result[0].stake).toBe(21)
    expect(result[1].stake).toBe(35)
    expect(result[1].odds_american).toBe(-110)
  })

  it('extracts odds when description ends with a period/half tag', () => {
    const cases = [
      { input: 'SJ Sharks - CHI Black Hawks o1½ -145 (1P)', odds: -145, desc: 'SJ Sharks - CHI Black Hawks o1½ (1P)' },
      { input: 'PHI Phillies -½ -130 (1st5)', odds: -130, desc: 'PHI Phillies -½ (1st5)' },
      { input: 'Michigan - Connecticut u69 -110 (1H)', odds: -110, desc: 'Michigan - Connecticut u69 (1H)' },
      { input: 'Chelsea - Manchester City o2 -121 Live', odds: -121, desc: 'Chelsea - Manchester City o2 Live' },
      { input: 'Michigan -8 +102(Sell 1)', odds: 102, desc: 'Michigan -8 (Sell 1)' },
    ]
    for (const c of cases) {
      const result = parsePaste(['22.00 / 20.00', c.input].join('\n'))
      expect(result[0].odds_american, c.input).toBe(c.odds)
      expect(result[0].description, c.input).toBe(c.desc)
    }
  })

  it('treats small signed numbers (spread values) as part of description, not odds', () => {
    const result = parsePaste(['100.00 / 90.91', 'Michigan -7 -110'].join('\n'))
    expect(result[0].odds_american).toBe(-110)
    expect(result[0].description).toBe('Michigan -7')
  })

  it('detects (FP) freeplay marker and strips it from description', () => {
    const input = [
      '35.00 / 31.82',
      'PHX Suns -13 -110 (FP)',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(1)
    expect(result[0].is_freeplay).toBe(true)
    expect(result[0].description).toBe('PHX Suns -13')
    expect(result[0].odds_american).toBe(-110)
  })

  it('parses a parlay with N legs', () => {
    const input = [
      '20.00 / 42.54',
      'Parlay - 2 Teams',
      'MIL Brewers ML -119',
      'LA Dodgers ML -143',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      stake: 20,
      to_win: 42.54,
      bet_type: 'parlay',
      is_freeplay: false,
    })
    expect(result[0].legs).toHaveLength(2)
    expect(result[0].legs[0].description).toBe('MIL Brewers ML')
    expect(result[0].legs[0].odds_american).toBe(-119)
    expect(result[0].legs[1].description).toBe('LA Dodgers ML')
    expect(result[0].legs[1].odds_american).toBe(-143)
  })

  it('handles parlay followed by another bet', () => {
    const input = [
      '20.00 / 42.54',
      'Parlay - 2 Teams',
      'MIL Brewers ML -119',
      'LA Dodgers ML -143',
      '10.00 / 9.09',
      'NYY Yankees ML -110',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(2)
    expect(result[0].bet_type).toBe('parlay')
    expect(result[1].bet_type).toBe('single')
    expect(result[1].stake).toBe(10)
  })

  it('handles the full example from the spec', () => {
    const input = [
      'GameRisk / Win',
      '21.00 / 19.74',
      'Will there be a score in 1st Inning - NO (MIN @ KC) -106',
      '35.00 / 31.82',
      'PHX Suns -13 -110 (FP)',
      '20.00 / 42.54',
      'Parlay - 2 Teams',
      'MIL Brewers ML -119',
      'LA Dodgers ML -143',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(3)

    // Bet 1: single, no freeplay
    expect(result[0].stake).toBe(21)
    expect(result[0].is_freeplay).toBe(false)
    expect(result[0].bet_type).toBe('single')

    // Bet 2: single, freeplay
    expect(result[1].stake).toBe(35)
    expect(result[1].is_freeplay).toBe(true)
    expect(result[1].bet_type).toBe('single')

    // Bet 3: parlay
    expect(result[2].stake).toBe(20)
    expect(result[2].bet_type).toBe('parlay')
    expect(result[2].legs).toHaveLength(2)
  })

  it('handles Windows-style line endings', () => {
    const input = '10.00 / 5.00\r\nSome bet +200'
    const result = parsePaste(input)
    expect(result).toHaveLength(1)
    expect(result[0].odds_american).toBe(200)
  })

  it('handles bets with no odds in the description', () => {
    const input = [
      '10.00 / 8.00',
      'Over 8.5 runs',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(1)
    expect(result[0].odds_american).toBeNull()
    expect(result[0].description).toBe('Over 8.5 runs')
  })

  it('skips lines that are not stake lines gracefully', () => {
    const input = [
      'Some random text',
      '10.00 / 8.00',
      'A bet -110',
    ].join('\n')

    const result = parsePaste(input)
    expect(result).toHaveLength(1)
    expect(result[0].stake).toBe(10)
  })
})
