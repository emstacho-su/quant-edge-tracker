import { describe, it, expect } from 'vitest'
import {
  cashAtRisk,
  totalDeposits,
  totalFpAssigned,
  totalVault,
  totalWithdrawals,
} from './account-ledger'
import type { BankrollEvent } from '@/lib/types'

// Minimal fixture type — only the fields the utils need. `withdraw_destination`
// is optional since most utils ignore it; only totalVault tests supply it.
type EventFixture = Pick<BankrollEvent, 'event_type' | 'bankroll_type' | 'amount'> & {
  withdraw_destination?: string | null
}

// ---------------------------------------------------------------------------
// totalDeposits
// ---------------------------------------------------------------------------

describe('totalDeposits', () => {
  it('returns 0 for an empty array', () => {
    expect(totalDeposits([])).toBe(0)
  })

  it('sums only deposit+cash events (800)', () => {
    const events: EventFixture[] = [
      { event_type: 'deposit', bankroll_type: 'cash', amount: 500 },
      { event_type: 'deposit', bankroll_type: 'cash', amount: 300 },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: 100 },
      { event_type: 'promo', bankroll_type: 'freeplay', amount: 200 },
    ]
    expect(totalDeposits(events)).toBe(800)
  })

  it('excludes freeplay deposits', () => {
    const events: EventFixture[] = [
      { event_type: 'deposit', bankroll_type: 'cash', amount: 100 },
      { event_type: 'deposit', bankroll_type: 'freeplay', amount: 50 },
    ]
    // freeplay deposit is hypothetical but should be excluded
    expect(totalDeposits(events)).toBe(100)
  })

  it('excludes starting_balance even if cash', () => {
    const events: EventFixture[] = [
      { event_type: 'starting_balance', bankroll_type: 'cash', amount: 1000 },
      { event_type: 'deposit', bankroll_type: 'cash', amount: 200 },
    ]
    expect(totalDeposits(events)).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// totalFpAssigned
// ---------------------------------------------------------------------------

describe('totalFpAssigned', () => {
  it('returns 0 for an empty array', () => {
    expect(totalFpAssigned([])).toBe(0)
  })

  it('sums promo + starting_balance freeplay, excludes bet_settled (150 not 125)', () => {
    const events: EventFixture[] = [
      { event_type: 'promo', bankroll_type: 'freeplay', amount: 100 },
      { event_type: 'starting_balance', bankroll_type: 'freeplay', amount: 50 },
      // bet_settled freeplay events are FP stake-consumption events — NOT FP grants
      { event_type: 'bet_settled', bankroll_type: 'freeplay', amount: -25 },
    ]
    expect(totalFpAssigned(events)).toBe(150)
  })

  it('excludes cash promo/starting_balance (wrong bankroll_type)', () => {
    const events: EventFixture[] = [
      { event_type: 'promo', bankroll_type: 'freeplay', amount: 75 },
      { event_type: 'promo', bankroll_type: 'cash', amount: 50 },
    ]
    // cash promo would be a manual_adjustment equivalent — should not count as FP assigned
    expect(totalFpAssigned(events)).toBe(75)
  })

  it('excludes withdrawal and manual_adjustment even if freeplay', () => {
    const events: EventFixture[] = [
      { event_type: 'promo', bankroll_type: 'freeplay', amount: 100 },
      { event_type: 'withdrawal', bankroll_type: 'freeplay', amount: -20 },
      { event_type: 'manual_adjustment', bankroll_type: 'freeplay', amount: -10 },
    ]
    expect(totalFpAssigned(events)).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// totalWithdrawals
// ---------------------------------------------------------------------------

describe('totalWithdrawals', () => {
  it('returns 0 for an empty array', () => {
    expect(totalWithdrawals([])).toBe(0)
  })

  it('sums magnitudes of cash withdrawals (300) — negative source amounts', () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -200 },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -100 },
      { event_type: 'deposit', bankroll_type: 'cash', amount: 500 },
    ]
    expect(totalWithdrawals(events)).toBe(300)
  })

  it('treats positive-amount withdrawal as same magnitude (sign-robust)', () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: 75 },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -25 },
    ]
    expect(totalWithdrawals(events)).toBe(100)
  })

  it('excludes manual_adjustment (corrections, not capital flows)', () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -100 },
      { event_type: 'manual_adjustment', bankroll_type: 'cash', amount: -50 },
    ]
    expect(totalWithdrawals(events)).toBe(100)
  })

  it('excludes freeplay withdrawals (wrong bankroll_type)', () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -100 },
      { event_type: 'withdrawal', bankroll_type: 'freeplay', amount: -50 },
    ]
    expect(totalWithdrawals(events)).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// cashAtRisk
// ---------------------------------------------------------------------------

describe('cashAtRisk', () => {
  it('returns 0 for an empty array', () => {
    expect(cashAtRisk([])).toBe(0)
  })

  it('returns deposits − withdrawals (net principal)', () => {
    const events: EventFixture[] = [
      { event_type: 'deposit', bankroll_type: 'cash', amount: 1000 },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -300 },
    ]
    expect(cashAtRisk(events)).toBe(700)
  })

  it('ignores manual_adjustment, freeplay, and bet_settled', () => {
    const events: EventFixture[] = [
      { event_type: 'deposit', bankroll_type: 'cash', amount: 500 },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -100 },
      { event_type: 'manual_adjustment', bankroll_type: 'cash', amount: 25 },
      { event_type: 'promo', bankroll_type: 'freeplay', amount: 200 },
      { event_type: 'bet_settled', bankroll_type: 'cash', amount: -50 },
    ]
    expect(cashAtRisk(events)).toBe(400)
  })

  it('can go negative when withdrawals exceed deposits (winnings withdrawn)', () => {
    const events: EventFixture[] = [
      { event_type: 'deposit', bankroll_type: 'cash', amount: 500 },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -800 },
    ]
    expect(cashAtRisk(events)).toBe(-300)
  })
})

// ---------------------------------------------------------------------------
// totalVault
// ---------------------------------------------------------------------------

describe('totalVault', () => {
  it('returns 0 for an empty array', () => {
    expect(totalVault([])).toBe(0)
  })

  it("sums only withdrawals tagged with destination='vault' (1705)", () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -1000, withdraw_destination: 'vault' },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -705, withdraw_destination: 'vault' },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -100, withdraw_destination: 'paid colton venmo' },
      { event_type: 'deposit', bankroll_type: 'cash', amount: 500 },
    ]
    expect(totalVault(events)).toBe(1705)
  })

  it('excludes withdrawals with a non-vault destination string', () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -200, withdraw_destination: 'vault' },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -50, withdraw_destination: 'fees' },
    ]
    expect(totalVault(events)).toBe(200)
  })

  it('excludes withdrawals with NULL destination (untagged, legacy data)', () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -300, withdraw_destination: 'vault' },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -100, withdraw_destination: null },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -50 }, // omitted entirely
    ]
    expect(totalVault(events)).toBe(300)
  })

  it('excludes freeplay withdrawals even if tagged vault', () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -200, withdraw_destination: 'vault' },
      { event_type: 'withdrawal', bankroll_type: 'freeplay', amount: -75, withdraw_destination: 'vault' },
    ]
    expect(totalVault(events)).toBe(200)
  })

  it('is sign-robust: positive-amount vault withdrawal counts same magnitude', () => {
    const events: EventFixture[] = [
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: 100, withdraw_destination: 'vault' },
      { event_type: 'withdrawal', bankroll_type: 'cash', amount: -100, withdraw_destination: 'vault' },
    ]
    expect(totalVault(events)).toBe(200)
  })
})
