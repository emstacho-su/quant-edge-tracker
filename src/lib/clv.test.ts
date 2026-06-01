import { describe, it, expect } from 'vitest'
import {
  probToAmerican,
  impliedFromAmerican,
  americanToDecimal,
  buildFairSeries,
  buildOutrightSeries,
  latestBookPrice,
  marketKeyForBet,
  centsVsFair,
  bestAvailable,
  ladderPositions,
  verdictText,
  plmPct,
  plmProbPoints,
  plmVerdictText,
  SHARP_BOOKS,
  type OddsSnapshot,
} from './clv'

function snap(
  p: Partial<OddsSnapshot> & {
    bookmaker: string
    selection: string
    price_american: number
    captured_at: string
  },
): OddsSnapshot {
  return {
    id: Math.random().toString(36).slice(2),
    odds_event_id: 'ev1',
    commence_time: null,
    home_team: null,
    away_team: null,
    market: 'h2h',
    point: null,
    ...p,
  }
}

describe('probToAmerican', () => {
  it('is the inverse of impliedFromAmerican (away from even money)', () => {
    for (const a of [-200, -110, +120, +250]) {
      expect(probToAmerican(impliedFromAmerican(a))).toBe(a)
    }
  })
  it('maps an even-money probability to -100', () => {
    expect(probToAmerican(0.5)).toBe(-100)
  })
  it('guards out-of-range probabilities', () => {
    expect(Number.isNaN(probToAmerican(0))).toBe(true)
    expect(Number.isNaN(probToAmerican(1))).toBe(true)
  })
})

describe('buildFairSeries', () => {
  it('uses only Pinnacle rows for the no-vig series', () => {
    const t = '2026-05-22T00:00:00Z'
    const snaps = [
      snap({ bookmaker: 'pinnacle', selection: 'Yankees', price_american: -120, captured_at: t }),
      snap({ bookmaker: 'pinnacle', selection: 'Red Sox', price_american: 100, captured_at: t }),
      snap({ bookmaker: 'draftkings', selection: 'Yankees', price_american: -200, captured_at: t }),
      snap({ bookmaker: 'draftkings', selection: 'Red Sox', price_american: 170, captured_at: t }),
    ]
    const series = buildFairSeries(snaps, 'Yankees', 'h2h')
    expect(series).toHaveLength(1)
    const pYou = impliedFromAmerican(-120)
    const pOther = impliedFromAmerican(100)
    expect(series[0].fair).toBeCloseTo(pYou / (pYou + pOther), 5)
  })

  it('ignores non-matching-market Pinnacle rows at a mixed-market tick (no spike)', () => {
    const t = '2026-05-22T16:00:00Z'
    const snaps = [
      snap({ bookmaker: 'pinnacle', market: 'h2h', selection: 'Yankees', price_american: -137, captured_at: t }),
      snap({ bookmaker: 'pinnacle', market: 'h2h', selection: 'Rays', price_american: 126, captured_at: t }),
      // spreads + totals at the SAME captured_at — must be ignored, or the de-vig spikes
      snap({ bookmaker: 'pinnacle', market: 'spreads', selection: 'Yankees', point: -1.5, price_american: 130, captured_at: t }),
      snap({ bookmaker: 'pinnacle', market: 'spreads', selection: 'Rays', point: 1.5, price_american: -150, captured_at: t }),
      snap({ bookmaker: 'pinnacle', market: 'totals', selection: 'Over', point: 8.5, price_american: -105, captured_at: t }),
      snap({ bookmaker: 'pinnacle', market: 'totals', selection: 'Under', point: 8.5, price_american: -115, captured_at: t }),
    ]
    const series = buildFairSeries(snaps, 'Yankees', 'h2h')
    expect(series).toHaveLength(1)
    const pYou = impliedFromAmerican(-137)
    const pOther = impliedFromAmerican(126)
    expect(series[0].fair).toBeCloseTo(pYou / (pYou + pOther), 5) // ~0.566, NOT collapsed
  })
})

