import { describe, it, expect } from 'vitest'
import { propMarketFor } from './prop-market.js'

describe('propMarketFor', () => {
  it('NBA points → player_points', () => expect(propMarketFor('NBA', 'points')).toBe('player_points'))
  it('NBA pra → player_points_rebounds_assists', () => expect(propMarketFor('NBA', 'pra')).toBe('player_points_rebounds_assists'))
  it('MLB strikeouts → pitcher_strikeouts', () => expect(propMarketFor('MLB', 'strikeouts')).toBe('pitcher_strikeouts'))
  it('unknown sport/stat → null', () => {
    expect(propMarketFor('NHL', 'goals')).toBeNull()
    expect(propMarketFor(null, 'points')).toBeNull()
  })
})
