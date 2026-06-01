import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useBets } from '@/hooks/use-bets'
import { useBankroll } from '@/hooks/use-bankroll'
import { useAutoUnitSize } from '@/hooks/use-auto-unit-size'
import type { Bet } from '@/lib/types'
import { ExportBar } from '@/components/ExportBar'
import { exportStats, exportComprehensive } from '@/utils/excel-export'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  computeStats,
  computeEdgeStats,
  buildCumulativePl,
  computeSportPerformance,
  type PerformanceRow,
} from '@/utils/stats-analytics'
import { EdgeAnalytics } from '@/components/stats/EdgeAnalytics'
import { UnitSizePerformance } from '@/components/stats/UnitSizePerformance'
import {
  ChartTimeRangePicker,
  type ChartWindow,
} from '@/components/stats/ChartTimeRangePicker'
import { useChartPan } from '@/hooks/use-chart-pan'
import { USD } from '@/lib/demo-mode'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIME_FRAMES = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'All', days: 0 },
] as const

type BalanceFilter = 'all' | 'cash' | 'freeplay'

const BALANCE_FILTERS: { label: string; value: BalanceFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Cash', value: 'cash' },
  { label: 'Freeplay', value: 'freeplay' },
]

const GROUP_DIVIDER = 'border-l border-border/60'

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d
}

function filterByTimeframe(bets: Bet[], days: number): Bet[] {
  if (days === 0) return bets
  const cutoff = daysAgo(days)
  return bets.filter((b) => new Date(b.placed_at) >= cutoff)
}