describe('buildOutrightSeries', () => {
  it('plots raw implied prob per snapshot for the selection, sorted by time', () => {
    const snaps = [
      snap({ bookmaker: 'draftkings', market: 'outrights', selection: 'Scottie Scheffler', price_american: 450, captured_at: '2026-05-22T02:00:00Z' }),
      snap({ bookmaker: 'draftkings', market: 'outrights', selection: 'Scottie Scheffler', price_american: 400, captured_at: '2026-05-22T01:00:00Z' }),
      snap({ bookmaker: 'draftkings', market: 'outrights', selection: 'Rory McIlroy', price_american: 800, captured_at: '2026-05-22T01:00:00Z' }),
    ]
    const series = buildOutrightSeries(snaps, 'Scottie Scheffler')
    expect(series.map((p) => p.t)).toEqual([
      Date.parse('2026-05-22T01:00:00Z'),
      Date.parse('2026-05-22T02:00:00Z'),
    ])
    expect(series[0].fair).toBeCloseTo(impliedFromAmerican(400), 6)
  })
})

describe('latestBookPrice', () => {
  it('returns the newest matching book/selection price for the market', () => {
    const snaps = [
      snap({ bookmaker: 'draftkings', selection: 'Yankees', price_american: -115, captured_at: '2026-05-22T01:00:00Z' }),
      snap({ bookmaker: 'draftkings', selection: 'Yankees', price_american: -120, captured_at: '2026-05-22T03:00:00Z' }),
      snap({ bookmaker: 'betmgm', selection: 'Yankees', price_american: -110, captured_at: '2026-05-22T03:00:00Z' }),
    ]
    expect(latestBookPrice(snaps, { bookmaker: 'draftkings', selection: 'Yankees', market: 'h2h' })).toBe(-120)
    expect(latestBookPrice(snaps, { bookmaker: 'betmgm', selection: 'Yankees', market: 'h2h' })).toBe(-110)
    expect(latestBookPrice(snaps, { bookmaker: 'fanduel', selection: 'Yankees', market: 'h2h' })).toBeNull()
  })
  it('respects market + point for spreads/totals', () => {
    const snaps = [
      snap({ bookmaker: 'draftkings', market: 'h2h', selection: 'Yankees', price_american: -140, captured_at: '2026-05-22T03:00:00Z' }),
      snap({ bookmaker: 'draftkings', market: 'spreads', selection: 'Yankees', point: -1.5, price_american: 150, captured_at: '2026-05-22T01:00:00Z' }),
      snap({ bookmaker: 'draftkings', market: 'spreads', selection: 'Yankees', point: 1.5, price_american: -180, captured_at: '2026-05-22T02:00:00Z' }),
    ]
    expect(latestBookPrice(snaps, { bookmaker: 'draftkings', selection: 'Yankees', market: 'spreads', point: -1.5 })).toBe(150)
    // h2h must not leak into a spreads query even though it is newer
    expect(latestBookPrice(snaps, { bookmaker: 'draftkings', selection: 'Yankees', market: 'spreads', point: 1.5 })).toBe(-180)
  })
})

describe('marketKeyForBet', () => {
  it('maps clv_market to snapshot market keys', () => {
    expect(marketKeyForBet('moneyline')).toBe('h2h')
    expect(marketKeyForBet('spread')).toBe('spreads')
    expect(marketKeyForBet('total')).toBe('totals')
    expect(marketKeyForBet('team_total')).toBe('team_totals')
    expect(marketKeyForBet('outright')).toBe('outrights')
    expect(marketKeyForBet(null)).toBe('h2h')
  })
})

describe('centsVsFair', () => {
  it('is positive when you are worse than fair (favorites)', () => {
    expect(centsVsFair(-152, -131)).toBe(21)
  })
  it('is negative when you beat fair (favorites)', () => {
    expect(centsVsFair(-125, -140)).toBe(-15)
  })
  it('is positive when you are worse than fair (dogs)', () => {
    expect(centsVsFair(120, 140)).toBe(20)
  })
  it('returns null when the prices straddle even money', () => {
    expect(centsVsFair(-110, 100)).toBeNull()
  })
})

