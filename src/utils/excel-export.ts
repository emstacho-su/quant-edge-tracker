import * as XLSX from 'xlsx'
import type { Bet, BankrollEvent } from '@/lib/types'
import {
  computeStats,
  computeEdgeStats,
  buildCumulativePl,
  computeSportPerformance,
  computeLineTypePerformance,
} from '@/utils/stats-analytics'
import { buildDailyReport } from '@/utils/daily-report'

// ---------------------------------------------------------------------------
// Performance aggregation helpers
// ---------------------------------------------------------------------------

interface PerformanceRow {
  label: string
  totalBets: number
  wins: number
  losses: number
  pushes: number
  winPct: number
  totalStaked: number
  totalProfitLoss: number
  roi: number
  unitsProfit: number
}

function computePerformance(
  bets: readonly Bet[],
  groupBy: (bet: Bet) => string,
  unitSize: number,
): PerformanceRow[] {
  const groups = new Map<string, Bet[]>()

  for (const bet of bets) {
    const key = groupBy(bet)
    const existing = groups.get(key)
    if (existing) {
      existing.push(bet)
    } else {
      groups.set(key, [bet])
    }
  }

  const rows: PerformanceRow[] = []

  for (const [label, groupBets] of groups) {
    const settled = groupBets.filter((b) => b.status !== 'pending')
    const wins = settled.filter((b) => b.status === 'won').length
    const losses = settled.filter((b) => b.status === 'lost').length
    const pushes = settled.filter((b) => b.status === 'push').length
    const denominator = wins + losses
    const winPct = denominator > 0 ? (wins / denominator) * 100 : 0
    const totalStaked = settled.reduce((sum, b) => sum + b.stake, 0)
    const totalProfitLoss = settled.reduce(
      (sum, b) => sum + (b.profit_loss ?? 0),
      0,
    )
    const roi = totalStaked > 0 ? (totalProfitLoss / totalStaked) * 100 : 0
    const unitsProfit = unitSize > 0 ? totalProfitLoss / unitSize : 0

    rows.push({
      label,
      totalBets: groupBets.length,
      wins,
      losses,
      pushes,
      winPct: Math.round(winPct * 100) / 100,
      totalStaked,
      totalProfitLoss: Math.round(totalProfitLoss * 100) / 100,
      roi: Math.round(roi * 100) / 100,
      unitsProfit: Math.round(unitsProfit * 100) / 100,
    })
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------------------
// Row formatting
// ---------------------------------------------------------------------------

function formatBetRows(bets: readonly Bet[]) {
  return bets.map((b) => ({
    ID: b.id,
    Sport: b.sport,
    Type: b.bet_type,
    Description: b.description,
    Odds: b.odds_american ?? '',
    Stake: b.stake,
    'To Win': b.to_win,
    Status: b.status,
    Freeplay: b.is_freeplay ? 'Yes' : 'No',
    'Profit/Loss': b.profit_loss ?? '',
    'Placed At': b.placed_at,
    'Settled At': b.settled_at ?? '',
    Notes: b.notes ?? '',
  }))
}

function formatPerformanceRows(rows: readonly PerformanceRow[]) {
  return rows.map((r) => ({
    Name: r.label,
    'Total Bets': r.totalBets,
    Wins: r.wins,
    Losses: r.losses,
    Pushes: r.pushes,
    'Win %': r.winPct,
    'Total Staked': r.totalStaked,
    'Total P/L': r.totalProfitLoss,
    'ROI %': r.roi,
    'Units Profit': r.unitsProfit,
  }))
}

function formatBankrollRows(events: readonly BankrollEvent[]) {
  return events.map((e) => ({
    ID: e.id,
    'Event Type': e.event_type,
    'Bankroll Type': e.bankroll_type,
    Amount: e.amount,
    'Balance After': e.balance_after,
    'Bet ID': e.bet_id ?? '',
    'Occurred At': e.occurred_at,
    Note: e.note ?? '',
  }))
}

function downloadWorkbook(wb: XLSX.WorkBook, prefix: string): void {
  const date = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `quant-edge-tracker-${prefix}-${date}.xlsx`)
}

// ---------------------------------------------------------------------------
// Comprehensive export — every detail across the app
// ---------------------------------------------------------------------------

export function exportComprehensive(
  bets: readonly Bet[],
  bankrollEvents: readonly BankrollEvent[],
  unitSize: number,
): void {
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(formatBetRows(bets.filter((b) => !b.is_freeplay))),
    'Cash Bets',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(formatBetRows(bets.filter((b) => b.is_freeplay))),
    'FP Bets',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      formatPerformanceRows(computePerformance(bets, (b) => b.sport, unitSize)),
    ),
    'Sport Performance',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      formatPerformanceRows(
        computePerformance(bets, (b) => b.bet_type, unitSize),
      ),
    ),
    'Bet Type Performance',
  )

  // Stats overview
  const stats = computeStats(bets)
  const overviewSheet = XLSX.utils.json_to_sheet([
    { Metric: 'Total Bets', Value: stats.total },
    { Metric: 'Wins', Value: stats.wins },
    { Metric: 'Losses', Value: stats.losses },
    { Metric: 'Pushes', Value: stats.pushes },
    { Metric: 'Pending', Value: stats.pending },
    { Metric: 'Total P/L', Value: stats.totalPl },
    { Metric: 'Cash P/L', Value: stats.cashPl },
    { Metric: 'FP P/L', Value: stats.fpPl },
    { Metric: 'Total Wagered', Value: stats.totalWagered },
    { Metric: 'Cash Wagered', Value: stats.totalCashWagered },
    { Metric: 'FP Wagered', Value: stats.totalFpWagered },
    { Metric: 'ROI %', Value: stats.roi },
    { Metric: 'Avg Stake', Value: stats.avgStake },
    { Metric: 'Biggest Win', Value: stats.biggestWin },
    { Metric: 'Biggest Loss', Value: stats.biggestLoss },
  ])
  XLSX.utils.book_append_sheet(wb, overviewSheet, 'Stats Overview')

  // Cumulative P/L series
  const cumPl = buildCumulativePl(bets)
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      cumPl.map((p) => ({ Date: p.date, 'Cumulative P/L': p.pl })),
    ),
    'Cumulative P&L',
  )

  // Daily report
  const report = buildDailyReport(bets, bankrollEvents)
  const reportRows = report.flatMap((day) =>
    day.bets.map((b) => ({
      Date: day.dateKey,
      Sport: b.bet.sport,
      Description: b.bet.description,
      Stake: b.bet.stake,
      'To Win': b.bet.to_win,
      Result: b.resultLabel,
      'P/L': b.bet.profit_loss ?? '',
      'Pct of Bankroll': b.pctOfBankroll,
      Freeplay: b.isFreeplay ? 'Yes' : 'No',
    })),
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(reportRows),
    'Daily Report',
  )

  // Bankroll history
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(formatBankrollRows(bankrollEvents)),
    'Bankroll History',
  )

  downloadWorkbook(wb, 'comprehensive')
}

