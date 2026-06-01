/**
 * RunControls — auth-gated cancel/remove controls for an in-flight run, shown in
 * the /strategies row panel (and reusable on the detail page).
 *
 *   queued   → "Remove from queue"  (DELETE the row)
 *   running  → "Cancel run"         (sets cancel_requested; the daemon kills the
 *              child + flips status → 'cancelled')
 *   running + cancel_requested → a disabled "Cancel requested…" indicator
 *
 * Renders nothing for terminal runs (completed/failed/cancelled). Reads stay
 * public; the buttons are wrapped in <AuthActions>.
 */
import { useState } from 'react'
import { Ban, Loader2, Trash2 } from 'lucide-react'
import { AuthActions } from '@/components/auth/AuthGate'
import { Button } from '@/components/ui/button'
import { deleteQueuedRun, requestCancelRun } from '@/lib/strategy-run-actions'
import type { StrategyRun } from '@/types/strategies'

export function RunControls({
  run,
  onChanged,
}: {
  run: Pick<StrategyRun, 'id' | 'strategy_id' | 'status' | 'cancel_requested'>
  /** Called after a successful delete/cancel so the parent can refetch. */
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (run.status !== 'queued' && run.status !== 'running') return null
  const isQueued = run.status === 'queued'

  // A running run already asked to cancel — show a pending indicator, no button.
  if (!isQueued && run.cancel_requested) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-400">
        <Loader2 className="size-3.5 animate-spin" />
        Cancel requested — stopping after the current step…
      </p>
    )
  }

  async function act() {
    setBusy(true)
    setError(null)
    try {
      if (isQueued) await deleteQueuedRun(run.strategy_id, run.id)
      else await requestCancelRun(run.strategy_id, run.id)
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthActions>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={act}
          disabled={busy}
          className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          {busy ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : isQueued ? (
            <Trash2 className="mr-1.5 size-4" />
          ) : (
            <Ban className="mr-1.5 size-4" />
          )}
          {isQueued
            ? busy
              ? 'Removing…'
              : 'Remove from queue'
            : busy
              ? 'Cancelling…'
              : 'Cancel run'}
        </Button>
        {error && (
          <span className="text-xs text-red-400" role="alert">
            {error}
          </span>
        )}
      </div>
    </AuthActions>
  )
}
