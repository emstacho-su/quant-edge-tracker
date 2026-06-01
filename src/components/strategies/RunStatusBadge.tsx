import { Badge } from '@/components/ui/badge'
import type { StrategyRunStatus } from '@/types/strategies'

const STATUS_CLASS: Record<StrategyRunStatus, string> = {
  queued:
    'bg-amber-500/15 text-amber-400 border-amber-500/40 hover:bg-amber-500/20',
  running:
    'bg-sky-500/15 text-sky-400 border-sky-500/40 hover:bg-sky-500/20 animate-pulse',
  completed:
    'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/20',
  failed:
    'bg-red-500/15 text-red-400 border-red-500/40 hover:bg-red-500/20',
  cancelled:
    'bg-slate-500/15 text-slate-400 border-slate-500/40 hover:bg-slate-500/20',
}

const STATUS_LABEL: Record<StrategyRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/**
 * Run status badge. When `status='running'` and a `phase`/`elapsed` is provided,
 * renders the SPEC §8.4 form: "Running · Phase N — title · 1m 47s". The live
 * phase comes from `strategy_runs.current_phase` (written by the daemon, 05-02).
 */
export function RunStatusBadge({
  status,
  phase,
  elapsed,
}: {
  status: StrategyRunStatus
  phase?: string | null
  elapsed?: string | null
}) {
  const parts: string[] = [STATUS_LABEL[status]]
  if (status === 'running') {
    if (phase) parts.push(phase)
    if (elapsed) parts.push(elapsed)
  }
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]}>
      {parts.join(' · ')}
    </Badge>
  )
}