function filterByBalance(bets: Bet[], filter: BalanceFilter): Bet[] {
  if (filter === 'all') return bets
  if (filter === 'cash') return bets.filter((b) => !b.is_freeplay)
  return bets.filter((b) => b.is_freeplay)
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

function StatItem({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${color ?? ''}`}>
        {value}
      </p>
    </div>
  )
}

function fmtPct(value: number, showSign = false): string {
  const prefix = showSign && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

function edgeColor(edge: number): string {
  if (edge > 0) return 'text-green-400'
  if (edge < 0) return 'text-red-400'
  return 'text-muted-foreground'
}

// ---------------------------------------------------------------------------
// Inline KPI bar — Actual / Expected / Edge, sits in filter row
// ---------------------------------------------------------------------------

function InlineKpiBar({
  actualWinRate,
  expectedWinRate,
  edge,
  totalBets,
}: {
  actualWinRate: number
  expectedWinRate: number
  edge: number
  totalBets: number
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-1.5 text-sm"
      title={`${totalBets} decided bets · expected from implied odds`}
    >
      <InlineKpi label="Actual" value={fmtPct(actualWinRate)} />
      <span className="h-4 w-px bg-border" />
      <InlineKpi label="Exp" value={fmtPct(expectedWinRate)} />
      <span className="h-4 w-px bg-border" />
      <InlineKpi
        label="Edge"
        value={fmtPct(edge, true)}
        valueClass={edgeColor(edge)}
      />
    </div>
  )
}

function InlineKpi({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${valueClass ?? ''}`}>
        {value}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Stats() {
  const { bets, loading: betsLoading } = useBets()
  const { events: bankrollEvents } = useBankroll()
  const { unitSize } = useAutoUnitSize()
  const [timeframe, setTimeframe] = useState<number>(0)
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all')

  const filtered = useMemo(
    () => filterByBalance(filterByTimeframe(bets, timeframe), balanceFilter),
    [bets, timeframe, balanceFilter],
  )
  const stats = useMemo(() => computeStats(filtered), [filtered])
  const edgeStats = useMemo(() => computeEdgeStats(filtered), [filtered])
  const sportPerf = useMemo(
    () => computeSportPerformance(filtered, unitSize),
    [filtered, unitSize],
  )

  // Per-chart Cumulative P&L state: bypass page-level timeframe filter; keep
  // balance filter applied so the Cash/Freeplay toggle still affects the chart.
  const [plWindow, setPlWindow] = useState<ChartWindow>(null)
  const balanceFilteredBets = useMemo(
    () => filterByBalance(bets, balanceFilter),
    [bets, balanceFilter],
  )
  const fullPlData = useMemo(
    () => buildCumulativePl(balanceFilteredBets),
    [balanceFilteredBets],
  )
  const plDates = useMemo(
    () => fullPlData.map((d) => d.sortKey),
    [fullPlData],
  )
  const plPan = useChartPan({ allDates: plDates, windowDays: plWindow })
  const visiblePlData = useMemo(() => {
    if (plWindow === null) return fullPlData
    return fullPlData.filter(
      (d) =>
        d.sortKey >= plPan.visibleRange.start &&
        d.sortKey <= plPan.visibleRange.end,
    )
  }, [fullPlData, plWindow, plPan.visibleRange])

  const loading = betsLoading

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        Loading stats...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filter bar with inline KPIs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Stats</h1>
          <InlineKpiBar
            actualWinRate={edgeStats.overall.actualWinRate}
            expectedWinRate={edgeStats.overall.expectedWinRate}
            edge={edgeStats.overall.edge}
            totalBets={edgeStats.overall.totalBets}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            {BALANCE_FILTERS.map((bf) => (
              <button
                key={bf.value}
                onClick={() => setBalanceFilter(bf.value)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  balanceFilter === bf.value
                    ? 'bg-purple-500/15 text-purple-400'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {bf.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            {TIME_FRAMES.map((tf) => (
              <button
                key={tf.days}
                onClick={() => setTimeframe(tf.days)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  timeframe === tf.days
                    ? 'bg-chart-1/15 text-chart-1'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cumulative P&L Chart */}
      <Card className="glass-card" data-glow="rgba(96,165,250,1)">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">Cumulative P&L</CardTitle>
            <div className="flex items-center gap-3">
              <ChartTimeRangePicker value={plWindow} onChange={setPlWindow} />
              <span
                className={`text-base font-bold tabular-nums ${
                  stats.totalPl >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {stats.totalPl >= 0 ? '+' : ''}
                {USD.format(stats.totalPl)}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {visiblePlData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No settled bets in this window.
            </p>
          ) : (
            <div
              ref={plPan.containerRef}
              {...plPan.dragHandlers}
              className={
                plPan.disabled
                  ? ''
                  : 'cursor-grab select-none active:cursor-grabbing'
              }
              style={{ touchAction: plPan.disabled ? 'auto' : 'pan-y' }}
            >
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={visiblePlData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                  />
                  <XAxis
                    dataKey="date"
                    fontSize={11}
                    stroke="var(--color-muted-foreground)"
                    tick={{ fill: 'var(--color-muted-foreground)' }}
                  />
                  <YAxis
                    fontSize={11}
                    stroke="var(--color-muted-foreground)"
                    tick={{ fill: 'var(--color-muted-foreground)' }}
                    tickFormatter={(v) => USD.format(Number(v))}
                  />
                  <Tooltip
                    cursor={false}
                    contentStyle={{
                      backgroundColor: 'var(--color-popover)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      color: 'var(--color-popover-foreground)',
                    }}
                    formatter={(value) => {
                      const v = typeof value === 'number' ? value : 0
                      return [
                        <span key="v" style={{ color: 'var(--color-foreground)', fontWeight: 600 }}>
                          {v >= 0 ? '+' : ''}
                          {USD.format(v)}
                        </span>,
                        'Cumulative P&L',
                      ]
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="pl"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overview stat grid — filter-aware */}
      <Card className="glass-card" data-glow="rgba(250,204,21,1)">
        <CardHeader>
          <CardTitle className="text-sm">Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatItem label="Total Bets" value={String(stats.total)} />
            <StatItem
              label="Record"
              value={`${stats.wins}-${stats.losses}-${stats.pushes}`}
            />
            <StatItem label="Pending" value={String(stats.pending)} />

            {balanceFilter === 'all' && (
              <StatItem
                label="Total P&L"
                value={`${stats.totalPl >= 0 ? '+' : ''}${USD.format(stats.totalPl)}`}
                color={stats.totalPl >= 0 ? 'text-green-400' : 'text-red-400'}
              />
            )}

            <StatItem
              label="Total Wagered"
              value={USD.format(stats.totalWagered)}
            />

            {balanceFilter === 'all' && (
              <>
                <StatItem
                  label="Cash Wagered"
                  value={USD.format(stats.totalCashWagered)}
                />
                <StatItem
                  label="FP Wagered"
                  value={USD.format(stats.totalFpWagered)}
                />
              </>
            )}

            {balanceFilter !== 'freeplay' && (
              <StatItem
                label="Cash P&L"
                value={`${stats.cashPl >= 0 ? '+' : ''}${USD.format(stats.cashPl)}`}
                color={stats.cashPl >= 0 ? 'text-green-400' : 'text-red-400'}
              />
            )}

            {balanceFilter !== 'cash' && (
              <StatItem
                label="FP Earnings"
                value={`+${USD.format(stats.fpPl)}`}
                color="text-green-400"
              />
            )}

            {balanceFilter !== 'freeplay' && (
              <StatItem
                label="ROI (Cash)"
                value={`${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`}
                color={stats.roi >= 0 ? 'text-green-400' : 'text-red-400'}
              />
            )}

            <StatItem label="Avg Stake" value={USD.format(stats.avgStake)} />
            <StatItem
              label="Biggest Win"
              value={`+${USD.format(stats.biggestWin)}`}
              color="text-green-400"
            />
            <StatItem
              label="Biggest Loss"
              value={USD.format(stats.biggestLoss)}
              color="text-red-400"
            />
          </div>
        </CardContent>
      </Card>

      {/* Edge analytics — daily trend, bracket section, bet type */}
      <EdgeAnalytics
        bets={filtered}
        trendBets={balanceFilteredBets}
        unitSize={unitSize}
      />

      {/* Unit-size performance — bucket settled cash singles by stake size */}
      <UnitSizePerformance bets={filtered} unitSize={unitSize} />

      {/* Sport Performance */}
      <Card className="glass-card" data-glow="rgba(96,165,250,1)">
        <CardHeader>
          <CardTitle className="text-sm">Sport Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {sportPerf.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No bets in this timeframe.
            </p>
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <SportPerformanceTable rows={sportPerf} />
            </div>
          )}
        </CardContent>
      </Card>

      <ExportBar
        pageLabel="Stats"
        onExportPage={() => exportStats(filtered, unitSize)}
        onExportComprehensive={() =>
          exportComprehensive(bets, bankrollEvents, unitSize)
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sport Performance Table — grouped columns: [Win% | Exp% | Edge] [ROI% | Units]
// ---------------------------------------------------------------------------

function SportPerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  return (
    <Table className="min-w-[44rem]">
      <TableHeader>
        <TableRow>
          <TableHead>Sport</TableHead>
          <TableHead className="text-right">Bets</TableHead>
          <TableHead className="text-right">W-L-P</TableHead>
          <TableHead className={`text-right ${GROUP_DIVIDER}`}>Win%</TableHead>
          <TableHead className="text-right">Exp%</TableHead>
          <TableHead className="text-right">Edge</TableHead>
          <TableHead className={`text-right ${GROUP_DIVIDER}`}>ROI%</TableHead>
          <TableHead className="text-right">Units</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="text-right">{row.bets}</TableCell>
            <TableCell className="text-right">
              {row.wins}-{row.losses}-{row.pushes}
            </TableCell>
            <TableCell className={`text-right ${GROUP_DIVIDER}`}>
              {fmtPct(row.winPct)}
            </TableCell>
            <TableCell className="text-right">
              {row.expectedWinRate > 0 ? fmtPct(row.expectedWinRate) : '-'}
            </TableCell>
            <TableCell className={`text-right ${edgeColor(row.edge)}`}>
              {row.expectedWinRate > 0 ? fmtPct(row.edge, true) : '-'}
            </TableCell>
            <TableCell
              className={`text-right ${GROUP_DIVIDER} ${row.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {row.roi >= 0 ? '+' : ''}
              {row.roi.toFixed(1)}%
            </TableCell>
            <TableCell
              className={`text-right ${row.units >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {row.units >= 0 ? '+' : ''}
              {row.units.toFixed(2)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default Stats