// Backwards-compat alias.
export const exportToExcel = exportComprehensive

// ---------------------------------------------------------------------------
// Page-specific exports
// ---------------------------------------------------------------------------

export function exportDashboard(
  bets: readonly Bet[],
  bankrollEvents: readonly BankrollEvent[],
  unitSize: number,
): void {
  const wb = XLSX.utils.book_new()

  // Bankroll over time — same transform as the dashboard chart
  const sorted = [...bankrollEvents].sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  )
  const dateMap = new Map<string, { cash: number | null; freeplay: number | null }>()
  for (const evt of sorted) {
    const dateKey = evt.occurred_at.slice(0, 10)
    const current = dateMap.get(dateKey) ?? { cash: null, freeplay: null }
    if (evt.bankroll_type === 'cash') current.cash = evt.balance_after
    else current.freeplay = evt.balance_after
    dateMap.set(dateKey, current)
  }
  let lastCash = 0
  let lastFp = 0
  const series = Array.from(dateMap.entries()).map(([date, val]) => {
    if (val.cash !== null) lastCash = val.cash
    if (val.freeplay !== null) lastFp = val.freeplay
    return { Date: date, Cash: lastCash, Freeplay: lastFp }
  })
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(series),
    'Bankroll Over Time',
  )

  // Sport performance (cash only, matches dashboard)
  const cashBets = bets.filter((b) => !b.is_freeplay)
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      formatPerformanceRows(
        computePerformance(cashBets, (b) => b.sport, unitSize),
      ),
    ),
    'Sport Performance',
  )

  downloadWorkbook(wb, 'dashboard')
}

