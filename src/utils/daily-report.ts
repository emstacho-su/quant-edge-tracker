import type { Bet, BankrollEvent } from '@/lib/types'

const ET_TZ = 'America/New_York'

const ET_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const ET_DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

const ET_DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BetResult = 'Win' | 'Loss' | 'Push' | 'Void' | 'Pending'

export interface ReportTally {
  wins: number
  losses: number
  pushes: number
  voids: number
  pending: number
  profitLoss: number
  pctOfBankroll: number
}

export interface ReportBet {
  bet: Bet
  resultLabel: BetResult
  pctOfBankroll: number
  isFreeplay: boolean
}

export interface PendingExposure {
  /** Number of pending bets (cash + FP). */
  count: number
  /** Sum of pending stakes as % of weekStartingBankroll (positive magnitude). */
  pctOfBankroll: number
}

export interface DailyReportDay {
  dateKey: string
  dateLabel: string
  weekKey: string
  weekStartingBankroll: number
  bets: ReportBet[]
  cashDay: ReportTally
  fpDay: ReportTally
  cashWeek: ReportTally
  fpWeek: ReportTally
  /** Aggregate pending exposure for this day across cash + FP bets. */
  pendingDay: PendingExposure
  /** Aggregate pending exposure rolled across the week. */
  pendingWeek: PendingExposure
}

// ---------------------------------------------------------------------------
// ET date helpers
// ---------------------------------------------------------------------------

interface EtParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

function getEtParts(date: Date): EtParts {
  const parts = ET_PARTS.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  }
}

function etDateKey(date: Date): string {
  return ET_DATE_KEY.format(date)
}

// Day-of-week in ET: 0=Sun..6=Sat. We compute via UTC noon on the ET date to
// avoid DST edge effects when constructing the Date.
function etDayOfWeek(date: Date): number {
  const { year, month, day } = getEtParts(date)
  // UTC noon on the ET civil date is always the same civil day regardless of TZ
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay()
}

/**
 * Date key ('YYYY-MM-DD') of the Monday that starts the ET week containing `date`.
 */
export function getEtWeekKey(date: Date): string {
  const { year, month, day } = getEtParts(date)
  const dow = etDayOfWeek(date)
  // Sunday (0) => -6 days from Monday; otherwise dow=1..6 => -(dow-1)
  const daysBack = dow === 0 ? 6 : dow - 1
  const monday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  monday.setUTCDate(monday.getUTCDate() - daysBack)
  return ET_DATE_KEY.format(monday)
}

/**
 * The ISO instant corresponding to Monday 00:00 ET for the week containing `date`.
 * Accounts for DST: picks the instant whose ET wall-clock is Monday 00:00.
 */
export function getEtWeekStart(date: Date): Date {
  const key = getEtWeekKey(date) // 'YYYY-MM-DD'
  const [y, m, d] = key.split('-').map(Number)
  // ET is UTC-4 (EDT) or UTC-5 (EST). Probe both and pick the one whose
  // ET parts resolve to the intended local date at hour 0.
  for (const offsetHours of [4, 5]) {
    const probe = new Date(Date.UTC(y, m - 1, d, offsetHours, 0, 0))
    const parts = getEtParts(probe)
    if (
      parts.year === y &&
      parts.month === m &&
      parts.day === d &&
      parts.hour === 0
    ) {
      return probe
    }
  }
  // Fallback: EST
  return new Date(Date.UTC(y, m - 1, d, 5, 0, 0))
}

// ---------------------------------------------------------------------------
// Bet day assignment
// ---------------------------------------------------------------------------

const SIXTEEN_HOURS_MS = 16 * 60 * 60 * 1000

/**
 * The ET date key under which to group this bet in the report.
 *
 * Default: bucket by placed_at.
 * Exceptions (bucket by settled_at):
 *   1. Golf — multi-day tournaments always settle after the event.
 *   2. Bet placed the day prior to the event — detected when settled_at falls
 *      on a later ET calendar day AND the placement-to-settle gap exceeds 16h.
 *      The 16h buffer excludes late-night games that finish past midnight ET.
 *
 * Used by Dashboard's 7-day P&L. The Reports page uses
 * `getBetPlacedDayKey` instead — placed_at always.
 */
export function getBetReportDay(bet: Bet): string {
  const placed = new Date(bet.placed_at)
  const placedKey = etDateKey(placed)

  if (!bet.settled_at) return placedKey
  const settled = new Date(bet.settled_at)

  if (bet.sport === 'Golf') return etDateKey(settled)

  const settledKey = etDateKey(settled)
  if (
    settledKey !== placedKey &&
    settled.getTime() - placed.getTime() > SIXTEEN_HOURS_MS
  ) {
    return settledKey
  }

  return placedKey
}

