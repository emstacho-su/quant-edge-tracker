/**
 * Write actions on strategy runs. Like every write in this app, these go through
 * the auth-gated service-role API routes (the browser only holds the anon key).
 *
 *   deleteQueuedRun   → DELETE /api/strategies/:id/runs/:runId   (queued only)
 *   requestCancelRun  → POST   /api/strategies/:id/runs/:runId   (running only)
 *
 * Both throw an Error with the server's message on a non-2xx response.
 */

async function runAction(
  strategyId: string,
  runId: string,
  method: 'DELETE' | 'POST',
): Promise<void> {
  const res = await fetch(`/api/strategies/${strategyId}/runs/${runId}`, {
    method,
    credentials: 'include',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown }
    throw new Error(
      typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
    )
  }
}

/** Remove a queued run from the queue. Server guards on status='queued'. */
export function deleteQueuedRun(strategyId: string, runId: string): Promise<void> {
  return runAction(strategyId, runId, 'DELETE')
}

/** Request cancellation of a running run. Server guards on status='running'. */
export function requestCancelRun(strategyId: string, runId: string): Promise<void> {
  return runAction(strategyId, runId, 'POST')
}
