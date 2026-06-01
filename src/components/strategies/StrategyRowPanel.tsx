/**
 * StrategyRowPanel — the inline accordion body for an expanded /strategies row.
 *
 * Three zones (per the 2026-05-21 design spec):
 *   1. All-time metrics strip: Record W-L-P · Win rate% · ROI% · P/L (Nu / $)
 *   2. Today's picks: latest run's final_card joined to outcomes by pick_key
 *   3. Run today's slate (auth-gated inline form), refetches zone 2 on completion
 *
 * Data loads lazily on mount (the parent only mounts this when the row is open),
 * so opening one row never fetches picks/outcomes for every strategy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { RunInlineForm } from '@/components/strategies/RunInlineForm'
import { RunControls } from '@/components/strategies/RunControls'
import { useSettings } from '@/hooks/use-settings'
import { useDemoMode, USD } from '@/lib/demo-mode'
import {
  getStrategyStats,
  listRuns,
  listOutcomes,
} from '@/lib/supabase-strategies'
import { OutputSummarySchema } from '@/types/strategies'
import {
  joinPicksToOutcomes,
  formatRunDateLabel,
  unitsToUsd,
  type JoinedPick,
} from '@/utils/strategy-panel'
import type {
  Strategy,
  StrategyListItem,
  StrategyStats,
  StrategyRun,
  StrategyOutcome,
  StrategyOutcomeSettlement,
} from '@/types/strategies'

const DEFAULT_UNIT_SIZE = 30

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const SETTLEMENT_CLASS: Record<StrategyOutcomeSettlement, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  won: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  lost: 'bg-red-500/15 text-red-400 border-red-500/40',
  push: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  void: 'bg-slate-500/15 text-slate-400 border-slate-500/40',
}

const SETTLEMENT_LABEL: Record<StrategyOutcomeSettlement, string> = {
  pending: 'Pending',
  won: 'Won',
  lost: 'Lost',
  push: 'Push',
  void: 'Void',
}

function SettlementChip({ status }: { status: StrategyOutcomeSettlement }) {
  return (
    <Badge variant="outline" className={SETTLEMENT_CLASS[status]}>
      {SETTLEMENT_LABEL[status]}
    </Badge>
  )
}

function fmtAmericanOdds(line: number): string {
  return line >= 0 ? `+${line}` : `${line}`
}

function fmtPct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`
}

function fmtUnits(u: number): string {
  const sign = u > 0 ? '+' : ''
  return `${sign}${u.toFixed(2)}u`
}

// ---------------------------------------------------------------------------
// Metrics strip (zone 1)
// ---------------------------------------------------------------------------

function MetricCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  )
}

function MetricsStrip({
  stats,
  unitSize,
}: {
  stats: StrategyStats | null
  unitSize: number
}) {
  // No settled bets at all → empty state.
  const settledCount = stats
    ? stats.won + stats.lost + stats.push + stats.void
    : 0
  if (!stats || settledCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">No settled bets yet.</p>
    )
  }

  const record = `${stats.won}-${stats.lost}-${stats.push}`
  const usd = unitsToUsd(stats.units_pl, unitSize)
  const plClass =
    stats.units_pl > 0
      ? 'text-emerald-400'
      : stats.units_pl < 0
        ? 'text-red-400'
        : ''

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <MetricCell label="Record (W-L-P)" value={record} />
      <MetricCell label="Win rate" value={fmtPct(stats.win_rate_pct)} />
      <MetricCell label="ROI" value={fmtPct(stats.roi_pct)} />
      <MetricCell
        label="P/L"
        value={
          <span className={plClass}>
            {fmtUnits(stats.units_pl)}{' '}
            <span className="text-muted-foreground">/ {USD.format(usd)}</span>
          </span>
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Picks zone (zone 2)
// ---------------------------------------------------------------------------

function PickRow({ joined, unitSize }: { joined: JoinedPick; unitSize: number }) {
  const { pick, status, units_pl } = joined
  const plClass =
    units_pl == null
      ? 'text-muted-foreground'
      : units_pl > 0
        ? 'text-emerald-400'
        : units_pl < 0
          ? 'text-red-400'
          : ''
  return (
    <tr className="border-b border-border/20">
      <td className="py-1.5 pr-3 font-mono">{pick.game}</td>
      <td className="py-1.5 pr-3">{pick.market}</td>
      <td className="py-1.5 pr-3 font-mono">{fmtAmericanOdds(pick.line)}</td>
      <td className="py-1.5 pr-3 tabular-nums">
        {pick.stake_u}u{' '}
        <span className="text-muted-foreground">
          / {USD.format(unitsToUsd(pick.stake_u, unitSize))}
        </span>
      </td>
      <td className="py-1.5 pr-3 text-emerald-400">+{pick.edge_pct.toFixed(1)}%</td>
      <td className="py-1.5 pr-3">
        <SettlementChip status={status} />
      </td>
      <td className={`py-1.5 tabular-nums ${plClass}`}>
        {units_pl == null ? '—' : fmtUnits(units_pl)}
      </td>
    </tr>
  )
}

function PicksZone({
  latestRun,
  joined,
  unitSize,
}: {
  latestRun: StrategyRun | null
  joined: JoinedPick[]
  unitSize: number
}) {
  // No run yet.
  if (!latestRun) {
    return (
      <p className="text-sm text-muted-foreground">
        No runs yet — enter today's slate below.
      </p>
    )
  }

  // Run in progress (queued / running) → defer to the run form's live status.
  if (latestRun.status === 'queued' || latestRun.status === 'running') {
    return (
      <p className="text-sm text-muted-foreground">
        Run in progress — picks will appear when it completes.
      </p>
    )
  }

  const dateLabel = formatRunDateLabel(
    latestRun.completed_at ?? latestRun.triggered_at,
  )

  // Failed run with no picks.
  if (latestRun.status === 'failed' && joined.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Last run failed ({dateLabel}) — re-run today's slate below.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Today's picks · {dateLabel}
      </p>
      {joined.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Full pass — no picks ({dateLabel}).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/40 text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Game</th>
                <th className="py-1.5 pr-3 font-medium">Market</th>
                <th className="py-1.5 pr-3 font-medium">Odds</th>
                <th className="py-1.5 pr-3 font-medium">Stake</th>
                <th className="py-1.5 pr-3 font-medium">Edge</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 font-medium">P/L</th>
              </tr>
            </thead>
            <tbody>
              {joined.map((j, i) => (
                <PickRow key={j.pick.pick_key || i} joined={j} unitSize={unitSize} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function StrategyRowPanel({
  strategy,
}: {
  strategy: Strategy | StrategyListItem
}) {
  const { settings } = useSettings()
  // Re-render on demo-mode flip so USD values rescale.
  useDemoMode()

  const unitSize = useMemo(() => {
    const raw = settings.get('unit_size')
    const n = raw == null ? NaN : Number(raw)
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_UNIT_SIZE
  }, [settings])

  const [stats, setStats] = useState<StrategyStats | null>(null)
  const [latestRun, setLatestRun] = useState<StrategyRun | null>(null)
  const [outcomes, setOutcomes] = useState<StrategyOutcome[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, runsRes] = await Promise.all([
        getStrategyStats(strategy.id),
        listRuns(strategy.id, 1),
      ])
      const run = runsRes[0] ?? null
      const outcomesRes = run ? await listOutcomes(run.id) : []
      setStats(statsRes)
      setLatestRun(run)
      setOutcomes(outcomesRes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [strategy.id])

  useEffect(() => {
    void load()
  }, [load])

  // Join the latest run's final_card to its outcomes by pick_key.
  const joined = useMemo<JoinedPick[]>(() => {
    if (!latestRun?.output_summary) return []
    const parsed = OutputSummarySchema.safeParse(latestRun.output_summary)
    if (!parsed.success) return []
    return joinPicksToOutcomes(parsed.data.final_card, outcomes)
  }, [latestRun, outcomes])

  return (
    <div className="space-y-5 rounded-lg border border-border/40 bg-background/30 p-4">
      {/* Header row: title + full details link */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{strategy.name}</p>
        <Link
          to={`/strategies/${strategy.id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Full details <ArrowRight className="size-3" />
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {/* Zone 1: all-time metrics */}
          <MetricsStrip stats={stats} unitSize={unitSize} />

          {/* Zone 2: today's picks */}
          <PicksZone latestRun={latestRun} joined={joined} unitSize={unitSize} />

          {/* Cancel running / remove queued (auth-gated; null for terminal runs) */}
          {latestRun && (
            <RunControls run={latestRun} onChanged={() => void load()} />
          )}
        </>
      )}

      {/* Zone 3: run today's slate (auth-gated). Refetch zones 1 & 2 on completion. */}
      <RunInlineForm strategyId={strategy.id} onCompleted={() => void load()} />
    </div>
  )
}
