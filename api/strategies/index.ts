import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../_lib/supabase-admin.js'
import { requireSession } from '../_lib/session.js'

/**
 * GET  /api/strategies        — list strategies + last-run hint (public)
 * POST /api/strategies        — create strategy, enqueue scaffold task (gated)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') return await handleList(req, res)
    if (req.method === 'POST') return await handleCreate(req, res)
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}

async function handleList(_req: VercelRequest, res: VercelResponse) {
  const supabase = getServiceClient()
  const { data: strategies, error } = await supabase
    .from('strategies')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })

  if (!strategies || strategies.length === 0) {
    return res.status(200).json([])
  }

  const ids = strategies.map((s) => s.id)
  const { data: runs, error: runsErr } = await supabase
    .from('strategy_runs')
    .select('id, strategy_id, status, completed_at, triggered_at')
    .in('strategy_id', ids)
    .order('triggered_at', { ascending: false })
  if (runsErr) return res.status(500).json({ error: runsErr.message })

  const lastRunByStrategy = new Map<string, {
    id: string; status: string; completed_at: string | null
  }>()
  for (const r of runs ?? []) {
    if (!lastRunByStrategy.has(r.strategy_id)) {
      lastRunByStrategy.set(r.strategy_id, {
        id: r.id,
        status: r.status as string,
        completed_at: r.completed_at,
      })
    }
  }

  const result = strategies.map((s) => ({
    ...s,
    last_run: lastRunByStrategy.get(s.id) ?? null,
  }))
  return res.status(200).json(result)
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const KNOWN_SPORTS = new Set(['mlb'])

async function handleCreate(req: VercelRequest, res: VercelResponse) {
  const session = requireSession(req, res)
  if (!session) return // 401 already sent

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
    slug?: unknown
    name?: unknown
    description?: unknown
    sport?: unknown
  }
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description =
    typeof body.description === 'string' ? body.description.trim() : null
  const sport = typeof body.sport === 'string' ? body.sport.trim().toLowerCase() : ''

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug — must be kebab-case (lowercase letters, digits, hyphens).' })
  }
  if (!name) {
    return res.status(400).json({ error: 'Name is required.' })
  }
  if (!sport || !KNOWN_SPORTS.has(sport)) {
    return res.status(400).json({ error: `Unsupported sport "${sport}". Known: ${[...KNOWN_SPORTS].join(', ')}.` })
  }

  const supabase = getServiceClient()

  // Uniqueness check (unique constraint on slug catches it too, but a clean
  // 409 reads better in the UI than a Postgres error message).
  const { data: existing, error: existsErr } = await supabase
    .from('strategies')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (existsErr) return res.status(500).json({ error: existsErr.message })
  if (existing) return res.status(409).json({ error: `Slug "${slug}" already exists.` })

  const { data: created, error: insertErr } = await supabase
    .from('strategies')
    .insert({
      slug,
      name,
      description,
      sport,
      status: 'draft',
      current_git_sha: null,
    })
    .select('*')
    .single()
  if (insertErr) return res.status(500).json({ error: insertErr.message })

  // Enqueue scaffold task (daemon will pick this up; mocked in slice 05-01)
  const { error: taskErr } = await supabase.from('pending_tasks').insert({
    kind: 'scaffold_strategy',
    payload: { strategy_id: created.id, slug: created.slug },
    status: 'queued',
  })
  if (taskErr) {
    // Strategy is created; surface but don't fail the request (user can
    // re-enqueue manually if needed; daemon's idempotent on slug existence)
    return res.status(201).json({
      ...created,
      _warning: `Strategy created but scaffold task enqueue failed: ${taskErr.message}`,
    })
  }

  return res.status(201).json(created)
}
