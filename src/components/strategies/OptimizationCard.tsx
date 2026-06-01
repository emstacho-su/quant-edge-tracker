/**
 * OptimizationCard — renders a single strategy_optimization row (05-05 W4.4).
 *
 * Shows synthesis (rendered Markdown), diff viewer, cited runs, and
 * Approve/Reject actions (auth-gated).
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, X, Loader2, ExternalLink, AlertTriangle } from 'lucide-react'
import { AuthActions } from '@/components/auth/AuthGate'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { DiffViewer } from './DiffViewer'
import type { StrategyOptimization, StrategyOptimizationStatus } from '@/types/strategies'

// ---------------------------------------------------------------------------
// Status pill helpers
// ---------------------------------------------------------------------------

function statusVariant(
  s: StrategyOptimizationStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (s) {
    case 'pending_review': return 'outline'
    case 'approved': return 'default'
    case 'applying': return 'default'
    case 'applied': return 'default'
    case 'rejected': return 'secondary'
    case 'failed_apply': return 'destructive'
    default: return 'outline'
  }
}

function statusLabel(s: StrategyOptimizationStatus): string {
  switch (s) {
    case 'pending_review': return 'Pending review'
    case 'approved': return 'Queued for apply'
    case 'applying': return 'Applying…'
    case 'applied': return 'Applied'
    case 'rejected': return 'Rejected'
    case 'failed_apply': return 'Apply failed'
    default: return s
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OptimizationCardProps {
  optimization: StrategyOptimization
  strategyId: string
  onStatusChange?: (id: string, newStatus: StrategyOptimizationStatus) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OptimizationCard({
  optimization: opt,
  strategyId,
  onStatusChange,
}: OptimizationCardProps) {
  const [status, setStatus] = useState<StrategyOptimizationStatus>(opt.status)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectNoteOpen, setRejectNoteOpen] = useState(false)
  const [reviewerNote, setReviewerNote] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const isNoChange = opt.synthesis_md?.startsWith('NO_CHANGE_RECOMMENDED')

  // --- Approve ----------------------------------------------------------------
  async function handleApprove() {
    setApproving(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/strategies/${strategyId}/optimizations/${opt.id}/approve`, {
        method: 'POST',
        credentials: 'include',
      })
      const body = await res.json().catch(() => ({}) as Record<string, unknown>)
      if (!res.ok) {
        setActionError((body.error as string) ?? `Request failed (${res.status})`)
        return
      }
      // Adopt the server-returned status rather than hardcoding 'approved' — the server may
      // return a different terminal state (e.g. 'applied', 'rejected') on idempotent calls.
      // WR-06 fix: single status owner, no drift between card and parent statusOverrides.
      const newStatus: StrategyOptimizationStatus =
        (body.status as StrategyOptimizationStatus | undefined) ?? 'approved'
      setStatus(newStatus)
      onStatusChange?.(opt.id, newStatus)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setApproving(false)
    }
  }

  // --- Reject -----------------------------------------------------------------
  async function handleReject() {
    setRejecting(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/strategies/${strategyId}/optimizations/${opt.id}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer_note: reviewerNote || undefined }),
      })
      const body = await res.json().catch(() => ({}) as Record<string, unknown>)
      if (!res.ok) {
        setActionError((body.error as string) ?? `Request failed (${res.status})`)
        return
      }
      const newStatus: StrategyOptimizationStatus = 'rejected'
      setStatus(newStatus)
      setRejectNoteOpen(false)
      onStatusChange?.(opt.id, newStatus)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setRejecting(false)
    }
  }

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">
              Week of{' '}
              <span className="font-mono">{opt.week_start}</span>
            </span>
            <Badge variant={statusVariant(status)} className="text-[10px]">
              {status === 'approved' ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  {statusLabel(status)}
                </span>
              ) : (
                statusLabel(status)
              )}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {relativeTime(opt.created_at)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* failed_apply error banner */}
        {status === 'failed_apply' && (
          <div className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>Git apply failed — the diff may have drifted from the current SKILL.md. This optimization cannot be applied automatically.</span>
          </div>
        )}

        {/* Synthesis */}
        {opt.synthesis_md && !isNoChange && (
          <div className="prose prose-sm prose-invert max-w-none rounded border border-border/40 bg-muted/20 px-4 py-3 text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {opt.synthesis_md}
            </ReactMarkdown>
          </div>
        )}

        {/* Cited run links */}
        {opt.evidence_run_ids && opt.evidence_run_ids.length > 0 && !isNoChange && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-muted-foreground self-center">Cited runs:</span>
            {opt.evidence_run_ids.map((runId) => (
              <Link
                key={runId}
                to={`/strategies/${strategyId}/runs/${runId}`}
                className="inline-flex items-center gap-1 rounded bg-muted/50 px-2 py-0.5 text-xs font-mono hover:bg-muted transition-colors"
              >
                {runId.slice(0, 8)}
                <ExternalLink className="size-2.5" />
              </Link>
            ))}
          </div>
        )}

        {/* Diff viewer */}
        {opt.proposed_diff && !isNoChange && (
          <DiffViewer diff={opt.proposed_diff} />
        )}

        {/* Applied SHA link */}
        {status === 'applied' && opt.applied_git_sha && (
          <div className="text-xs text-muted-foreground">
            Applied at commit:{' '}
            <a
              href={`https://github.com/emstacho-su/quant-edge-skills/commit/${opt.applied_git_sha}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:underline text-foreground"
            >
              {opt.applied_git_sha.slice(0, 7)}
            </a>
          </div>
        )}

        {/* Action buttons */}
        {actionError && (
          <p className="text-xs text-destructive" role="alert">{actionError}</p>
        )}

        {status === 'pending_review' && (
          <AuthActions>
            <div className="flex items-start gap-2 flex-wrap">
              <Button size="sm" onClick={handleApprove} disabled={approving}>
                {approving ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Check className="size-3.5 mr-1.5" />}
                Approve
              </Button>

              {!rejectNoteOpen ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRejectNoteOpen(true)}
                  disabled={rejecting}
                >
                  <X className="size-3.5 mr-1.5" />
                  Reject
                </Button>
              ) : (
                <div className="flex flex-col gap-2 w-full max-w-sm">
                  <Textarea
                    placeholder="Optional: note why you're rejecting this..."
                    value={reviewerNote}
                    onChange={(e) => setReviewerNote(e.target.value)}
                    rows={3}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={handleReject} disabled={rejecting}>
                      {rejecting ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <X className="size-3.5 mr-1.5" />}
                      Confirm reject
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRejectNoteOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </AuthActions>
        )}
      </CardContent>
    </Card>
  )
}