/**
 * The ET date key of the bet's placed_at — bucketing rule used by the Reports
 * page. PnL of every bet impacts the day it was placed.
 */
export function getBetPlacedDayKey(bet: Bet): string {
  return etDateKey(new Date(bet.placed_at))
}

// ---------------------------------------------------------------------------
// Bankroll lookup
// ---------------------------------------------------------------------------

/**
 * The last cash `balance_after` at or before the start of the ET week
 * containing `date`. Returns 0 if no such event exists.
 */
export function getWeekStartingBankroll(
  events: readonly BankrollEvent[],
  date: Date,
): number {
  const weekStartMs = getEtWeekStart(date).getTime()
  let latest: BankrollEvent | null = null
  for (const ev of events) {
    if (ev.bankroll_type !== 'cash') continue
    const ts = new Date(ev.occurred_at).getTime()
    if (ts > weekStartMs) continue
    if (!latest || new Date(latest.occurred_at).getTime() < ts) {
      latest = ev
    }
  }
  return latest?.balance_after ?? 0
}

// ---------------------------------------------------------------------------
// Result labels and tallies
// ---------------------------------------------------------------------------

function resultLabel(bet: Bet): BetResult {
  switch (bet.status) {
    case 'won':
      return 'Win'
    case 'lost':
      return 'Loss'
    case 'push':
      return 'Push'
    case 'void':
      return 'Void'
    default:
      return 'Pending'
  }
}

function emptyTally(): ReportTally {
  return {
    wins: 0,
    losses: 0,
    pushes: 0,
    voids: 0,
    pending: 0,
    profitLoss: 0,
    pctOfBankroll: 0,
  }
}

function addToTally(tally: ReportTally, bet: Bet): void {
  switch (bet.status) {
    case 'won':
      tally.wins += 1
      break
    case 'lost':
      tally.losses += 1
      break
    case 'push':
      tally.pushes += 1
      break
    case 'void':
      tally.voids += 1
      break
    default:
      tally.pending += 1
      break
  }
  tally.profitLoss += bet.profit_loss ?? 0
}

