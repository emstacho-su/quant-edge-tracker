/**
 * POST /api/strategies/[id]/optimizations/[optId]/reject
 *
 * Auth-gated. Transitions status to 'rejected', optionally saving reviewer_note (05-05 W4.6).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../../../../_lib/supabase-admin.js'
import { requireSession } from '../../../../_lib/session.js'

interface RejectBody {
  reviewer_note?: string
}

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

  const body = (req.body ?? {}) as RejectBody
  const reviewer_note = typeof body.reviewer_note === 'string' ? body.reviewer_note.trim() : null

  try {
    const supabase = getServiceClient()

    const updatePayload: Record<string, unknown> = {
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
    }
    if (reviewer_note) {
      updatePayload.reviewer_note = reviewer_note
    }

    // Constrain to 'pending_review' only — prevents flipping an already-applied or
    // already-approved row to rejected. Returns null when the row exists but is in
    // a terminal state, which we surface as a 409. WR-03 fix.
    const { data, error } = await supabase
      .from('strategy_optimizations')
      .update(updatePayload)
      .eq('id', optId)
      .eq('strategy_id', strategyId)
      .eq('status', 'pending_review')
      .select('*')
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    if (!data) {
      // Distinguish "not found at all" from "found but not in a rejectable state"
      // by checking whether the row exists independently.
      const { data: exists } = await supabase
        .from('strategy_optimizations')
        .select('id')
        .eq('id', optId)
        .eq('strategy_id', strategyId)
        .maybeSingle()
      if (!exists) return res.status(404).json({ error: 'Optimization not found.' })
      return res.status(409).json({ error: 'Optimization is not pending review (already actioned?).' })
    }

    return res.status(200).json({ ok: true, optimization: data })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
