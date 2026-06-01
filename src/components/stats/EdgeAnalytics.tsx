import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { Bet } from '@/lib/types'
import {
  computeEdgeStats,
  computeLineTypePerformance,
  computeDailyWinRateTrend,
  classifyUnitBucket,
  UNIT_BUCKETS,
  type BracketRow,
  type LineTypeRow,
} from '@/utils/stats-analytics'
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
  ChartTimeRangePicker,
  type ChartWindow,
} from '@/components/stats/ChartTimeRangePicker'
import { useChartPan } from '@/hooks/use-chart-pan'
import { useViewport } from '@/hooks/useViewport'
import { USD } from '@/lib/demo-mode'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EdgeAnalyticsProps {
  /** Page-filtered bets — used for bracket and line-type tables. */
  bets: readonly Bet[]
  /** Pre-page-filter bets (balance-filter applied) — used by the Win Rate
   *  Trend chart so its per-chart timeline window can override the page-
   *  level timeframe filter. */
  trendBets: readonly Bet[]
  unitSize: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-popover-foreground)',
}

// Column group separator — subtle border between logical column groups.
const GROUP_DIVIDER = 'border-l border-border/60'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edgeColor(edge: number): string {
  if (edge > 0) return 'text-green-400'
  if (edge < 0) return 'text-red-400'
  return 'text-muted-foreground'
}

