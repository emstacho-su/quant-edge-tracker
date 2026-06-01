import { describe, it, expect } from 'vitest'
import { recomputeChain, projectFinalBalance, projectBalanceSeries } from './bankroll-helpers'
import type { BankrollEvent } from '@/lib/types'

function evt(overrides: Partial<BankrollEvent> = {}): BankrollEvent {
  return {
    id: crypto.randomUUID(),
    event_type: 'manual_adjustment',
    bankroll_type: 'cash',
    amount: 0,
    balance_after: 0,
    bet_id: null,
    occurred_at: '2026-04-01T00:00:00Z',
    note: null,
    ...overrides,
  }
}

describe('recomputeChain', () => {
  it('reports drift when balance_after diverges from running sum', () => {
    const events = [
      evt({ amount: 100, balance_after: 100, occurred_at: '2026-04-01T00:00:00Z' }),
      evt({ amount: 50, balance_after: 999, occurred_at: '2026-04-02T00:00:00Z' }),
    ]
    const drift = recomputeChain(events, 'cash')
    expect(drift).toHaveLength(1)
    expect(drift[0].expected).toBe(150)
    expect(drift[0].actual).toBe(999)
  })

  it('returns empty when chain is consistent', () => {
    const events = [
      evt({ amount: 100, balance_after: 100, occurred_at: '2026-04-01T00:00:00Z' }),
      evt({ amount: -25, balance_after: 75, occurred_at: '2026-04-02T00:00:00Z' }),
    ]
    expect(recomputeChain(events, 'cash')).toHaveLength(0)
  })

  it('isolates by bankroll_type', () => {
    const events = [
      evt({ bankroll_type: 'cash', amount: 100, balance_after: 100 }),
      evt({ bankroll_type: 'freeplay', amount: 50, balance_after: 50 }),
    ]
    expect(recomputeChain(events, 'cash')).toHaveLength(0)
    expect(recomputeChain(events, 'freeplay')).toHaveLength(0)
  })
})

describe('projectFinalBalance', () => {
  const base: BankrollEvent[] = [
    evt({ id: 'a', amount: 1000, balance_after: 1000, occurred_at: '2026-04-01T00:00:00Z' }),
    evt({ id: 'b', amount: -100, balance_after: 900, occurred_at: '2026-04-02T00:00:00Z' }),
  ]

  it('projects a pending insert at end of chain', () => {
    const result = projectFinalBalance({
      events: base,
      bankrollType: 'cash',
      pendingInsert: { amount: -200, occurred_at: '2026-04-03T00:00:00Z' },
    })
    expect(result).toBe(700)
  })

  it('projects a pending insert at start (chronological re-sort)', () => {
    const result = projectFinalBalance({
      events: base,
      bankrollType: 'cash',
      pendingInsert: { amount: 500, occurred_at: '2026-03-01T00:00:00Z' },
    })
    expect(result).toBe(1400)
  })

  it('projects an update', () => {
    const result = projectFinalBalance({
      events: base,
      bankrollType: 'cash',
      pendingUpdate: { id: 'b', amount: -300, occurred_at: '2026-04-02T00:00:00Z' },
    })
    expect(result).toBe(700)
  })

  it('projects a delete', () => {
    const result = projectFinalBalance({
      events: base,
      bankrollType: 'cash',
      pendingDeleteId: 'b',
    })
    expect(result).toBe(1000)
  })
})

describe('projectBalanceSeries', () => {
  it('returns running balance after every event', () => {
    const events = [
      evt({ id: 'a', amount: 100, balance_after: 100, occurred_at: '2026-04-01T00:00:00Z' }),
      evt({ id: 'b', amount: -200, balance_after: -100, occurred_at: '2026-04-02T00:00:00Z' }),
      evt({ id: 'c', amount: 50, balance_after: -50, occurred_at: '2026-04-03T00:00:00Z' }),
    ]
    const series = projectBalanceSeries({ events, bankrollType: 'cash' })
    expect(series).toEqual([100, -100, -50])
  })

  it('exposes intermediate dips with backdated insert', () => {
    const events = [
      evt({ id: 'a', amount: 1000, balance_after: 1000, occurred_at: '2026-04-01T00:00:00Z' }),
      evt({ id: 'b', amount: 500, balance_after: 1500, occurred_at: '2026-04-10T00:00:00Z' }),
    ]
    const series = projectBalanceSeries({
      events,
      bankrollType: 'cash',
      pendingInsert: { amount: -1100, occurred_at: '2026-04-05T00:00:00Z' },
    })
    expect(series).toEqual([1000, -100, 400])
    expect(Math.min(...series)).toBe(-100)
  })
})
