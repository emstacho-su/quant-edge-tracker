import { useMemo, useState, useCallback } from 'react'
import { useBets } from '@/hooks/use-bets'
import { useBankroll } from '@/hooks/use-bankroll'
import { useAutoUnitSize } from '@/hooks/use-auto-unit-size'
import { useViewport } from '@/hooks/useViewport'
import { MobileBetSheet } from '@/components/MobileBetSheet'
import {
  buildDailyReport,
  buildWeeklySummary,
  type DailyReportDay,
  type ReportBet,
  type ReportTally,
  type WeekSummary,
} from '@/utils/daily-report'
import { ExportBar } from '@/components/ExportBar'
import { EditBetForm } from '@/components/EditBetForm'
import { exportReport, exportComprehensive } from '@/utils/excel-export'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { USD } from '@/lib/demo-mode'
import { AuthActions } from '@/components/auth/AuthGate'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtSignedPct(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '+0.00%'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function fmtSignedUsd(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${USD.format(value)}`
}

function resultClass(label: ReportBet['resultLabel']): string {
  switch (label) {
    case 'Win':
      return 'text-green-400'
    case 'Loss':
      return 'text-red-400'
    case 'Push':
      return 'text-amber-400'
    case 'Void':
      return 'text-muted-foreground'
    default:
      return 'text-sky-400'
  }
}

function pctClass(value: number, isPending: boolean): string {
  if (isPending) return 'text-sky-400/80'
  if (value > 0) return 'text-green-400'
  if (value < 0) return 'text-red-400'
  return 'text-muted-foreground'
}

function recordLabel(tally: ReportTally): string {
  const parts: string[] = [`${tally.wins}-${tally.losses}-${tally.pushes}`]
  if (tally.voids > 0) parts.push(`${tally.voids}V`)
  return parts.join(' · ')
}

function recordVerdict(tally: ReportTally): 'Win' | 'Loss' | 'Push' | '' {
  if (tally.wins === 0 && tally.losses === 0 && tally.pushes === 0) return ''
  if (tally.profitLoss > 0) return 'Win'
  if (tally.profitLoss < 0) return 'Loss'
  return 'Push'
}

// ---------------------------------------------------------------------------
// Daily-view subcomponents
// ---------------------------------------------------------------------------

function fmtUnsignedPct(value: number): string {
  if (!Number.isFinite(value)) return '0.00%'
  return `${Math.abs(value).toFixed(2)}%`
}

interface BetRowProps {
  reportBet: ReportBet
  expanded: boolean
  editing: boolean
  onToggle: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSettle: (status: 'won' | 'lost' | 'push' | 'void') => void
  onEditSave: (patch: {
    stake?: number
    odds_american?: number | null
    status?: 'pending' | 'won' | 'lost' | 'push' | 'void'
  }) => Promise<void>
  settlingStatus: 'won' | 'lost' | 'push' | 'void' | null
}

function BetRow({
  reportBet,
  expanded,
  editing,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onSettle,
  onEditSave,
  settlingStatus,
}: BetRowProps) {
  const { bet, resultLabel, pctOfBankroll, isFreeplay } = reportBet
  const pending = resultLabel === 'Pending'
  // Pending bets show stake-at-risk as a plain magnitude (no sign).
  // Settled bets keep the signed +/- pct.
  const pctText = pending
    ? fmtUnsignedPct(pctOfBankroll)
    : fmtSignedPct(pctOfBankroll)

  const rowInteractive = 'cursor-pointer rounded-md transition-colors hover:bg-muted/30'

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className={`grid grid-cols-[64px_24px_1fr_auto] items-baseline gap-3 px-1 py-2 text-sm ${rowInteractive}`}
      >
        <span className={`font-semibold tabular-nums ${resultClass(resultLabel)}`}>
          {resultLabel}
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground">
          {bet.bet_type === 'parlay' ? 'P' : 'S'}
        </span>
        <span className="truncate">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {bet.sport}
          </span>
          {isFreeplay && (
            <span className="mr-1.5 inline-block rounded bg-purple-500/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-purple-300">
              FP
            </span>
          )}
          <span className="text-foreground/90">{bet.description}</span>
        </span>
        <span
          className={`font-semibold tabular-nums ${pctClass(pctOfBankroll, pending)}`}
          title={pending ? 'Stake at risk as % of week-start bankroll' : undefined}
        >
          {pctText}
        </span>
      </div>

      {expanded && !editing && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-t border-border/30 bg-muted/20 px-3 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="w-full text-xs text-foreground/80 mb-2 break-words">{bet.description}</p>
          <AuthActions>
            {pending ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Settle as:
                </span>
                <SettleButton
                  label="Won"
                  tone="green"
                  busy={settlingStatus === 'won'}
                  disabled={settlingStatus !== null}
                  onClick={() => onSettle('won')}
                />
                <SettleButton
                  label="Lost"
                  tone="red"
                  busy={settlingStatus === 'lost'}
                  disabled={settlingStatus !== null}
                  onClick={() => onSettle('lost')}
                />
                <SettleButton
                  label="Push"
                  tone="amber"
                  busy={settlingStatus === 'push'}
                  disabled={settlingStatus !== null}
                  onClick={() => onSettle('push')}
                />
                <SettleButton
                  label="Void"
                  tone="muted"
                  busy={settlingStatus === 'void'}
                  disabled={settlingStatus !== null}
                  onClick={() => onSettle('void')}
                />
              </div>
            ) : (
              <span />
            )}
          </AuthActions>
          <AuthActions>
            <Button
              size="xs"
              variant="outline"
              onClick={onStartEdit}
              disabled={settlingStatus !== null}
            >
              Edit Entry
            </Button>
          </AuthActions>
        </div>
      )}

      {expanded && editing && (
        <div
          className="border-t border-border/30 bg-muted/20 px-3 py-3"
          onClick={(e) => e.stopPropagation()}
        >
          <EditBetForm bet={bet} onSave={onEditSave} onCancel={onCancelEdit} />
        </div>
      )}
    </div>
  )
}

function SettleButton({
  label,
  tone,
  busy,
  disabled,
  onClick,
}: {
  label: string
  tone: 'green' | 'red' | 'amber' | 'muted'
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  const toneClass = {
    green: 'bg-green-600 text-white hover:bg-green-700',
    red: 'bg-red-600 text-white hover:bg-red-700',
    amber: 'bg-amber-600 text-white hover:bg-amber-700',
    muted: 'bg-zinc-600 text-white hover:bg-zinc-700',
  }[tone]
  return (
    <Button
      size="xs"
      className={`${toneClass} disabled:opacity-60`}
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? '...' : label}
    </Button>
  )
}

function PendingBlock({
  count,
  pctOfBankroll,
}: {
  count: number
  pctOfBankroll: number
}) {
  if (count === 0) return null
  return (
    <div className="flex flex-col items-end gap-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-400/80">
        Pending
      </p>
      <p className="text-base font-semibold tabular-nums text-sky-400">
        {pctOfBankroll.toFixed(2)}%
      </p>
      <p className="text-[10px] text-muted-foreground">
        {count} bet{count === 1 ? '' : 's'} pending
      </p>
    </div>
  )
}

function TallyBlock({
  label,
  period,
  tally,
}: {
  label: string
  period: 'DAY' | 'WEEK'
  tally: ReportTally
}) {
  const verdict = recordVerdict(tally)
  const pct = tally.pctOfBankroll
  const pctColor =
    pct > 0 ? 'text-green-400' : pct < 0 ? 'text-red-400' : 'text-muted-foreground'

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label} · {period}
      </p>
      <p className="text-sm tabular-nums">
        <span className="font-semibold">{recordLabel(tally)}</span>
        {verdict && (
          <span className="ml-1.5 text-xs uppercase text-muted-foreground">
            {verdict}
          </span>
        )}
        <span className={`ml-2 font-semibold ${pctColor}`}>
          {fmtSignedPct(pct)}
        </span>
      </p>
    </div>
  )
}

interface DaySectionProps {
  day: DailyReportDay
  expandedBetId: string | null
  editingBetId: string | null
  inlineEdit: boolean
  onToggleBet: (betId: string) => void
  onStartEdit: (betId: string) => void
  onCancelEdit: () => void
  onSettleBet: (
    betId: string,
    status: 'won' | 'lost' | 'push' | 'void',
  ) => void
  onEditSave: (
    betId: string,
    patch: {
      stake?: number
      odds_american?: number | null
      status?: 'pending' | 'won' | 'lost' | 'push' | 'void'
    },
  ) => Promise<void>
  settlingState: { betId: string; status: 'won' | 'lost' | 'push' | 'void' } | null
}

function DaySection({
  day,
  expandedBetId,
  editingBetId,
  inlineEdit,
  onToggleBet,
  onStartEdit,
  onCancelEdit,
  onSettleBet,
  onEditSave,
  settlingState,
}: DaySectionProps) {
  return (
    <Card className="glass-card" data-glow="rgba(96,165,250,1)">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-baseline justify-between text-base">
          <span>{day.dateLabel}</span>
          {day.weekStartingBankroll > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              Week base: {USD.format(day.weekStartingBankroll)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col">
          {day.bets.map((b) => (
            <BetRow
              key={b.bet.id}
              reportBet={b}
              expanded={expandedBetId === b.bet.id}
              editing={inlineEdit && editingBetId === b.bet.id}
              onToggle={() => onToggleBet(b.bet.id)}
              onStartEdit={() => onStartEdit(b.bet.id)}
              onCancelEdit={onCancelEdit}
              onSettle={(status) => onSettleBet(b.bet.id, status)}
              onEditSave={(patch) => onEditSave(b.bet.id, patch)}
              settlingStatus={
                settlingState?.betId === b.bet.id ? settlingState.status : null
              }
            />
          ))}
        </div>

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="flex flex-col gap-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Cumulative
              </p>
              <p className="text-[10px] text-muted-foreground">Cash week</p>
              <p className={`text-sm tabular-nums font-semibold ${pctClass(day.cashWeek.pctOfBankroll, false)}`}>
                {fmtSignedPct(day.cashWeek.pctOfBankroll)}
              </p>
              <p className="text-[10px] text-muted-foreground">FP week</p>
              <p className={`text-sm tabular-nums font-semibold ${pctClass(day.fpWeek.pctOfBankroll, false)}`}>
                {fmtSignedPct(day.fpWeek.pctOfBankroll)}
              </p>
            </div>
            <TallyBlock label="Cash" period="DAY" tally={day.cashDay} />
            <TallyBlock label="Cash" period="WEEK" tally={day.cashWeek} />
            <TallyBlock label="FP" period="DAY" tally={day.fpDay} />
            <TallyBlock label="FP" period="WEEK" tally={day.fpWeek} />
          </div>
          <PendingBlock
            count={day.pendingDay.count}
            pctOfBankroll={day.pendingDay.pctOfBankroll}
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Weekly-view table
// ---------------------------------------------------------------------------

function tallySignClass(value: number): string {
  if (value > 0) return 'text-green-400'
  if (value < 0) return 'text-red-400'
  return 'text-muted-foreground'
}

function WeekSummaryTable({ weeks }: { weeks: WeekSummary[] }) {
  return (
    <Card className="glass-card" data-glow="rgba(250,204,21,1)">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Weekly Summary</CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:px-3">
        <Table className="w-full text-xs [&_th]:px-2 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
          <TableHeader>
            <TableRow>
              <TableHead>Week</TableHead>
              <TableHead className="text-right">Bets</TableHead>
              <TableHead className="text-right">Cash Rec</TableHead>
              <TableHead className="text-right">Cash P/L</TableHead>
              <TableHead className="text-right">Cash %</TableHead>
              <TableHead className="text-right">FP Rec</TableHead>
              <TableHead className="text-right">FP P/L</TableHead>
              <TableHead className="text-right">FP %</TableHead>
              <TableHead className="text-right">Week Start</TableHead>
              <TableHead className="text-right">Week End</TableHead>
              <TableHead className="text-right">Week P/L</TableHead>
              <TableHead
                className="text-right"
                title="Betting P/L as % of week-start bankroll. Excludes deposits, withdrawals, and manual adjustments."
              >
                Account %
              </TableHead>
              <TableHead className="text-right">Deposits</TableHead>
              <TableHead className="text-right">Withdrawals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeks.map((w) => (
              <TableRow key={w.weekKey}>
                <TableCell className="font-medium">
                  {w.startLabel} – {w.endLabel}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {w.betCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {recordLabel(w.cash)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${tallySignClass(w.cash.profitLoss)}`}
                >
                  {w.cash.profitLoss === 0
                    ? USD.format(0)
                    : fmtSignedUsd(w.cash.profitLoss)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${tallySignClass(w.cash.pctOfBankroll)}`}
                >
                  {fmtSignedPct(w.cash.pctOfBankroll)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {recordLabel(w.fp)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${tallySignClass(w.fp.profitLoss)}`}
                >
                  {w.fp.profitLoss === 0
                    ? USD.format(0)
                    : fmtSignedUsd(w.fp.profitLoss)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${tallySignClass(w.fp.pctOfBankroll)}`}
                >
                  {fmtSignedPct(w.fp.pctOfBankroll)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {USD.format(w.weekStartingBankroll)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {USD.format(w.weekEndingBankroll)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${tallySignClass(w.weekPl)}`}
                >
                  {w.weekPl === 0 ? USD.format(0) : fmtSignedUsd(w.weekPl)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${tallySignClass(w.accountPct)}`}
                >
                  {fmtSignedPct(w.accountPct)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    w.cashDeposits > 0 ? 'text-green-400' : 'text-muted-foreground'
                  }`}
                >
                  {w.cashDeposits > 0
                    ? fmtSignedUsd(w.cashDeposits)
                    : USD.format(0)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    w.cashWithdrawals > 0 ? 'text-red-400' : 'text-muted-foreground'
                  }`}
                >
                  {w.cashWithdrawals > 0
                    ? `-${USD.format(w.cashWithdrawals)}`
                    : USD.format(0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface Week {
  weekKey: string
  label: string
  days: DailyReportDay[]
}

function formatWeekLabel(weekKey: string, days: DailyReportDay[]): string {
  const [y, m, d] = weekKey.split('-').map(Number)
  const monday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  const fmt = (date: Date) =>
    date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
  const bets = days.reduce((n, day) => n + day.bets.length, 0)
  return `${fmt(monday)} – ${fmt(sunday)} (${bets} bet${bets !== 1 ? 's' : ''})`
}

type ViewMode = 'daily' | 'weekly'

function DailyReport() {
  const { bets, loading: betsLoading, settleBet, editBet } = useBets()
  const { events, loading: bankrollLoading, refetch: refetchBankroll } = useBankroll()
  const { unitSize } = useAutoUnitSize()
  const { isMobile } = useViewport()

  const [view, setView] = useState<ViewMode>('daily')
  const [weekIndex, setWeekIndex] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [noDataForPick, setNoDataForPick] = useState(false)
  const [expandedBetId, setExpandedBetId] = useState<string | null>(null)
  const [editingBetId, setEditingBetId] = useState<string | null>(null)
  const [settlingState, setSettlingState] = useState<{
    betId: string
    status: 'won' | 'lost' | 'push' | 'void'
  } | null>(null)
  const [settleError, setSettleError] = useState<string | null>(null)

  const toggleBet = useCallback((betId: string) => {
    setSettleError(null)
    setEditingBetId(null)
    setExpandedBetId((current) => (current === betId ? null : betId))
  }, [])

  const startEdit = useCallback((betId: string) => {
    setSettleError(null)
    setEditingBetId(betId)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingBetId(null)
  }, [])

  const handleSettle = useCallback(
    async (betId: string, status: 'won' | 'lost' | 'push' | 'void') => {
      setSettleError(null)
      setSettlingState({ betId, status })
      try {
        await settleBet(betId, status)
        setExpandedBetId(null)
      } catch (err: unknown) {
        setSettleError(
          err instanceof Error ? err.message : 'Failed to settle bet.',
        )
      } finally {
        setSettlingState(null)
      }
    },
    [settleBet],
  )

  const handleEditSave = useCallback(
    async (
      betId: string,
      patch: {
        stake?: number
        odds_american?: number | null
        status?: 'pending' | 'won' | 'lost' | 'push' | 'void'
      },
    ) => {
      setSettleError(null)
      try {
        await editBet(betId, patch)
        await refetchBankroll()
        setEditingBetId(null)
        setExpandedBetId(null)
      } catch (err: unknown) {
        setSettleError(
          err instanceof Error ? err.message : 'Failed to edit bet.',
        )
        throw err
      }
    },
    [editBet, refetchBankroll],
  )

  const report = useMemo(() => buildDailyReport(bets, events), [bets, events])

  const weeks = useMemo<Week[]>(() => {
    const map = new Map<string, DailyReportDay[]>()
    for (const day of report) {
      const bucket = map.get(day.weekKey) ?? []
      bucket.push(day)
      map.set(day.weekKey, bucket)
    }
    return Array.from(map.entries())
      .map(([weekKey, days]) => ({
        weekKey,
        label: formatWeekLabel(weekKey, days),
        days,
      }))
      .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
  }, [report])

  const weeklySummary = useMemo(
    () => buildWeeklySummary(bets, events),
    [bets, events],
  )

  const loading = betsLoading || bankrollLoading

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        Loading report...
      </div>
    )
  }

  if (weeks.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Weekly Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily results grouped by week (Mon–Sun, ET).
          </p>
        </header>
        <Card className="glass-card" data-glow="rgba(96,165,250,1)">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No bets yet.
          </CardContent>
        </Card>
      </div>
    )
  }

  const currentWeek = weeks[weekIndex]

  return (
    <div
      className={`mx-auto space-y-4 ${
        view === 'weekly' ? 'max-w-7xl' : 'max-w-5xl'
      }`}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Weekly Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === 'daily'
              ? currentWeek.label
              : `${weeklySummary.length} week${weeklySummary.length === 1 ? '' : 's'} of activity`}
          </p>
        </div>
        <div className="flex w-full items-center gap-1 rounded-lg border border-border bg-card p-0.5 sm:w-auto">
          <button
            onClick={() => setView('daily')}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-medium sm:flex-none sm:py-1 ${
              view === 'daily'
                ? 'bg-chart-1/15 text-chart-1'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setView('weekly')}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-medium sm:flex-none sm:py-1 ${
              view === 'weekly'
                ? 'bg-chart-1/15 text-chart-1'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Weekly
          </button>
        </div>
      </header>

      {view === 'daily' && (
        <>
          <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
            <div className="flex gap-1 overflow-x-auto no-scrollbar pb-0.5">
              {weeks.map((week, idx) => (
                <button
                  key={week.weekKey}
                  onClick={() => setWeekIndex(idx)}
                  className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap ${
                    idx === weekIndex
                      ? 'bg-chart-1/15 text-chart-1'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {new Date(week.weekKey + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </button>
              ))}
              <Popover open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) setNoDataForPick(false) }}>
                <PopoverTrigger
                  className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap"
                >
                  …
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    onSelect={(date) => {
                      setNoDataForPick(false)
                      if (!date) return
                      const idx = weeks.findIndex((w) => {
                        const monday = new Date(w.weekKey + 'T12:00:00')
                        const sunday = new Date(monday)
                        sunday.setDate(monday.getDate() + 6)
                        return date >= monday && date <= sunday
                      })
                      if (idx >= 0) {
                        setWeekIndex(idx)
                        setPickerOpen(false)
                      } else {
                        setNoDataForPick(true)
                      }
                    }}
                  />
                  {noDataForPick && (
                    <p className="text-xs text-muted-foreground p-3">No data for this week.</p>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {settleError && (
            <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {settleError}
            </p>
          )}

          {currentWeek.days.map((day) => (
            <DaySection
              key={day.dateKey}
              day={day}
              expandedBetId={expandedBetId}
              editingBetId={editingBetId}
              inlineEdit={!isMobile}
              onToggleBet={toggleBet}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onSettleBet={handleSettle}
              onEditSave={handleEditSave}
              settlingState={settlingState}
            />
          ))}
        </>
      )}

      {view === 'weekly' && <WeekSummaryTable weeks={weeklySummary} />}

      {isMobile && (
        <MobileBetSheet
          bet={
            editingBetId
              ? bets.find((b) => b.id === editingBetId) ?? null
              : null
          }
          open={editingBetId !== null}
          onOpenChange={(open) => {
            if (!open) cancelEdit()
          }}
          onSave={async (patch) => {
            if (editingBetId) await handleEditSave(editingBetId, patch)
          }}
        />
      )}

      <ExportBar
        pageLabel="Report"
        onExportPage={() => exportReport(bets, events)}
        onExportComprehensive={() =>
          exportComprehensive(bets, events, unitSize)
        }
      />
    </div>
  )
}

export default DailyReport
