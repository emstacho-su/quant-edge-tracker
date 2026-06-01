import { LineChart, Line, ReferenceLine, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatOdds, probToAmerican, type FairPoint } from '@/lib/clv'

/** Movement strip: the no-vig fair (or outright implied) series over time, with the user's
 *  entry price anchored as a dashed line and a dot per refresh. */
export function ClvMovementStrip({
  series,
  entryImplied,
  entryAmerican,
  locked,
  isOutright,
  placedAt,
}: {
  series: FairPoint[]
  entryImplied: number | null
  entryAmerican: number | null
  locked: boolean
  isOutright: boolean
  placedAt?: number
}) {
  if (series.length < 2) {
    return (
      <div className="flex h-16 items-center justify-center text-[11px] text-muted-foreground">
        {series.length === 1 ? 'collecting line movement…' : 'awaiting first snapshot'}
      </div>
    )
  }
  const data = series.map((p) => ({ t: p.t, fair: +(p.fair * 100).toFixed(2) }))
  const fairVals = data.map((d) => d.fair)
  const entryPct = entryImplied != null ? entryImplied * 100 : null
  const yLo = Math.min(...fairVals, entryPct ?? Infinity) - 1
  const yHi = Math.max(...fairVals, entryPct ?? -Infinity) + 1
  const first = series[0]
  const last = series[series.length - 1]
  const firstAmer = probToAmerican(first.fair)
  const lastAmer = probToAmerican(last.fair)
  const hoursAgo = Math.max(1, Math.round((Date.now() - first.t) / 3_600_000))
  const movedCents =
    Number.isFinite(firstAmer) && Number.isFinite(lastAmer) ? Math.abs(lastAmer - firstAmer) : null
  const dataMin = data[0]?.t ?? Date.now()
  const displayMin = placedAt != null ? Math.min(dataMin, placedAt - 3_600_000) : dataMin

  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
        Line Movement
      </div>
      <div className="text-[10px] text-muted-foreground">
        {locked ? 'placement → close' : `last ${hoursAgo}h`}
        {movedCents != null && <span> · moved ~{movedCents}¢</span>}
      </div>
      <div className="h-16 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" type="number" domain={[displayMin, 'dataMax']} hide />
            <YAxis hide domain={[yLo, yHi]} />
            <Tooltip
              contentStyle={{ fontSize: 11, background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6 }}
              formatter={(v) => {
                const pct = Number(v)
                const amer = probToAmerican(pct / 100)
                const americanStr = Number.isFinite(amer) ? formatOdds(amer) : '—'
                return [`${pct.toFixed(1)}% (${americanStr})`, isOutright ? 'Implied' : 'Fair']
              }}
              labelFormatter={(t) =>
                new Date(t as number).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              }
            />
            {entryPct != null && <ReferenceLine y={entryPct} stroke="#fbbf24" strokeDasharray="3 3" strokeOpacity={0.7} />}
            {placedAt != null
              && data.length >= 1
              && data[0].t <= placedAt
              && placedAt <= data[data.length - 1].t
              && (
                <ReferenceLine
                  x={placedAt}
                  stroke="#fbbf24"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  strokeOpacity={0.8}
                />
              )}
            <Line type="monotone" dataKey="fair" stroke="#f87171" strokeWidth={1.75} dot={{ r: 2, fill: '#f87171' }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {locked ? (
        <div className="text-[11px] text-muted-foreground">
          placement ({entryAmerican != null ? formatOdds(entryAmerican) : '—'})
          {' · '}
          close ({formatOdds(Number.isFinite(lastAmer) ? lastAmer : null)})
        </div>
      ) : (
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{formatOdds(Number.isFinite(firstAmer) ? firstAmer : null)} · {hoursAgo}h ago</span>
          {entryAmerican != null && <span className="text-amber-400/80">entry {formatOdds(entryAmerican)}</span>}
          <span>{formatOdds(Number.isFinite(lastAmer) ? lastAmer : null)} · now</span>
        </div>
      )}
    </div>
  )
}
