/**
 * OptimizationsTab — shows optimizer history for a strategy (05-05 W4.2).
 *
 * Public read. Approve/Reject actions are wrapped in <AuthActions>.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { OptimizationCard } from '@/components/strategies/OptimizationCard'
import { useOptimizations } from '@/hooks/use-optimizations'
import type { StrategyOptimization, StrategyOptimizationStatus } from '@/types/strategies'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNoChange(opt: StrategyOptimization): boolean {
  return (
    opt.status === 'rejected' &&
    (opt.synthesis_md?.startsWith('NO_CHANGE_RECOMMENDED') ?? false)
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface OptimizationsTabProps {
  strategy_id: string
}

export function OptimizationsTab({ strategy_id }: OptimizationsTabProps) {
  const { optimizations, loading, error, refetch } = useOptimizations(strategy_id)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Local status tracking for optimistic updates
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, StrategyOptimizationStatus>
  >({})

  function handleStatusChange(id: string, newStatus: StrategyOptimizationStatus) {
    setStatusOverrides((prev) => ({ ...prev, [id]: newStatus }))
  }

  function getEffectiveStatus(opt: StrategyOptimization): StrategyOptimizationStatus {
    return statusOverrides[opt.id] ?? opt.status
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-32 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load optimizations: {error}
        <Button variant="ghost" size="sm" className="ml-2" onClick={refetch}>
          Retry
        </Button>
      </div>
    )
  }

  if (optimizations.length === 0) {
    return (
      <Card className="glass-card">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No optimizer runs yet. The optimizer runs automatically every Sunday at 8am ET.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Most recent optimization row
  const latest = optimizations[0]
  const latestIsNoChange = isNoChange(latest)

  // Split pending vs history
  const effectivePending = optimizations.filter(
    (o) => getEffectiveStatus(o) === 'pending_review',
  )
  const history = optimizations.filter(
    (o) => getEffectiveStatus(o) !== 'pending_review',
  )

  // Counts
  const pendingCount = effectivePending.length
  const appliedCount = optimizations.filter((o) => getEffectiveStatus(o) === 'applied').length
  const rejectedCount = optimizations.filter(
    (o) =>
      getEffectiveStatus(o) === 'rejected' &&
      !isNoChange({ ...o, status: getEffectiveStatus(o) }),
  ).length

  return (
    <div className="space-y-6">
      {/* Header line */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            Last reviewed:{' '}
            <span className="text-foreground font-medium">
              {formatDate(latest.created_at)}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {latestIsNoChange ? (
            <Badge variant="secondary" className="text-[10px]">
              No change recommended last week
            </Badge>
          ) : (
            <>
              {pendingCount > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {pendingCount} pending
                </Badge>
              )}
              {appliedCount > 0 && (
                <Badge variant="default" className="text-[10px]">
                  {appliedCount} applied
                </Badge>
              )}
              {rejectedCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {rejectedCount} rejected
                </Badge>
              )}
            </>
          )}
        </div>
      </div>

      {/* Pending section */}
      {effectivePending.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-foreground">Pending review</h3>
          {effectivePending.map((opt) => (
            <OptimizationCard
              key={opt.id}
              optimization={{ ...opt, status: getEffectiveStatus(opt) }}
              strategyId={strategy_id}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {/* History section — collapsible */}
      {history.length > 0 && (
        <div className="space-y-3">
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setHistoryOpen((o) => !o)}
          >
            {historyOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            History ({history.length} entries)
          </Button>

          {historyOpen && (
            <div className="space-y-2 rounded border border-border/40 bg-muted/10 p-3">
              {history.map((opt) => {
                const eff = getEffectiveStatus(opt)
                const isNC = isNoChange({ ...opt, status: eff })
                return (
                  <div
                    key={opt.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1 border-b border-border/20 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        {opt.week_start}
                      </span>
                      <Badge
                        variant={
                          eff === 'applied'
                            ? 'default'
                            : eff === 'failed_apply'
                              ? 'destructive'
                              : 'secondary'
                        }
                        className="text-[10px]"
                      >
                        {isNC ? 'No change' : eff}
                      </Badge>
                    </div>
                    {eff === 'applied' && opt.applied_git_sha && (
                      <a
                        href={`https://github.com/emstacho-su/quant-edge-skills/commit/${opt.applied_git_sha}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {opt.applied_git_sha.slice(0, 7)}
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
