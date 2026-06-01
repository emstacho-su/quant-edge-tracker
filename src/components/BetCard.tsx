import { useMemo } from 'react'
import type { Bet } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { USD } from '@/lib/demo-mode'
import { AuthActions } from '@/components/auth/AuthGate'

const STATUS_STYLES: Record<Bet['status'], { band: string; pill: string; label: string }> = {
  pending: {
    band: 'bg-sky-500/40',
    pill: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
    label: 'Pending',
  },
  won: {
    band: 'bg-emerald-500/50',
    pill: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
    label: 'Won',
  },
  lost: {
    band: 'bg-red-500/50',
    pill: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
    label: 'Lost',
  },
  push: {
    band: 'bg-amber-500/50',
    pill: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    label: 'Push',
  },
  void: {
    band: 'bg-zinc-500/50',
    pill: 'bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30',
    label: 'Void',
  },
}

function formatOdds(odds: number | null | undefined): string {
  if (odds == null) return '—'
  return odds > 0 ? `+${odds}` : String(odds)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface BetCardProps {
  bet: Bet
  onEdit?: (bet: Bet) => void
  onSettle?: (bet: Bet, status: 'won' | 'lost' | 'push' | 'void') => void
  className?: string
}

export function BetCard({ bet, onEdit, onSettle, className }: BetCardProps) {
  const style = STATUS_STYLES[bet.status]
  const placedLabel = useMemo(() => formatDate(bet.placed_at), [bet.placed_at])
  const isPending = bet.status === 'pending'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-border/60 bg-card/60 backdrop-blur-sm',
        className,
      )}
    >
      <div className={cn('absolute inset-y-0 left-0 w-1', style.band)} aria-hidden />

      <div className="space-y-3 p-3 pl-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium uppercase tracking-wide">{bet.sport}</span>
              {bet.bet_type === 'parlay' && (
                <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-300">
                  Parlay
                </span>
              )}
              {bet.is_freeplay && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                  FP
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-foreground">{bet.description}</p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              style.pill,
            )}
          >
            {style.label}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stake</div>
            <div className="font-semibold tabular-nums">{USD.format(bet.stake)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">To Win</div>
            <div className="font-semibold tabular-nums">{USD.format(bet.to_win)}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Odds</div>
            <div className="font-semibold tabular-nums">{formatOdds(bet.odds_american)}</div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{placedLabel}</span>
          {bet.profit_loss != null && (
            <span
              className={cn(
                'font-medium tabular-nums',
                bet.profit_loss > 0 && 'text-emerald-400',
                bet.profit_loss < 0 && 'text-red-400',
              )}
            >
              {bet.profit_loss > 0 ? '+' : ''}
              {USD.format(bet.profit_loss)}
            </span>
          )}
        </div>

        {(onEdit || (isPending && onSettle)) && (
          <AuthActions>
            <div className="flex flex-wrap gap-2 pt-1">
              {isPending && onSettle && (
                <>
                  <Button
                    size="sm"
                    className="min-h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => onSettle(bet, 'won')}
                  >
                    Won
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 flex-1 border-red-500/40 text-red-300 hover:bg-red-500/10"
                    onClick={() => onSettle(bet, 'lost')}
                  >
                    Lost
                  </Button>
                </>
              )}
              {onEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 flex-1"
                  onClick={() => onEdit(bet)}
                >
                  {isPending ? 'More' : 'Edit'}
                </Button>
              )}
            </div>
          </AuthActions>
        )}
      </div>
    </div>
  )
}
