/**
 * ConsensusHeader — shows the Pinnacle-anchored no-vig consensus + pre-bet CLV.
 *
 * UI-SPEC:
 *   - No-vig consensus odds + probability (Pinnacle-anchored when present)
 *   - Pre-bet CLV of best available price vs consensus
 *   - CLV <= 0 → explicit "No edge at any book" banner (muted/destructive accent)
 *   - Not blank when CLV is negative — show the state explicitly (D-05)
 */

import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatPct, formatOdds, americanToDecimal } from '@/lib/clv'
import type { MarketAnalysis } from '@/lib/line-shop-types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConsensusHeaderProps {
  analysis: MarketAnalysis
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a fair probability to American odds (inverse of impliedFromAmerican). */
function fairProbToAmerican(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0
  if (prob >= 0.5) {
    return Math.round(-prob / (1 - prob) * 100)
  }
  return Math.round((1 - prob) / prob * 100)
}

/** Format a side label for display. */
function formatSide(side: string): string {
  const MAP: Record<string, string> = {
    home: 'Home', away: 'Away', over: 'Over', under: 'Under', yes: 'Yes', no: 'No',
  }
  return MAP[side] ?? side
}

// ─── ConsensusHeader ──────────────────────────────────────────────────────────

export function ConsensusHeader({ analysis }: ConsensusHeaderProps) {
  const sides = Object.keys(analysis.noVigConsensus)
  const hasConsensus = sides.some((s) => analysis.noVigConsensus[s] != null)
  const clv = analysis.preBetCLV

  // CLV state
  const hasEdge = clv != null && clv > 0
  const noEdge = clv != null && clv <= 0

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">No-Vig Consensus</h3>
          <p className="text-xs text-muted-foreground">
            Pinnacle-anchored fair line · Pre-bet CLV
          </p>
        </div>

        {/* Pre-bet CLV badge */}
        {clv != null && (
          <div className="flex items-center gap-1.5">
            {hasEdge ? (
              <TrendingUp className="size-4 text-green-500" />
            ) : noEdge ? (
              <TrendingDown className="size-4 text-red-500" />
            ) : (
              <Minus className="size-4 text-muted-foreground" />
            )}
            <Badge
              variant={hasEdge ? 'default' : 'secondary'}
              className={
                hasEdge
                  ? 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30'
                  : noEdge
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                  : ''
              }
            >
              CLV {formatPct(clv)}
            </Badge>
          </div>
        )}
      </div>

      {/* No-edge banner */}
      {noEdge && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
          <TrendingDown className="size-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-600 dark:text-red-400">
            No edge at any book — best available price does not beat the no-vig consensus.
          </p>
        </div>
      )}

      {/* Consensus table */}
      {hasConsensus && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {sides.map((side) => {
            const fairProb = analysis.noVigConsensus[side]
            const best = analysis.bestPrice[side]
            if (fairProb == null) return null

            const fairAmerican = fairProbToAmerican(fairProb)
            const fairDecimal = americanToDecimal(fairAmerican)

            return (
              <div
                key={side}
                className="rounded-md border border-border/40 bg-background/40 px-3 py-2"
              >
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {formatSide(side)}
                </div>
                <div className="mt-1 text-base font-semibold tabular-nums">
                  {formatOdds(fairAmerican)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {fairDecimal.toFixed(3)} dec · {(fairProb * 100).toFixed(1)}%
                </div>
                {best && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Best: {formatOdds(best.priceAmerican)} @ {best.book}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!hasConsensus && (
        <p className="mt-3 text-sm text-muted-foreground">
          No price data available for consensus calculation.
        </p>
      )}
    </div>
  )
}
