import { describe, it, expect } from 'vitest'
import {
  startOfWeek,
  getCashBankrollAtWeekStart,
  computeWeeklyUnit,
} from './unit-size'
import type { BankrollEvent } from '@/lib/types'

function evt(overrides: Partial<BankrollEvent> = {}): BankrollEvent {
  return {
    id: crypto.randomUUID(),
    event_type: 'manual_adjustment',
    bankroll_type: 'cash',
    amount: 0,
    balance_after: 0,
    bet_id: null,
    occurred_at: '2026-05-04T00:00:00',
    note: null,
    ...overrides,
  }
}

describe('startOfWeek', () => {
  it('returns Monday 00:00 when given a Monday afternoon', () => {
    const monday = new Date(2026, 4, 4, 14, 30, 0)
    const got = startOfWeek(monday)
    expect(got.getFullYear()).toBe(2026)
    expect(got.getMonth()).toBe(4)
    expect(got.getDate()).toBe(4)
    expect(got.getHours()).toBe(0)
    expect(got.getMinutes()).toBe(0)
  })

  it('rolls Sunday back to the previous Monday', () => {
    const sunday = new Date(2026, 4, 10, 9, 0, 0)
    const got = startOfWeek(sunday)
    expect(got.getDate()).toBe(4)
    expect(got.getMonth()).toBe(4)
  })

  it('rolls Saturday back to the previous Monday', () => {
    const saturday = new Date(2026, 4, 9, 23, 59, 59)
    const got = startOfWeek(saturday)
    expect(got.getDate()).toBe(4)
  })

  it('does not mutate the input date', () => {
    const input = new Date(2026, 4, 10, 9, 0, 0)
    const before = input.getTime()
    startOfWeek(input)
    expect(input.getTime()).toBe(before)
  })
})

describe('computeWeeklyUnit', () => {
  it('returns $10 for $0', () => {
    expect(computeWeeklyUnit(0)).toBe(10)
  })

  it('returns $10 for negative bankroll', () => {
    expect(computeWeeklyUnit(-500)).toBe(10)
  })

  it('returns $10 for NaN', () => {
    expect(computeWeeklyUnit(NaN)).toBe(10)
  })

  it('returns $10 for non-finite', () => {
    expect(computeWeeklyUnit(Infinity)).toBe(10)
  })

  it('returns $10 for $400 bankroll (1% = $4, floored)', () => {
    expect(computeWeeklyUnit(400)).toBe(10)
  })

  it('returns $10 for $1,000 bankroll (1% = $10)', () => {
    expect(computeWeeklyUnit(1000)).toBe(10)
  })

  it('returns $15 for $1,001 bankroll (1% = $10.01 -> $15)', () => {
    expect(computeWeeklyUnit(1001)).toBe(15)
  })

  it('returns $25 for $2,340 bankroll (1% = $23.40 -> $25)', () => {
    expect(computeWeeklyUnit(2340)).toBe(25)
  })

  it('returns $35 for $3,001 bankroll (1% = $30.01 -> $35)', () => {
    expect(computeWeeklyUnit(3001)).toBe(35)
  })

  it('returns $30 for exactly $3,000 bankroll (1% = $30)', () => {
    expect(computeWeeklyUnit(3000)).toBe(30)
  })
})

describe('getCashBankrollAtWeekStart', () => {
  it('returns 0 when no events', () => {
    expect(getCashBankrollAtWeekStart([], new Date(2026, 4, 18))).toBe(0)
  })

  it('returns balance_after of last cash event before the week boundary', () => {
    const events: BankrollEvent[] = [
      evt({ occurred_at: '2026-04-25T10:00:00', balance_after: 1000 }),
      evt({ occurred_at: '2026-05-02T10:00:00', balance_after: 1500 }),
      evt({ occurred_at: '2026-05-10T10:00:00', balance_after: 1700 }),
    ]
    const asOf = new Date(2026, 4, 6)
    expect(getCashBankrollAtWeekStart(events, asOf)).toBe(1500)
  })

  it('ignores freeplay events', () => {
    const events: BankrollEvent[] = [
      evt({ occurred_at: '2026-05-02T10:00:00', balance_after: 1500, bankroll_type: 'cash' }),
      evt({ occurred_at: '2026-05-03T10:00:00', balance_after: 99999, bankroll_type: 'freeplay' }),
    ]
    const asOf = new Date(2026, 4, 14)
    expect(getCashBankrollAtWeekStart(events, asOf)).toBe(1500)
  })

  it('returns 0 when all events are after the boundary', () => {
    const events: BankrollEvent[] = [
      evt({ occurred_at: '2026-05-15T10:00:00', balance_after: 1500 }),
    ]
    const asOf = new Date(2026, 4, 14)
    expect(getCashBankrollAtWeekStart(events, asOf)).toBe(0)
  })

  it('treats events ON the boundary as part of the current week (excluded from snapshot)', () => {
    const events: BankrollEvent[] = [
      evt({ occurred_at: '2026-05-03T23:59:59', balance_after: 800 }),
      evt({ occurred_at: '2026-05-04T00:00:00', balance_after: 900 }),
    ]
    const asOf = new Date(2026, 4, 5)
    expect(getCashBankrollAtWeekStart(events, asOf)).toBe(800)
  })
})