function pctOf(profit: number, bankroll: number): number {
  if (bankroll <= 0) return 0
  return (profit / bankroll) * 100
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build a WagerTalk-style daily report from bets + bankroll history.
 * Bets are grouped by ET day of `placed_at` — every bet impacts the day it
 * was placed regardless of when it settles.
 * Days are returned newest-first. Per-bet % and daily/weekly tallies are
 * expressed as % of the cash bankroll at the start of that bet's ET week.
 * Pending bets show their stake-at-risk as a negative pct of bankroll.
 * FP bets are tracked in adjacent, separate tallies.
 */
export function buildDailyReport(
  bets: readonly Bet[],
  bankrollEvents: readonly BankrollEvent[],
): DailyReportDay[] {
  if (bets.length === 0) return []

  // Bucket bets by ET day of placed_at
  const byDay = new Map<string, Bet[]>()
  for (const bet of bets) {
    const key = getBetPlacedDayKey(bet)
    const bucket = byDay.get(key)
    if (bucket) {
      bucket.push(bet)
    } else {
      byDay.set(key, [bet])
    }
  }

  const dayKeysAsc = Array.from(byDay.keys()).sort()

  // Accumulate week-rolling tallies keyed by week
  const weekCashTally = new Map<string, ReportTally>()
  const weekFpTally = new Map<string, ReportTally>()
  const weekBankroll = new Map<string, number>()
  const weekPendingStake = new Map<string, number>()
  const weekPendingCount = new Map<string, number>()

  const days: DailyReportDay[] = []

  for (const dateKey of dayKeysAsc) {
    const dayBets = (byDay.get(dateKey) ?? []).slice().sort((a, b) => {
      return (
        new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime()
      )
    })

    // Use midday of the ET date for week lookup to avoid DST ambiguity
    const [y, m, d] = dateKey.split('-').map(Number)
    const dayAnchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
    const weekKey = getEtWeekKey(dayAnchor)

    let startingBankroll = weekBankroll.get(weekKey)
    if (startingBankroll === undefined) {
      startingBankroll = getWeekStartingBankroll(bankrollEvents, dayAnchor)
      weekBankroll.set(weekKey, startingBankroll)
    }

    let cashWeek = weekCashTally.get(weekKey)
    if (!cashWeek) {
      cashWeek = emptyTally()
      weekCashTally.set(weekKey, cashWeek)
    }
    let fpWeek = weekFpTally.get(weekKey)
    if (!fpWeek) {
      fpWeek = emptyTally()
      weekFpTally.set(weekKey, fpWeek)
    }

    const cashDay = emptyTally()
    const fpDay = emptyTally()
    const reportBets: ReportBet[] = []
    let pendingDayStake = 0
    let pendingDayCount = 0

    for (const bet of dayBets) {
      const target = bet.is_freeplay ? fpDay : cashDay
      const weekTarget = bet.is_freeplay ? fpWeek : cashWeek
      addToTally(target, bet)
      addToTally(weekTarget, bet)

      // Pending bets surface the stake-at-risk as a positive magnitude (no
      // sign) so the UI can render "potential exposure" instead of an
      // em-dash. Settled bets keep the realized pl-based pct (signed).
      const isPending = bet.status === 'pending'
      const pct = isPending
        ? pctOf(bet.stake, startingBankroll)
        : pctOf(bet.profit_loss ?? 0, startingBankroll)

      if (isPending) {
        pendingDayStake += bet.stake
        pendingDayCount += 1
      }

      reportBets.push({
        bet,
        resultLabel: resultLabel(bet),
        pctOfBankroll: pct,
        isFreeplay: bet.is_freeplay,
      })
    }

    // Roll pending into the week
    weekPendingStake.set(
      weekKey,
      (weekPendingStake.get(weekKey) ?? 0) + pendingDayStake,
    )
    weekPendingCount.set(
      weekKey,
      (weekPendingCount.get(weekKey) ?? 0) + pendingDayCount,
    )

    cashDay.pctOfBankroll = pctOf(cashDay.profitLoss, startingBankroll)
    fpDay.pctOfBankroll = pctOf(fpDay.profitLoss, startingBankroll)

    const pendingDay: PendingExposure = {
      count: pendingDayCount,
      pctOfBankroll: pctOf(pendingDayStake, startingBankroll),
    }
    const pendingWeek: PendingExposure = {
      count: weekPendingCount.get(weekKey) ?? 0,
      pctOfBankroll: pctOf(
        weekPendingStake.get(weekKey) ?? 0,
        startingBankroll,
      ),
    }

    const cashWeekSnapshot: ReportTally = {
      ...cashWeek,
      pctOfBankroll: pctOf(cashWeek.profitLoss, startingBankroll),
    }
    const fpWeekSnapshot: ReportTally = {
      ...fpWeek,
      pctOfBankroll: pctOf(fpWeek.profitLoss, startingBankroll),
    }

    days.push({
      dateKey,
      dateLabel: ET_DAY_LABEL.format(dayAnchor),
      weekKey,
      weekStartingBankroll: startingBankroll,
      bets: reportBets,
      cashDay,
      fpDay,
      cashWeek: cashWeekSnapshot,
      fpWeek: fpWeekSnapshot,
      pendingDay,
      pendingWeek,
    })
  }

  // Reverse-chronological (newest first)
  days.reverse()
  return days
}

// ---------------------------------------------------------------------------
// Weekly summary — zoomed-out roll-up of buildDailyReport output
// ---------------------------------------------------------------------------

export interface WeekSummary {
  weekKey: string
  /** Mon date label, e.g. "Apr 13". */
  startLabel: string
  /** Sun date label, e.g. "Apr 19". */
  endLabel: string
  weekStartingBankroll: number
  /**
   * Latest cash balance_after at or before the start of the following ET week
   * (i.e., the balance carried into next week, which equals the balance at end
   * of this week). For the most recent week, naturally resolves to the latest
   * cash balance — the current bankroll.
   */
  weekEndingBankroll: number
  betCount: number
  /** Sum of cash deposit events occurring within the week (Mon 00:00 ET to next Mon 00:00 ET). */
  cashDeposits: number
  /** Sum of cash withdrawal magnitudes occurring within the week (always positive). */
  cashWithdrawals: number
  cash: ReportTally
  fp: ReportTally
  /** Aggregate pending exposure for the week. */
  pending: PendingExposure
  /** Total (cash + FP) P/L for this week. */
  weekPl: number
  /**
   * Per-week betting performance: weekPl / weekStartingBankroll * 100.
   * Deliberately bet-driven (not balance-delta) so capital flows — deposits,
   * withdrawals, manual adjustments — are excluded; those are out-of-pocket
   * money, not P/L. See cashDeposits / cashWithdrawals for capital movement.
   */
  accountPct: number
}

const ET_MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
})

