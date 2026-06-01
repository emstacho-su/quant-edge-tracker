import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../../_lib/supabase-admin.js'
import { requireSession } from '../../_lib/session.js'

/**
 * POST /api/strategies/[id]/run — enqueue a run. Auth-gated.
 *
 * Body: { input_lines_raw?: string, input_meta?: InputMeta }
 *
 * 05-02 (reconciled): the Vercel route ONLY stores the user's paste + a sport/date
 * stamp. It does NOT fetch the Odds API. The runner reads the pre-ingested daily
 * slate from `odds_snapshots` + pitcher peripherals from `fangraphs_pitchers` at
 * run time (see quant-edge-runner/src/prompt.ts) and overwrites `input_meta`
 * with the resolved provenance (paste/odds_api/books).
 *
 * Empty paste is allowed — it forces a full slate fill from odds_snapshots.
 * Allowed strategy statuses: 'active' or 'draft' (dev convenience).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const session = requireSession(req, res)
  if (!session) return // 401 already sent

  const id = typeof req.query.id === 'string' ? req.query.id : ''
  if (!id) return res.status(400).json({ error: 'Missing strategy id.' })

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
    input_lines_raw?: unknown
    input_meta?: unknown
  }
  const inputLines = typeof body.input_lines_raw === 'string' ? body.input_lines_raw : ''
  const hasPaste = inputLines.trim().length > 0

  try {
    const supabase = getServiceClient()
    const { data: strategy, error: sErr } = await supabase
      .from('strategies')
      .select('id, status, current_git_sha, sport')
      .eq('id', id)
      .maybeSingle()
    if (sErr) return res.status(500).json({ error: sErr.message })
    if (!strategy) return res.status(404).json({ error: 'Strategy not found.' })
    if (strategy.status !== 'active' && strategy.status !== 'draft') {
      return res.status(409).json({
        error: `Strategy status "${strategy.status}" does not allow runs (must be active or draft).`,
      })
    }

    // Provisional input_meta stamped at enqueue. The runner overwrites odds_api +
    // books once it resolves the pre-ingested slate at run time. We stamp the
    // sport + the ET date so the row is self-describing even before the run starts.
    const etDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const inputMeta = {
      paste: hasPaste,
      odds_api: false, // provisional — runner sets the true value from odds_snapshots
      books: [] as string[],
      sport: strategy.sport ?? 'mlb',
      slate_date: etDate,
    }

    const { data: run, error: rErr } = await supabase
      .from('strategy_runs')
      .insert({
        strategy_id: id,
        strategy_version_sha: strategy.current_git_sha,
        status: 'queued',
        triggered_by: 'user',
        input_lines_raw: inputLines,
        input_meta: inputMeta,
      })
      .select('id')
      .single()
    if (rErr) return res.status(500).json({ error: rErr.message })

    return res.status(202).json({ run_id: run.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
