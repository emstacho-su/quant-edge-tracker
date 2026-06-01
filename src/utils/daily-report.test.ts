import { describe, it, expect } from 'vitest'
import {
  getEtWeekKey,
  getEtWeekStart,
  getBetReportDay,
  getBetPlacedDayKey,
  getWeekStartingBankroll,
  buildDailyReport,
  buildWeeklySummary,
} from './daily-report'
import type { Bet, BankrollEvent } from '@/lib/types'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeBet(overrides: Partial<Bet> = {}): Bet {
  return {
    id: crypto.randomUUID(),
    sport: 'NHL',
    bet_type: 'single',
    stake: 22,
    to_win: 20,
    odds_american: -110,
    description: 'Team A at Team B',
    status: 'won',
    is_freeplay: false,
    placed_at: '2026-04-13T20:00:00Z', // Mon Apr 13 16:00 ET
    settled_at: '2026-04-13T23:00:00Z', // Mon Apr 13 19:00 ET
    profit_loss: 20,
    notes: null,
    live_game_id: null,
    live_game_sport: null,
    live_game_locked_at: null,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<BankrollEvent> = {}): BankrollEvent {
  return {
    id: crypto.randomUUID(),
    event_type: 'bet_settled',
    bankroll_type: 'cash',
    amount: 0,
    balance_after: 1000,
    bet_id: null,
    occurred_at: '2026-04-13T00:00:00Z',
    note: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Week helpers (ET timezone, Monday start)
// ---------------------------------------------------------------------------

describe('getEtWeekKey', () => {
  it('returns Monday date key for any day in a week', () => {
    // Mon Apr 13 2026 -> 2026-04-13
    expect(getEtWeekKey(new Date('2026-04-13T20:00:00Z'))).toBe('2026-04-13')
    // Wed Apr 15 2026 -> 2026-04-13
    expect(getEtWeekKey(new Date('2026-04-15T20:00:00Z'))).toBe('2026-04-13')
    // Sun Apr 19 2026 23:00 ET -> still Mon Apr 13 week
    expect(getEtWeekKey(new Date('2026-04-20T03:00:00Z'))).toBe('2026-04-13')
  })

  it('rolls over to new week at Monday 00:00 ET', () => {
    // Sunday Apr 19 23:59 ET (Apr 20 03:59 UTC) -> Apr 13 week
    expect(getEtWeekKey(new Date('2026-04-20T03:59:00Z'))).toBe('2026-04-13')
    // Monday Apr 20 00:01 ET (Apr 20 04:01 UTC) -> Apr 20 week
    expect(getEtWeekKey(new Date('2026-04-20T04:01:00Z'))).toBe('2026-04-20')
  })
})

describe('getEtWeekStart', () => {
  it('returns an ISO timestamp for Monday 00:00 ET', () => {
    const weekStart = getEtWeekStart(new Date('2026-04-15T20:00:00Z'))
    // Monday Apr 13 00:00 ET = Apr 13 04:00 UTC (EDT, UTC-4)
    expect(weekStart.toISOString()).toBe('2026-04-13T04:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// getBetReportDay — placed_at by default, settled_at for Golf or day-prior bets
// ---------------------------------------------------------------------------

describe('getBetReportDay', () => {
  it('uses placed_at when bet is pending', () => {
    const bet = makeBet({
      status: 'pending',
      placed_at: '2026-04-13T20:00:00Z',
      settled_at: null,
    })
    expect(getBetReportDay(bet)).toBe('2026-04-13')
  })

  it('uses placed_at when settled same ET day', () => {
    const bet = makeBet({
      placed_at: '2026-04-13T20:00:00Z', // Mon 16:00 ET
      settled_at: '2026-04-13T23:00:00Z', // Mon 19:00 ET
    })
    expect(getBetReportDay(bet)).toBe('2026-04-13')
  })

  it('uses placed_at for late-night games that finish past midnight ET', () => {
    // Placed Mon 16:30 ET, settled Tue 00:45 ET (8h gap, different ET day)
    const bet = makeBet({
      placed_at: '2026-04-13T20:30:00Z',
      settled_at: '2026-04-14T04:45:00Z',
    })
    expect(getBetReportDay(bet)).toBe('2026-04-13')
  })

  it('uses settled_at when placed the day prior to the event (>16h gap)', () => {
    const bet = makeBet({
      placed_at: '2026-04-13T20:00:00Z', // Mon 16:00 ET
      settled_at: '2026-04-14T14:00:00Z', // Tue 10:00 ET — 18h later
    })
    expect(getBetReportDay(bet)).toBe('2026-04-14')
  })

  it('uses placed_at at the exact 16 hour boundary', () => {
    const bet = makeBet({
      placed_at: '2026-04-13T20:00:00Z',
      settled_at: '2026-04-14T12:00:00Z', // exactly 16h
    })
    expect(getBetReportDay(bet)).toBe('2026-04-13')
  })

  it('uses settled_at for Golf regardless of gap', () => {
    // Thu placement for Sun settle — multi-day tournament
    const bet = makeBet({
      sport: 'Golf',
      placed_at: '2026-04-16T15:00:00Z', // Thu
      settled_at: '2026-04-19T23:00:00Z', // Sun
    })
    expect(getBetReportDay(bet)).toBe('2026-04-19')
  })

  it('uses settled_at for Golf even when settled same ET day', () => {
    // A round-long Sunday golf bet — still buckets to settled day
    const bet = makeBet({
      sport: 'Golf',
      placed_at: '2026-04-19T14:00:00Z', // Sun 10:00 ET
      settled_at: '2026-04-19T22:00:00Z', // Sun 18:00 ET
    })
    expect(getBetReportDay(bet)).toBe('2026-04-19')
  })
})

// ---------------------------------------------------------------------------
// getWeekStartingBankroll
// ---------------------------------------------------------------------------

describe('getWeekStartingBankroll', () => {
  const events: BankrollEvent[] = [
    makeEvent({
      bankroll_type: 'cash',
      occurred_at: '2026-04-06T12:00:00Z', // prior Mon
      balance_after: 500,
    }),
    makeEvent({
      bankroll_type: 'freeplay',
      occurred_at: '2026-04-07T12:00:00Z',
      balance_after: 999, // must be ignored
    }),
    makeEvent({
      bankroll_type: 'cash',
      occurred_at: '2026-04-12T23:00:00Z', // Sun 19:00 ET before week Apr 13
      balance_after: 800,
    }),
    makeEvent({
      bankroll_type: 'cash',
      occurred_at: '2026-04-14T14:00:00Z', // during target week
      balance_after: 950,
    }),
  ]

  it('returns the last cash balance at or before the week start', () => {
    const bankroll = getWeekStartingBankroll(
      events,
      new Date('2026-04-15T12:00:00Z'),
    )
    expect(bankroll).toBe(800)
  })

  it('ignores freeplay events', () => {
    const onlyFp: BankrollEvent[] = [
      makeEvent({
        bankroll_type: 'freeplay',
        occurred_at: '2026-04-06T12:00:00Z',
        balance_after: 500,
      }),
    ]
    expect(
      getWeekStartingBankroll(onlyFp, new Date('2026-04-15T12:00:00Z')),
    ).toBe(0)
  })

  it('returns 0 when no prior event exists', () => {
    expect(
      getWeekStartingBankroll([], new Date('2026-04-15T12:00:00Z')),
    ).toBe(0)
  })

  it('includes events occurring exactly at week start', () => {
    const atWeekStart: BankrollEvent[] = [
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-13T04:00:00Z', // Mon 00:00 ET
        balance_after: 1234,
      }),
    ]
    expect(
      getWeekStartingBankroll(atWeekStart, new Date('2026-04-15T12:00:00Z')),
    ).toBe(1234)
  })
})

// ---------------------------------------------------------------------------
// buildDailyReport
// ---------------------------------------------------------------------------

describe('buildDailyReport', () => {
  const startingBankroll: BankrollEvent[] = [
    makeEvent({
      bankroll_type: 'cash',
      occurred_at: '2026-04-12T23:00:00Z',
      balance_after: 1000,
    }),
  ]

  it('returns empty array when no bets', () => {
    expect(buildDailyReport([], startingBankroll)).toEqual([])
  })

  it('groups bets by day in reverse chronological order', () => {
    const bets = [
      makeBet({
        id: 'mon',
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 20,
        status: 'won',
      }),
      makeBet({
        id: 'wed',
        placed_at: '2026-04-15T20:00:00Z',
        settled_at: '2026-04-15T23:00:00Z',
        profit_loss: -22,
        status: 'lost',
      }),
    ]
    const report = buildDailyReport(bets, startingBankroll)
    expect(report.map((d) => d.dateKey)).toEqual(['2026-04-15', '2026-04-13'])
  })

  it('sorts bets within a day by placed_at ascending', () => {
    const bets = [
      makeBet({
        id: 'late',
        placed_at: '2026-04-13T22:00:00Z',
        settled_at: '2026-04-13T23:30:00Z',
        description: 'late bet',
      }),
      makeBet({
        id: 'early',
        placed_at: '2026-04-13T14:00:00Z',
        settled_at: '2026-04-13T16:00:00Z',
        description: 'early bet',
      }),
    ]
    const report = buildDailyReport(bets, startingBankroll)
    expect(report[0].bets.map((b) => b.bet.id)).toEqual(['early', 'late'])
  })

  it('computes pctOfBankroll as profit_loss / weekStartingBankroll * 100', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 30,
        status: 'won',
      }),
    ]
    const report = buildDailyReport(bets, startingBankroll)
    expect(report[0].bets[0].pctOfBankroll).toBeCloseTo(3, 5)
    expect(report[0].cashDay.pctOfBankroll).toBeCloseTo(3, 5)
    expect(report[0].cashWeek.pctOfBankroll).toBeCloseTo(3, 5)
  })

  it('separates cash and FP tallies', () => {
    const bets = [
      makeBet({
        id: 'cash-win',
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 20,
        status: 'won',
        is_freeplay: false,
      }),
      makeBet({
        id: 'fp-win',
        placed_at: '2026-04-13T20:30:00Z',
        settled_at: '2026-04-13T23:30:00Z',
        profit_loss: 15,
        status: 'won',
        is_freeplay: true,
      }),
    ]
    const day = buildDailyReport(bets, startingBankroll)[0]
    expect(day.cashDay.wins).toBe(1)
    expect(day.cashDay.profitLoss).toBe(20)
    expect(day.fpDay.wins).toBe(1)
    expect(day.fpDay.profitLoss).toBe(15)
  })

  it('rolls the weekly tally across the week and resets on a new Monday', () => {
    const bets = [
      makeBet({
        id: 'mon',
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 10,
        status: 'won',
      }),
      makeBet({
        id: 'wed',
        placed_at: '2026-04-15T20:00:00Z',
        settled_at: '2026-04-15T23:00:00Z',
        profit_loss: 20,
        status: 'won',
      }),
      makeBet({
        id: 'next-mon',
        placed_at: '2026-04-20T20:00:00Z', // Mon Apr 20
        settled_at: '2026-04-20T23:00:00Z',
        profit_loss: 5,
        status: 'won',
      }),
    ]
    // Add a Monday-of-week-2 balance event so we compute % off a fresh baseline
    const events: BankrollEvent[] = [
      ...startingBankroll,
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-20T04:00:00Z', // exactly at week2 start
        balance_after: 2000,
      }),
    ]
    const report = buildDailyReport(bets, events)
    const byKey = Object.fromEntries(report.map((d) => [d.dateKey, d]))

    expect(byKey['2026-04-13'].cashWeek.profitLoss).toBe(10)
    expect(byKey['2026-04-15'].cashWeek.profitLoss).toBe(30) // 10 + 20
    expect(byKey['2026-04-20'].cashWeek.profitLoss).toBe(5) // new week
    expect(byKey['2026-04-20'].cashWeek.pctOfBankroll).toBeCloseTo(0.25, 3)
  })

  it('counts push as separate push tally, excluded from wins/losses', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 0,
        status: 'push',
      }),
    ]
    const day = buildDailyReport(bets, startingBankroll)[0]
    expect(day.cashDay.pushes).toBe(1)
    expect(day.cashDay.wins).toBe(0)
    expect(day.cashDay.losses).toBe(0)
    expect(day.bets[0].resultLabel).toBe('Push')
    expect(day.bets[0].pctOfBankroll).toBe(0)
  })

  it('counts void as separate void tally with explicit label', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 0,
        status: 'void',
      }),
    ]
    const day = buildDailyReport(bets, startingBankroll)[0]
    expect(day.cashDay.voids).toBe(1)
    expect(day.cashDay.wins).toBe(0)
    expect(day.cashDay.losses).toBe(0)
    expect(day.bets[0].resultLabel).toBe('Void')
  })

  it('reports pending bets with stake-at-risk pct (positive magnitude)', () => {
    const bets = [
      makeBet({
        stake: 50,
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: null,
        profit_loss: null,
        status: 'pending',
      }),
    ]
    const day = buildDailyReport(bets, startingBankroll)[0]
    expect(day.cashDay.pending).toBe(1)
    expect(day.cashDay.wins).toBe(0)
    expect(day.cashDay.profitLoss).toBe(0)
    // Stake $50 against $1000 starting bankroll => 5% at risk (no sign)
    expect(day.bets[0].pctOfBankroll).toBeCloseTo(5, 5)
    expect(day.bets[0].resultLabel).toBe('Pending')
    expect(day.pendingDay.count).toBe(1)
    expect(day.pendingDay.pctOfBankroll).toBeCloseTo(5, 5)
  })

  it('aggregates pending exposure across multiple cash + FP bets in a day', () => {
    const bets = [
      makeBet({
        stake: 50,
        placed_at: '2026-04-13T18:00:00Z',
        settled_at: null,
        profit_loss: null,
        status: 'pending',
        is_freeplay: false,
      }),
      makeBet({
        stake: 25,
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: null,
        profit_loss: null,
        status: 'pending',
        is_freeplay: true,
      }),
      makeBet({
        stake: 22,
        placed_at: '2026-04-13T21:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 20,
        status: 'won',
      }),
    ]
    const day = buildDailyReport(bets, startingBankroll)[0]
    expect(day.pendingDay.count).toBe(2)
    // (50 + 25) / 1000 = 7.5%
    expect(day.pendingDay.pctOfBankroll).toBeCloseTo(7.5, 5)
  })

  it('rolls pending exposure across the week', () => {
    const bets = [
      makeBet({
        stake: 30,
        placed_at: '2026-04-13T18:00:00Z',
        settled_at: null,
        profit_loss: null,
        status: 'pending',
      }),
      makeBet({
        stake: 70,
        placed_at: '2026-04-15T18:00:00Z',
        settled_at: null,
        profit_loss: null,
        status: 'pending',
      }),
    ]
    const report = buildDailyReport(bets, startingBankroll)
    const wed = report.find((d) => d.dateKey === '2026-04-15')!
    expect(wed.pendingWeek.count).toBe(2)
    expect(wed.pendingWeek.pctOfBankroll).toBeCloseTo(10, 5) // (30+70)/1000
  })

  it('always buckets bets by placed_at, regardless of settle time or sport', () => {
    const bets = [
      makeBet({
        id: 'quick',
        placed_at: '2026-04-13T20:00:00Z', // Mon
        settled_at: '2026-04-14T04:00:00Z', // Tue UTC, 8h later
      }),
      makeBet({
        id: 'slow',
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-14T20:00:00Z', // 24h later (would have been settled-day under old rule)
      }),
      makeBet({
        id: 'golf',
        sport: 'Golf',
        placed_at: '2026-04-13T15:00:00Z', // Mon
        settled_at: '2026-04-19T22:00:00Z', // Sun (multi-day)
      }),
    ]
    const report = buildDailyReport(bets, startingBankroll)
    const byKey = Object.fromEntries(report.map((d) => [d.dateKey, d]))
    expect(byKey['2026-04-13'].bets.map((b) => b.bet.id).sort()).toEqual([
      'golf',
      'quick',
      'slow',
    ])
    expect(byKey['2026-04-14']).toBeUndefined()
    expect(byKey['2026-04-19']).toBeUndefined()
  })

  it('returns 0% for all bets when starting bankroll is 0', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 100,
      }),
    ]
    const day = buildDailyReport(bets, [])[0]
    expect(day.weekStartingBankroll).toBe(0)
    expect(day.bets[0].pctOfBankroll).toBe(0)
    expect(day.cashDay.pctOfBankroll).toBe(0)
    expect(day.cashWeek.pctOfBankroll).toBe(0)
  })

  it('extracts sport and result label correctly', () => {
    const bets = [
      makeBet({
        sport: 'NHL',
        status: 'won',
        description: 'Rangers ML',
      }),
    ]
    const reportBet = buildDailyReport(bets, startingBankroll)[0].bets[0]
    expect(reportBet.resultLabel).toBe('Win')
    expect(reportBet.bet.sport).toBe('NHL')
  })

  it('produces a readable dateLabel', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
      }),
    ]
    const day = buildDailyReport(bets, startingBankroll)[0]
    expect(day.dateLabel).toMatch(/Mon.*Apr.*13/)
  })
})

