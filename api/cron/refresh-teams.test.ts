import { describe, it, expect } from 'vitest'
import { isInSeason } from './refresh-teams.js'

// Fixed dates used for deterministic assertions
const JUN_15 = new Date('2025-06-15T12:00:00Z')   // June — MLB/NBA/WNBA in-season
const JAN_15 = new Date('2025-01-15T12:00:00Z')   // January — NBA/NHL/NFL in-season; MLB/WNBA off
const DEC_15 = new Date('2025-12-15T12:00:00Z')   // December — NBA/NHL in-season; year-wrap test
const AUG_15 = new Date('2025-08-15T12:00:00Z')   // August — only MLB/WNBA in-season

describe('isInSeason — MLB', () => {
  it('returns true in June (regular season)', () => {
    expect(isInSeason('MLB', JUN_15)).toBe(true)
  })
  it('returns false in January (off-season)', () => {
    expect(isInSeason('MLB', JAN_15)).toBe(false)
  })
})

describe('isInSeason — NBA (year-wrap window)', () => {
  it('returns true in December (year-wrap — season spans Oct–Jun)', () => {
    expect(isInSeason('NBA', DEC_15)).toBe(true)
  })
  it('returns true in June (year-wrap — before Jun-30 end)', () => {
    expect(isInSeason('NBA', JUN_15)).toBe(true)
  })
  it('returns false in August (gap between seasons)', () => {
    expect(isInSeason('NBA', AUG_15)).toBe(false)
  })
})

describe('isInSeason — NHL (year-wrap window)', () => {
  it('returns true in December (regular season)', () => {
    expect(isInSeason('NHL', DEC_15)).toBe(true)
  })
  it('returns false in August (off-season)', () => {
    expect(isInSeason('NHL', AUG_15)).toBe(false)
  })
})

describe('isInSeason — NFL', () => {
  it('returns true in January (playoffs)', () => {
    expect(isInSeason('NFL', JAN_15)).toBe(true)
  })
  it('returns false in August (preseason not started / off-season)', () => {
    expect(isInSeason('NFL', AUG_15)).toBe(false)
  })
})

describe('isInSeason — WNBA', () => {
  it('returns true in June (regular season)', () => {
    expect(isInSeason('WNBA', JUN_15)).toBe(true)
  })
  it('returns false in January (off-season)', () => {
    expect(isInSeason('WNBA', JAN_15)).toBe(false)
  })
})

describe('isInSeason — unknown sport', () => {
  it('returns true for an unrecognised sport (never accidentally skip)', () => {
    expect(isInSeason('ESPORTS', JAN_15)).toBe(true)
  })
  it('returns true for empty string sport', () => {
    expect(isInSeason('', JUN_15)).toBe(true)
  })
})