function fmtPct(value: number, showSign = false): string {
  const prefix = showSign && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

// ---------------------------------------------------------------------------
// Win Rate Trend Chart (daily + 7-day rolling, auto-scaled)
// ---------------------------------------------------------------------------

function WinRateTrendChart({
  bets,
  unitSize,
}: {
  bets: readonly Bet[]
  unitSize: number
}) {
  const [bucket, setBucket] = useState<string>('all')
  const { isMobile } = useViewport()
  const [trendWindow, setTrendWindow] = useState<ChartWindow>(() =>
    isMobile ? 7 : 30,
  )

  // Per-bucket bet counts so we can disable pills with no data.
  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 }
    for (const b of UNIT_BUCKETS) counts[b.key] = 0
    for (const bet of bets) {
      if (bet.bet_type === 'parlay') continue
      if (bet.is_freeplay) continue
      const key = classifyUnitBucket(bet.stake, unitSize)
      if (!key) continue
      counts.all += 1
      counts[key] += 1
    }
    return counts
  }, [bets, unitSize])

  // Apply bucket filter before bucketing by day.
  const filteredBets = useMemo(() => {
    if (bucket === 'all') return bets
    return bets.filter((b) => {
      if (b.bet_type === 'parlay') return false
      if (b.is_freeplay) return false
      return classifyUnitBucket(b.stake, unitSize) === bucket
    })
  }, [bets, bucket, unitSize])

  const fullData = useMemo(
    () => computeDailyWinRateTrend(filteredBets),
    [filteredBets],
  )

  const trendDates = useMemo(() => fullData.map((d) => d.sortKey), [fullData])
  const pan = useChartPan({ allDates: trendDates, windowDays: trendWindow })

  const data = useMemo(() => {
    if (trendWindow === null) return fullData
    return fullData.filter(
      (d) =>
        d.sortKey >= pan.visibleRange.start &&
        d.sortKey <= pan.visibleRange.end,
    )
  }, [fullData, trendWindow, pan.visibleRange])

  const { yMin, yMax } = useMemo(() => {
    const values: number[] = []
    for (const d of data) {
      if (d.actualWinRate != null) values.push(d.actualWinRate)
      if (d.expectedWinRate != null) values.push(d.expectedWinRate)
    }
    if (values.length === 0) return { yMin: 0, yMax: 100 }
    const min = Math.min(...values)
    const max = Math.max(...values)
    return {
      yMin: Math.max(0, Math.floor((min - 5) / 5) * 5),
      yMax: Math.min(100, Math.ceil((max + 5) / 5) * 5),
    }
  }, [data])

  const pillRow = unitSize > 0 && bucketCounts.all > 0 && (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-0.5">
      <button
        onClick={() => setBucket('all')}
        className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
          bucket === 'all'
            ? 'bg-purple-500/15 text-purple-400'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        All
      </button>
      {UNIT_BUCKETS.map((b) => {
        const disabled = (bucketCounts[b.key] ?? 0) === 0
        return (
          <button
            key={b.key}
            onClick={() => !disabled && setBucket(b.key)}
            disabled={disabled}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              disabled
                ? 'cursor-not-allowed text-muted-foreground/40'
                : bucket === b.key
                  ? 'bg-purple-500/15 text-purple-400'
                  : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {b.label}
          </button>
        )
      })}
    </div>
  )

  const timeRangePicker = (
    <ChartTimeRangePicker value={trendWindow} onChange={setTrendWindow} />
  )

  if (data.length === 0) {
    return (
      <Card className="glass-card" data-glow="rgba(96,165,250,1)">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">Win Rate Trend</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {timeRangePicker}
              {pillRow}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            {bucket === 'all'
              ? 'Not enough settled bets with odds for trend data.'
              : `No settled ${bucket} bets with odds in this timeframe.`}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="glass-card" data-glow="rgba(96,165,250,1)">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            Win Rate Trend (Daily)
            {bucket !== 'all' && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                · {UNIT_BUCKETS.find((b) => b.key === bucket)?.label} plays only
              </span>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {timeRangePicker}
            {pillRow}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={pan.containerRef}
          {...pan.dragHandlers}
          className={
            pan.disabled ? '' : 'cursor-grab select-none active:cursor-grabbing'
          }
          style={{ touchAction: pan.disabled ? 'auto' : 'pan-y' }}
        >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="label"
              fontSize={11}
              stroke="var(--color-muted-foreground)"
              tick={{ fill: 'var(--color-muted-foreground)' }}
            />
            <YAxis
              fontSize={11}
              stroke="var(--color-muted-foreground)"
              tick={{ fill: 'var(--color-muted-foreground)' }}
              domain={[yMin, yMax]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              cursor={false}
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => [
                value == null
                  ? '—'
                  : `${(typeof value === 'number' ? value : 0).toFixed(1)}%`,
                String(name),
              ]}
            />
            <Legend />
            {yMin <= 50 && yMax >= 50 && (
              <ReferenceLine
                y={50}
                stroke="var(--color-muted-foreground)"
                strokeDasharray="3 3"
                strokeOpacity={0.4}
              />
            )}
            <Line
              type="monotone"
              dataKey="actualWinRate"
              name="Actual"
              stroke="var(--color-chart-1)"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="expectedWinRate"
              name="Expected"
              stroke="var(--color-chart-2)"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Odds Bracket Section (Option C — pill filter + compact chart)
// ---------------------------------------------------------------------------

function BracketPills({
  data,
  selected,
  onSelect,
}: {
  data: BracketRow[]
  selected: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-0.5">
      <button
        onClick={() => onSelect('all')}
        className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
          selected === 'all'
            ? 'bg-purple-500/15 text-purple-400'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        All
      </button>
      {data.map((row) => {
        const disabled = row.totalBets === 0
        return (
          <button
            key={row.bracketKey}
            onClick={() => !disabled && onSelect(row.bracketKey)}
            disabled={disabled}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              disabled
                ? 'cursor-not-allowed text-muted-foreground/40'
                : selected === row.bracketKey
                  ? 'bg-purple-500/15 text-purple-400'
                  : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {row.label}
          </button>
        )
      })}
    </div>
  )
}

function BracketSideStats({ row }: { row: BracketRow }) {
  const plPositive = row.profitLoss >= 0
  return (
    <div className="grid h-full grid-cols-[1fr_auto] content-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <span className="text-muted-foreground">Bets</span>
      <span className="text-right tabular-nums font-medium">
        {row.totalBets}{' '}
        <span className="text-xs font-normal text-muted-foreground">
          ({row.wins}-{row.losses})
        </span>
      </span>
      <span className="text-muted-foreground">Actual</span>
      <span className="text-right tabular-nums font-medium">
        {fmtPct(row.actualWinRate)}
      </span>
      <span className="text-muted-foreground">Expected</span>
      <span className="text-right tabular-nums font-medium">
        {fmtPct(row.expectedWinRate)}
      </span>
      <span className="text-muted-foreground">Edge</span>
      <span
        className={`text-right tabular-nums font-semibold ${edgeColor(row.edge)}`}
      >
        {fmtPct(row.edge, true)}
      </span>
      <span className="text-muted-foreground">P&L</span>
      <span
        className={`text-right tabular-nums font-medium ${plPositive ? 'text-green-400' : 'text-red-400'}`}
      >
        {plPositive ? '+' : ''}
        {USD.format(row.profitLoss)}
      </span>
    </div>
  )
}

function BracketMiniChart({
  data,
  height = 150,
  singleBracket = false,
}: {
  data: BracketRow[]
  height?: number
  singleBracket?: boolean
}) {
  const chartData = data
    .filter((r) => r.totalBets > 0)
    .map((row) => ({
      bracket: row.label,
      actual: row.actualWinRate,
      expected: row.expectedWinRate,
    }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={chartData}
        barGap={singleBracket ? 8 : 1}
        barCategoryGap={singleBracket ? '35%' : '10%'}
        margin={{ top: 4, right: 8, bottom: 0, left: -8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="bracket"
          fontSize={10}
          stroke="var(--color-muted-foreground)"
          tick={{ fill: 'var(--color-muted-foreground)' }}
          interval={0}
        />
        <YAxis
          fontSize={10}
          stroke="var(--color-muted-foreground)"
          tick={{ fill: 'var(--color-muted-foreground)' }}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          width={38}
        />
        <Tooltip
          cursor={false}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name) => [
            `${(typeof value === 'number' ? value : 0).toFixed(1)}%`,
            String(name),
          ]}
        />
        <Bar dataKey="actual" name="Actual" fill="var(--color-chart-1)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="expected" name="Expected" fill="var(--color-chart-2)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function BracketTable({ data }: { data: BracketRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Bracket</TableHead>
          <TableHead className="text-right">Bets</TableHead>
          <TableHead className="text-right">W-L</TableHead>
          <TableHead className={`text-right ${GROUP_DIVIDER}`}>Win%</TableHead>
          <TableHead className="text-right">Exp%</TableHead>
          <TableHead className="text-right">Edge</TableHead>
          <TableHead className={`text-right ${GROUP_DIVIDER}`}>P&L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.bracketKey}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="text-right">{row.totalBets}</TableCell>
            <TableCell className="text-right">
              {row.wins}-{row.losses}
            </TableCell>
            <TableCell className={`text-right ${GROUP_DIVIDER}`}>
              {row.totalBets > 0 ? fmtPct(row.actualWinRate) : '-'}
            </TableCell>
            <TableCell className="text-right">
              {row.totalBets > 0 ? fmtPct(row.expectedWinRate) : '-'}
            </TableCell>
            <TableCell className={`text-right ${edgeColor(row.edge)}`}>
              {row.totalBets > 0 ? fmtPct(row.edge, true) : '-'}
            </TableCell>
            <TableCell
              className={`text-right ${GROUP_DIVIDER} ${row.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {row.totalBets > 0
                ? `${row.profitLoss >= 0 ? '+' : ''}${USD.format(row.profitLoss)}`
                : '-'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function OddsBracketSection({ data }: { data: BracketRow[] }) {
  const [selected, setSelected] = useState<string>('all')
  const hasData = data.some((r) => r.totalBets > 0)
  const selectedRow =
    selected === 'all' ? null : data.find((r) => r.bracketKey === selected) ?? null

  return (
    <Card className="glass-card" data-glow="rgba(96,165,250,1)">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Performance by Odds Range</CardTitle>
          {hasData && (
            <BracketPills data={data} selected={selected} onSelect={setSelected} />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No settled bets with odds data yet.
          </p>
        ) : selectedRow ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_240px]">
            <BracketMiniChart data={[selectedRow]} height={200} singleBracket />
            <BracketSideStats row={selectedRow} />
          </div>
        ) : (
          <>
            <BracketMiniChart data={data} />
            <BracketTable data={data} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Bet Type Performance Table
// ---------------------------------------------------------------------------

function BetTypeSection({ data }: { data: LineTypeRow[] }) {
  if (data.length === 0) return null

  return (
    <Card className="glass-card" data-glow="rgba(96,165,250,1)">
      <CardHeader>
        <CardTitle className="text-sm">Performance by Bet Type</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
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
            {data.map((row) => {
              const isParlay = row.label === 'Parlay'
              return (
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
                    {isParlay ? 'N/A' : fmtPct(row.expectedWinRate)}
                  </TableCell>
                  <TableCell
                    className={`text-right ${isParlay ? 'text-muted-foreground' : edgeColor(row.edge)}`}
                  >
                    {isParlay ? 'N/A' : fmtPct(row.edge, true)}
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
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main component — KPI strip now lives in Stats.tsx; this renders the rest.
// ---------------------------------------------------------------------------

export function EdgeAnalytics({
  bets,
  trendBets,
  unitSize,
}: EdgeAnalyticsProps) {
  const edgeStats = useMemo(() => computeEdgeStats(bets), [bets])
  const lineTypePerf = useMemo(
    () => computeLineTypePerformance(bets, unitSize),
    [bets, unitSize],
  )

  return (
    <div className="space-y-4">
      <WinRateTrendChart bets={trendBets} unitSize={unitSize} />
      <OddsBracketSection data={edgeStats.byBracket} />
      <BetTypeSection data={lineTypePerf} />
    </div>
  )
}
