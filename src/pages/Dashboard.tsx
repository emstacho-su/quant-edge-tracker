import { useMemo } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { useBets } from '@/hooks/use-bets'
import { useBankroll } from '@/hooks/use-bankroll'
import { useAutoUnitSize } from '@/hooks/use-auto-unit-size'
import { toEtDate, toEtLabel } from '@/utils/dates'
import { getBetReportDay } from '@/utils/daily-report'
import { computeSportPerformance, type PerformanceRow } from '@/utils/stats-analytics'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { BentoGrid, type BentoItem } from '@/components/ui/bento-grid'
import { Wallet, Coins, CircleDollarSign, Trophy } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ExportBar } from '@/components/ExportBar'
import { exportDashboard, exportComprehensive } from '@/utils/excel-export'
import { USD } from '@/lib/demo-mode'


function Dashboard() {
  const { bets, loading: betsLoading } = useBets()
  const { events, cashBalance, fpBalance, loading: bankrollLoading } =
    useBankroll()
  const { unitSize } = useAutoUnitSize()

  // Bankroll over time data from events
  const bankrollChartData = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    )

    // null = no event that day; 0 = balance was explicitly zeroed.
    // Distinguishing them matters so a true $0 FP balance forward-fills as 0
    // instead of inheriting the last non-zero value.
    const dateMap = new Map<string, { cash: number | null; freeplay: number | null }>()

    for (const evt of sorted) {
      const dateKey = toEtLabel(evt.occurred_at)
      const current = dateMap.get(dateKey) ?? { cash: null, freeplay: null }
      if (evt.bankroll_type === 'cash') {
        current.cash = evt.balance_after
      } else {
        current.freeplay = evt.balance_after
      }
      dateMap.set(dateKey, current)
    }

    let lastCash = 0
    let lastFp = 0
    return Array.from(dateMap.entries()).map(([date, val]) => {
      if (val.cash !== null) lastCash = val.cash
      if (val.freeplay !== null) lastFp = val.freeplay
      return { date, cash: lastCash, freeplay: lastFp }
    })
  }, [events])

  // Deposit/withdrawal markers for the bankroll chart
  const depositWithdrawEvents = useMemo(
    () =>
      events.filter(
        (e) => e.event_type === 'deposit' || e.event_type === 'withdrawal'
      ),
    [events]
  )

  const chartDateSet = useMemo(
    () => new Set(bankrollChartData.map((d) => d.date)),
    [bankrollChartData]
  )

  // Last 7 days P&L — bucketed by placed_at (ET) unless settled >16hr after
  // placement, matching the daily report rule.
  const last7DaysData = useMemo(() => {
    const plByDay = new Map<string, number>()
    for (const b of bets) {
      if (b.profit_loss === null || b.status === 'pending' || b.status === 'void') continue
      const key = getBetReportDay(b)
      plByDay.set(key, (plByDay.get(key) ?? 0) + (b.profit_loss ?? 0))
    }

    const now = new Date()
    const days: { date: string; pl: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = toEtDate(d)
      const label = toEtLabel(d)
      days.push({ date: label, pl: plByDay.get(dateStr) ?? 0 })
    }
    return days
  }, [bets])

  const last7DaysTotal = useMemo(
    () => last7DaysData.reduce((sum, d) => sum + d.pl, 0),
    [last7DaysData]
  )

  // Sport Performance — shared util (freeplay filter stays at call site per RESEARCH Pitfall 4)
  const sportPerformance = useMemo(
    () => computeSportPerformance(bets.filter((b) => !b.is_freeplay), unitSize),
    [bets, unitSize]
  )

  const loading = betsLoading || bankrollLoading

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading dashboard...
      </div>
    )
  }

  const totalBalance = cashBalance + fpBalance
  const settledCash = bets.filter((b) => b.status !== 'pending' && !b.is_freeplay)
  const totalWins = settledCash.filter((b) => b.status === 'won').length
  const totalLosses = settledCash.filter((b) => b.status === 'lost').length
  const winRate = totalWins + totalLosses > 0
    ? ((totalWins / (totalWins + totalLosses)) * 100).toFixed(1)
    : '0.0'

  const statsItems: BentoItem[] = [
    {
      title: 'Cash',
      value: USD.format(cashBalance),
      icon: <Wallet className="size-4 text-chart-1" />,
      glow: 'rgba(74,222,128,1)',
    },
    {
      title: 'Freeplay',
      value: USD.format(fpBalance),
      icon: <Coins className="size-4 text-chart-4" />,
      glow: 'rgba(167,139,250,1)',
    },
    {
      title: 'Total',
      value: USD.format(totalBalance),
      icon: <CircleDollarSign className="size-4 text-chart-3" />,
      glow: 'rgba(250,204,21,1)',
    },
    {
      title: 'Record',
      value: (
        <>
          {totalWins}-{totalLosses}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">{winRate}%</span>
        </>
      ),
      icon: <Trophy className="size-4 text-chart-2" />,
      glow: 'rgba(125,211,252,1)',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <BentoGrid items={statsItems} />


      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="glass-card" data-glow="rgba(96,165,250,1)">
          <CardHeader>
            <CardTitle className="text-sm">Bankroll Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {bankrollChartData.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                No bankroll data yet.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={bankrollChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" fontSize={12} stroke="var(--color-muted-foreground)" tick={{ fill: 'var(--color-muted-foreground)' }} />
                  <YAxis fontSize={12} stroke="var(--color-muted-foreground)" tick={{ fill: 'var(--color-muted-foreground)' }} tickFormatter={(v) => USD.format(Number(v))} />
                  <Tooltip
                    cursor={false}
                    contentStyle={{
                      backgroundColor: 'var(--color-popover)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                      color: 'var(--color-popover-foreground)',
                    }}
                    formatter={(value) => typeof value === 'number' ? USD.format(value) : String(value ?? '')}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="cash"
                    name="Cash"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="freeplay"
                    name="Freeplay"
                    stroke="var(--color-chart-2)"
                    strokeWidth={2}
                    dot={false}
                  />
                  {depositWithdrawEvents
                    .filter((evt) => chartDateSet.has(toEtLabel(evt.occurred_at)))
                    .map((evt) => {
                      const isDeposit = evt.event_type === 'deposit'
                      const color = isDeposit
                        ? 'var(--color-chart-1)'
                        : 'var(--color-chart-5)'
                      return (
                        <ReferenceLine
                          key={evt.id}
                          x={toEtLabel(evt.occurred_at)}
                          stroke={color}
                          strokeDasharray="4 2"
                          strokeWidth={1.5}
                          strokeOpacity={0.7}
                          label={{
                            value: isDeposit ? 'D' : 'W',
                            fill: color,
                            fontSize: 10,
                            position: 'top',
                          }}
                        />
                      )
                    })}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card" data-glow="rgba(96,165,250,1)">
          <CardHeader>
            <div className="flex items-baseline justify-between">
              <CardTitle className="text-sm">7-Day P&L</CardTitle>
              <span
                className={`text-base font-bold tabular-nums ${
                  last7DaysTotal >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {last7DaysTotal >= 0 ? '+' : ''}
                {USD.format(last7DaysTotal)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={last7DaysData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" fontSize={12} stroke="var(--color-muted-foreground)" tick={{ fill: 'var(--color-muted-foreground)' }} />
                <YAxis fontSize={12} stroke="var(--color-muted-foreground)" tick={{ fill: 'var(--color-muted-foreground)' }} tickFormatter={(v) => USD.format(Number(v))} />
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
                        {v >= 0 ? '+' : ''}{USD.format(v)}
                      </span>,
                      'P&L',
                    ]
                  }}
                />
                <Bar dataKey="pl" name="P&L" radius={[3, 3, 0, 0]}>
                  {last7DaysData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.pl >= 0 ? 'var(--color-chart-1)' : 'var(--color-chart-5)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Sport Performance */}
      <Card className="glass-card" data-glow="rgba(96,165,250,1)">
        <CardHeader>
          <CardTitle className="text-sm">Sport Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {sportPerformance.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              No bets recorded yet.
            </p>
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <PerformanceTable rows={sportPerformance} />
            </div>
          )}
        </CardContent>
      </Card>

      <ExportBar
        pageLabel="Dashboard"
        onExportPage={() => exportDashboard(bets, events, unitSize)}
        onExportComprehensive={() =>
          exportComprehensive(bets, events, unitSize)
        }
      />
    </div>
  )
}

const GROUP_DIVIDER = 'border-l border-border/60'

function fmtPct(value: number, showSign = false): string {
  const prefix = showSign && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

function edgeColor(edge: number): string {
  if (edge > 0) return 'text-green-400'
  if (edge < 0) return 'text-red-400'
  return 'text-muted-foreground'
}

function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
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

export default Dashboard
