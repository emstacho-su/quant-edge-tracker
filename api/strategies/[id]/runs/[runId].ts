import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../../../_lib/supabase-admin.js'
import { requireSession } from '../../../_lib/session.js'

/**
 * /api/strategies/[id]/runs/[runId]
 *
 *   GET    — full run row (public). Returns the entire run including output_md.
 *   DELETE — remove a QUEUED run from the queue (auth-gated). Guarded on
 *            status='queued' so a run already claimed by the daemon is never
 *            deleted out from under it (returns 409 instead).
 *   POST   — request cancel of a RUNNING run (auth-gated). Sets
 *            cancel_requested=true; the daemon polls this mid-run, kills the
 *            claude child, and transitions status → 'cancelled'. Guarded on
 *            status='running'.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = typeof req.query.id === 'string' ? req.query.id : ''
  const runId = typeof req.query.runId === 'string' ? req.query.runId : ''
  if (!id || !runId) {
    return res.status(400).json({ error: 'Missing id or runId parameter.' })
  }

  const supabase = getServiceClient()

  // ---- GET (public) -------------------------------------------------------
  if (req.method === 'GET') {
    try {
      const { data: run, error } = await supabase
        .from('strategy_runs')
        .select('*')
        .eq('id', runId)
        .eq('strategy_id', id)
        .maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      if (!run) return res.status(404).json({ error: 'Run not found.' })
      return res.status(200).json(run)
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  // ---- DELETE (auth) — remove a queued run --------------------------------
  if (req.method === 'DELETE') {
    if (!requireSession(req, res)) return // 401 already sent
    try {
      const { data, error } = await supabase
        .from('strategy_runs')
        .delete()
        .eq('id', runId)
        .eq('strategy_id', id)
        .eq('status', 'queued')
        .select('id')
      if (error) return res.status(500).json({ error: error.message })
      if (!data || data.length === 0) {
        // Either it doesn't exist or it's no longer queued (already claimed/finished).
        return res
          .status(409)
          .json({ error: 'Run is not queued — it may have already started or finished.' })
      }
      return res.status(200).json({ deleted: runId })
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  // ---- POST (auth) — request cancel of a running run ----------------------
  if (req.method === 'POST') {
    if (!requireSession(req, res)) return // 401 already sent
    try {
      const { data, error } = await supabase
        .from('strategy_runs')
        .update({ cancel_requested: true })
        .eq('id', runId)
        .eq('strategy_id', id)
        .eq('status', 'running')
        .select('id, status, cancel_requested')
      if (error) return res.status(500).json({ error: error.message })
      if (!data || data.length === 0) {
        return res
          .status(409)
          .json({ error: 'Run is not running — only an in-progress run can be cancelled.' })
      }
      return res.status(202).json({ cancel_requested: runId })
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  res.setHeader('Allow', 'GET, DELETE, POST')
  return res.status(405).json({ error: 'Method not allowed' })
}