describe('bestAvailable', () => {
  it('returns the highest-decimal price for the side, excluding Pinnacle, newest per book', () => {
    const snaps = [
      snap({ bookmaker: 'pinnacle', selection: 'Yankees', price_american: -110, captured_at: '2026-05-22T03:00:00Z' }),
      snap({ bookmaker: 'draftkings', selection: 'Yankees', price_american: -154, captured_at: '2026-05-22T03:00:00Z' }),
      snap({ bookmaker: 'betmgm', selection: 'Yankees', price_american: -145, captured_at: '2026-05-22T03:00:00Z' }),
      snap({ bookmaker: 'betmgm', selection: 'Yankees', price_american: -160, captured_at: '2026-05-22T01:00:00Z' }),
    ]
    expect(bestAvailable(snaps, { selection: 'Yankees', market: 'h2h', exclude: ['pinnacle'] }))
      .toEqual({ book: 'betmgm', price: -145 })
  })
  it('returns null when no non-excluded book matches', () => {
    const snaps = [snap({ bookmaker: 'pinnacle', selection: 'Yankees', price_american: -110, captured_at: '2026-05-22T03:00:00Z' })]
    expect(bestAvailable(snaps, { selection: 'Yankees', market: 'h2h', exclude: ['pinnacle'] })).toBeNull()
  })
  it('excludes books whose newest snapshot is stale vs the latest tick', () => {
    const snaps = [
      snap({ bookmaker: 'draftkings', selection: 'Yankees', price_american: -150, captured_at: '2026-05-22T20:00:00Z' }),
      // matchbook has the "better" price but is 4h stale (e.g. the daily odds-slate dump)
      snap({ bookmaker: 'matchbook', selection: 'Yankees', price_american: -130, captured_at: '2026-05-22T16:00:00Z' }),
    ]
    expect(bestAvailable(snaps, { selection: 'Yankees', market: 'h2h', exclude: ['pinnacle'] }))
      .toEqual({ book: 'draftkings', price: -150 })
  })
})

describe('ladderPositions', () => {
  it('maps lower implied prob to smaller x (left = better value)', () => {
    const pos = ladderPositions([
      { key: 'fair', impliedProb: 0.566 },
      { key: 'best', impliedProb: 0.592 },
      { key: 'you', impliedProb: 0.603 },
    ])
    const x = Object.fromEntries(pos.map((p) => [p.key, p.x]))
    expect(x.fair).toBeLessThan(x.best)
    expect(x.best).toBeLessThan(x.you)
    pos.forEach((p) => { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1) })
  })
})

describe('verdictText', () => {
  it('tracking + worse uses cents over fair', () => {
    expect(verdictText({ yourAmerican: -152, fairAmerican: -131, clvPct: -0.061, state: 'tracking' }))
      .toBe("You're paying 21¢ over the fair price.")
  })
  it('tracking + better says better than fair', () => {
    expect(verdictText({ yourAmerican: -125, fairAmerican: -140, clvPct: 0.05, state: 'tracking' }))
      .toBe("You're getting 15¢ better than fair.")
  })
  it('locked + worse is a final missed-close verdict', () => {
    expect(verdictText({ yourAmerican: -152, fairAmerican: -131, clvPct: -0.061, state: 'locked' }))
      .toBe('✗ Missed the close — 21¢ worse than the closing line.')
  })
  it('falls back to percent when prices straddle even money', () => {
    expect(verdictText({ yourAmerican: -110, fairAmerican: 100, clvPct: -0.04, state: 'tracking' }))
      .toBe("You're paying 4.0% over the fair price.")
  })
})

describe('SHARP_BOOKS', () => {
  it('is the curated sharp/major subset incl. Pinnacle', () => {
    expect(SHARP_BOOKS).toContain('pinnacle')
    expect(SHARP_BOOKS).toContain('draftkings')
    expect(SHARP_BOOKS).toContain('williamhill_us') // Caesars
  })
})

describe('plmPct', () => {
  it('is positive when your price beats the best available now (favorites)', () => {
    expect(plmPct(-110, -120)).toBeCloseTo(americanToDecimal(-110) / americanToDecimal(-120) - 1, 6)
    expect(plmPct(-110, -120)).toBeGreaterThan(0)
  })
  it('is negative when a better price is available now (favorites)', () => {
    expect(plmPct(-110, -105)).toBeLessThan(0)
  })
  it('is positive for dogs when your price pays more than the best now', () => {
    expect(plmPct(120, 110)).toBeGreaterThan(0)
  })
  it('is zero when your price equals the best now', () => {
    expect(plmPct(-110, -110)).toBe(0)
  })
})

