import { describe, it, expect } from 'vitest'
import { displayBookSnaps } from './line-movement'
import type { OddsEvent } from '../_lib/odds-api'

const ev: OddsEvent = {
  id: 'ev1',
  commence_time: '2026-05-22T23:00:00Z',
  home_team: 'Boston Red Sox',
  away_team: 'New York Yankees',
  bookmakers: [
    { key: 'pinnacle', title: 'Pinnacle', last_update: '', markets: [{ key: 'h2h', outcomes: [{ name: 'New York Yankees', price: -120 }, { name: 'Boston Red Sox', price: 100 }] }] },
    { key: 'draftkings', title: 'DK', last_update: '', markets: [{ key: 'h2h', outcomes: [{ name: 'New York Yankees', price: -125 }, { name: 'Boston Red Sox', price: 105 }] }] },
    { key: 'betmgm', title: 'MGM', last_update: '', markets: [{ key: 'h2h', outcomes: [{ name: 'New York Yankees', price: -118 }, { name: 'Boston Red Sox', price: -102 }] }] },
  ],
}

describe('displayBookSnaps', () => {
  it('emits one bet-side row per display book present', () => {
    const rows = displayBookSnaps(ev, 'h2h', 'New York Yankees', null, ['draftkings', 'betmgm'], {
      sportKey: 'baseball_mlb',
      capturedAt: 'T',
    })
    expect(rows.map((r) => r.bookmaker)).toEqual(['draftkings', 'betmgm'])
    expect(rows.map((r) => r.price_american)).toEqual([-125, -118])
    expect(rows.every((r) => r.selection === 'New York Yankees')).toBe(true)
  })

  it('skips a book that does not offer the market', () => {
    const noMgm: OddsEvent = { ...ev, bookmakers: ev.bookmakers.filter((b) => b.key !== 'betmgm') }
    const rows = displayBookSnaps(noMgm, 'h2h', 'New York Yankees', null, ['draftkings', 'betmgm'], {
      sportKey: 'baseball_mlb',
      capturedAt: 'T',
    })
    expect(rows.map((r) => r.bookmaker)).toEqual(['draftkings'])
  })
})
