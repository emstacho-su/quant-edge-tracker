/**
 * RollingPnlChart — rolling weekly unit P&L line chart (05-04 W4.3)
 *
 * Reuses useChartPan + ChartTimeRangePicker per the 2026-05-18 _DECISIONS
 * entry (locked pattern — do NOT roll a custom pan).
 * Default range: last 12 weeks; user can pan via the picker.
 */

import { useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { useChartPan } from '@/hooks/use-chart-pan'
import { ChartTimeRangePicker } from '@/components/stats/ChartTimeRangePicker'
import type { ChartWindow } from '@/hooks/use-chart-pan'
import type { RollingPnlRow } from '@/types/strategies'

interface Props {
  data: RollingPnlRow[]
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// Default: 90-day window, matching the picker option options={[30, 90, null]}
const DEFAULT_WINDOW: ChartWindow = 90

interface TooltipPayload {
  payload?: RollingPnlRow
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0]?.payload
  if (!d) return null
  const sign = d.cumulative_units_pl >= 0 ? '+' : ''
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium mb-1">{d.week_start}</p>
      <p>Week P&L: {d.units_pl >= 0 ? '+' : ''}{d.units_pl.toFixed(2)}u</p>
      <p>Cumulative: {sign}{d.cumulative_units_pl.toFixed(2)}u</p>
      <p>Bets: {d.bets}</p>
    </div>
  )
}

export function RollingPnlChart({ data }: Props) {
  const [windowDays, setWindowDays] = useState<ChartWindow>(DEFAULT_WINDOW)

  // Hooks must be called unconditionally — compute allDates before early return
  const allDates = data.map((d) => new Date(d.week_start).getTime())

  const { visibleRange, containerRef, dragHandlers, disabled } = useChartPan({
    allDates,
    windowDays,
  })

  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        Need 7+ days of settled outcomes for rolling P&L.
      </p>
    )
  }

  const filtered = data.filter((d) => {
    const t = new Date(d.week_start).getTime()
    return t >= visibleRange.start - WEEK_MS && t <= visibleRange.end + WEEK_MS
  })

  // WR-07 fix: the data.length === 0 guard above doesn't cover the case where data exists
  // but all points fall outside the current pan window. Show a muted message rather than
  // rendering an empty LineChart with no visual feedback.
  if (filtered.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        No data points in the selected range — try panning or expanding the window.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <ChartTimeRangePicker
          value={windowDays}
          onChange={setWindowDays}
          options={[30, 90, null]}
        />
      </div>
      <div
        ref={containerRef}
        className={`select-none ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
        {...dragHandlers}
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={filtered} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis
              dataKey="week_start"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => {
                const d = new Date(v as string)
                return `${d.getMonth() + 1}/${d.getDate()}`
              }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={44}
              tickFormatter={(v) => `${(v as number).toFixed(1)}u`}
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="cumulative_units_pl"
              name="Cumulative P&L"
              stroke="var(--purple-400, #a78bfa)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--purple-400, #a78bfa)' }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
