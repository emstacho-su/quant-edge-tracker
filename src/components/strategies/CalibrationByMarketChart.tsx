/**
 * CalibrationByMarketChart — ROI % by market type (05-04 W4.3)
 *
 * Recharts BarChart with bars colored green (ROI >= 0) or red (ROI < 0).
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts'
import type { CalibrationByMarketRow } from '@/types/strategies'

interface Props {
  data: CalibrationByMarketRow[]
}

interface TooltipPayload {
  payload?: CalibrationByMarketRow
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0]?.payload
  if (!d) return null
  const roiSign = d.roi_pct >= 0 ? '+' : ''
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium mb-1">{d.market}</p>
      <p>n = {d.n}</p>
      <p>Staked: {d.total_stake_units.toFixed(2)}u</p>
      <p>P&L: {d.total_units_pl.toFixed(2)}u</p>
      <p>ROI: {roiSign}{d.roi_pct.toFixed(1)}%</p>
    </div>
  )
}

export function CalibrationByMarketChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        No market data yet — needs settled outcomes.
      </p>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
        <XAxis
          dataKey="market"
          tick={{ fontSize: 10 }}
          label={{ value: 'Market', position: 'insideBottom', offset: -12, fontSize: 11 }}
        />
        <YAxis
          tickFormatter={(v) => `${(v as number).toFixed(0)}%`}
          tick={{ fontSize: 10 }}
          width={44}
          label={{ value: 'ROI %', angle: -90, position: 'insideLeft', offset: 8, fontSize: 11 }}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
        <Bar dataKey="roi_pct" name="ROI %">
          {data.map((row, idx) => (
            <Cell
              key={idx}
              fill={row.roi_pct >= 0 ? 'var(--green-500, #22c55e)' : 'var(--red-500, #ef4444)'}
              fillOpacity={0.8}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
