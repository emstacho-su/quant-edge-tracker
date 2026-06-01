import { describe, it, expect } from 'vitest'
import { legRowsForInsert } from './leg-rows'

describe('legRowsForInsert', () => {
  it('maps drafts to parlay_legs rows with pending status', () => {
    const rows = legRowsForInsert('b1', [
      { description: 'KC Royals ML', sport: 'MLB', odds_american: -120,
        clv_market: 'moneyline', clv_selection: 'KC Royals', clv_line: null },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      bet_id: 'b1', leg_status: 'pending', clv_market: 'moneyline',
      clv_selection: 'KC Royals', description: 'KC Royals ML',
    })
  })

  it('returns [] for no legs', () => {
    expect(legRowsForInsert('b1', [])).toEqual([])
  })
})
