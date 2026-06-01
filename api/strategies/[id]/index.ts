import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../../_lib/supabase-admin.js'

/**
 * GET /api/strategies/[id] — strategy detail + recent runs (last 20). Public.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const id = typeof req.query.id === 'string' ? req.query.id : ''
  if (!id) return res.status(400).json({ error: 'Missing id parameter.' })

  try {
    const supabase = getServiceClient()
    const { data: strategy, error: sErr } = await supabase
      .from('strategies')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (sErr) return res.status(500).json({ error: sErr.message })
    if (!strategy) return res.status(404).json({ error: 'Strategy not found.' })

    const { data: recent_runs, error: rErr } = await supabase
      .from('strategy_runs')
      .select('*')
      .eq('strategy_id', id)
      .order('triggered_at', { ascending: false })
      .limit(20)
    if (rErr) return res.status(500).json({ error: rErr.message })

    return res.status(200).json({ strategy, recent_runs: recent_runs ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