export function exportStats(
  bets: readonly Bet[],
  unitSize: number,
): void {
  const wb = XLSX.utils.book_new()

  const stats = computeStats(bets)
  const edge = computeEdgeStats(bets)
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Metric: 'Total Bets', Value: stats.total },
      { Metric: 'Wins', Value: stats.wins },
      { Metric: 'Losses', Value: stats.losses },
      { Metric: 'Pushes', Value: stats.pushes },
      { Metric: 'Pending', Value: stats.pending },
      { Metric: 'Total P/L', Value: stats.totalPl },
      { Metric: 'Cash P/L', Value: stats.cashPl },
      { Metric: 'FP P/L', Value: stats.fpPl },
      { Metric: 'Total Wagered', Value: stats.totalWagered },
      { Metric: 'ROI %', Value: stats.roi },
      { Metric: 'Avg Stake', Value: stats.avgStake },
      { Metric: 'Biggest Win', Value: stats.biggestWin },
      { Metric: 'Biggest Loss', Value: stats.biggestLoss },
      { Metric: 'Actual Win Rate %', Value: edge.overall.actualWinRate },
      { Metric: 'Expected Win Rate %', Value: edge.overall.expectedWinRate },
      { Metric: 'Edge %', Value: edge.overall.edge },
    ]),
    'Overview',
  )

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      buildCumulativePl(bets).map((p) => ({
        Date: p.date,
        'Cumulative P/L': p.pl,
      })),
    ),
    'Cumulative P&L',
  )

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      computeSportPerformance(bets, unitSize).map((r) => ({
        Sport: r.label,
        Bets: r.bets,
        Wins: r.wins,
        Losses: r.losses,
        Pushes: r.pushes,
        'Win %': r.winPct,
        'Expected Win %': r.expectedWinRate,
        'Edge %': r.edge,
        'ROI %': r.roi,
        Units: r.units,
      })),
    ),
    'Sport Performance',
  )

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      computeLineTypePerformance(bets, unitSize).map((r) => ({
        'Bet Type': r.label,
        Bets: r.bets,
        'Win %': r.winPct,
        'ROI %': r.roi,
        Units: r.units,
      })),
    ),
    'Bet Type Performance',
  )

  downloadWorkbook(wb, 'stats')
}

export function exportReport(
  bets: readonly Bet[],
  bankrollEvents: readonly BankrollEvent[],
): void {
  const wb = XLSX.utils.book_new()
  const report = buildDailyReport(bets, bankrollEvents)

  // One row per bet with day-level context
  const detailRows = report.flatMap((day) =>
    day.bets.map((b) => ({
      Date: day.dateKey,
      'Day Label': day.dateLabel,
      Week: day.weekKey,
      'Week Base': day.weekStartingBankroll,
      Sport: b.bet.sport,
      Description: b.bet.description,
      Stake: b.bet.stake,
      'To Win': b.bet.to_win,
      Status: b.bet.status,
      Freeplay: b.isFreeplay ? 'Yes' : 'No',
      'P/L': b.bet.profit_loss ?? '',
      'Pct of Bankroll': b.pctOfBankroll,
      Result: b.resultLabel,
    })),
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(detailRows),
    'Daily Bets',
  )

  // Day-level tally summary
  const tallyRows = report.map((day) => ({
    Date: day.dateKey,
    'Cash Day W-L-P': `${day.cashDay.wins}-${day.cashDay.losses}-${day.cashDay.pushes}`,
    'Cash Day P/L': day.cashDay.profitLoss,
    'Cash Day %': day.cashDay.pctOfBankroll,
    'Cash Week W-L-P': `${day.cashWeek.wins}-${day.cashWeek.losses}-${day.cashWeek.pushes}`,
    'Cash Week P/L': day.cashWeek.profitLoss,
    'Cash Week %': day.cashWeek.pctOfBankroll,
    'FP Day W-L-P': `${day.fpDay.wins}-${day.fpDay.losses}-${day.fpDay.pushes}`,
    'FP Day P/L': day.fpDay.profitLoss,
    'FP Week W-L-P': `${day.fpWeek.wins}-${day.fpWeek.losses}-${day.fpWeek.pushes}`,
    'FP Week P/L': day.fpWeek.profitLoss,
  }))
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(tallyRows),
    'Daily Tallies',
  )

  downloadWorkbook(wb, 'report')
}

export function exportBetLog(bets: readonly Bet[]): void {
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(formatBetRows(bets)),
    'All Bets',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(formatBetRows(bets.filter((b) => !b.is_freeplay))),
    'Cash Bets',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(formatBetRows(bets.filter((b) => b.is_freeplay))),
    'FP Bets',
  )

  // Parlay legs flattened
  const legRows = bets.flatMap((b) =>
    (b.parlay_legs ?? []).map((leg) => ({
      'Bet ID': b.id,
      'Bet Description': b.description,
      'Leg Description': leg.description,
      Sport: leg.sport ?? '',
      Odds: leg.odds_american ?? '',
      'Leg Status': leg.leg_status,
    })),
  )
  if (legRows.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(legRows),
      'Parlay Legs',
    )
  }

  downloadWorkbook(wb, 'bet-log')
}
