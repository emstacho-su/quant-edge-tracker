/**
 * CalibrationByBucketChart — predicted vs realized hit rate scatter (05-04 W4.3)
 *
 * Recharts ComposedChart with a scatter of probability buckets sized by sample
 * count, and a y=x reference line for "perfect calibration."
 */

import {
  ComposedChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import type { CalibrationByBucketRow } from '@/types/strategies'

interface Props {
  data: CalibrationByBucketRow[]
}

function pct(v: number | null | undefined): string {
  if (v == null) return 'n/a'
  return `${(v * 100).toFixed(1)}%`
}

interface TooltipPayload {
  payload?: CalibrationByBucketRow
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium mb-1">Bucket {pct(d.p_bucket)}</p>
      <p>Predicted: {pct(d.avg_predicted)}</p>
      <p>Realized: {pct(d.realized_win_rate)}</p>
      <p>n = {d.n}</p>
    </div>
  )
}

export function CalibrationByBucketChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        No calibration data yet — needs settled outcomes.
      </p>
    )
  }

  // Map to scatter-friendly shape; size by sample count (clamped 4–20 radius)
  const points = data.map((row) => ({
    ...row,
    x: row.avg_predicted,
    y: row.realized_win_rate ?? 0,
    r: Math.min(20, Math.max(4, Math.sqrt(row.n) * 3)),
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={points} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
        <XAxis
          dataKey="x"
          type="number"
          domain={[0, 1]}
          tickFormatter={(v) => pct(v as number)}
          label={{ value: 'Avg Predicted', position: 'insideBottom', offset: -12, fontSize: 11 }}
          tick={{ fontSize: 10 }}
        />
        <YAxis
          type="number"
          domain={[0, 1]}
          tickFormatter={(v) => pct(v as number)}
          tick={{ fontSize: 10 }}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} />
        {/* Perfect calibration diagonal */}
        <ReferenceLine
          segment={[
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ]}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          strokeOpacity={0.6}
        />
        <Scatter
          dataKey="y"
          fill="var(--purple-400, #a78bfa)"
          fillOpacity={0.8}
          name="Bucket"
          data={points}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
