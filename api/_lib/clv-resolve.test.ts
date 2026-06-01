import { describe, it, expect } from 'vitest'
import { candidateOddsKeys, SOCCER_LEAGUES } from './clv-resolve.js'

describe('candidateOddsKeys', () => {
  it('resolved key short-circuits everything', () => {
    expect(candidateOddsKeys('Soccer', 'soccer_epl', ['tennis_wta_french_open'])).toEqual(['soccer_epl'])
  })
  it('soccer → the bounded league list', () => {
    expect(candidateOddsKeys('Soccer', null, [])).toEqual(SOCCER_LEAGUES)
  })
  it('tennis → the live tennis keys passed in', () => {
    expect(candidateOddsKeys('Tennis', null, ['tennis_wta_french_open', 'tennis_atp_hamburg_open']))
      .toEqual(['tennis_wta_french_open', 'tennis_atp_hamburg_open'])
  })
  it('case-insensitive sport', () => {
    expect(candidateOddsKeys('soccer', null, [])).toEqual(SOCCER_LEAGUES)
  })
  it('unknown sport → []', () => {
    expect(candidateOddsKeys('Cricket', null, [])).toEqual([])
  })
})
