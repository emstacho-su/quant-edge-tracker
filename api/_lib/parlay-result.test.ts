import { describe, it, expect } from 'vitest'
import { deriveParlayResult } from './parlay-result.js'

describe('deriveParlayResult', () => {
  it('all legs won → won', () => expect(deriveParlayResult(['won', 'won', 'won'])).toBe('won'))
  it('any leg lost → lost (kills the parlay)', () => expect(deriveParlayResult(['won', 'lost', 'won'])).toBe('lost'))
  it('lost beats push', () => expect(deriveParlayResult(['push', 'lost'])).toBe('lost'))
  it('any leg pending → pending (not all resolved)', () => expect(deriveParlayResult(['won', 'pending'])).toBe('pending'))
  it('a push/void leg → null (payout must be recomputed manually)', () => {
    expect(deriveParlayResult(['won', 'push'])).toBeNull()
    expect(deriveParlayResult(['won', 'void'])).toBeNull()
  })
  it('no legs → null', () => expect(deriveParlayResult([])).toBeNull())
})
