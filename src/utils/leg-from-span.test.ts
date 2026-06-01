import { describe, it, expect } from 'vitest'
import { legFromSpan } from './leg-from-span'

describe('legFromSpan', () => {
  it('parses the selection and re-detects sport from the span', () => {
    const leg = legFromSpan('COL Avalanche -1½', 'MLB')
    expect(leg).toMatchObject({
      description: 'COL Avalanche -1½',
      clv_market: 'spread',
      clv_line: -1.5,
      sport: 'NHL',
    })
  })

  it('falls back to the parent bet sport when the span has no detectable team', () => {
    const leg = legFromSpan('o9.5', 'MLB')
    expect(leg.sport).toBe('MLB')
    expect(leg.clv_market).toBe('total')
    expect(leg.clv_line).toBe(9.5)
  })
})
