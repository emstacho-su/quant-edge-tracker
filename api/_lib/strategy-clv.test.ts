import { describe, it, expect } from 'vitest'
import { closingFairForSelection, gradeOutcome } from './strategy-clv.js'

const snaps = [
  { selection: 'San Diego Padres', point: 1.5, price_american: -120 },
  { selection: 'Los Angeles Dodgers', point: -1.5, price_american: -110 },
]

describe('closingFairForSelection', () => {
  it('devigs Pinnacle for the selection', () => {
    expect(closingFairForSelection(snaps, 'San Diego Padres', 1.5)).toBeCloseTo(0.5101, 4)
  })

  it('returns null when the selection is absent', () => {
    expect(closingFairForSelection(snaps, 'Nobody', 1.5)).toBeNull()
  })

  it('uses only the matching point line, ignoring alt lines', () => {
    const multi = [
      { selection: 'San Diego Padres', point: 1.5, price_american: -120 },
      { selection: 'Los Angeles Dodgers', point: -1.5, price_american: -110 },
      { selection: 'San Diego Padres', point: 2.5, price_american: -200 },
      { selection: 'Los Angeles Dodgers', point: -2.5, price_american: 160 },
    ]
    expect(closingFairForSelection(multi, 'San Diego Padres', 1.5)).toBeCloseTo(0.5101, 4)
  })

  it('devigs a moneyline (point == null) over both h2h prices', () => {
    const ml = [
      { selection: 'San Diego Padres', point: null, price_american: -120 },
      { selection: 'Los Angeles Dodgers', point: null, price_american: -110 },
    ]
    // implied(-120)=0.5455, implied(-110)=0.5238, sum=1.0693 → 0.5101
    expect(closingFairForSelection(ml, 'San Diego Padres', null)).toBeCloseTo(0.5101, 4)
  })

  it('returns null when fewer than 2 prices remain after filtering', () => {
    const oneSide = [{ selection: 'San Diego Padres', point: 1.5, price_american: -120 }]
    expect(closingFairForSelection(oneSide, 'San Diego Padres', 1.5)).toBeNull()
  })
})

describe('gradeOutcome', () => {
  it('grades clv_pct + beat_close', () => {
    const g = gradeOutcome({ offered_odds: -126, closingFair: 0.5101 })
    expect(g.beat_close).toBe(g.clv_pct > 0)
    expect(g.pinnacle_close_fair).toBe(0.5101)
  })
})
