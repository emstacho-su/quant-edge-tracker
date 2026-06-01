import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { Bet } from '@/lib/types'
import {
  computeUnitSizePerformance,
  type UnitBucketRow,
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
import { USD } from '@/lib/demo-mode'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-popover-foreground)',
}

const GROUP_DIVIDER = 'border-l border-border/60'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Pill filter — same shape as the odds-bracket pills above
// ---------------------------------------------------------------------------

interface BucketPillsProps {
  data: readonly UnitBucketRow[]
  selected: string
  onSelect: (key: string) => void
}

function BucketPills({ data, selected, onSelect }: BucketPillsProps) {
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
        const disabled = row.bets === 0
        return (
          <button
            key={row.bucketKey}
            onClick={() => !disabled && onSelect(row.bucketKey)}
            disabled={disabled}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              disabled
                ? 'cursor-not-allowed text-muted-foreground/40'
                : selected === row.bucketKey
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

// ---------------------------------------------------------------------------
// Mini chart — Actual vs Expected win rate per bucket
// ---------------------------------------------------------------------------

function BucketChart({
  data,
  height = 200,
  singleBucket = false,
}: {
  data: readonly UnitBucketRow[]
  height?: number
  singleBucket?: boolean
}) {
  const chartData = data
    .filter((r) => r.bets > 0)
    .map((row) => ({
      bucket: row.label,
      actual: row.winPct,
      expected: row.expectedWinRate,
    }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={chartData}
        barGap={singleBucket ? 8 : 1}
        barCategoryGap={singleBucket ? '35%' : '12%'}
        margin={{ top: 4, right: 8, bottom: 0, left: -8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="bucket"
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
        <Legend
          wrapperStyle={{ fontSize: '11px' }}
          iconType="circle"
        />
        <Bar dataKey="actual" name="Actual" fill="var(--color-chart-1)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="expected" name="Expected" fill="var(--color-chart-2)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Side stats panel — shown when a single bucket is selected
// ---------------------------------------------------------------------------

function BucketSideStats({ row }: { row: UnitBucketRow }) {
  const plPositive = row.profitLoss >= 0
  return (
    <div className="grid h-full grid-cols-[1fr_auto] content-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <span className="text-muted-foreground">Bets</span>
      <span className="text-right tabular-nums font-medium">
        {row.bets}{' '}
        <span className="text-xs font-normal text-muted-foreground">
          ({row.wins}-{row.losses}-{row.pushes})
        </span>
      </span>
      <span className="text-muted-foreground">Avg Stake</span>
      <span className="text-right tabular-nums font-medium">
        {USD.format(row.avgStake)}
      </span>
      <span className="text-muted-foreground">Actual</span>
      <span className="text-right tabular-nums font-medium">
        {fmtPct(row.winPct)}
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
      <span className="text-muted-foreground">ROI</span>
      <span
        className={`text-right tabular-nums font-medium ${row.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}
      >
        {row.roi >= 0 ? '+' : ''}
        {row.roi.toFixed(1)}%
      </span>
      <span className="text-muted-foreground">Units</span>
      <span
        className={`text-right tabular-nums font-medium ${row.units >= 0 ? 'text-green-400' : 'text-red-400'}`}
      >
        {row.units >= 0 ? '+' : ''}
        {row.units.toFixed(2)}
      </span>
      <span className="text-muted-foreground">P&L</span>
      <span
        className={`text-right tabular-nums font-semibold ${plPositive ? 'text-green-400' : 'text-red-400'}`}
      >
        {plPositive ? '+' : ''}
        {USD.format(row.profitLoss)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Full table — all buckets at once
// ---------------------------------------------------------------------------

function BucketTable({ data }: { data: readonly UnitBucketRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Unit Size</TableHead>
          <TableHead className="text-right">Bets</TableHead>
          <TableHead className="text-right">W-L-P</TableHead>
          <TableHead className={`text-right ${GROUP_DIVIDER}`}>Win%</TableHead>
          <TableHead className="text-right">Exp%</TableHead>
          <TableHead className="text-right">Edge</TableHead>
          <TableHead className={`text-right ${GROUP_DIVIDER}`}>ROI%</TableHead>
          <TableHead className="text-right">Units</TableHead>
          <TableHead className="text-right">P&L</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow key={row.bucketKey}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="text-right">{row.bets}</TableCell>
            <TableCell className="text-right">
              {row.bets > 0 ? `${row.wins}-${row.losses}-${row.pushes}` : '-'}
            </TableCell>
            <TableCell className={`text-right ${GROUP_DIVIDER}`}>
              {row.bets > 0 ? fmtPct(row.winPct) : '-'}
            </TableCell>
            <TableCell className="text-right">
              {row.bets > 0 && row.expectedWinRate > 0 ? fmtPct(row.expectedWinRate) : '-'}
            </TableCell>
            <TableCell className={`text-right ${edgeColor(row.edge)}`}>
              {row.bets > 0 && row.expectedWinRate > 0 ? fmtPct(row.edge, true) : '-'}
            </TableCell>
            <TableCell
              className={`text-right ${GROUP_DIVIDER} ${row.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {row.bets > 0 ? `${row.roi >= 0 ? '+' : ''}${row.roi.toFixed(1)}%` : '-'}
            </TableCell>
            <TableCell
              className={`text-right ${row.units >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {row.bets > 0 ? `${row.units >= 0 ? '+' : ''}${row.units.toFixed(2)}` : '-'}
            </TableCell>
            <TableCell
              className={`text-right ${row.profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {row.bets > 0 ? `${row.profitLoss >= 0 ? '+' : ''}${USD.format(row.profitLoss)}` : '-'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

interface UnitSizePerformanceProps {
  bets: readonly Bet[]
  unitSize: number
}

export function UnitSizePerformance({ bets, unitSize }: UnitSizePerformanceProps) {
  const rows = useMemo(
    () => computeUnitSizePerformance(bets, unitSize),
    [bets, unitSize],
  )
  const [selected, setSelected] = useState<string>('all')

  const hasData = rows.some((r) => r.bets > 0)
  const selectedRow =
    selected === 'all' ? null : rows.find((r) => r.bucketKey === selected) ?? null

  return (
    <Card className="glass-card" data-glow="rgba(250,204,21,1)">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Performance by Unit Size</CardTitle>
          {hasData && (
            <BucketPills data={rows} selected={selected} onSelect={setSelected} />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No settled cash single-bets in this timeframe. Set a unit size in
            Account Settings first.
          </p>
        ) : selectedRow ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_240px]">
            <BucketChart data={[selectedRow]} height={220} singleBucket />
            <BucketSideStats row={selectedRow} />
          </div>
        ) : (
          <>
            <BucketChart data={rows} />
            <BucketTable data={rows} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