describe('plmProbPoints', () => {
  it('+ when your implied prob is below the best-now implied (favorable)', () => {
    expect(plmProbPoints(-110, -120)).toBeCloseTo(impliedFromAmerican(-120) - impliedFromAmerican(-110), 6)
    expect(plmProbPoints(-110, -120)).toBeGreaterThan(0)
  })
  it('− when a better price exists now', () => {
    expect(plmProbPoints(-110, -105)).toBeLessThan(0)
  })
})

describe('plmVerdictText', () => {
  it('tracking + favorable names the market best you beat', () => {
    expect(plmVerdictText({ yourAmerican: -120, bestAmerican: -140, bestBook: 'draftkings', plmPct: 0.03, state: 'tracking' }))
      .toBe('Your price beats the market best (-140 @ draftkings) by 20¢.')
  })
  it('tracking + unfavorable points to the better price now', () => {
    expect(plmVerdictText({ yourAmerican: -140, bestAmerican: -120, bestBook: 'fanduel', plmPct: -0.03, state: 'tracking' }))
      .toBe("You'd get 20¢ better elsewhere now (-120 @ fanduel).")
  })
  it('locked + favorable is a final beat-the-market verdict', () => {
    expect(plmVerdictText({ yourAmerican: -120, bestAmerican: -140, bestBook: 'draftkings', plmPct: 0.03, state: 'locked' }))
      .toBe('✓ Line moved your way — beat the closing market by 20¢.')
  })
  it('locked + unfavorable is a final missed verdict', () => {
    expect(plmVerdictText({ yourAmerican: -140, bestAmerican: -120, bestBook: 'fanduel', plmPct: -0.03, state: 'locked' }))
      .toBe('✗ Line moved against you — closing best was 20¢ better.')
  })
  it('falls back to percent when prices straddle even money', () => {
    expect(plmVerdictText({ yourAmerican: -110, bestAmerican: 100, bestBook: 'betmgm', plmPct: 0.02, state: 'tracking' }))
      .toBe('Your price beats the market best (+100 @ betmgm) by 2.0%.')
  })
  it('awaits the line when best is unknown', () => {
    expect(plmVerdictText({ yourAmerican: -110, bestAmerican: null, bestBook: null, plmPct: null, state: 'tracking' }))
      .toBe('Awaiting the line.')
  })
})

describe('bestAvailable include (sharp subset)', () => {
  it('restricts to the included books and counts Pinnacle as bettable', () => {
    const snaps = [
      snap({ bookmaker: 'pinnacle', selection: 'Yankees', price_american: -105, captured_at: '2026-05-22T03:00:00Z' }),
      snap({ bookmaker: 'draftkings', selection: 'Yankees', price_american: -120, captured_at: '2026-05-22T03:00:00Z' }),
      snap({ bookmaker: 'bovada', selection: 'Yankees', price_american: 100, captured_at: '2026-05-22T03:00:00Z' }),
    ]
    // bovada has the best price but is outside the subset → ignored; pinnacle -105 wins
    expect(bestAvailable(snaps, { selection: 'Yankees', market: 'h2h', include: ['pinnacle', 'draftkings'] }))
      .toEqual({ book: 'pinnacle', price: -105 })
  })
})

describe('hasNoVigAnchor', () => {
  it('true when closing_fair_prob set', async () => {
    const { hasNoVigAnchor } = await import('./clv')
    expect(hasNoVigAnchor({ closing_fair_prob: 0.52 })).toBe(true)
  })
  it('true when clv_pct set even without closing_fair_prob', async () => {
    const { hasNoVigAnchor } = await import('./clv')
    expect(hasNoVigAnchor({ clv_pct: 0.03 })).toBe(true)
  })
  it('false when both null/undefined (e.g. props, exotics)', async () => {
    const { hasNoVigAnchor } = await import('./clv')
    expect(hasNoVigAnchor({})).toBe(false)
    expect(hasNoVigAnchor({ closing_fair_prob: null, clv_pct: null })).toBe(false)
  })
})
