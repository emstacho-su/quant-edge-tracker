import { describe, it, expect } from 'vitest'
import { deriveMarketRows, reverseSport, reverseMarket, type IngestSnap } from './markets-ingest.js'

function snap(o: Partial<IngestSnap> = {}): IngestSnap {
  return {
    odds_event_id: 'evt1',
    sport_key: 'baseball_mlb',
    commence_time: '2026-05-23T00:00:00Z',
    home_team: 'New York Yankees',
    away_team: 'Tampa Bay Rays',
    market: 'h2h',
    point: null,
    ...o,
  }
}

describe('reverse maps', () => {
  it('maps sport keys and market keys back to app codes', () => {
    expect(reverseSport('baseball_mlb')).toBe('mlb')
    expect(reverseSport('basketball_nba')).toBe('nba')
    expect(reverseSport('unknown_key')).toBe('unknown_key')
    expect(reverseMarket('h2h')).toBe('moneyline')
    expect(reverseMarket('spreads')).toBe('spread')
    expect(reverseMarket('totals')).toBe('total')
  })
})

describe('deriveMarketRows', () => {
  it('emits one row per (event, market_type, param) and dedups repeats', () => {
    const rows = deriveMarketRows([
      snap(),                                   // h2h
      snap(),                                   // duplicate h2h for the same event
      snap({ market: 'spreads', point: -1.5 }),
      snap({ market: 'totals', point: 8.5 }),
    ])
    expect(rows).toHaveLength(3)
    const ml = rows.find((r) => r.market_type === 'moneyline')!
    expect(ml.market_param).toBe('')
    expect(ml.event_id).toBe('evt1')
    expect(ml.odds_api_event_id).toBe('evt1')
    expect(ml.sport).toBe('mlb')
    expect(ml.event_name).toBe('Tampa Bay Rays @ New York Yankees')
    expect(ml.home_team).toBe('New York Yankees')
    const sp = rows.find((r) => r.market_type === 'spread')!
    expect(sp.market_param).toBe('-1.5')
    const tot = rows.find((r) => r.market_type === 'total')!
    expect(tot.market_param).toBe('8.5')
  })

  it('skips unsupported markets (props, outrights, team_totals, lay)', () => {
    const rows = deriveMarketRows([
      snap({ market: 'outrights' }),
      snap({ market: 'team_totals', point: 4.5 }),
      snap({ market: 'h2h_lay' }),
      snap({ market: 'batter_home_runs', point: 0.5 }),
    ])
    expect(rows).toHaveLength(0)
  })

  it('keeps different events and different points separate', () => {
    const rows = deriveMarketRows([
      snap({ odds_event_id: 'a', market: 'spreads', point: -1.5 }),
      snap({ odds_event_id: 'a', market: 'spreads', point: 1.5 }),
      snap({ odds_event_id: 'b', market: 'spreads', point: -1.5 }),
    ])
    expect(rows).toHaveLength(3)
  })
})