// ---------------------------------------------------------------------------
// getBetPlacedDayKey — placed_at always (used by Reports page)
// ---------------------------------------------------------------------------

describe('getBetPlacedDayKey', () => {
  it('always returns the placed_at ET date, ignoring settled_at and sport', () => {
    const monPlaced = '2026-04-13T20:00:00Z' // Mon Apr 13 16:00 ET
    expect(
      getBetPlacedDayKey(
        makeBet({ placed_at: monPlaced, settled_at: '2026-04-14T20:00:00Z' }),
      ),
    ).toBe('2026-04-13')
    expect(
      getBetPlacedDayKey(
        makeBet({
          sport: 'Golf',
          placed_at: monPlaced,
          settled_at: '2026-04-19T22:00:00Z',
        }),
      ),
    ).toBe('2026-04-13')
  })
})

// ---------------------------------------------------------------------------
// buildWeeklySummary
// ---------------------------------------------------------------------------

describe('buildWeeklySummary', () => {
  const startingBankroll: BankrollEvent[] = [
    makeEvent({
      bankroll_type: 'cash',
      occurred_at: '2026-04-12T23:00:00Z',
      balance_after: 1000,
    }),
    makeEvent({
      bankroll_type: 'cash',
      occurred_at: '2026-04-20T04:00:00Z', // Mon week 2 start
      balance_after: 2000,
    }),
  ]

  it('returns empty array when no bets', () => {
    expect(buildWeeklySummary([], startingBankroll)).toEqual([])
  })

  it('rolls daily totals into per-week summaries, newest first', () => {
    const bets = [
      makeBet({
        id: 'mon1',
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 10,
        status: 'won',
      }),
      makeBet({
        id: 'wed1',
        placed_at: '2026-04-15T20:00:00Z',
        settled_at: '2026-04-15T23:00:00Z',
        profit_loss: 20,
        status: 'won',
      }),
      makeBet({
        id: 'mon2',
        placed_at: '2026-04-20T20:00:00Z',
        settled_at: '2026-04-20T23:00:00Z',
        profit_loss: -50,
        status: 'lost',
      }),
    ]
    const summary = buildWeeklySummary(bets, startingBankroll)
    expect(summary.map((w) => w.weekKey)).toEqual([
      '2026-04-20',
      '2026-04-13',
    ])
    expect(summary[0].cash.profitLoss).toBe(-50)
    expect(summary[0].cash.losses).toBe(1)
    expect(summary[0].weekStartingBankroll).toBe(2000)
    expect(summary[0].betCount).toBe(1)
    expect(summary[1].cash.profitLoss).toBe(30)
    expect(summary[1].cash.wins).toBe(2)
    expect(summary[1].betCount).toBe(2)
  })

  it('produces friendly week range labels', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 10,
        status: 'won',
      }),
    ]
    const summary = buildWeeklySummary(bets, startingBankroll)
    expect(summary[0].startLabel).toMatch(/Apr 13/)
    expect(summary[0].endLabel).toMatch(/Apr 19/)
  })

  it('separates cash and FP totals at the week level', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 25,
        status: 'won',
        is_freeplay: false,
      }),
      makeBet({
        placed_at: '2026-04-14T20:00:00Z',
        settled_at: '2026-04-14T23:00:00Z',
        profit_loss: 15,
        status: 'won',
        is_freeplay: true,
      }),
    ]
    const summary = buildWeeklySummary(bets, startingBankroll)
    expect(summary[0].cash.profitLoss).toBe(25)
    expect(summary[0].fp.profitLoss).toBe(15)
  })

  it('reports weekEndingBankroll from the next week start, falling back to latest balance for the most recent week', () => {
    const events: BankrollEvent[] = [
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-12T23:00:00Z', // before week Apr 13
        balance_after: 1000,
      }),
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-20T04:00:00Z', // Mon week 2 start = end of week 1
        balance_after: 1010,
      }),
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-22T20:00:00Z', // mid week 2 — newest event
        balance_after: 985,
      }),
    ]
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 10,
      }),
      makeBet({
        placed_at: '2026-04-22T20:00:00Z',
        settled_at: '2026-04-22T23:00:00Z',
        profit_loss: -25,
      }),
    ]
    const summary = buildWeeklySummary(bets, events)
    const byKey = Object.fromEntries(summary.map((w) => [w.weekKey, w]))
    // Week 1 ends at the balance entering week 2.
    expect(byKey['2026-04-13'].weekEndingBankroll).toBe(1010)
    // Most recent week has no following-week event; falls back to latest cash balance.
    expect(byKey['2026-04-20'].weekEndingBankroll).toBe(985)
  })

  it('exposes per-week (cash + FP) P/L as weekPl, independent across weeks', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 100,
        status: 'won',
      }),
      makeBet({
        placed_at: '2026-04-20T20:00:00Z',
        settled_at: '2026-04-20T23:00:00Z',
        profit_loss: -40,
        status: 'lost',
      }),
    ]
    const summary = buildWeeklySummary(bets, startingBankroll)
    const byKey = Object.fromEntries(summary.map((w) => [w.weekKey, w]))
    expect(byKey['2026-04-13'].weekPl).toBe(100)
    expect(byKey['2026-04-20'].weekPl).toBe(-40)
  })

  it('includes FP P/L in weekPl', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 50,
        status: 'won',
        is_freeplay: false,
      }),
      makeBet({
        placed_at: '2026-04-13T21:00:00Z',
        settled_at: '2026-04-13T23:30:00Z',
        profit_loss: 30,
        status: 'won',
        is_freeplay: true,
      }),
    ]
    const summary = buildWeeklySummary(bets, startingBankroll)
    expect(summary[0].weekPl).toBe(80) // 50 cash + 30 FP
  })

  it('computes accountPct per-week as betting P/L over starting bankroll', () => {
    const events: BankrollEvent[] = [
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-12T23:00:00Z',
        balance_after: 1000,
      }),
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-20T04:00:00Z', // Mon week 2 start = end of week 1
        balance_after: 1100,
      }),
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-22T20:00:00Z', // mid week 2 — latest cash balance
        balance_after: 1045,
      }),
    ]
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 100,
        status: 'won',
      }),
      makeBet({
        placed_at: '2026-04-22T20:00:00Z',
        settled_at: '2026-04-22T23:00:00Z',
        profit_loss: -55,
        status: 'lost',
      }),
    ]
    const summary = buildWeeklySummary(bets, events)
    const byKey = Object.fromEntries(summary.map((w) => [w.weekKey, w]))
    // Week 1: weekPl +100 over start 1000 -> +10%
    expect(byKey['2026-04-13'].accountPct).toBeCloseTo(10, 5)
    // Week 2: weekPl -55 over start 1100 -> -5%
    expect(byKey['2026-04-20'].accountPct).toBeCloseTo(-5, 5)
  })

  it('excludes deposits from accountPct (capital flows are not performance)', () => {
    // Week of Apr 13: start 1000, a +100 winning bet, AND a $500 deposit.
    // The deposit pushes the ending balance to 1600. Account % must reflect
    // ONLY the betting P/L (+100 / 1000 = +10%), not the balance delta that
    // a deposit would inflate to (1600 - 1000) / 1000 = +60%.
    const events: BankrollEvent[] = [
      makeEvent({
        bankroll_type: 'cash',
        occurred_at: '2026-04-12T23:00:00Z',
        balance_after: 1000,
      }),
      makeEvent({
        event_type: 'bet_settled',
        bankroll_type: 'cash',
        amount: 100,
        occurred_at: '2026-04-13T23:00:00Z',
        balance_after: 1100,
      }),
      makeEvent({
        event_type: 'deposit',
        bankroll_type: 'cash',
        amount: 500,
        occurred_at: '2026-04-15T12:00:00Z',
        balance_after: 1600,
      }),
    ]
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 100,
        status: 'won',
      }),
    ]
    const week = buildWeeklySummary(bets, events).find(
      (w) => w.weekKey === '2026-04-13',
    )!
    // Deposit is still surfaced separately as capital flow.
    expect(week.cashDeposits).toBe(500)
    expect(week.weekEndingBankroll).toBe(1600)
    // ...but it must not count as betting performance.
    expect(week.weekPl).toBe(100)
    expect(week.accountPct).toBeCloseTo(10, 5)
  })

  it('returns accountPct of 0 when week starting bankroll is 0', () => {
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 50,
        status: 'won',
      }),
    ]
    const summary = buildWeeklySummary(bets, [])
    expect(summary[0].weekStartingBankroll).toBe(0)
    expect(summary[0].weekPl).toBe(50)
    expect(summary[0].accountPct).toBe(0)
  })

  it('aggregates cash withdrawals per week (positive magnitudes, excludes deposits and FP)', () => {
    const events: BankrollEvent[] = [
      ...startingBankroll,
      makeEvent({
        event_type: 'withdrawal',
        bankroll_type: 'cash',
        amount: -200,
        occurred_at: '2026-04-15T12:00:00Z',
      }),
      makeEvent({
        event_type: 'withdrawal',
        bankroll_type: 'cash',
        amount: -50,
        occurred_at: '2026-04-17T12:00:00Z',
      }),
      makeEvent({
        event_type: 'deposit',
        bankroll_type: 'cash',
        amount: 500,
        occurred_at: '2026-04-16T12:00:00Z',
      }),
      makeEvent({
        event_type: 'withdrawal',
        bankroll_type: 'freeplay',
        amount: -25,
        occurred_at: '2026-04-15T12:00:00Z',
      }),
    ]
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 10,
      }),
    ]
    const summary = buildWeeklySummary(bets, events)
    expect(summary[0].cashWithdrawals).toBe(250)
  })

  it('aggregates cash deposits per week (excluding promos, withdrawals, FP)', () => {
    const events: BankrollEvent[] = [
      ...startingBankroll,
      makeEvent({
        event_type: 'deposit',
        bankroll_type: 'cash',
        amount: 500,
        occurred_at: '2026-04-15T12:00:00Z', // Wed of week Apr 13
      }),
      makeEvent({
        event_type: 'deposit',
        bankroll_type: 'cash',
        amount: 200,
        occurred_at: '2026-04-17T12:00:00Z', // Fri of same week
      }),
      makeEvent({
        event_type: 'withdrawal',
        bankroll_type: 'cash',
        amount: -100,
        occurred_at: '2026-04-16T12:00:00Z',
      }),
      makeEvent({
        event_type: 'promo',
        bankroll_type: 'freeplay',
        amount: 50,
        occurred_at: '2026-04-15T12:00:00Z',
      }),
      makeEvent({
        event_type: 'deposit',
        bankroll_type: 'cash',
        amount: 1000,
        occurred_at: '2026-04-21T12:00:00Z', // next week
      }),
    ]
    const bets = [
      makeBet({
        placed_at: '2026-04-13T20:00:00Z',
        settled_at: '2026-04-13T23:00:00Z',
        profit_loss: 10,
      }),
      makeBet({
        placed_at: '2026-04-21T20:00:00Z',
        settled_at: '2026-04-21T23:00:00Z',
        profit_loss: 20,
      }),
    ]
    const summary = buildWeeklySummary(bets, events)
    const byKey = Object.fromEntries(summary.map((w) => [w.weekKey, w]))
    expect(byKey['2026-04-13'].cashDeposits).toBe(700)
    expect(byKey['2026-04-20'].cashDeposits).toBe(1000)
  })
})