function weekRangeLabels(weekKey: string): { start: string; end: string } {
  const [y, m, d] = weekKey.split('-').map(Number)
  const monday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  return {
    start: ET_MONTH_DAY.format(monday),
    end: ET_MONTH_DAY.format(sunday),
  }
}

/**
 * The bankroll value at the end of the ET week identified by `weekKey`.
 * Resolved as the latest cash `balance_after` at or before the start of the
 * *following* week — i.e., the balance entering next week, which equals the
 * balance leaving this week. For the most recent week (no future events),
 * this falls back to the current bankroll.
 */
function getWeekEndingBankroll(
  events: readonly BankrollEvent[],
  weekKey: string,
): number {
  const [y, m, d] = weekKey.split('-').map(Number)
  // Anchor inside the next ET week (this Monday + 7 days, noon UTC is safe).
  const nextWeekAnchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  nextWeekAnchor.setUTCDate(nextWeekAnchor.getUTCDate() + 7)
  return getWeekStartingBankroll(events, nextWeekAnchor)
}

function sumWeekDeposits(
  events: readonly BankrollEvent[],
  weekKey: string,
): number {
  const [y, m, d] = weekKey.split('-').map(Number)
  const weekStart = getEtWeekStart(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)))
  const weekStartMs = weekStart.getTime()
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000

  let total = 0
  for (const ev of events) {
    if (ev.event_type !== 'deposit') continue
    if (ev.bankroll_type !== 'cash') continue
    const ts = new Date(ev.occurred_at).getTime()
    if (ts >= weekStartMs && ts < weekEndMs) total += Number(ev.amount)
  }
  return Number(total.toFixed(2))
}

function sumWeekWithdrawals(
  events: readonly BankrollEvent[],
  weekKey: string,
): number {
  const [y, m, d] = weekKey.split('-').map(Number)
  const weekStart = getEtWeekStart(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)))
  const weekStartMs = weekStart.getTime()
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000

  let total = 0
  for (const ev of events) {
    if (ev.event_type !== 'withdrawal') continue
    if (ev.bankroll_type !== 'cash') continue
    const ts = new Date(ev.occurred_at).getTime()
    if (ts >= weekStartMs && ts < weekEndMs) total += Math.abs(Number(ev.amount))
  }
  return Number(total.toFixed(2))
}

/**
 * Roll the per-day report into per-week summaries. Built from the same
 * bucketing as buildDailyReport so it matches the daily view exactly.
 * Returned newest-first.
 */
export function buildWeeklySummary(
  bets: readonly Bet[],
  bankrollEvents: readonly BankrollEvent[],
): WeekSummary[] {
  const days = buildDailyReport(bets, bankrollEvents)
  if (days.length === 0) return []

  // `days` is newest-first. The first day encountered for each week holds
  // that week's final cumulative cashWeek/fpWeek tallies (running totals).
  const seen = new Map<string, WeekSummary>()
  const order: string[] = []

  for (const day of days) {
    if (!seen.has(day.weekKey)) {
      const { start, end } = weekRangeLabels(day.weekKey)
      seen.set(day.weekKey, {
        weekKey: day.weekKey,
        startLabel: start,
        endLabel: end,
        weekStartingBankroll: day.weekStartingBankroll,
        weekEndingBankroll: getWeekEndingBankroll(bankrollEvents, day.weekKey),
        betCount: 0,
        cashDeposits: sumWeekDeposits(bankrollEvents, day.weekKey),
        cashWithdrawals: sumWeekWithdrawals(bankrollEvents, day.weekKey),
        cash: { ...day.cashWeek },
        fp: { ...day.fpWeek },
        pending: { ...day.pendingWeek },
        weekPl: 0,
        accountPct: 0,
      })
      order.push(day.weekKey)
    }
    const summary = seen.get(day.weekKey)!
    summary.betCount += day.bets.length
  }

  const result = order.map((k) => seen.get(k)!)

  // Per-week (cash + FP) P/L and per-week account % as betting performance.
  // Account % is derived from weekPl (bet-driven) — NOT the balance delta —
  // so capital flows (deposits, withdrawals, manual adjustments) never count
  // as performance. Those flows are surfaced separately in cashDeposits /
  // cashWithdrawals and in the Week Start/End balances.
  for (const w of result) {
    w.weekPl = w.cash.profitLoss + w.fp.profitLoss
    w.accountPct =
      w.weekStartingBankroll > 0
        ? (w.weekPl / w.weekStartingBankroll) * 100
        : 0
  }

  return result
}
