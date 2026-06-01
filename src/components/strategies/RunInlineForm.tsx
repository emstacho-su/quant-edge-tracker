/**
 * RunInlineForm — inline "Run today's slate" control.
 *
 * Extracted so both the expandable /strategies row panel and the strategy
 * detail page share one run-trigger path (removes the duplicated `submitRun`).
 *
 * Posts to the existing service-role API route `POST /api/strategies/:id/run`
 * (no new write path), then subscribes to the returned run via `useRunRealtime`
 * and surfaces queued → running → completed. Calls `onCompleted(runId)` once the
 * run reaches `completed`.
 *
 * Auth-gated with `AuthActions` — reads stay public, only the write is gated.
 */
import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { AuthActions } from '@/components/auth/AuthGate'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RunStatusBadge } from '@/components/strategies/RunStatusBadge'
import { useRunRealtime } from '@/hooks/useRunRealtime'

interface RunInlineFormProps {
  strategyId: string
  /** Fired once the enqueued run reaches `completed` (e.g. to refetch picks). */
  onCompleted?: (runId: string) => void
  /**
   * Fired immediately after the run is enqueued (POST returns a run_id), before
   * it completes. Lets callers that want to navigate away (e.g. the detail page
   * jumping to the run viewer) do so without waiting for completion.
   */
  onEnqueued?: (runId: string) => void
}

export function RunInlineForm({
  strategyId,
  onCompleted,
  onEnqueued,
}: RunInlineFormProps) {
  const [inputLines, setInputLines] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  // Track which run we've already fired onCompleted for (avoid double-fire).
  const completedFiredFor = useRef<string | null>(null)

  // Live status for the run we just enqueued.
  const { run: liveRun } = useRunRealtime(activeRunId, null)

  useEffect(() => {
    if (!liveRun || !activeRunId) return
    if (liveRun.status === 'completed' && completedFiredFor.current !== activeRunId) {
      completedFiredFor.current = activeRunId
      onCompleted?.(activeRunId)
    }
  }, [liveRun, activeRunId, onCompleted])

  async function submitRun() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/strategies/${strategyId}/run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_lines_raw: inputLines,
          input_meta: {
            paste: inputLines.trim().length > 0,
            odds_api: false,
            books: [],
          },
        }),
      })
      const body = await res.json().catch(() => ({}) as Record<string, unknown>)
      if (!res.ok) {
        setError(
          (body && typeof body.error === 'string' ? body.error : null) ??
            `Request failed (${res.status})`,
        )
        return
      }
      const { run_id } = body as { run_id: string }
      setInputLines('')
      completedFiredFor.current = null
      setActiveRunId(run_id)
      onEnqueued?.(run_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enqueue run.')
    } finally {
      setSubmitting(false)
    }
  }

  const liveStatus = liveRun?.status ?? null
  // Show live status while the active run is not yet completed/failed.
  const showStatus =
    activeRunId !== null && liveStatus !== null && liveStatus !== 'completed'

  return (
    <AuthActions>
      <div className="space-y-2">
        <Label htmlFor={`run-input-${strategyId}`} className="text-xs">
          Run today's slate
        </Label>
        <Textarea
          id={`run-input-${strategyId}`}
          value={inputLines}
          onChange={(e) => setInputLines(e.target.value)}
          rows={4}
          placeholder="Paste today's lines, or leave empty to use the pre-ingested slate…"
          disabled={submitting}
        />
        {error && (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={submitRun} disabled={submitting}>
            <Play className="mr-1.5 size-4" />
            {submitting ? 'Enqueuing…' : "Run today's slate"}
          </Button>
          {showStatus && liveStatus && (
            <RunStatusBadge status={liveStatus} />
          )}
        </div>
      </div>
    </AuthActions>
  )
}
