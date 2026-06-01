import { useNavigate } from 'react-router-dom'
import { TableCell, TableRow } from '@/components/ui/table'
import { RunStatusBadge } from './RunStatusBadge'
import type { StrategyRun } from '@/types/strategies'

interface RunRowProps {
  strategyId: string
  run: StrategyRun
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '—'
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function RunRow({ strategyId, run }: RunRowProps) {
  const navigate = useNavigate()
  const to = `/strategies/${strategyId}/runs/${run.id}`
  return (
    <TableRow
      onClick={() => navigate(to)}
      className="cursor-pointer hover:bg-muted/40"
      title="View run output"
    >
      <TableCell className="font-mono text-xs text-primary underline-offset-2 hover:underline">
        {run.id.slice(0, 8)}…
      </TableCell>
      <TableCell>
        <RunStatusBadge status={run.status} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {fmtDate(run.triggered_at)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {fmtDuration(run.started_at, run.completed_at)}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {run.triggered_by}
      </TableCell>
    </TableRow>
  )
}
