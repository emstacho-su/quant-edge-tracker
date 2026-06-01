/**
 * POST /api/strategies/[id]/optimizations/[optId]/approve
 *
 * Auth-gated. Transitions status from 'pending_review' to 'approved' and
 * enqueues an 'apply_optimization' pending_task for the daemon (05-05 W4.5).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../../../../_lib/supabase-admin.js'
import { requireSession } from '../../../../_lib/session.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = requireSession(req, res)
  if (!session) return // 401 already sent

  const strategyId = typeof req.query.id === 'string' ? req.query.id : ''
  const optId = typeof req.query.optId === 'string' ? req.query.optId : ''
  if (!strategyId || !optId) {
    return res.status(400).json({ error: 'Missing id or optId parameter.' })
  }

  try {
    const supabase = getServiceClient()

    // 1. Check current status for idempotency
    const { data: current, error: selErr } = await supabase
      .from('strategy_optimizations')
      .select('id, status, strategy_id')
      .eq('id', optId)
      .eq('strategy_id', strategyId)
      .maybeSingle()
    if (selErr) return res.status(500).json({ error: selErr.message })
    if (!current) return res.status(404).json({ error: 'Optimization not found.' })

    const opt = current as { id: string; status: string; strategy_id: string }

    // Idempotency: if already approved (or further), return current state
    if (opt.status !== 'pending_review') {
      return res.status(200).json({
        ok: true,
        optimization_id: optId,
        status: opt.status,
        message: `Already in status '${opt.status}' — no change made.`,
      })
    }

    // 2. Atomic CAS: only update if still 'pending_review'
    const { error: updErr, count } = await supabase
      .from('strategy_optimizations')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', optId)
      .eq('status', 'pending_review')
      .select('id', { count: 'exact', head: true })
    if (updErr) return res.status(500).json({ error: updErr.message })
    if (!count || count === 0) {
      // Race: someone else approved it
      return res.status(409).json({ error: 'Optimization status changed concurrently — please reload.' })
    }

    // 3. Enqueue pending_task for daemon
    const { data: task, error: taskErr } = await supabase
      .from('pending_tasks')
      .insert({
        kind: 'apply_optimization',
        payload: { optimization_id: optId },
      })
      .select('id')
      .single()
    if (taskErr) {
      // Roll back the status change — guard with .eq('status', 'approved') so a concurrent
      // reject that already moved the row to 'rejected' is not clobbered. WR-02 fix.
      const { error: rbErr } = await supabase
        .from('strategy_optimizations')
        .update({ status: 'pending_review', reviewed_at: null })
        .eq('id', optId)
        .eq('status', 'approved') // don't clobber a concurrent reject
      if (rbErr) {
        return res.status(500).json({
          error: `Task enqueue failed and rollback failed (${taskErr.message}; ${rbErr.message}). Optimization may be stuck in 'approved'.`,
        })
      }
      return res.status(500).json({ error: `Failed to enqueue task: ${taskErr.message}` })
    }

    const taskRow = task as { id: string }
    return res.status(200).json({
      ok: true,
      optimization_id: optId,
      pending_task_id: taskRow.id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
