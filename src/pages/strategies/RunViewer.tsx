import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RunStatusBadge } from '@/components/strategies/RunStatusBadge'
import { AuditScoreChip } from '@/components/strategies/AuditScoreChip'
import { AuditPanel } from '@/components/strategies/AuditPanel'
import { PicksCard } from '@/components/strategies/PicksCard'
import { ParlaysCard } from '@/components/strategies/ParlaysCard'
import { PhaseHeadingsPill } from '@/components/strategies/PhaseHeadingsPill'
import { getStrategy, getRun, getRunAudit } from '@/lib/supabase-strategies'
import { useRunRealtime } from '@/hooks/useRunRealtime'
import { OutputSummarySchema } from '@/types/strategies'
import type { Strategy, StrategyRun, StrategyRunAudit } from '@/types/strategies'

function fmtDuration(
  startedAt: string | null,
  completedAt: string | null,
  status: StrategyRun['status'],
): string {
  if (!startedAt) return '—'
  const start = new Date(startedAt).getTime()
  const end = completedAt
    ? new Date(completedAt).getTime()
    : status === 'running'
      ? Date.now()
      : new Date(startedAt).getTime()
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export default function RunViewer() {
  const { id, runId } = useParams<{ id: string; runId: string }>()
  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [initialRun, setInitialRun] = useState<StrategyRun | null>(null)
  const [audit, setAudit] = useState<StrategyRunAudit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showFullReasoning, setShowFullReasoning] = useState(false)

  useEffect(() => {
    if (!id || !runId) return
    let cancelled = false
    Promise.all([getStrategy(id), getRun(runId)])
      .then(([s, r]) => {
        if (cancelled) return
        setStrategy(s)
        setInitialRun(r)
        if (!r) setError('Run not found.')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [id, runId])

  // Fetch audit row after run loads (sibling query keyed by run_id)
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    getRunAudit(runId)
      .then((a) => { if (!cancelled) setAudit(a) })
      .catch(() => { /* audit row absence is not an error */ })
    return () => { cancelled = true }
  }, [runId])

  const { run: liveRun, source } = useRunRealtime(runId ?? null, initialRun)
  const run = liveRun ?? initialRun

  // Phase pill: prefer the daemon-written current_phase (05-02). Fall back to
  // client-side parsing of output_md headings for older runs.
  const phaseLine = useMemo(() => {
    if (run?.current_phase) return run.current_phase
    if (!run?.output_md) return null
    const matches = run.output_md.match(/^###\s+Phase[^\n]+/gm)
    if (!matches || matches.length === 0) return null
    return matches[matches.length - 1].replace(/^###\s+/, '')
  }, [run])

  // Parse + validate output_summary if present
  const outputSummary = useMemo(() => {
    if (!run?.output_summary) return null
    const parsed = OutputSummarySchema.safeParse(run.output_summary)
    return parsed.success ? parsed.data : null
  }, [run])

  const hasStructuredView = outputSummary !== null
  const auditFailed = audit?.summary_md?.startsWith('AUDIT FAILED:') ?? false

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>
  }
  if (!run) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div>
        <Link
          to={strategy ? `/strategies/${strategy.id}` : '/strategies'}
          className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} mb-2 -ml-2`}
        >
          <ArrowLeft className="mr-1.5 size-4" />
          {strategy?.name ?? 'Strategies'}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-base">
            Run {run.id.slice(0, 8)}…
          </h1>
          <RunStatusBadge
            status={run.status}
            phase={run.status === 'running' ? phaseLine : null}
            elapsed={
              run.status === 'running'
                ? fmtDuration(run.started_at, run.completed_at, run.status)
                : null
            }
          />
          {/* Audit score chip in header when audit row exists */}
          {audit && run.status === 'completed' && (
            <AuditScoreChip
              score={auditFailed ? null : (audit.score ?? null)}
              variant="large"
            />
          )}
          {run.status !== 'running' && (
            <span className="text-xs text-muted-foreground">
              {fmtDuration(run.started_at, run.completed_at, run.status)}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground" title={`live source: ${source}`}>
            {source === 'realtime'
              ? 'live (realtime)'
              : source === 'polling'
                ? 'live (polling)'
                : 'static'}
          </span>
        </div>
        {/* Phase pill during streaming */}
        {run.status === 'running' && run.output_md && (
          <div className="mt-2">
            <PhaseHeadingsPill outputMd={run.output_md} />
          </div>
        )}
      </div>

      {/* ---- Run details card ---- */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Run details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Triggered at</p>
            <p>{fmtTimestamp(run.triggered_at)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Started / completed</p>
            <p>{fmtTimestamp(run.started_at)} → {fmtTimestamp(run.completed_at)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Triggered by</p>
            <p>{run.triggered_by}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Strategy version</p>
            <p className="font-mono text-xs">
              {run.strategy_version_sha ? run.strategy_version_sha.slice(0, 12) : '— (no pinned sha)'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---- Input lines ---- */}
      {run.input_lines_raw && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">Input lines</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded border border-border/40 bg-background/50 p-3 font-mono text-xs">
              {run.input_lines_raw}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* ---- Structured view (when output_summary present) ---- */}
      {hasStructuredView && outputSummary && (
        <>
          {/* Headline */}
          {outputSummary.headline && (
            <Card className="glass-card">
              <CardContent className="pt-4">
                <p className="text-sm font-medium">{outputSummary.headline}</p>
              </CardContent>
            </Card>
          )}

          {/* Picks */}
          <PicksCard
            finalCard={outputSummary.final_card}
            auditSeminars={outputSummary.audit_seminars}
          />

          {/* Parlays */}
          <ParlaysCard parlays={outputSummary.parlays} />

          {/* Pitcher notes */}
          {outputSummary.pitcher_notes.length > 0 && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base">Pitcher Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {outputSummary.pitcher_notes.map((note, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-mono text-muted-foreground mr-2">{note.game}</span>
                    <span className="font-medium">{note.starter}</span>
                    <span className="mx-2 text-muted-foreground">—</span>
                    <span>{note.verdict}</span>
                    {note.tier1_signal && (
                      <span className={`ml-2 text-xs ${note.tier1_signal === 'strong' ? 'text-emerald-400' : note.tier1_signal === 'weak' ? 'text-red-400' : 'text-muted-foreground'}`}>
                        [{note.tier1_signal}]
                      </span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Situational notes */}
          {outputSummary.situational_notes.length > 0 && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base">Situational</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {outputSummary.situational_notes.map((note, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-mono text-muted-foreground mr-2">{note.game}</span>
                    <span className="font-medium">{note.factor}</span>
                    {note.detail && <span className="text-muted-foreground ml-2">{note.detail}</span>}
                    {note.impact && <span className="ml-2 text-xs text-amber-400">{note.impact}</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Flags */}
          {outputSummary.flags.length > 0 && (
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base">Flags</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {outputSummary.flags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-amber-400 mt-0.5">▲</span>
                      {flag}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Audit panel */}
          {audit && (
            <AuditPanel
              score={auditFailed ? null : (audit.score ?? null)}
              findings={(audit.findings as Parameters<typeof AuditPanel>[0]['findings']) ?? []}
              summaryMd={audit.summary_md ?? ''}
            />
          )}

          {/* Show full reasoning toggle (W3.6) */}
          <div>
            <button
              onClick={() => setShowFullReasoning((v) => !v)}
              className="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
            >
              {showFullReasoning ? 'Hide full reasoning' : 'Show full reasoning'}
            </button>
            {showFullReasoning && run.output_md && (
              <Card className="glass-card mt-3">
                <CardContent className="pt-4">
                  <div className="prose prose-sm prose-invert max-w-none text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.output_md}</ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}

      {/* ---- Fallback raw rendering (no output_summary, or pre-05c runs) ---- */}
      {!hasStructuredView && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">
              Output {run.status === 'running' && '(streaming…)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* "Audit unavailable" badge for completed runs with no output_summary */}
            {run.status === 'completed' && !run.output_summary && (
              <div className="mb-3 flex items-center gap-2">
                <AuditScoreChip score={null} variant="large" />
                <span className="text-xs text-muted-foreground">audit unavailable for this run</span>
              </div>
            )}
            {run.error_message && (
              <div className="mb-3">
                {run.error_message.startsWith('rate_limit:') ? (
                  <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
                    <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                      Rate limit
                    </span>
                    <span className="font-mono text-xs text-destructive/80">
                      {run.error_message}
                    </span>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap rounded border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
                    {run.error_message}
                  </pre>
                )}
              </div>
            )}
            {run.output_md ? (
              <pre className="whitespace-pre-wrap rounded border border-border/40 bg-background/50 p-3 font-mono text-xs">
                {run.output_md}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                {run.status === 'queued'
                  ? 'Waiting for the daemon to claim this run…'
                  : run.status === 'running'
                    ? 'Daemon claimed — output streaming will appear shortly.'
                    : 'No output recorded.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
