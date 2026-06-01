/**
 * ConfidenceVsWinRateChart — audit confidence tier vs realized win rate (05-04 W4.3)
 *
 * Recharts BarChart with grouped bars (predicted vs realized win rate) per
 * confidence band (HIGH/MEDIUM/LOW/n/a). Shows whether HIGH actually predicts better.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from 'recharts'
import type { CalibrationByConfidenceRow } from '@/types/strategies'

interface Props {
  data: CalibrationByConfidenceRow[]
}

// Canonical confidence order
const CONFIDENCE_ORDER = ['HIGH', 'MEDIUM', 'LOW', 'n/a']

function pct(v: number | null | undefined): string {
  if (v == null) return 'n/a'
  return `${(v * 100).toFixed(1)}%`
}

interface TooltipPayload {
  name?: string
  value?: number
  payload?: CalibrationByConfidenceRow
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium mb-1">{row.audit_confidence}</p>
      <p>Predicted: {pct(row.avg_predicted)}</p>
      <p>Realized: {pct(row.realized_win_rate)}</p>
      <p>n = {row.n}</p>
    </div>
  )
}

export function ConfidenceVsWinRateChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        No confidence data yet — needs settled outcomes with audit seminars.
      </p>
    )
  }

  // Sort into canonical order.
  // POSITIONAL CONTRACT: Recharts categorical bars are keyed by array position.
  // The LabelList formatter (n=N) and predicted/realized pairing rely on this ordering.
  // Do not introduce per-row keyed rendering without also passing dataKey-based keys.
  const sorted = [...data].sort((a, b) => {
    const ai = CONFIDENCE_ORDER.indexOf(a.audit_confidence)
    const bi = CONFIDENCE_ORDER.indexOf(b.audit_confidence)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  // Replace null realized_win_rate with undefined so Recharts drops the bar rather
  // than rendering it as 0 (which reads as a genuine 0% win rate). WR-04 fix.
  const chartData = sorted.map((row) => ({
    ...row,
    realized_win_rate: row.realized_win_rate ?? undefined,
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
        <XAxis
          dataKey="audit_confidence"
          tick={{ fontSize: 10 }}
          label={{ value: 'Confidence', position: 'insideBottom', offset: -12, fontSize: 11 }}
        />
        <YAxis
          tickFormatter={(v) => pct(v as number)}
          domain={[0, 1]}
          tick={{ fontSize: 10 }}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="avg_predicted" name="Predicted" fill="var(--blue-500, #3b82f6)" fillOpacity={0.7}>
          <LabelList
            dataKey="n"
            position="top"
            style={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
            formatter={(v: unknown) => `n=${v}`}
          />
        </Bar>
        <Bar dataKey="realized_win_rate" name="Realized" fill="var(--purple-500, #a855f7)" fillOpacity={0.8} />
      </BarChart>
    </ResponsiveContainer>
  )
}
